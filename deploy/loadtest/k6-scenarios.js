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
// No usa el flujo real de registro para los 1.000 VUs: registrar una cuenta
// dispara la Saga de registro completa (Usuarios + Auth + correo) y consultar
// Mailhog 1.000 veces en el arranque de la prueba mediría esa saga, no las
// lecturas que SC-003/SC-005 exigen. `setup()` crea una vez un fondo de cuentas
// reales (`LOADTEST_USER_POOL`, por defecto 40) con el mismo flujo que `dev/demo`, y los
// VU lo reutilizan — igual que en la vida real muchas pestañas/dispositivos
// concurrentes pertenecen a una fracción mucho menor de cuentas.
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
import { Trend } from 'k6/metrics';

// ── Configuración (Principio X: nada hardcodeado, todo por entorno) ────────────
//
// Prefijo `LOADTEST_`, no `K6_`: k6 trata CUALQUIER variable `K6_<OPCION>` como
// un valor de sus propias opciones de CLI (`K6_VUS` equivale a `--vus`,
// `K6_DURATION` a `--duration`, etc. — no es una convención, es un mecanismo
// real del binario). Nombrar aquí `K6_VUS` parecía natural y rompía la prueba en
// silencio: k6 lo interpretaba como `options.vus`, que junto con `scenarios`
// hace que gane el modo de ejecución antiguo (una iteración por VU) y las tres
// etapas de `options.scenarios` de más abajo (`RAMP_UP`/`HOLD`/`RAMP_DOWN`) se
// ignoraban sin ningún error — la corrida terminaba en segundos en vez de
// sostener la carga el tiempo configurado. `K6_SETUP_TIMEOUT`, más abajo, SÍ usa
// el prefijo reservado a propósito: es la opción nativa de k6 para el límite de
// `setup()`, y usar su nombre real es lo correcto ahí.
const BASE_URL = __ENV.LOADTEST_BASE_URL || 'http://localhost:8080';
const MAILHOG_URL = __ENV.LOADTEST_MAILHOG_URL || 'http://localhost:8025';
const USER_POOL_SIZE = parseInt(__ENV.LOADTEST_USER_POOL || '40', 10);
const TARGET_VUS = parseInt(__ENV.LOADTEST_VUS || '1000', 10);
const RAMP_UP = __ENV.LOADTEST_RAMP_UP || '30s';
const HOLD = __ENV.LOADTEST_HOLD || '2m';
const RAMP_DOWN = __ENV.LOADTEST_RAMP_DOWN || '30s';

// El de `dev/seed`: cinco categorías, un artículo por categoría, un cuestionario
// con tres preguntas sobre el primero (peso 1/1/1, aprobar exige 70 de 100).
const QUIZ_ID = '00000000-0000-4000-8000-000000000c01';
const QUIZ_ANSWERS_PASSING = {
  '00000000-0000-4000-8000-000000000d01': 'b',
  '00000000-0000-4000-8000-000000000d02': 'b',
  '00000000-0000-4000-8000-000000000d03': 'b',
};
const REDIRECT_URI = 'http://localhost:4200/auth/callback';
const CLIENT_ID = 'fintcart-spa'; // registrado por `dev/seed`.

// Métricas con nombre propio: los dos criterios de éxito se leen directo del
// resumen sin tener que filtrar `http_req_duration` por URL a mano.
const readDuration = new Trend('fintcart_read_duration', true);
const actionDuration = new Trend('fintcart_action_duration', true);

export const options = {
  // `setup()` registra y verifica el fondo de cuentas de forma secuencial (más
  // abajo, en el comentario de `registerAndLogin`, está el porqué); con un fondo
  // grande supera el `setupTimeout` por defecto de k6 (60 s).
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
  },
};

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

