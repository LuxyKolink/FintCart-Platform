// deploy/loadtest/k6-calculadora.js — T162, FR-047 y D-15.
//
// ## Qué comprueba, y qué NO
//
// El endpoint de ejecución de calculadoras (`POST /calculators/{id}/run`) bajo concurrencia, para
// confirmar que **el coste acotado del AST se sostiene**: FR-047 exige que la evaluación esté
// acotada, y D-15 prometió que lo estuviera «por construcción». Que los topes existan se comprueba
// en el crate (`services/simulator/tests/bounded_cost.rs`, que además mide el peor caso admisible en
// unos cientos de microsegundos); lo que NO se puede comprobar ahí es que eso siga siendo cierto
// **con decenas de peticiones a la vez**, que es lo que mide este guion.
//
// La forma de medirlo es una **comparación emparejada**: cada iteración ejecuta la definición del
// peor caso admisible (diez salidas con `pot` al exponente máximo) y, en la misma iteración, una
// definición trivial. Si el coste del AST pesara en la respuesta, la primera sería más lenta que la
// segunda; si el p95 de las dos es el mismo, lo que se está midiendo es el resto del camino —el
// borde, el Orquestador y la escritura del historial (FR-050)— y el AST no es el coste.
//
// **NO mide SC-003 ni SC-005**: esos hablan de la plataforma DESPLEGADA (`deploy/k8s`, ≥ 2 réplicas
// y HPA) y son de `k6-scenarios.js`. Aquí se ejecuta contra `dev/up` a propósito: lo que se
// persigue es el comportamiento del evaluador, no una cifra de latencia que solo valdría para el
// portátil donde se corre. El presupuesto de SC-005 (2 s de respuesta percibida) se usa como
// umbral de referencia, y el margen medido se declara en `deploy/loadtest/README.md`.
//
// ## Por qué las cuentas y las calculadoras llegan por entorno y no las crea `setup()`
//
// `k6-scenarios.js` registra su fondo de cuentas dentro de `setup()` porque mide el sistema
// completo. Aquí la pieza bajo prueba es el evaluador, y registrar cuentas exige recorrer la saga
// de registro y leer el correo de verificación en MailHog: eso alargaría la preparación y metería
// una dependencia que no tiene nada que ver con lo que se mide. Las prepara `calculadora.sh`, que
// usa `dev/token` (el flujo real: registro, verificación por correo y PKCE) y las pasa como
// variables. El guion queda entonces reducido a lo suyo: cargar y medir.
//
// ## Los dos límites de tasa, y por qué una VU es una cuenta
//
// El borde limita DOS veces (`internal/handler`: `RateLimitByIP` y `RateLimitByUser`, 600 rpm cada
// uno): una petición autenticada descuenta de la cuota de su IP **y** de la de su usuario. Medir con
// un fondo de cuentas pequeño compartido entre muchas VUs —lo que hacía `k6-scenarios.js`— choca
// con el segundo límite y devuelve 429 en masa: 30 VUs compartiendo una cuenta piden unas 2.000 rpm
// contra un tope de 600. La corrida no mediría el sistema, mediría el limitador.
//
// Así que aquí **cada VU tiene su propia cuenta** y el ritmo es humano (`sleep(1)`): dos peticiones
// por segundo y usuario quedan dentro de la cuota, y la concurrencia que se busca es la del
// SISTEMA, que sale de sumar usuarios. El `X-Forwarded-For` sintético —uno por VU, como en
// `k6-scenarios.js`— hace lo propio con el límite por IP, que si no contaría 30 VUs como una sola
// IP y también daría 429.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// ── Configuración (Principio X: todo por entorno) ──────────────────────────────
const BASE_URL = __ENV.LOADTEST_BASE_URL || 'http://localhost:8080';
const PEOR = __ENV.LOADTEST_CALCULATOR_ID || '';
const BARATO = __ENV.LOADTEST_CHEAP_CALCULATOR_ID || '';
const TOKENS = (__ENV.LOADTEST_TOKENS || __ENV.LOADTEST_TOKEN || '')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0);

// El CUERPO de la petición, que es `{inputs: {…}}` y no el mapa de entradas pelado: el borde
// decodifica con campos desconocidos prohibidos, así que `{"base":"0.05"}` responde 400
// `unknown field "base"`. Costó un `curl` averiguarlo —la primera corrida dio 100 % de fallos a
// 2 ms, que es un número demasiado bonito para ser real— y por eso el diagnóstico de más abajo
// imprime el cuerpo del primer fallo: un fallo de carga tiene que explicarse solo.
const INPUTS = __ENV.LOADTEST_INPUTS || '{"inputs":{"base":"0.05"}}';

