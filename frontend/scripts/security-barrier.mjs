#!/usr/bin/env node
/**
 * security-barrier.mjs — la barrera de FR-068, en el frontend (tarea T157).
 *
 * POR QUÉ EXISTE
 * El vocabulario cerrado del documento de bloques (research D-14) hace que el cuerpo de un
 * artículo se renderice **por componente**, así que no hay ninguna superficie de inyección
 * que sanear: lo que no está en el `@switch` no se dibuja. Eso es cierto hoy y deja de serlo
 * el día que alguien escriba `[innerHTML]` «solo para esta vista» — el mismo día en que la
 * garantía desaparece sin que ninguna prueba se ponga roja, porque el artículo se seguiría
 * viendo bien.
 *
 * El quickstart §6 pide comprobarlo con un `grep`. Un `grep` que se ejecuta a mano de vez en
 * cuando no es una barrera: es una intención. Esto lo ejecuta `npm run lint`, así que la
 * comprobación corre en cada lint local y en CI, y en el mismo sitio donde ya corre el resto.
 *
 * QUÉ PROHÍBE, y por qué cada uno
 *   - `innerHTML` / `outerHTML` / `insertAdjacentHTML`: interpretan marcado. Es LA puerta.
 *   - `bypassSecurityTrust*`: le dice a Angular que deje de sanear, que es exactamente lo que
 *     el vocabulario cerrado existe para no necesitar. Cualquiera de sus variantes.
 *   - `DomSanitizer`: no es peligroso por sí solo, pero solo se inyecta para lo anterior. Si
 *     aparece, conviene que sea una decisión consciente y no un import que se coló.
 *   - `[innerHTML]` en plantillas: la misma puerta, desde el otro lado.
 *
 * ALCANCE
 * `src/app/**` completo y no solo `features/learning`: la barrera vale para lo que se
 * escriba mañana en cualquier pantalla, y acotarla a un directorio la dejaría caducada en
 * cuanto el editor (T131) cree su propia carpeta. Las excepciones, si algún día hacen falta,
 * se escriben aquí una a una y con su motivo.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = new URL('..', import.meta.url).pathname;
const OBJETIVO = join(RAIZ, 'src', 'app');

/** Cada patrón con el motivo por el que está prohibido, para que el error enseñe algo. */
const PROHIBIDOS = [
  {
    nombre: 'innerHTML',
    // Sin `\b` delante de `[`: entre un espacio y un corchete NO hay límite de palabra
    // —los dos son caracteres no-palabra—, así que `\b\[innerHTML\]` no coincidía nunca.
    // Lo encontró la autocomprobación de abajo, no una lectura: el caso más importante de
    // esta barrera era justo el que no funcionaba.
    patron: /\.innerHTML\b|\[innerHTML\]/u,
    motivo:
      'interpreta marcado. El cuerpo del artículo se renderiza por componente (FR-068): usa el componente del bloque, no una cadena de HTML.',
  },
  {
    nombre: 'outerHTML',
    patron: /\.outerHTML\b|\[outerHTML\]/u,
    motivo: 'interpreta marcado, igual que `innerHTML`.',
  },
  {
    nombre: 'insertAdjacentHTML',
    patron: /\.insertAdjacentHTML\s*\(/u,
    motivo: 'interpreta marcado en una posición del DOM.',
  },
  {
    nombre: 'bypassSecurityTrust*',
    patron: /bypassSecurityTrust[A-Za-z]*/u,
    motivo:
      'desactiva el saneado de Angular. El vocabulario cerrado existe para no necesitarlo: si hace falta, el problema está en el vocabulario, no en el saneador.',
  },
  {
    nombre: 'DomSanitizer',
    patron: /\bDomSanitizer\b/u,
    motivo:
      'solo se inyecta para llamar a `bypassSecurityTrust*`. Si de verdad hace falta, escríbelo aquí con su motivo.',
  },
];

/** Archivos que se revisan: plantillas y TypeScript de la aplicación. */
function archivos(dir) {
  const encontrados = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      encontrados.push(...archivos(ruta));
    } else if (/\.(html|ts)$/u.test(entrada) && !entrada.endsWith('.spec.ts')) {
      encontrados.push(ruta);
    }
  }
  return encontrados;
}

/**
 * Quita los comentarios dejando las líneas intactas.
 *
 * No es un adorno: la cabecera del componente de bloques explica, en un comentario, que no
 * se usa `bypassSecurityTrust*` — y la primera versión de esta barrera lo denunció a él. Una
 * barrera que castiga documentar la decisión se acaba desactivando, así que hay que
 * distinguir código de comentario de verdad.
 *
 * Se recorre carácter a carácter y no con expresiones regulares por línea porque las dos
 * trampas están dentro de las cadenas: `'https://ejemplo'` no empieza un comentario, y
 * `` `<div [innerHTML]="x">` `` sí tiene que encontrarse aunque venga después de unas
 * barras. Cada carácter de comentario se sustituye por un espacio para que los números de
 * línea y las columnas sigan siendo los del archivo.
 */
