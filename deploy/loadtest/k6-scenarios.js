// deploy/loadtest/k6-scenarios.js — T175, SC-003 y SC-005.
//
// SC-003 exige lecturas de progreso/historial/catálogo < 1 s bajo carga normal;
// SC-005 exige respuesta percibida < 2 s con ≥ 1.000 usuarios concurrentes. Ambos
// criterios hablan de la plataforma DESPLEGADA (`deploy/k8s`, ≥ 2 réplicas en ruta
// crítica, HPA — ver plan.md §Structure Decision), no de `dev/up`: un `docker
// compose` con una sola réplica de cada servicio en un portátil no es el sistema
// que SC-003/SC-005 describen, y una corrida ahí solo mediría el portátil. Este
// guion es el mismo contra ambos entornos —se le apunta con `LOADTEST_BASE_URL`—; lo que
// cambia es qué corrida cuenta como verificación del criterio.
//
// ## Tres defectos que este guion tenía y que ya no tiene
//
// El guion se escribió contra una API anterior. Tal como estaba medía sus propios
// errores de programación como si fueran fallos del producto:
//
// 1. **Cuestionario sin sesión.** Llamaba a `POST /quizzes/{id}/attempts` con solo
//    `{answers}` y el borde respondía `409 session_id es obligatorio` —que entraba en
//    `http_req_failed`. El flujo real (FR-038…FR-042) es: `POST /quizzes/{id}/session`
//    devuelve una sesión con N preguntas y las opciones barajadas y SIN la clave
//    correcta; se responde sobre las preguntas servidas y se envía el `session_id`.
//    El contrato está en `contracts/proto/fintcart/learning/v1/learning.proto`
//    (`StartQuizSession`, `QuizSession`, `GradeRequest.session_id`) y en el DTO
//    `SubmitAttemptRequest` del borde (`services/api-gateway/internal/handler/types.go`).
// 2. **Calculadora inexistente.** Ejecutaba `fondo_emergencia`, que solo se alcanza por
//    `POST /calculators/{id}/run`; el camino por categoría
//    (`POST /simulators/{calcType}/run`) despacha exactamente `ahorro`, `credito` y
//    `presupuesto` (`calcTypeByPath` en `handler/mapping.go`) y respondía
//    `400 tipo de cálculo desconocido`. Se ejecutan las tres, rotando por iteración.
// 3. **Fondo de cuentas dentro de la ventana medida.** El guion se auto-provisionaba
//    `loadtest<timestamp>_<i>@fintcart.co` con registro + correo + verificación. Ahora
//    acepta una bolsa externa (`LOADTEST_ACCOUNTS_CSV`) ya creada por el camino real.
//
// No usa el flujo real de registro para los 1.000 VUs: registrar una cuenta
// dispara la Saga de registro completa (Usuarios + Auth + correo) y consultar
// Mailhog 1.000 veces en el arranque de la prueba mediría esa saga, no las
// lecturas que SC-003/SC-005 exigen. Sin `LOADTEST_ACCOUNTS_CSV`, `setup()` crea una
// vez un fondo de cuentas reales (`LOADTEST_USER_POOL`, por defecto 40) con el mismo
// flujo que `dev/demo`, y los VU lo reutilizan — igual que en la vida real muchas
// pestañas/dispositivos concurrentes pertenecen a una fracción mucho menor de cuentas.
//
// OJO: 40 cuentas para 1.000 VUs NO puede pasar los umbrales de abajo. El borde limita
// por IP **y por usuario** (600 rpm cada uno), así que 25 VUs compartiendo una cuenta
// piden ~2.250 rpm y reciben 429 —que cuentan como `http_req_failed`, porque cualquier
// respuesta que no sea 2xx lo hace—. Una corrida de 1.000 VUs con el fondo por defecto
// mediría el limitador de tasa creyendo medir la plataforma. La corrida acordada para la
// tesis es `VUS=200` con la bolsa de 200 cuentas (`/tmp/k6/pool.csv`): una cuenta por VU.
// Ver `deploy/loadtest/README.md`.
//
// Cada VU manda un `X-Forwarded-For` propio y estable (derivado de `__VU`). El
// Gateway limita por IP (`internal/ratelimit`, clave `ip:` + `X-Forwarded-For` —
// confía en la cabecera porque corre siempre detrás de un proxy, Principio X) y en
// producción 1.000 usuarios concurrentes son 1.000 IPs distintas. Sin esto, la
// prueba entera compartiría la IP del contenedor de k6 y mediría el limitador de
// tasa, no la latencia — el propósito de T175.
import crypto from 'k6/crypto';
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ── Configuración (Principio X: nada hardcodeado, todo por entorno) ────────────
//
// Prefijo `LOADTEST_`, no `K6_`: k6 trata CUALQUIER variable `K6_<OPCION>` como
// un valor de sus propias opciones de CLI (`K6_VUS` equivale a `--vus`,
// `K6_DURATION` a `--duration`, etc. — no es una convención, es un mecanismo
// real del binario). Nombrar aquí `K6_VUS` parecía natural y rompía la prueba en
// silencio: k6 lo interpretaba como `options.vus`, que junto con `scenarios`
// hace que gane el modo de ejecución antiguo (una iteración por VU) y las tres
// etapas de `options.scenarios` de más abajo (`RAMP`/`HOLD`/`DOWN`) se
// ignoraban sin ningún error — la corrida terminaba en segundos en vez de
// sostener la carga el tiempo configurado. `K6_SETUP_TIMEOUT`, más abajo, SÍ usa
// el prefijo reservado a propósito: es la opción nativa de k6 para el límite de
// `setup()`, y usar su nombre real es lo correcto ahí.
//
// El perfil de carga se fija con `VUS`, `RAMP`, `HOLD` y `DOWN` (nombres cortos: no
// colisionan con ninguna opción nativa de k6). Los antiguos `LOADTEST_VUS`,
// `LOADTEST_RAMP_UP`, `LOADTEST_HOLD` y `LOADTEST_RAMP_DOWN` se siguen leyendo como
// alias para no romper las corridas documentadas antes; el nombre corto gana.
const BASE_URL = __ENV.LOADTEST_BASE_URL || 'http://localhost:8080';
const MAILHOG_URL = __ENV.LOADTEST_MAILHOG_URL || 'http://localhost:8025';
const USER_POOL_SIZE = parseInt(__ENV.LOADTEST_USER_POOL || '40', 10);
const TARGET_VUS = parseInt(__ENV.VUS || __ENV.LOADTEST_VUS || '1000', 10);
const RAMP_UP = __ENV.RAMP || __ENV.LOADTEST_RAMP_UP || '30s';
const HOLD = __ENV.HOLD || __ENV.LOADTEST_HOLD || '2m';
const RAMP_DOWN = __ENV.DOWN || __ENV.LOADTEST_RAMP_DOWN || '30s';