const TARGET_VUS = parseInt(__ENV.LOADTEST_VUS || '30', 10);
const RAMP_UP = __ENV.LOADTEST_RAMP_UP || '15s';
const HOLD = __ENV.LOADTEST_HOLD || '1m';
const RAMP_DOWN = __ENV.LOADTEST_RAMP_DOWN || '15s';

if (PEOR === '' || TOKENS.length === 0) {
  throw new Error(
    'faltan variables: LOADTEST_CALCULATOR_ID y LOADTEST_TOKENS son obligatorias. ' +
      'Se preparan con `deploy/loadtest/calculadora.sh`, que imprime la orden exacta.',
  );
}

const runDuration = new Trend('fintcart_run_duration', true);
const peorDuration = new Trend('fintcart_run_peor_caso', true);
const baratoDuration = new Trend('fintcart_run_trivial', true);

export const options = {
  scenarios: {
    ejecuciones_concurrentes: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP_UP, target: TARGET_VUS },
        { duration: HOLD, target: TARGET_VUS },
        { duration: RAMP_DOWN, target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // El presupuesto de SC-005 (2 s de respuesta percibida) como referencia. Si el peor caso
    // admisible se acercara a esto, el coste habría dejado de estar acotado.
    fintcart_run_peor_caso: ['p(95)<2000'],
    fintcart_run_trivial: ['p(95)<2000'],
    // Un 429 del limitador de tasa es una decisión del sistema, no un fallo; un 5xx sí.
    http_req_failed: ['rate<0.01'],
  },
};

function syntheticIp(vu) {
  return `10.${(vu >> 16) & 0xff}.${(vu >> 8) & 0xff}.${vu & 0xff}`;
}

function ejecutar(id, headers, etiqueta) {
  const res = http.post(`${BASE_URL}/calculators/${id}/run`, INPUTS, {
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

  // El primer fallo de la primera VU se imprime entero. Sin esto, «✗ peor caso admisible → 200,
  // ✓ 0 / ✗ 4530» no dice si fue un 400 del cuerpo, un 401 de un token caducado o un 429 —y las
  // tres cosas se arreglan en sitios distintos—. Se imprime una vez para no inundar la salida.
  if (res.status !== 200 && __VU === 1 && __ITER === 0) {
    console.error(
      `primer fallo (${etiqueta} → ${res.status}): ${res.body}`,
    );
  }
  return res;
}

export default function () {
  const token = TOKENS[__VU % TOKENS.length];
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Forwarded-For': syntheticIp(__VU),
  };

  const peor = ejecutar(PEOR, headers, 'peor caso admisible');
  check(peor, {
    'peor caso admisible → 200': (r) => r.status === 200,
  });
  peorDuration.add(peor.timings.duration);
  runDuration.add(peor.timings.duration);

  if (BARATO !== '') {
    const barato = ejecutar(BARATO, headers, 'caso trivial');
    check(barato, {
      'caso trivial → 200': (r) => r.status === 200,
    });
    baratoDuration.add(barato.timings.duration);
    runDuration.add(barato.timings.duration);

    // La comprobación emparejada: en la MISMA iteración, el peor caso admisible no puede tardar
    // mucho más que uno trivial. Comparar dos p95 medidas en momentos distintos diría menos: la
    // máquina cambia de carga entre una y otra.
    //
    // La holgura es de UN SEGUNDO, y el número importa: medido, la diferencia real es de decenas
    // de milisegundos (el AST del peor caso son ~0,3 ms de CPU y el resto es contención del host),
    // así que con 250 ms de holgura esta comprobación fallaba 6 veces de 2.994 en una corrida a 60
    // VUs —no por la fórmula, sino por un hipo del host que llega a 390 ms—. Una comprobación que
    // se dispara con el ruido de la máquina acaba desactivada, que es la forma habitual de perder
    // una garantía. Con un segundo sigue distinguiendo lo que tiene que distinguir: una definición
    // que dejara de estar acotada añadiría SEGUNDOS, no cientos de milisegundos.
    check(peor.timings.duration, {
      'el peor caso admisible no se despega del trivial': (d) =>
        d < barato.timings.duration + 1000,
    });
  }

  // El ritmo no es decorativo: con el límite de 600 rpm por usuario, dos peticiones por segundo
  // dejan margen (120 rpm) y a la vez sostienen la carga. Acortarlo no mediría más sistema, mediría
  // más 429.
  sleep(1);
}
