#!/usr/bin/env node
/**
 * verify-citations.mjs — ¿se cita lo que se ha leído?
 *
 * POR QUÉ EXISTE
 * `refs/fuentes-acceso.md` mide, clave por clave, de qué fuentes se tuvo el texto completo el
 * 2026-11-03 (39 COMPLETO · 2 PARCIAL · 4 SOLO-ABSTRACT · 1 INACCESIBLE). Ese registro es un
 * acuerdo entre personas: nada impide que un capítulo cite `choung2023digital` como si se hubiera
 * leído. Este script convierte el registro en una puerta, igual que `prose-barrier.mjs` convierte
 * el glosario en una puerta.
 *
 * QUÉ MIDE, Y CON QUÉ SEVERIDAD
 *   ERROR  clave citada que no existe en `refs/referencias.bib`: biblatex la imprimiría como
 *          `[?]`, y una cita rota se lee como un fallo de la tesis, no como un hueco del .bib.
 *   WARN   clave citada cuyo veredicto en `refs/fuentes-acceso.md` no es COMPLETO. Es WARN y no
 *          ERROR porque citar por existencia o por un hecho leído es legítimo (es lo que dice la
 *          regla del §«Regla que se deriva»); lo que no es legítimo es citarla por su argumento,
 *          y eso el script no puede distinguirlo sin leer la frase. El aviso pone el veredicto
 *          delante de quien escribe.
 *   WARN   clave citada sin veredicto en el registro: nadie ha medido esa fuente todavía.
 *   INFO   \nocite{*}: andamiaje de borrador. Hace que la bibliografía imprima las 46 entradas y
 *          por eso oculta cuántas están escritas sin citarse; se informa, no falla.
 *
 * QUÉ NO MIDE
 * El script no juzga si la frase que rodea a la cita corresponde a lo que la obra sostiene. Eso
 * exige leer, y leer es el trabajo del capítulo (`04-marco-referencial.tex` lleva su inventario de
 * afirmaciones con la evidencia al lado). Aquí solo se cruzan tres listas de claves.
 * Los comentarios `%` no son citas: no llegan al PDF. Se corta la línea en el primer `%` sin
 * escapar, como en `prose-barrier.mjs`, de modo que comentar una cita pendiente no dispara el
 * ERROR. `\%` es un porcentaje literal.
 * `\nocite{*}` no es una clave: se cuenta aparte. `\nocite{clave}` sí es una cita a efectos de
 * este script (imprime la entrada sin llamarla en el texto, pero afirma que existe).
 *
 * USO
 *   node docs/informe/scripts/verify-citations.mjs                # informe legible
 *   node docs/informe/scripts/verify-citations.mjs --check        # puerta: solo problemas
 *   node docs/informe/scripts/verify-citations.mjs /tmp/probe.tex # rutas sueltas (pruebas)
 *
 * SALIDA
 *   0  ningún ERROR (los WARN no bloquean)
 *   1  al menos un ERROR
 *   2  no se encontró ningún .tex, o falta el .bib / el registro de acceso
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFORM_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CHAPTERS = join(INFORM_ROOT, 'chapters');
const BIB_PATH = join(INFORM_ROOT, 'refs', 'referencias.bib');
const ACCESO_PATH = join(INFORM_ROOT, 'refs', 'fuentes-acceso.md');

/** Veredictos posibles. El orden es el de la escala, de más a menos texto leído. */
const VERDICTS = ['COMPLETO', 'PARCIAL', 'SOLO-ABSTRACT', 'INACCESIBLE', 'SIN-LOCALIZADOR'];

/**
 * Cualquier comando de cita de biblatex: \cite, \parencite, \textcite, \autocite, \footcite,
 * \citet, \citep, \Citep, \smartcite, \citeauthor… Admite el `*` y hasta dos argumentos
 * opcionales antes de la lista de claves (`\parencite[see][p.~3]{a,b}`).
 */
const CITE_RE = /\\([a-zA-Z]*cite[a-zA-Z]*)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)\}/g;
const NOCITE_STAR_RE = /\\nocite\*?\s*\{\s*\*\s*\}/g;