// Bolsa externa de cuentas ya creadas (`email,password`, con cabecera). Vacía ⇒ se
// auto-provisiona como antes (y entonces la creación del fondo ocurre dentro de la
// ventana de la prueba, que es justo lo que esta variable evita).
//
// `open()` SOLO se puede llamar en el contexto de inicialización: k6 prohíbe la IO de
// ficheros dentro del bucle de la VU (y dentro de `setup()`), así que se lee aquí arriba,
// una vez por runtime de VU, y el resultado viaja como constante. Si la variable está
// puesta y el fichero no existe, k6 falla al inicializar: es preferible a medir con una
// bolsa vacía y descubrirlo en el informe.
const ACCOUNTS_CSV = __ENV.LOADTEST_ACCOUNTS_CSV || '';
const ACCOUNTS = ACCOUNTS_CSV ? parseAccountsCsv(open(ACCOUNTS_CSV)) : [];

// Más cuentas que VUs no aportan nada —el reparto es una cuenta por VU— y sí cuestan
// tiempo de `setup()` (un login y un calentamiento por cuenta). Se recorta a `VUS`.
const USABLE_ACCOUNTS = ACCOUNTS.slice(0, TARGET_VUS);

// El de `dev/seed`: cinco categorías, un artículo por categoría, un cuestionario
// con tres preguntas sobre el primero (peso 1/1/1, aprobar exige 70 de 100).
const QUIZ_ID = '00000000-0000-4000-8000-000000000c01';
const REDIRECT_URI = 'http://localhost:4200/auth/callback';
const CLIENT_ID = 'fintcart-spa'; // registrado por `dev/seed`.

