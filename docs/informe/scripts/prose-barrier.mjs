#!/usr/bin/env node
/**
 * prose-barrier.mjs — barrera de prosa del informe (glosario §2 y §3).
 *
 * POR QUÉ EXISTE
 * El informe se escribe en inglés y se traduce después (main.tex:7-10), con tres agentes
 * redactando capítulos en paralelo. Sin una barrera ejecutable, la terminología del glosario
 * (`00-glosario-y-estilo.md`) es una recomendación: cada capítulo llamaría «simulator» a la
 * calculadora y «learner» al estudiante, y la traducción tendría que adivinar. Esta barrera
 * convierte el glosario en una puerta: lo que el glosario prohíbe, aquí falla.
 *
 * QUÉ MIDE, Y CON QUÉ SEVERIDAD
 *   ERROR  grafía británica (behaviour, colour, organis*, centre, analyse, licence, programme,
 *          modelling, favour, defence). El cuerpo va en inglés estadounidense
 *          (`preamble/packages.tex:19`, `main.tex:58`).
 *   ERROR  comilla recta `"` en prosa: babel carga `es-noshorthands` y `csquotes`, así que una
 *          comilla recta no es una comilla tipográfica. Se escribe \enquote{…} o ``…''.
 *   ERROR  términos prohibidos por el glosario: «calculation engine», «apprentice», «learner»
 *          fuera de «learner kit» del capítulo 09, «design-system» como sustantivo, «simulador»
 *          fuera de un título español.
 *   WARN   «the editor» cuando puede ser la pantalla: el glosario §2.6 reserva «editor» para la
 *          persona y pide «the writing surface» / «the editing screen» para la UI. Es WARN y no
 *          ERROR porque el uso legítimo (la persona) es indistinguible sin leer la frase.
 *   WARN   \nocite{*}: andamiaje de borrador, se retira antes de entregar.
 *   INFO   \todo: solo se cuenta, nunca falla (un borrador puede tenerlos).
 *
 * QUÉ NO MIDE
 * Los comentarios `%` no son prosa: no llegan al PDF. Se analiza únicamente el texto anterior al
 * primer `%` sin escapar, de modo que explicar una decisión en un comentario no dispara la
 * barrera —el mismo falso positivo que `design-debt.mjs` evita con los comentarios HTML—.
 * Una línea que termina en `% style-ok` queda exenta entera: es la vía para un título citado con
 * grafía británica, y solo para eso.
 * Los argumentos de \section{}, \subsection{}, \chapter{} y \paragraph{} son títulos españoles
 * canónicos: ahí «simulador» es correcto y por eso se enmascaran antes de buscar el término.
 * Los literales de código (\texttt{}, \code{}, \verb, \url{}, \enquote{} y `…`) se enmascaran:
 * una cadena decimal como `"1234567.89"` lleva comillas rectas a propósito (glosario §4).
 *
 * USO
 *   node docs/informe/scripts/prose-barrier.mjs                 # informe legible
 *   node docs/informe/scripts/prose-barrier.mjs --check         # puerta: sin salida si limpio
 *   node docs/informe/scripts/prose-barrier.mjs /tmp/probe.tex  # rutas sueltas (pruebas)
 *
 * SALIDA
 *   0  ningún ERROR (los WARN no bloquean)
 *   1  al menos un ERROR
 *   2  no se encontró ningún .tex que escanear
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INFORM_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_CHAPTERS = join(INFORM_ROOT, 'chapters');

/** Marca de exención para un título citado con grafía británica. */
const STYLE_OK_RE = /%\s*style-ok\b/;

/** Comandos cuyos argumentos son títulos españoles canónicos (glosario §1). */
const TITLE_SPAN_RES = [
  /\\[a-zA-Z]*section\*?\{[^{}]*\}/g,
  /\\chapter\*?\{[^{}]*\}/g,
  /\\paragraph\*?\{[^{}]*\}/g,
];

