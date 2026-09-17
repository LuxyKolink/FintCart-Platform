#!/usr/bin/env node
// Barrera del catálogo de eventos: todo lo que un servicio PUBLICA tiene que estar
// enlazado a una cola.
//
// Por qué existe (hallazgo 20 de 002): `category.deactivated` se publicaba desde
// Aprendizaje desde T056 y **nadie lo recibía**. El Orquestador declara el exchange,
// las colas y los bindings, y no tenía binding para ese nombre. Un exchange `topic`
// con una routing key sin binding no da error: descarta el mensaje. Así que el
// trabajo de Aprendizaje se cobraba, la promesa de FR-035 («auditar la desactivación
// de una categoría») se quedaba sin cumplir, y no había ni un log que lo dijera.
//
// Lo que había en su lugar era una prueba en Go con la lista de eventos escrita a
// mano (`allCatalogEvents`) que decía, en su propio comentario, que había que
// ampliarla al añadir un evento. Una barrera que depende de que alguien se acuerde
// de ampliarla no es una barrera: es una nota. Esta lee los productores.
//
// Comprueba cuatro cosas, y las cuatro son la misma idea vista desde lados distintos:
//   1. Todo nombre de evento asignado a una constante `*event*` en un servicio, se
//      use o no, está declarado en `topology.go` y enlazado a alguna cola.
//   2. Toda constante `Event*` de `topology.go` está enlazada (declararla y no
//      enlazarla es la forma exacta de este defecto).
//   3. El catálogo `contracts/events/events-catalog.md` y los bindings coinciden en
//      los dos sentidos: nada enlazado que no esté documentado, nada documentado que
//      no esté enlazado.
//   4. Cada binding apunta a una de las dos colas permitidas (Principio V).
//
// Uso:  node scripts/events-barrier.mjs
//       node scripts/events-barrier.mjs --verbose

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const VERBOSE = process.argv.includes('--verbose');

const TOPOLOGIA = 'services/orchestrator/internal/events/topology.go';
const CATALOGO = 'contracts/events/events-catalog.md';

/**
 * Un nombre de evento es un literal con esta forma. Se exige el punto: `user.activity`
 * sí, `simulation` no. Así una constante de configuración con nombre `event*` no
 * entra por accidente.
 */
const FORMA_DE_EVENTO = /^[a-z][a-z0-9]*\.[a-z][a-z0-9_]*$/;

/** Identificador que puede nombrar un evento, en cualquier convención. */
const PARECE_IDENTIFICADOR_DE_EVENTO = /event/i;

/**
 * Archivos que NO son productores: pruebas (pueden nombrar eventos de cualquier manera
 * para probar el enrutado), stubs generados (los escribe `contracts/generate.sh`) y
 * dependencias.
 */
const SE_IGNORA = [
  /_test\.go$/,
  /\.spec\.ts$/,
  /\.test\.ts$/,
  /node_modules\//,
  /\/dist\//,
  /\/src\/pb\//,
  /\/gen\//,
  /\.d\.ts$/,
];

function esFuenteDeProduccion(ruta) {
  return (
    (ruta.endsWith('.go') || ruta.endsWith('.ts')) && !SE_IGNORA.some((p) => p.test(ruta))
  );
}

/** Recorre un directorio y devuelve las rutas de archivo que pasan el filtro. */
function recorrer(dir, encontrados = []) {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return encontrados;
  }
  for (const entrada of entradas) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      recorrer(ruta, encontrados);
    } else if (esFuenteDeProduccion(ruta)) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

/**
 * Nombres de evento que un servicio **publica**: toda asignación a un identificador
 * que contenga «event», en cualquier convención (`EventUserRegistered`,
 * `EVENT_CATEGORY_DEACTIVATED`, `eventType`). Se admiten comillas simples y dobles.
 */