// Las TRES calculadoras que el camino por categoría despacha de verdad
// (`calcTypeByPath` en `services/api-gateway/internal/handler/mapping.go`). Los
// nombres de entrada son los de la definición semilla correspondiente
// (`services/simulator/src/domain/seeds/generales.rs`): la ruta por `calc_type` ya no
// ejecuta código nativo, resuelve la semilla (T098/FR-043), así que un nombre inventado
// devuelve 400 «campo desconocido» en vez de ejecutar.
const CALCULATORS = [
  {
    name: 'ahorro',
    payload: {
      currency: 'COP',
      inputs: {
        deposito_inicial: '1000000',
        aporte_mensual: '500000',
        tasa_anual: '0.09',
        meses: '24',
      },
    },
  },
  {
    name: 'credito',
    payload: {
      currency: 'COP',
      inputs: { monto: '20000000', tasa_anual: '0.185', meses: '36' },
    },
  },
  {
    name: 'presupuesto',
    payload: {
      currency: 'COP',
      inputs: {
        ingreso_mensual: '5000000',
        gastos_fijos: '2000000',
        gastos_variables: '800000',
      },
    },
  },
];

// Métricas con nombre propio: los dos criterios de éxito se leen directo del
// resumen sin tener que filtrar `http_req_duration` por URL a mano.
const readDuration = new Trend('fintcart_read_duration', true);
const actionDuration = new Trend('fintcart_action_duration', true);

// Toda respuesta que no es la esperada, atribuida. `http_req_failed` cuenta CUÁNTAS
// fallaron; este contador dice CUÁLES, por `status`, `check` que la detectó, `phase`
// (`vu` = ventana medida, `setup` = preparación fuera de ella) y `path`.
//
// Existe porque un «0,21 % de fallos» sin desglose no se puede defender en un informe: la
// primera corrida de 200 VUs dejó 160 fallos anónimos que resultaron ser 160 × 429 sobre
// `POST /quizzes/{id}/session` en una ventana de 58 ms —el calentamiento de `setup()`,
// que no manda `X-Forwarded-For` y por tanto pega con la única IP del contenedor de k6
// contra el límite de 600 rpm por IP—, no un fallo del producto bajo carga. Con el
// desglose eso se ve en el resumen en vez de descubrirse buceando en el log del borde.
const unexpected = new Counter('fintcart_unexpected_responses');

// k6 solo imprime y exporta las series ETIQUETADAS de una métrica cuando llevan un umbral:
// sin esto, el resumen diría «160 fallos» otra vez y el desglose se quedaría dentro del
// objeto, invisible. Estos umbrales no afirman nada —`count>=0` es siempre cierto—; existen
// solo para materializar la serie en el informe y en `--summary-export`. Los estados de la
// lista son los que producen el borde, el proxy y k6 (0 = error de transporte); cualquier
// otro estado sigue contado en la métrica y se ve completo con `--out csv`.
const MATERIALIZED_STATUSES = [0, 400, 401, 403, 404, 409, 413, 429, 500, 502, 503, 504];

