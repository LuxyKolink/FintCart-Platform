#!/usr/bin/env node
/**
 * design-debt.mjs — mide la deuda de estilo del frontend (research D-26, tarea T008).
 *
 * POR QUÉ EXISTE
 * El avance del feature 003 se mide por lo que DESAPARECE, no por lo que se escribe
 * (nota N-12): una capa artesanal retirada, 94 estilos en línea eliminados y las
 * plantillas dejando de depender de clases globales. Sin una medición reproducible,
 * "ya casi está" no es verificable y el criterio de terminación se vuelve opinión.
 *
 * QUÉ CUENTA
 *   1. Estilos en línea (`style="…"`) en las plantillas de `src/app/features`.
 *   2. Líneas de `src/styles.scss` — 0 cuando el archivo se elimina.
 *   3. Plantillas de pantalla que aún referencian clases artesanales.
 *   4. Referencias totales a esas clases, con desglose por clase.
 *
 * CLASES ARTESANALES vs PRIMITIVAS DE PORTAL
 * Solo cuentan las que define `styles.scss` (`fc-btn`, `fc-input`, `fc-select`,
 * `fc-field`, `fc-label`, `fc-help`, `fc-error-text`, `fc-banner` y sus variantes).
 * `fc-module`, `fc-num`, `fc-eyebrow` y `fc-linklist` viven en `tokens/base.css`
 * y SOBREVIVEN (research D-29): contarlas daría un objetivo imposible.
 *
 * CLASES vs SELECTORES DE COMPONENTE
 * `fc-input` es a la vez una clase artesanal y el tag `<fc-input …>` del design
 * system. Contar el tag daría un falso positivo que nunca baja a cero, así que el
 * emparejamiento ignora lo que viene tras `<` o `</`.
 *
 * ALCANCE
 * `src/app/features/admin/**` pertenece al feature 002, no a este. Se reporta
 * aparte porque, aun así, bloquea la eliminación de `styles.scss`: si una pantalla
 * admin sigue usando `fc-btn`, borrar la hoja la deja sin estilo. El script lo
 * muestra en vez de esconderlo en un total.
 *
 * USO
 *   node scripts/design-debt.mjs            # informe legible
 *   node scripts/design-debt.mjs --json     # salida máquina
 *   node scripts/design-debt.mjs --check    # falla (exit 1) si no se cumplió el criterio
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FEATURES_DIR = join(FRONTEND_ROOT, 'src', 'app', 'features');
const STYLES_SCSS = join(FRONTEND_ROOT, 'src', 'styles.scss');

const ARTISANAL_CLASS_NAMES = [
  'fc-btn',
  'fc-input',
  'fc-select',
  'fc-field',
  'fc-label',
  'fc-help',
  'fc-error-text',
  'fc-banner',
];

const ARTISANAL_CLASS_RE = /(?<![</])\bfc-(?:btn|input|select|field|label|help|error-text|banner)\b/g;
const INLINE_STYLE_RE = /(?:^|\s)style="/g;

/** Nivel superior cuyo dueño es el feature 002, fuera del alcance de este feature. */
const OUT_OF_SCOPE_TOP_LEVEL = 'admin';

/**
 * Línea base registrada al arrancar el feature (T008). Sirve para medir el avance
 * como diferencia, no para bloquear: el único umbral duro es `--check`.
 */
const BASELINE = {
  inlineStyles: 94,
  stylesScssLines: 116,
  artisanalScreens: 19,
};

function walkHtmlFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      files.push(...walkHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Quita los comentarios HTML antes de medir.
 *
 * POR QUÉ: un comentario que EXPLICA por qué se retiró una clase artesanal no es una clase en
 * uso, y contarlo convierte la explicación en deuda — con lo que la forma de bajar la cifra
 * pasa a ser borrar la explicación. Es el mismo falso positivo que ya tuvo la barrera de
 * seguridad (`security-barrier.mjs`) con los comentarios que justifican no usar
 * `bypassSecurityTrust*`: la herramienta tiene que medir el código, no lo que se dice de él.
 */
function sinComentarios(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function countMatches(text, pattern) {
  const matches = text.match(new RegExp(pattern.source, 'g'));
  return matches ? matches.length : 0;
}

function logicalLineCount(text) {
  if (text.length === 0) {
    return 0;
  }
  return text.replace(/\n$/, '').split('\n').length;
}

function collectMetrics() {
  const htmlFiles = walkHtmlFiles(FEATURES_DIR).sort();
  const byClass = Object.fromEntries(ARTISANAL_CLASS_NAMES.map((name) => [name, 0]));
  const inScopeScreens = [];
  const outOfScopeScreens = [];
  let inlineStyles = 0;
  let artisanalRefs = 0;

  for (const file of htmlFiles) {
    const text = sinComentarios(readFileSync(file, 'utf8'));
    inlineStyles += countMatches(text, INLINE_STYLE_RE);

    const refs = countMatches(text, ARTISANAL_CLASS_RE);
    if (refs === 0) {
      continue;
    }
    artisanalRefs += refs;

    const relativePath = relative(FEATURES_DIR, file);
    if (relativePath.split(sep)[0] === OUT_OF_SCOPE_TOP_LEVEL) {
      outOfScopeScreens.push(relativePath);
    } else {
      inScopeScreens.push(relativePath);
    }

    for (const match of text.matchAll(new RegExp(ARTISANAL_CLASS_RE.source, 'g'))) {
      if (match[0] in byClass) {
        byClass[match[0]] += 1;
      }
    }
  }

  const stylesScssExists = existsSync(STYLES_SCSS);

  return {
    featuresScanned: htmlFiles.length,
    inlineStyles,
    stylesScssExists,
    stylesScssLines: stylesScssExists ? logicalLineCount(readFileSync(STYLES_SCSS, 'utf8')) : 0,
    artisanalScreens: inScopeScreens.length,
    artisanalScreensList: inScopeScreens,
    outOfScopeScreens,
    artisanalRefs,
    byClass,
  };
}

function formatDelta(current, baseline) {
  const delta = current - baseline;
  if (delta === 0) {
    return `= ${baseline}`;
  }
  return `${delta > 0 ? '+' : ''}${delta} (base ${baseline})`;
}

function printReport(metrics) {
  console.log('FintCart — deuda de estilo (feature 003, research D-26)');
  console.log(`Plantillas escaneadas: ${metrics.featuresScanned}\n`);

  const rows = [
    [
      'Estilos en línea',
      String(metrics.inlineStyles),
      formatDelta(metrics.inlineStyles, BASELINE.inlineStyles),
    ],
    [
      'Líneas de styles.scss',
      metrics.stylesScssExists ? String(metrics.stylesScssLines) : 'eliminado ✅',
      metrics.stylesScssExists ? formatDelta(metrics.stylesScssLines, BASELINE.stylesScssLines) : '—',
    ],
    [
      'Pantallas con clase artesanal',
      String(metrics.artisanalScreens),
      formatDelta(metrics.artisanalScreens, BASELINE.artisanalScreens),
    ],
    ['Referencias totales', String(metrics.artisanalRefs), '—'],
  ];

  const width = Math.max(...rows.map((row) => row[0].length));
  for (const [label, current, delta] of rows) {
    console.log(`  ${label.padEnd(width)}  ${current.padStart(10)}   ${delta}`);
  }

  const usedClasses = Object.entries(metrics.byClass).filter(([, count]) => count > 0);
  if (usedClasses.length > 0) {
    console.log('\n  Desglose por clase:');
    for (const [name, count] of usedClasses.sort((a, b) => b[1] - a[1])) {
      console.log(`    ${name.padEnd(14)} ${String(count).padStart(4)}`);
    }
  }

  if (metrics.outOfScopeScreens.length > 0) {
    console.log(
      `\n  ⚠ Fuera del alcance de 003 (feature 002), pero bloquean borrar styles.scss:`,
    );
    for (const screen of metrics.outOfScopeScreens) {
      console.log(`    ${screen}`);
    }
  }
}

function runCheck(metrics) {
  const failures = [];
  if (metrics.inlineStyles !== 0) {
    failures.push(`${metrics.inlineStyles} estilos en línea (deben ser 0)`);
  }
  if (metrics.stylesScssExists) {
    failures.push(`styles.scss sigue existiendo (${metrics.stylesScssLines} líneas)`);
  }
  if (metrics.artisanalRefs !== 0) {
    failures.push(`${metrics.artisanalRefs} referencias a clases artesanales (deben ser 0)`);
  }

  if (failures.length === 0) {
    console.log('✅ Sin deuda de estilo: criterio de terminación del feature 003 cumplido.');
    return;
  }
  console.error('❌ El criterio de terminación NO se cumple:');
  for (const failure of failures) {
    console.error(`   - ${failure}`);
  }
  if (metrics.outOfScopeScreens.length > 0) {
    console.error(
      '   Nota: parte de la deuda vive en pantallas del feature 002 ' +
        `(${metrics.outOfScopeScreens.join(', ')}).`,
    );
  }
  process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  const metrics = collectMetrics();

  if (args.includes('--json')) {
    console.log(JSON.stringify({ baseline: BASELINE, ...metrics }, null, 2));
  } else {
    printReport(metrics);
  }

  if (args.includes('--check')) {
    if (!args.includes('--json')) {
      console.log('');
    }
    runCheck(metrics);
  }
}

main();