// Registra, verifica el correo (sondeando Mailhog, igual que `dev/demo`) y hace
// login por PKCE. Devuelve el access token. Vive en `setup()`, así que su
// latencia no cuenta para SC-003/SC-005 — lo que miden es lo que hace un VU
// DESPUÉS de haber iniciado sesión, no el propio inicio de sesión.
function registerAndLogin(email, password) {
  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password, display_name: 'Carga T175' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (registerRes.status !== 202) {
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
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (verifyRes.status !== 200) {
    throw new Error(`verificación de ${email} devolvió ${verifyRes.status}: ${verifyRes.body}`);
  }

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
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (authorizeRes.status !== 200) {
    throw new Error(`autorización de ${email} devolvió ${authorizeRes.status}: ${authorizeRes.body}`);
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
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (tokenRes.status !== 200) {
    throw new Error(`canje de token de ${email} devolvió ${tokenRes.status}: ${tokenRes.body}`);
  }

  const accessToken = tokenRes.json('access_token');

  // Un intento de cuestionario ya aprobado por cuenta: sin esto `/me/progress` y
  // `/simulators/history` (que también se leen) empezarían vacíos para TODAS las
  // cuentas del fondo, y una lectura vacía es más barata de servir que una con
  // datos — mediría un caso mejor que el real.
  http.post(
    `${BASE_URL}/quizzes/${QUIZ_ID}/attempts`,
    JSON.stringify({ answers: QUIZ_ANSWERS_PASSING }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );
  http.post(
    `${BASE_URL}/simulators/credito/run`,
    JSON.stringify({ currency: 'COP', inputs: { monto: '20000000', tasa_anual: '0.185', meses: '36' } }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` } },
  );

  return accessToken;
}

// `setup()` corre una sola vez, fuera de los VUs y de sus métricas.
export function setup() {
  const runId = Date.now();
  const password = 'CargaT175!2026'; // ≥ 12 caracteres, política de Auth (ver `dev/demo`).
  const tokens = [];
  for (let i = 0; i < USER_POOL_SIZE; i++) {
    const email = `loadtest${runId}_${i}@fintcart.co`;
    tokens.push(registerAndLogin(email, password));
  }
  if (tokens.length === 0) {
    throw new Error('el fondo de usuarios quedó vacío; no hay con qué generar carga');
  }
  return { tokens };
}

// IP sintética estable por VU (RFC 5737 no sirve aquí: hace falta un rango grande
// y contiguo). `__VU` es 1-based y no supera los VUs configurados, así que basta
// codificarlo en los tres octetos bajos de un bloque privado.
function syntheticIp(vu) {
  return `10.${(vu >> 16) & 0xff}.${(vu >> 8) & 0xff}.${vu & 0xff}`;
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': syntheticIp(__VU),
  };

  group('lecturas (SC-003, < 1s)', () => {
    const catalog = http.get(`${BASE_URL}/catalog/articles`, { headers });
    check(catalog, { 'catálogo → 200': (r) => r.status === 200 });
    readDuration.add(catalog.timings.duration);

    const progress = http.get(`${BASE_URL}/me/progress`, { headers });
    check(progress, { 'progreso → 200': (r) => r.status === 200 });
    readDuration.add(progress.timings.duration);

    const history = http.get(`${BASE_URL}/simulators/history`, { headers });
    check(history, { 'historial → 200': (r) => r.status === 200 });
    readDuration.add(history.timings.duration);
  });

  group('acciones (SC-005, respuesta percibida < 2s)', () => {
    const compute = http.post(
      `${BASE_URL}/simulators/credito/run`,
      JSON.stringify({ currency: 'COP', inputs: { monto: '20000000', tasa_anual: '0.185', meses: '36' } }),
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    );
    check(compute, { 'simulador → 200': (r) => r.status === 200 });
    actionDuration.add(compute.timings.duration);

    const attempt = http.post(
      `${BASE_URL}/quizzes/${QUIZ_ID}/attempts`,
      JSON.stringify({ answers: QUIZ_ANSWERS_PASSING }),
      { headers: { ...headers, 'Content-Type': 'application/json' } },
    );
    check(attempt, { 'cuestionario → 201': (r) => r.status === 201 });
    actionDuration.add(attempt.timings.duration);
  });

  sleep(Math.random() * 2 + 1); // 1-3s: espaciado de "pensar" entre acciones de un usuario real.
}