function failureBreakdownThresholds() {
  const thresholds = {};
  for (let i = 0; i < MATERIALIZED_STATUSES.length; i++) {
    thresholds[`fintcart_unexpected_responses{status:${MATERIALIZED_STATUSES[i]}}`] = ['count>=0'];
  }
  // `phase` es la distinción que evita el error más caro: sumar los fallos de `setup()` a
  // los de la carga medida, como pasó con los 160 × 429 del calentamiento.
  thresholds['fintcart_unexpected_responses{phase:vu}'] = ['count>=0'];
  thresholds['fintcart_unexpected_responses{phase:setup}'] = ['count>=0'];
  return thresholds;
}

export const options = {
  // `setup()` registra y verifica el fondo de cuentas de forma secuencial cuando no
  // hay bolsa externa (más abajo, en el comentario de `registerAndLogin`, está el
  // porqué); con un fondo grande supera el `setupTimeout` por defecto de k6 (60 s).
  // Con `LOADTEST_ACCOUNTS_CSV` solo se inicia sesión, así que sobra de largo.
  setupTimeout: __ENV.K6_SETUP_TIMEOUT || '10m',
  scenarios: {
    usuarios_concurrentes: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: TARGET_VUS },
        { duration: HOLD, target: TARGET_VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // SC-003 — lecturas de progreso/historial/catálogo < 1 s.
    fintcart_read_duration: ['p(95)<1000'],
    // SC-005 — respuesta percibida < 2 s con la carga concurrente objetivo.
    fintcart_action_duration: ['p(95)<2000'],
    // Un límite de tasa aplicado por diseño (429) no es un fallo del sistema, pero
    // un error de transporte o un 5xx sí lo es.
    http_req_failed: ['rate<0.01'],
    ...failureBreakdownThresholds(),
  },
};

// ── Bolsa de cuentas (CSV externo) ────────────────────────────────────────────

// `email,password`, con cabecera. Admite CRLF y líneas en blanco. NO admite comillas
// (RFC 4180) a propósito: un fichero de cuentas de carga con comas dentro de un campo
// es un problema que conviene que reviente aquí y no que se interprete a medias.
function parseAccountsCsv(text) {
  const accounts = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '').trim();
    if (line === '' || line.charAt(0) === '#') continue;
    const parts = line.split(',');
    if (parts.length !== 2) {
      throw new Error(`LOADTEST_ACCOUNTS_CSV, línea ${i + 1}: se esperaba "email,password"`);
    }
    const email = parts[0].trim();
    const password = parts[1].trim();
    // Cabecera: se reconoce por el nombre del primer campo, no por la posición.
    if (i === 0 && email.toLowerCase() === 'email' && password.toLowerCase() === 'password') {
      continue;
    }
    if (email === '' || password === '') {
      throw new Error(`LOADTEST_ACCOUNTS_CSV, línea ${i + 1}: email o contraseña vacíos`);
    }
    accounts.push({ email, password });
  }
  return accounts;
}

// ── Atribución de fallos ──────────────────────────────────────────────────────

// Ruta sin esquema ni host: el `path` del borde, para que el desglose se lea igual que su
// log de acceso.
function pathOf(res) {
  return String(res.url).replace(/^https?:\/\/[^/]+/, '');
}

// Una respuesta que no es la esperada, contada con su procedencia. Se llama SIEMPRE que
// `status !== esperado`, esté o no envuelta en un `check`: `http_req_failed` también
// cuenta las que no llevan `check` (las de `setup()`, por ejemplo), y si el contador no
// las contara los dos números no cuadrarían y el desglose mentiría por omisión.
function noteUnexpected(res, checkName, phase) {
  unexpected.add(1, {
    status: String(res.status),
    check: checkName,
    phase: phase,
    path: pathOf(res),
  });
}

// `check` + contador en un solo paso, con el nombre del `check` intacto — es el que el
// informe de umbrales cita desde antes.
function expect(res, expected, checkName, phase) {
  const ok = res.status === expected;
  check(res, { [checkName]: () => ok });
  if (!ok) noteUnexpected(res, checkName, phase);
  return ok;
}