/** Literales de código: sus comillas y sus palabras no son prosa. */
const CODE_SPAN_RES = [
  /\\texttt\{[^{}]*\}/g,
  /\\code\{[^{}]*\}/g,
  /\\url\{[^{}]*\}/g,
  /\\enquote\{[^{}]*\}/g,
  /\\verb\*?(.)[\s\S]*?\1/g,
  /`[^`]*`/g,
];

/** Grafías británicas y su forma estadounidense. */
const BRITISH_SPELLINGS = [
  { re: /\bbehaviour(s)?\b/gi, fix: (w) => w.replace(/behaviour/i, 'behavior') },
  { re: /\bcolour(s|ed|ing)?\b/gi, fix: (w) => w.replace(/colour/i, 'color') },
  { re: /\borganis\w*/gi, fix: (w) => w.replace(/organis/i, 'organiz') },
  { re: /\bcentre(s)?\b/gi, fix: (w) => w.replace(/centre/i, 'center') },
  { re: /\banalys(e|es|ed|ing)\b/gi, fix: (w) => w.replace(/analys/i, 'analyz') },
  { re: /\blicence(s)?\b/gi, fix: (w) => w.replace(/licence/i, 'license') },
  { re: /\bprogramme(s)?\b/gi, fix: (w) => w.replace(/programme/i, 'program') },
  { re: /\bmodelling\b/gi, fix: (w) => w.replace(/modelling/i, 'modeling') },
  { re: /\bfavour(s|ed|ing|able|ite|ites)?\b/gi, fix: (w) => w.replace(/favour/i, 'favor') },
  { re: /\bdefence(s)?\b/gi, fix: (w) => w.replace(/defence/i, 'defense') },
];

/** «design-system» como sustantivo: seguido de puntuación o de un verbo/preposición. */
const DESIGN_SYSTEM_NOUN_RE =
  /\bdesign-system\b(?=\s*(?:$|[,.;:!?)])|\s+(?:is|are|was|were|has|have|had|provides|consists|contains|defines|covers|includes|of|in|at|for|with|that|which|its)\b)/gi;

/** «learner» a secas; se excluyen «learner kit» y las rutas tipo `ui_kits/learner/`. */
const LEARNER_BARE_RE = /(?<![/\w-])learner\b(?![\w/-])(?!\s+kit\b)/gi;
const LEARNER_KIT_RE = /\blearner\s+kit\b/gi;

/** Términos prohibidos: ERROR, salvo que la regla diga otra severidad. */
const FORBIDDEN_TERMS = [
  {
    re: /\bcalculation engine\b/gi,
    fix: 'formula engine',
    why: 'el glosario §2.2 nombra el motor de fórmulas: analizador → AST → evaluador',
  },
  {
    re: /\bapprentice(ship)?s?\b/gi,
    fix: 'student',
    why: 'la persona es «student» (glosario §2.5)',
  },
  {
    re: DESIGN_SYSTEM_NOUN_RE,
    fix: 'design system (dos palabras)',
    why: '«design-system» con guion solo como identificador o ruta, no como sustantivo',
  },
  {
    re: /\bsimulador(?:es)?\b/gi,
    fix: 'simulator / calculator, según glosario §2.1',
    why: 'el término español solo cabe dentro de un título español canónico',
    maskTitles: true,
  },
];

const EDITOR_RE = /\bthe editor\b/gi;
const NOCITE_RE = /\\nocite\{\*\}/;
const TODO_CMD_RE = /\\todo\b/g;
const TODO_MARKER_RE = /%\s*TODO\b/gi;

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

/** Sustituye por espacios lo que no es prosa, conservando el largo de la línea. */
function maskSpans(text, patterns) {
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, (match) => ' '.repeat(match.length));
  }
  return out;
}

function countMatches(text, re) {
  const matches = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`));
  return matches ? matches.length : 0;
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