function eventosPublicadosEnLaFuente() {
  const producidos = new Map(); // nombre → ["ruta:línea", …]
  for (const archivo of recorrer(join(RAIZ, 'services'))) {
    const relativa = relative(RAIZ, archivo);
    // `topology.go` se lee aparte: ahí declarar y enlazar son dos actos distintos y
    // la barrera tiene que verlos por separado para poder acusar al que falte.
    if (relativa === TOPOLOGIA) continue;
    const lineas = readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      const m = linea.match(
        /(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(['"])([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)\2/,
      );
      if (!m) return;
      const [, identificador, , valor] = m;
      if (!PARECE_IDENTIFICADOR_DE_EVENTO.test(identificador)) return;
      if (!FORMA_DE_EVENTO.test(valor)) return;
      const sitios = producidos.get(valor) ?? [];
      sitios.push(`${relativa}:${i + 1}`);
      producidos.set(valor, sitios);
    });
  }
  return producidos;
}

/** Lee `topology.go`: las constantes `Event*` y los nombres de los dos arrays de bindings. */
function leerTopologia() {
  const texto = readFileSync(join(RAIZ, TOPOLOGIA), 'utf8');

  const declarados = new Map();
  for (const m of texto.matchAll(/^\s*(Event[A-Za-z0-9_]*)\s*=\s*"([^"]+)"/gm)) {
    declarados.set(m[1], m[2]);
  }

  const bindings = new Map(); // nombre → ['notification.q', …]
  for (const m of texto.matchAll(
    /Bindings(Notification|Audit)\s*=\s*\[\]string\{([^}]*)\}/gs,
  )) {
    const cola = m[1] === 'Notification' ? 'notification.q' : 'audit.q';
    for (const cuerpo of m[2].matchAll(/\b(Event[A-Za-z0-9_]*)\b/g)) {
      const sitios = bindings.get(cuerpo[1]) ?? [];
      sitios.push(cola);
      bindings.set(cuerpo[1], sitios);
    }
  }

  return { declarados, bindings };
}

/** Nombres de evento documentados en el catálogo (columna «Evento» de las tablas). */
function leerCatalogo() {
  const texto = readFileSync(join(RAIZ, CATALOGO), 'utf8');
  const eventos = new Set();
  for (const m of texto.matchAll(/^\|\s*`([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)`/gm)) {
    eventos.add(m[1]);
  }
  return eventos;
}

// ── comprobaciones ───────────────────────────────────────────────────────────

const fallos = [];
const producidos = eventosPublicadosEnLaFuente();
const { declarados, bindings } = leerTopologia();
const catalogo = leerCatalogo();

const declarado = (nombre) => [...declarados.values()].includes(nombre);
const enlazado = (nombre) => [...bindings.values()].flat().length > 0 && (() => {
  const constante = [...declarados.entries()].find(([, v]) => v === nombre)?.[0];
  return constante ? bindings.has(constante) : false;
})();

// 1. Todo lo que un servicio publica está declarado y enlazado.
for (const [nombre, sitios] of producidos) {
  if (!declarado(nombre)) {
    fallos.push(
      `«${nombre}» se publica en ${sitios.join(', ')} pero NO está declarado en ${TOPOLOGIA}: ` +
        `el Orquestador no sabe que existe y no lo enlaza a ninguna cola.`,
    );
  } else if (!enlazado(nombre)) {
    fallos.push(
      `«${nombre}» se publica en ${sitios.join(', ')} y está declarado, pero NO está en ` +
        `BindingsNotification ni en BindingsAudit: el exchange lo descarta en silencio.`,
    );
  } else if (VERBOSE) {
    console.log(`  ok  ${nombre} ← ${sitios.join(', ')}`);
  }
}

// 2. Toda constante declarada está enlazada. Declarar y no enlazar es el defecto.
for (const [constante, valor] of declarados) {
  if (!bindings.has(constante)) {
    fallos.push(
      `${TOPOLOGIA} declara ${constante} = "${valor}" pero no la incluye en ningún binding.`,
    );
  }
}

// 3. Catálogo y bindings, en los dos sentidos.
const nombresEnlazados = new Set(
  [...bindings.keys()].map((c) => declarados.get(c)).filter(Boolean),
);
for (const nombre of nombresEnlazados) {
  if (!catalogo.has(nombre)) {
    fallos.push(`«${nombre}» está enlazado pero no aparece en ${CATALOGO}.`);
  }
}
for (const nombre of catalogo) {
  if (!nombresEnlazados.has(nombre)) {
    fallos.push(
      `«${nombre}» está en ${CATALOGO} pero no está enlazado a ninguna cola: ` +
        `documentado y sin recepción es una promesa, no un evento.`,
    );
  }
}

// 4. Solo las dos colas permitidas (Principio V).
for (const [constante, colas] of bindings) {
  for (const cola of colas) {
    if (!['notification.q', 'audit.q'].includes(cola)) {
      fallos.push(`${constante} apunta a «${cola}», que no es una de las dos colas permitidas.`);
    }
  }
}

if (fallos.length > 0) {
  console.error(`Barrera de eventos: ${fallos.length} problema(s).\n`);
  for (const fallo of fallos) console.error(`  ✗ ${fallo}`);
  console.error(
    '\nUn evento publicado sin binding desaparece sin error. Si el evento es nuevo, ' +
      `decláralo y enlázalo en ${TOPOLOGIA} y documéntalo en ${CATALOGO}.`,
  );
  process.exit(1);
}

console.log(
  `barrera de eventos: ${producidos.size} eventos publicados, ${declarados.size} declarados, ` +
    `${catalogo.size} documentados — todos enlazados`,
);