// ── PKCE (igual que `dev/demo`, ver su comentario "El verificador...") ─────────
function randomToken(bytes) {
  let s = '';
  for (let i = 0; i < bytes; i++) {
    s += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  }
  return s;
}

function pkcePair() {
  const verifier = randomToken(64);
  const challenge = crypto.sha256(verifier, 'base64rawurl');
  return { verifier, challenge };
}

// El cuerpo de Mailhog viaja en quoted-printable (mismo formato que decodifica
// `dev/demo`): los saltos de línea forzados terminan en `=` y el propio `=` se
// escribe `=3D`. Hay que deshacer las dos cosas, en este orden.
//
// `res.body` es el JSON SIN decodificar: Mailhog serializa el CRLF real del
// correo como la secuencia de texto literal `\r\n` (backslash-r-backslash-n,
// escape JSON de un carácter de control, RFC 8259) y NO como los bytes CR/LF en
// crudo. Por eso el patrón busca esos cuatro caracteres literales y no
// `\r`/`\n` como clases de escape de expresión regular.
function decodeQuotedPrintable(body) {
  return body.replace(/=\\r\\n/g, '').replace(/=3D/g, '=');
}

function extractVerificationLink(mailBody) {
  const decoded = decodeQuotedPrintable(mailBody);
  const userId = (decoded.match(/user_id=([0-9a-f-]{36})/) || [])[1];
  const token = (decoded.match(/token=([A-Za-z0-9_-]{20,})/) || [])[1];
  return { userId, token };
}

// OAuth2 Authorization Code + PKCE. Sirve igual para una cuenta recién verificada y
// para una cuenta de la bolsa externa: quien ya existe está verificado, y este camino
// no toca el registro.
function login(email, password, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['X-Forwarded-For'] = ip;

  const { verifier, challenge } = pkcePair();
  const authorizeRes = http.post(
    `${BASE_URL}/oauth/authorize`,
    JSON.stringify({
      client_id: CLIENT_ID,
      email,
      password,
      redirect_uri: REDIRECT_URI,
      scopes: ['perfil', 'catalogo', 'simulador', 'progreso'],
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
    { headers },
  );
  if (!expect(authorizeRes, 200, 'setup: autorización → 200', 'setup')) {
    throw new Error(
      `autorización de ${email} devolvió ${authorizeRes.status}: ${authorizeRes.body}`,
    );
  }
  const code = authorizeRes.json('code');

  const tokenRes = http.post(
    `${BASE_URL}/oauth/token`,
    JSON.stringify({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
    { headers },
  );
  if (!expect(tokenRes, 200, 'setup: canje de token → 200', 'setup')) {
    throw new Error(`canje de token de ${email} devolvió ${tokenRes.status}: ${tokenRes.body}`);
  }
  return tokenRes.json('access_token');
}

// Registra y verifica el correo (sondeando Mailhog, igual que `dev/demo`) y hace login
// por PKCE. Devuelve el access token. Vive en `setup()`, así que su latencia no cuenta
// para SC-003/SC-005 — lo que miden es lo que hace una VU DESPUÉS de haber iniciado
// sesión, no el propio inicio de sesión. Solo se usa cuando NO hay bolsa externa.
function registerAndLogin(email, password, ip) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['X-Forwarded-For'] = ip;

  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password, display_name: 'Carga T175' }),
    { headers },
  );
  if (!expect(registerRes, 202, 'setup: registro → 202', 'setup')) {
    throw new Error(`registro de ${email} devolvió ${registerRes.status}: ${registerRes.body}`);
  }

  // La saga de registro es asíncrona; se sondea Mailhog en vez de dormir un
  // tiempo fijo, por la misma razón documentada en `dev/demo`.
  const deadline = Date.now() + 60000;
  let userId, token;
  while (Date.now() < deadline) {
    const search = http.get(
      `${MAILHOG_URL}/api/v2/search?kind=to&query=${encodeURIComponent(email)}`,
    );
    if (search.status === 200 && search.body && search.body.includes(email)) {
      ({ userId, token } = extractVerificationLink(search.body));
      if (userId && token) break;
    }
    sleep(1);
  }
  if (!userId || !token) {
    throw new Error(`no llegó el correo de verificación para ${email} en 60s`);
  }

  const verifyRes = http.post(
    `${BASE_URL}/auth/verify-email`,
    JSON.stringify({ user_id: userId, verification_token: token }),
    { headers },
  );
  if (!expect(verifyRes, 200, 'setup: verificación → 200', 'setup')) {
    throw new Error(`verificación de ${email} devolvió ${verifyRes.status}: ${verifyRes.body}`);
  }

  return login(email, password, ip);
}