function scanFile(file) {
  const findings = [];
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const isUiKitChapter = basename(file).startsWith('09');
  let todoCommands = 0;
  let todoMarkers = 0;

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const raw = rawLine.replace(/\r$/, '');

    const prose = stripComment(raw);
    // `\todo` cuenta solo si es código: uno comentado no llega al PDF ni al lector.
    todoCommands += countMatches(prose, TODO_CMD_RE);
    todoMarkers += countMatches(raw, TODO_MARKER_RE);
    if (prose.trim().length === 0) {
      return;
    }
    if (STYLE_OK_RE.test(raw)) {
      return;
    }

    const masked = maskSpans(prose, CODE_SPAN_RES);
    // Los títulos españoles son legítimos: se enmascaran para las búsquedas de términos.
    const withoutTitles = maskSpans(masked, TITLE_SPAN_RES);

    const add = (severity, rule, message, fix) => {
      findings.push({ line: lineNo, severity, rule, message, fix, text: raw.trim() });
    };

    for (const { re, fix } of BRITISH_SPELLINGS) {
      for (const match of masked.matchAll(new RegExp(re.source, re.flags))) {
        add(
          'ERROR',
          'spelling',
          `grafía británica «${match[0]}»`,
          `«${fix(match[0])}» (US). Si está dentro de un título citado, termina la línea con «% style-ok».`,
        );
      }
    }

    const straightQuotes = countMatches(masked, /"/g);
    if (straightQuotes > 0) {
      add(
        'ERROR',
        'quotes',
        `comilla recta «"» en prosa (${straightQuotes} en la línea)`,
        'usa \\enquote{…} (o ``…\'\'); si el valor es una cadena de la API, va en \\texttt{"…"} y no es prosa (glosario §4).',
      );
    }

    for (const term of FORBIDDEN_TERMS) {
      const haystack = term.maskTitles ? withoutTitles : masked;
      for (const match of haystack.matchAll(new RegExp(term.re.source, term.re.flags))) {
        add('ERROR', 'term', `término prohibido «${match[0]}» — ${term.why}`, term.fix);
      }
    }

    for (const match of withoutTitles.matchAll(new RegExp(LEARNER_BARE_RE.source, 'gi'))) {
      add(
        'ERROR',
        'term',
        `«${match[0]}»: la persona es «student» (glosario §2.5)`,
        'student. «learner kit» solo vale como nombre del kit de diseño, y solo en el capítulo 09.',
      );
    }
    for (const match of withoutTitles.matchAll(new RegExp(LEARNER_KIT_RE.source, 'gi'))) {
      if (isUiKitChapter) {
        continue;
      }
      add(
        'ERROR',
        'term',
        `«${match[0]}» fuera del capítulo 09`,
        'en este capítulo la persona es «student»; «learner kit» solo nombra el kit de diseño de 09.',
      );
    }

    const editorHits = countMatches(masked, EDITOR_RE);
    if (editorHits > 0) {
      add(
        'WARN',
        'editor',
        `«the editor» es ambiguo (${editorHits} en la línea): persona (editor) o pantalla (writing surface)`,
        'si es la pantalla, «the writing surface» o «the editing screen»; si es la persona, deja el rol explícito (glosario §2.6).',
      );
    }

    if (NOCITE_RE.test(masked)) {
      add(
        'WARN',
        'nocite',
        '\\nocite{*} — andamiaje de borrador (draft scaffolding)',
        'retíralo antes de entregar: la bibliografía imprime solo las obras citadas.',
      );
    }
  });

  return { file, findings, todoCommands, todoMarkers };
}

function printFindings(results, { onlyErrors = false, write = console.log } = {}) {
  for (const result of results) {
    const findings = result.findings
      .filter((finding) => !onlyErrors || finding.severity === 'ERROR')
      .sort((a, b) => a.line - b.line);
    for (const finding of findings) {
      const text = finding.text.length > 96 ? `${finding.text.slice(0, 93)}…` : finding.text;
      write(
        `  ${displayPath(result.file)}:${finding.line}  ${finding.severity.padEnd(5)} ${finding.message}`,
      );
      write(`        línea:   ${text}`);
      write(`        arreglo: ${finding.fix}`);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const targets = args.filter((arg) => !arg.startsWith('--'));
  const check = flags.has('--check');
  const help = flags.has('--help') || flags.has('-h');

  if (help) {
    console.log('uso: node prose-barrier.mjs [--check] [archivos-o-directorios…]');
    console.log('  --check  puerta silenciosa: sale 1 solo si hay ERROR, sin salida si está limpio');
    return;
  }

  const files = collectTexFiles(targets.length > 0 ? targets : [DEFAULT_CHAPTERS]);
  if (files.length === 0) {
    console.error('❌ No hay archivos .tex que escanear.');
    process.exitCode = 2;
    return;
  }

  const results = files.map(scanFile);
  const errors = results.reduce(
    (total, result) => total + result.findings.filter((f) => f.severity === 'ERROR').length,
    0,
  );
  const warnings = results.reduce(
    (total, result) => total + result.findings.filter((f) => f.severity === 'WARN').length,
    0,
  );
  const todoCommands = results.reduce((total, result) => total + result.todoCommands, 0);
  const todoMarkers = results.reduce((total, result) => total + result.todoMarkers, 0);

  if (check) {
    if (errors === 0) {
      return;
    }
    console.error(`❌ Barrera de prosa: ${errors} ERROR(es).`);
    printFindings(results, { onlyErrors: true, write: (line) => console.error(line) });
    process.exitCode = 1;
    return;
  }

  console.log('FintCart — barrera de prosa (glosario §2–§3, docs/informe/00-glosario-y-estilo.md)');
  console.log(`Archivos escaneados: ${files.length}`);
  console.log('');

  printFindings(results);

  if (errors + warnings > 0) {
    console.log('');
  }
  console.log(
    `Resumen: ${errors} ERROR · ${warnings} WARN · \\todo: ${todoCommands} · marcas TODO: ${todoMarkers}`,
  );
  console.log('  \\todo y las marcas TODO solo se cuentan: un capítulo en borrador puede tenerlos.');

  if (errors === 0) {
    console.log('✅ Sin ERROR: la prosa cumple el glosario.');
    return;
  }
  console.error(`❌ ${errors} ERROR(es): la prosa no cumple el glosario.`);
  process.exitCode = 1;
}

main();