/** `@article{key,` — se excluyen los tipos que no definen entradas. */
const BIB_ENTRY_RE = /^[ \t]*@([a-zA-Z]+)[ \t]*\{[ \t]*([^,\s{}]+)[ \t]*,/gm;
const NON_ENTRY_TYPES = new Set(['string', 'comment', 'preamble']);

/**
 * Fila de la tabla de `fuentes-acceso.md`: | `clave` | **VEREDICTO** | evidencia | qué sostiene |
 * Se exige el backtick en la clave y un veredicto conocido en la segunda celda para no confundir
 * la tabla con las tablas del método y del recuento.
 */
const ACCESO_ROW_RE = new RegExp(
  `^\\|\\s*\`([^\`]+)\`\\s*\\|\\s*\\**\\s*(${VERDICTS.join('|')})\\b`,
);

const WHITESPACE_RE = /\s+/;

/**
 * Corta la línea en el primer `%` sin escapar. Lo que queda es lo que llega al PDF.
 * `\%` es un porcentaje literal, no un comentario.
 */
function stripComment(line) {
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch !== '%') {
      out += ch;
      continue;
    }
    let slashes = 0;
    for (let j = out.length - 1; j >= 0 && out[j] === '\\'; j -= 1) {
      slashes += 1;
    }
    if (slashes % 2 === 0) {
      break;
    }
    out += ch;
  }
  return out;
}

function readRequired(path, label) {
  if (!existsSync(path)) {
    console.error(`❌ No existe ${label}: ${path}`);
    process.exit(2);
  }
  return readFileSync(path, 'utf8');
}

/** Claves definidas en el .bib. */
function loadBibKeys(text) {
  const keys = new Map();
  for (const match of text.matchAll(BIB_ENTRY_RE)) {
    const type = match[1].toLowerCase();
    if (NON_ENTRY_TYPES.has(type)) {
      continue;
    }
    keys.set(match[2], { type, line: text.slice(0, match.index).split('\n').length });
  }
  return keys;
}

/** Veredicto por clave, leído de la tabla del registro de acceso. */
function loadVerdicts(text) {
  const verdicts = new Map();
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const match = line.match(ACCESO_ROW_RE);
    if (match) {
      verdicts.set(match[1], { verdict: match[2], line: index + 1 });
    }
  });
  return verdicts;
}

function collectTexFiles(targets) {
  const files = [];
  for (const target of targets) {
    const full = resolve(target);
    if (!existsSync(full)) {
      console.error(`❌ No existe: ${target}`);
      process.exit(2);
    }
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.tex')) {
          files.push(join(full, entry.name));
        }
      }
    } else {
      files.push(full);
    }
  }
  return [...new Set(files)].sort();
}

function displayPath(file) {
  const rel = relative(INFORM_ROOT, file);
  return rel.startsWith('..') ? file : rel;
}

/** Extrae las claves citadas de un capítulo, con su línea y el comando que las cita. */
function scanFile(file) {
  const citations = [];
  let nociteStar = 0;
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const raw = rawLine.replace(/\r$/, '');
    const prose = stripComment(raw);
    if (prose.trim().length === 0) {
      return;
    }

    nociteStar += (prose.match(NOCITE_STAR_RE) ?? []).length;

    for (const match of prose.matchAll(CITE_RE)) {
      const command = match[1];
      const args = match[2];
      if (args.trim() === '*') {
        // `\nocite{*}` no cita una obra concreta: lo cuenta NOCITE_STAR_RE.
        continue;
      }
      for (const rawKey of args.split(',')) {
        const key = rawKey.split(WHITESPACE_RE).filter(Boolean)[0];
        if (!key) {
          continue;
        }
        citations.push({ key, command, line: lineNo, text: raw.trim() });
      }
    }
  });

  return { file, citations, nociteStar };
}