// ── Flujo real del cuestionario (FR-038…FR-042) ───────────────────────────────

// Abre una sesión de intento: `POST /quizzes/{id}/session` → 201
// `{session_id, quiz_id, title, pass_threshold, expires_at, questions[]}`, donde cada
// pregunta trae sus opciones YA BARAJADAS y **sin** la clave correcta (el servidor no la
// expone: por eso este guion no puede «responder bien», solo responder).
//
// Devuelve la respuesta sin lanzar: dentro de la VU un fallo es un `check` fallido y una
// métrica, no una excepción que aborte la iteración; el que sí revienta es `warmUp`.
function startQuizSession(token, headers) {
  return http.post(`${BASE_URL}/quizzes/${QUIZ_ID}/session`, null, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    tags: { action: 'quiz_session' },
  });
}

function sessionIsWellFormed(session) {
  return !!(
    session &&
    session.session_id &&
    session.questions &&
    session.questions.length > 0 &&
    session.questions[0].options &&
    session.questions[0].options.length > 0
  );
}

// Construye `{question_id: option_key}` a partir de las preguntas SERVIDAS. Enviar la
// respuesta de una pregunta que la sesión no sirvió es 409 (`FAILED_PRECONDITION` en
// Aprendizaje), no un intento fallido: la sesión sirve un subconjunto aleatorio
// (`questions_to_serve`), así que las respuestas no pueden venir escritas a mano como
// antes. Se elige la primera opción servida de cada pregunta: el objetivo es ejercitar
// la ruta de calificación, no aprobar.
function answersFromSession(session) {
  const answers = {};
  for (let i = 0; i < session.questions.length; i++) {
    const q = session.questions[i];
    answers[q.question_id] = q.options[0].key;
  }
  return answers;
}

function submitAttempt(token, headers, session) {
  return http.post(
    `${BASE_URL}/quizzes/${QUIZ_ID}/attempts`,
    JSON.stringify({ session_id: session.session_id, answers: answersFromSession(session) }),
    {
      headers: { ...headers, 'Content-Type': 'application/json' },
      tags: { action: 'quiz_attempt' },
    },
  );
}

