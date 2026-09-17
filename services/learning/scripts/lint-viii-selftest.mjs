#!/usr/bin/env node
/**
 * Auto-prueba de la regla del Principio VIII en el Servicio de Aprendizaje.
 *
 * Por qué existe: la regla original prohibía el tipo `number` a secas en
 * `src/quizzes/**`, y eso la hacía fallar sobre código CORRECTO —el número de preguntas
 * que se sirven, la fuente de aleatoriedad del barajado—. Una regla que señala código
 * correcto se acaba desactivando, y al desactivarla deja de proteger lo que protegía.
 *
 * La salida fue hacerla precisar el NOMBRE del valor (score, weight, tasa, monto…), que
 * es lo que de verdad distingue un valor financiero de un conteo. Este archivo es la
 * prueba de que la regla estrechada SIGUE FALLANDO donde tiene que fallar: sin él, el
 * cambio de configuración quedaría sin comprobar y nadie sabría si la regla quedó
 * apagada por accidente.
 *
 * Comprueba cuatro casos malos y cuatro buenos, uno por cada forma en que un valor
 * financiero puede colarse: parámetro, propiedad de clase, miembro de tipo y conversión
 * con `Number()`. Y comprueba los tres casos legítimos que motivaron el cambio, para que
 * un futuro «endurecimiento» no vuelva a romperlos.
 *
 * Uso:  node scripts/lint-viii-selftest.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RAIZ = join(import.meta.dirname, '..');
const CONFIG = join(RAIZ, '.eslintrc.cjs');

/** Los casos que DEBEN fallar: cada uno con la forma exacta de un valor financiero. */
const MALOS = [
  'export function calcular(score: number): string { return String(score); }',
  'export class Calculo { public weight: number = 0; }',
  'export interface Escala { readonly pass_threshold: number; }',
  'export function convertir(raw: string): number { return Number(raw); }',
  'export function redondear(v: number): number { return Math.round(v); }',
  // camelCase, que es como se escriben de verdad la mitad de estos nombres.
  'export interface Totales { readonly montoTotal: number; }',
  'export interface Umbral { readonly passThreshold: number; }',
  'export class Interes { public tasaInteres: number = 0; }',
  'export function aplicar(valorUvt: number): number { return valorUvt; }',
];

/** Los que DEBEN pasar: son conteos y fuentes de aleatoriedad, no dinero. */
const BUENOS = [
  // `preguntasAServir` es el falso positivo que obligó a poner fronteras de palabra:
  // contiene «tasA» y una búsqueda sin fronteras lo tomaba por una tasa.
  'export function servir(total: number, preguntasAServir: number): number { return Math.min(total, preguntasAServir); }',
  'export function barajar(items: readonly string[], random: () => number = Math.random): string[] { return [...items].sort(() => random() - 0.5); }',
  'export function validar(n: number): boolean { return Number.isInteger(n); }',
];

const dir = mkdtempSync(join(tmpdir(), 'lint-viii-'));
let fallos = 0;

/** Ejecuta eslint sobre un archivo y devuelve si pasó y qué dijo. */
function eslintSobre(contenido) {
  const archivo = join(RAIZ, 'src', 'quizzes', `zz-selftest-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.ts`);
  writeFileSync(archivo, contenido);
  try {
    execFileSync(
      'npx',
      ['eslint', '--no-ignore', '--resolve-plugins-relative-to', RAIZ, '--config', CONFIG, archivo],
      { cwd: RAIZ, stdio: 'pipe', encoding: 'utf8' },
    );
    return { paso: true, salida: '' };
  } catch (error) {
    return { paso: false, salida: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  } finally {
    rmSync(archivo, { force: true });
  }
}

for (const caso of MALOS) {
  const { paso, salida } = eslintSobre(caso);
  if (paso) {
    fallos += 1;
    console.error(`  ✗ NO falló, y debería:\n      ${caso}`);
  } else if (!/Principio VIII/u.test(salida)) {
    fallos += 1;
    console.error(`  ✗ falló por la razón equivocada (se esperaba un mensaje del Principio VIII):\n      ${caso}`);
  }
}

for (const caso of BUENOS) {
  const { paso, salida } = eslintSobre(caso);
  if (!paso) {
    fallos += 1;
    console.error(`  ✗ falló, y NO es un valor financiero:\n      ${caso}\n${salida}`);
  }
}

rmSync(dir, { recursive: true, force: true });

if (fallos > 0) {
  console.error(`\nregla del Principio VIII: ${fallos} caso(s) mal.\n`);
  process.exit(1);
}
console.log(
  `regla del Principio VIII: ${MALOS.length} formas de valor financiero siguen fallando, ` +
    `${BUENOS.length} usos legítimos siguen pasando`,
);