function printFindings(findings, { write = console.log } = {}) {
  for (const finding of findings) {
    const text = finding.text.length > 96 ? `${finding.text.slice(0, 93)}…` : finding.text;
    write(`  ${finding.where}  ${finding.severity.padEnd(5)} ${finding.message}`);
    write(`        línea: ${text}`);
    write(`        regla: ${finding.rule}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const check = flags.has('--check');
  const help = flags.has('--help') || flags.has('-h');

  if (help) {
    console.log('uso: node verify-citations.mjs [--check] [archivos-o-directorios…]');
    console.log('  --check  puerta: imprime solo los problemas; sale 1 solo si hay ERROR');
    return;
  }

  const files = collectTexFiles(targets.length > 0 ? targets : [DEFAULT_CHAPTERS]);
  if (files.length === 0) {
    console.error('❌ No hay archivos .tex que escanear.');
    process.exit(2);
  }

  const bibKeys = loadBibKeys(readRequired(BIB_PATH, 'la bibliografía'));
  const verdicts = loadVerdicts(readRequired(ACCESO_PATH, 'el registro de acceso'));

  const results = files.map(scanFile);
  const citations = results.flatMap((result) => result.citations);
  const nociteStar = results.reduce((total, result) => total + result.nociteStar, 0);

  const cited = new Map();
  for (const citation of citations) {
    if (!cited.has(citation.key)) {
      cited.set(citation.key, []);
    }
    cited.get(citation.key).push(citation);
  }

  const findings = [];
  for (const result of results) {
    for (const citation of result.citations) {
      const where = `${displayPath(result.file)}:${citation.line}`;
      if (!bibKeys.has(citation.key)) {
        findings.push({
          where,
          severity: 'ERROR',
          message: `\\${citation.command} cita «${citation.key}», que no está en refs/referencias.bib — biblatex imprimiría [?]`,
          rule: 'toda clave citada debe existir en el .bib; si la obra se descartó, retira la cita o añade la entrada.',
          text: citation.text,
        });
        continue;
      }
      const record = verdicts.get(citation.key);
      if (!record) {
        findings.push({
          where,
          severity: 'WARN',
          message: `«${citation.key}» no tiene veredicto en refs/fuentes-acceso.md — nadie ha medido si se puede leer`,
          rule: 'mide la fuente (rutas legales) y anota el veredicto en refs/fuentes-acceso.md antes de citarla por su argumento.',
          text: citation.text,
        });
        continue;
      }
      if (record.verdict !== 'COMPLETO') {
        findings.push({
          where,
          severity: 'WARN',
          message: `«${citation.key}» tiene veredicto ${record.verdict}, no COMPLETO — se puede citar por su existencia o por un hecho visible en la página leída, no por su argumento`,
          rule: `ver refs/fuentes-acceso.md:${record.line} y §«Regla que se deriva»; si la frase afirma el argumento de la obra, la frase no se sostiene.`,
          text: citation.text,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === 'ERROR');
  const warnings = findings.filter((f) => f.severity === 'WARN');
  const citedKeys = [...cited.keys()].sort();
  const completo = citedKeys.filter((key) => verdicts.get(key)?.verdict === 'COMPLETO');
  const neverCited = [...bibKeys.keys()].filter((key) => !cited.has(key)).sort();

  if (check) {
    if (findings.length === 0) {
      return;
    }
    console.error(
      `❌ Citas: ${errors.length} ERROR(es) · ${warnings.length} WARN (los WARN no bloquean).`,
    );
    printFindings(findings, { write: (line) => console.error(line) });
    if (errors.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  console.log('FintCart — ¿se cita lo que se ha leído? (docs/informe)');
  console.log(`Capítulos escaneados: ${files.length}`);
  console.log(`Bibliografía: refs/referencias.bib · ${bibKeys.size} claves definidas`);
  console.log(`Registro de acceso: refs/fuentes-acceso.md · ${verdicts.size} veredictos`);
  console.log('');

  printFindings(findings);

  if (findings.length > 0) {
    console.log('');
  }
  console.log(
    `Resumen: ${errors.length} ERROR · ${warnings.length} WARN · ${citations.length} citas en prosa`,
  );
  console.log(
    `  Claves distintas citadas: ${citedKeys.length} · de ellas COMPLETO: ${completo.length} · no COMPLETO: ${citedKeys.length - completo.length}`,
  );
  console.log(
    `  Definidas y nunca citadas: ${neverCited.length} de ${bibKeys.size}${neverCited.length > 0 ? ` — ${neverCited.join(', ')}` : ''}`,
  );
  if (neverCited.length > 0) {
    console.log(
      '  No es un fallo: los capítulos sin prosa todavía no citan. Es el hueco que \\nocite{*} tapa.',
    );
  }
  if (nociteStar > 0) {
    console.log(
      `  \\nocite{*}: ${nociteStar} ocurrencia(s) — andamiaje de borrador; la bibliografía imprime entradas que nadie cita.`,
    );
  }

  if (errors.length === 0) {
    console.log('✅ Sin ERROR: toda cita apunta a una entrada real del .bib.');
    return;
  }
  console.error(`❌ ${errors.length} ERROR(es): hay citas que imprimirían [?].`);
  process.exitCode = 1;
}

main();