// Calienta una cuenta fuera de la ventana medida: un intento de cuestionario ya
// guardado y las tres calculadoras ejecutadas, para que `/me/progress` y
// `/simulators/history` no empiecen vacíos para TODAS las cuentas — una lectura vacía
// es más barata de servir que una con datos y mediría un caso mejor que el real.
//
// Además es un CANARIO: si el contrato se mueve otra vez (como pasó con `session_id` y
// con `fondo_emergencia`), esto revienta en `setup()` con el endpoint y el cuerpo del
// error, en vez de dejar que la corrida entera reporte miles de fallos que parecen del
// producto.
function warmUp(email, token, strict, ip) {
  const headers = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip };

  const sessionRes = startQuizSession(token, headers);
  const session = sessionRes.status === 201 ? sessionRes.json() : null;
  if (!expect(sessionRes, 201, 'setup: sesión de cuestionario → 201', 'setup')) {
    return fail(
      `calentamiento de ${email}: POST /quizzes/${QUIZ_ID}/session devolvió ` +
        `${sessionRes.status}: ${String(sessionRes.body).slice(0, 200)}`,
      strict,
    );
  }
  if (!sessionIsWellFormed(session)) {
    noteUnexpected(sessionRes, 'setup: sesión sin preguntas respondibles', 'setup');
    return fail(`calentamiento de ${email}: la sesión llegó sin preguntas respondibles`, strict);
  }

  const attemptRes = submitAttempt(token, headers, session);
  if (!expect(attemptRes, 201, 'setup: cuestionario → 201', 'setup')) {
    return fail(
      `calentamiento de ${email}: POST /quizzes/${QUIZ_ID}/attempts devolvió ` +
        `${attemptRes.status}: ${String(attemptRes.body).slice(0, 200)}`,
      strict,
    );
  }

  for (let i = 0; i < CALCULATORS.length; i++) {
    const calc = CALCULATORS[i];
    const res = http.post(`${BASE_URL}/simulators/${calc.name}/run`, JSON.stringify(calc.payload), {
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (!expect(res, 200, `setup: simulador ${calc.name} → 200`, 'setup')) {
      return fail(
        `calentamiento de ${email}: POST /simulators/${calc.name}/run devolvió ` +
          `${res.status}: ${String(res.body).slice(0, 200)}`,
        strict,
      );
    }
  }
}

// La PRIMERA cuenta es estricta (si el contrato se movió, se sabe aquí y no en el
// informe); las demás solo avisan, porque una cuenta suelta con problemas no debe
// tumbar una corrida de 200 VUs.
function fail(message, strict) {
  if (strict) throw new Error(message);
  console.warn(message);
}

// `setup()` corre una sola vez, fuera de los VUs y de sus métricas.
export function setup() {
  const tokens = [];

  if (USABLE_ACCOUNTS.length > 0) {
    // Bolsa externa: ya existe y ya está verificada, así que aquí solo se inicia
    // sesión. Nada de esto cuenta para SC-003/SC-005, y sobre todo nada de esto CREA
    // cuentas dentro de la corrida.
    for (let i = 0; i < USABLE_ACCOUNTS.length; i++) {
      const { email, password } = USABLE_ACCOUNTS[i];
      tokens.push(login(email, password, setupIp(i)));
    }
  } else {
    // Sin bolsa externa se mantiene el comportamiento anterior: el guion se
    // provisiona sus propias cuentas. Es cómodo para humo y estorba para medir, porque
    // el alta ocurre en la misma corrida que se reporta.
    const runId = Date.now();
    const password = 'CargaT175!2026'; // ≥ 12 caracteres, política de Auth (ver `dev/demo`).
    console.warn(
      'LOADTEST_ACCOUNTS_CSV no está definida: se auto-provisiona el fondo dentro de ' +
        'la corrida (defecto conocido). Para medir de verdad, usa una bolsa externa.',
    );
    for (let i = 0; i < USER_POOL_SIZE; i++) {
      const email = `loadtest${runId}_${i}@fintcart.co`;
      tokens.push(registerAndLogin(email, password, setupIp(i)));
    }
  }

  if (tokens.length === 0) {
    throw new Error('el fondo de usuarios quedó vacío; no hay con qué generar carga');
  }

  // El calentamiento se hace con una sola cuenta por VU potencial: se reparten las
  // cuentas que hay y basta con que cada una tenga historial.
  for (let i = 0; i < tokens.length; i++) {
    const email = USABLE_ACCOUNTS.length > 0 ? USABLE_ACCOUNTS[i].email : `cuenta #${i}`;
    warmUp(email, tokens[i], i === 0, setupIp(i));
  }

  // Provenance y perfil en la salida de la corrida: un informe de carga sin saber de dónde
  // salieron las cuentas ni con qué perfil se corrió no es reproducible.
  console.log(
    `fondo de cuentas: ${tokens.length} desde ${USABLE_ACCOUNTS.length > 0 ? `bolsa externa ${ACCOUNTS_CSV}` : 'auto-provisión interna'}; ` +
      `perfil VUS=${TARGET_VUS} RAMP=${RAMP_UP} HOLD=${HOLD} DOWN=${RAMP_DOWN}`,
  );

  return { tokens };
}

// IP sintética estable por VU (RFC 5737 no sirve aquí: hace falta un rango grande
// y contiguo). `__VU` es 1-based y no supera los VUs configurados, así que basta
// codificarlo en los tres octetos bajos de un bloque privado.
function syntheticIp(vu) {
  return `10.${(vu >> 16) & 0xff}.${(vu >> 8) & 0xff}.${vu & 0xff}`;
}

// IP sintética para el tráfico de `setup()`, en OTRO bloque (10.255.0.0/16) para que no
// colisione con las de las VUs. Sin esto, las 200 sesiones del calentamiento salen todas
// de la IP del contenedor de k6 y el límite de 600 rpm POR IP del borde las corta: eso es
// exactamente lo que produjo los 160 × 429 de la primera corrida de 200 VUs, un fallo del
// arnés contado como fallo del producto (`http_req_failed` no distingue fases).
function setupIp(i) {
  return `10.255.${(i >> 8) & 0xff}.${i & 0xff}`;
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': syntheticIp(__VU),
  };

  group('lecturas (SC-003, < 1s)', () => {
    const catalog = http.get(`${BASE_URL}/catalog/articles`, { headers });
    expect(catalog, 200, 'catálogo → 200', 'vu');
    readDuration.add(catalog.timings.duration);

    const progress = http.get(`${BASE_URL}/me/progress`, { headers });
    expect(progress, 200, 'progreso → 200', 'vu');
    readDuration.add(progress.timings.duration);

    const history = http.get(`${BASE_URL}/simulators/history`, { headers });
    expect(history, 200, 'historial → 200', 'vu');
    readDuration.add(history.timings.duration);
  });

  group('acciones (SC-005, respuesta percibida < 2s)', () => {
    // Las tres calculadoras que el camino por categoría despacha, rotando por VU e
    // iteración: así las tres rutas reciben carga dentro de una misma corrida sin que
    // cada VU tenga que ejecutar tres simulaciones por vuelta (el triple de escrituras
    // de historial y de sagas por el mismo número de acciones de usuario).
    const calc = CALCULATORS[(__VU + __ITER) % CALCULATORS.length];
    const compute = http.post(
      `${BASE_URL}/simulators/${calc.name}/run`,
      JSON.stringify(calc.payload),
      { headers: { ...headers, 'Content-Type': 'application/json' }, tags: { calc: calc.name } },
    );
    expect(compute, 200, 'simulador → 200', 'vu');
    actionDuration.add(compute.timings.duration);

    // Cuestionario por el camino real: abrir sesión y responder sobre lo servido. Son
    // dos peticiones porque el flujo las exige; se miden las dos, que es lo que el
    // usuario percibe al terminar un intento.
    const sessionRes = startQuizSession(token, headers);
    const session = sessionRes.status === 201 ? sessionRes.json() : null;
    const sessionStatusOk = expect(sessionRes, 201, 'sesión de cuestionario → 201', 'vu');
    check(sessionRes, { 'sesión trae preguntas respondibles': () => sessionIsWellFormed(session) });
    if (sessionStatusOk && !sessionIsWellFormed(session)) {
      noteUnexpected(sessionRes, 'sesión trae preguntas respondibles', 'vu');
    }
    actionDuration.add(sessionRes.timings.duration);

    // Sin sesión no se puede calificar (409 por diseño): reintentar dentro de la misma
    // iteración solo añadiría un fallo del guion al recuento.
    if (!sessionIsWellFormed(session)) return;

    const attempt = submitAttempt(token, headers, session);
    expect(attempt, 201, 'cuestionario → 201', 'vu');
    actionDuration.add(attempt.timings.duration);
  });

  sleep(Math.random() * 2 + 1); // 1-3s: espaciado de "pensar" entre acciones de un usuario real.
}