function sinComentarios(codigo) {
  const salida = codigo.split('');
  let estado = 'codigo';
  for (let i = 0; i < codigo.length; i += 1) {
    const actual = codigo[i];
    const siguiente = codigo[i + 1];

    if (estado === 'codigo') {
      if (actual === '/' && siguiente === '/') estado = 'linea';
      else if (actual === '/' && siguiente === '*') estado = 'bloque';
      else if (actual === '<' && codigo.startsWith('<!--', i)) estado = 'plantilla';
      else if (actual === "'" || actual === '"' || actual === '`') estado = actual;
      continue;
    }

    if (estado === 'linea') {
      if (actual === '\n') estado = 'codigo';
      else salida[i] = ' ';
      continue;
    }

    if (estado === 'bloque') {
      if (actual === '*' && siguiente === '/') {
        salida[i] = ' ';
        salida[i + 1] = ' ';
        i += 1;
        estado = 'codigo';
      } else if (actual !== '\n') {
        salida[i] = ' ';
      }
      continue;
    }

    if (estado === 'plantilla') {
      if (codigo.startsWith('-->', i)) {
        salida[i] = salida[i + 1] = salida[i + 2] = ' ';
        i += 2;
        estado = 'codigo';
      } else if (actual !== '\n') {
        salida[i] = ' ';
      }
      continue;
    }

    // Dentro de una cadena: se respeta su contenido y se cierra al encontrar su comilla.
    // El escape evita confundir `'\''` con el final.
    if (actual === '\\') {
      i += 1;
      continue;
    }
    if (actual === estado) {
      estado = 'codigo';
    }
  }
  return salida.join('');
}

/**
 * Autocomprobación: la barrera se prueba a sí misma antes de juzgar el código.
 *
 * Existe porque una barrera puede dejar de funcionar **en silencio** y seguir diciendo «0
 * usos prohibidos», que es peor que no tenerla: da una garantía falsa. La primera versión de
 * este archivo tenía exactamente ese defecto —`\b\[innerHTML\]` no coincide nunca con
 * `[innerHTML]`—, y lo delató esta lista. Se ejecuta en cada `npm run lint` porque cuesta
 * menos que leerla.
 */
function autocomprobacion() {
  const casos = [
    ['<div [innerHTML]="x"></div>', true],
    ['x.innerHTML = y;', true],
    ['el.innerHTML = 1;', true],
    ['nodo.outerHTML = html;', true],
    ['caja.insertAdjacentHTML("beforeend", html);', true],
    ['this.sanitizer.bypassSecurityTrustHtml(h);', true],
    ['constructor(private readonly sanitizer: DomSanitizer) {}', true],
    ['// aquí NO se usa innerHTML ni bypassSecurityTrust', false],
    ['/* tampoco [innerHTML] */', false],
    ['<!-- y en plantilla, [innerHTML] tampoco -->', false],
    ['const url = "https://ejemplo";', false],
    ['const claro = "sin trampas";', false],
    ['el.textContent = "<b>texto</b>";', false],
  ];

  // `detectar` devuelve el NOMBRE de la regla o `null`, así que se compara contra la
  // presencia de hallazgo y no contra el nombre: compararlo con el booleano hacía que la
  // autocomprobación se quejara de todos los casos, incluidos los correctos. Un verificador
  // roto en el lado del «sí que funciona» es tan malo como uno roto en el otro: manda a
  // buscar un problema donde no está.
  const fallos = casos
    .filter(([codigo, esperado]) => (detectar(codigo) !== null) !== esperado)
    .map(([codigo, esperado]) => `«${codigo}» debería ${esperado ? '' : 'NO '}denunciarse`);

  if (fallos.length > 0) {
    console.error('la barrera de FR-068 no funciona:\n');
    for (const fallo of fallos) {
      console.error(`  ${fallo}`);
    }
    process.exit(2);
  }
}

/** Aplica las reglas a un fragmento ya sin comentarios. Devuelve el nombre de la regla o `null`. */
function detectar(fragmento) {
  const codigo = sinComentarios(fragmento);
  return PROHIBIDOS.find((regla) => regla.patron.test(codigo))?.nombre ?? null;
}

const hallazgos = [];
for (const archivo of archivos(OBJETIVO)) {
  const original = readFileSync(archivo, 'utf8');
  const lineas = original.split('\n');
  const codigo = sinComentarios(original).split('\n');
  codigo.forEach((linea, indice) => {
    for (const regla of PROHIBIDOS) {
      if (regla.patron.test(linea)) {
        hallazgos.push({
          archivo: relative(RAIZ, archivo),
          linea: indice + 1,
          fragmento: (lineas[indice] ?? '').trim().slice(0, 120),
          regla,
        });
        break;
      }
    }
  });
}

autocomprobacion();

if (hallazgos.length > 0) {
  console.error('barrera de FR-068: contenido no confiable renderizado como marcado\n');
  for (const h of hallazgos) {
    console.error(`  ${h.archivo}:${h.linea}`);
    console.error(`    ${h.fragmento}`);
    console.error(`    → ${h.regla.nombre}: ${h.regla.motivo}\n`);
  }
  process.exit(1);
}

console.log(
  `barrera de FR-068: 0 usos prohibidos en ${archivos(OBJETIVO).length} archivos de src/app`,
);
