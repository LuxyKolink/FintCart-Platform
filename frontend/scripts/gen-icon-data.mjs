#!/usr/bin/env node
/**
 * gen-icon-data.mjs — genera el registro de iconos SOLO con los datos de los 25
 * iconos que la interfaz usa.
 *
 * POR QUÉ EXISTE
 * `@lucide/angular` publica cada icono como un COMPONENTE Angular con una plantilla
 * propia de ~2,5 KB (`<path>`, `<line>`, `<circle>`… un `@switch` completo). El
 * registro de FintCart no usa esos componentes: usa `LucideDynamicIcon` y le pasa
 * datos (`LucideArrowRight.icon`). Al importar las 25 clases para leer su `static
 * icon`, esbuild conserva las 25 clases enteras —con su `ɵcmp` y su plantilla
 * duplicada— porque `static ɵcmp = …` es un efecto de módulo. Resultado medido en el
 * build de `db04bf3`: 87 367 B del chunk inicial eran `@lucide/angular`, de los
 * cuales los datos de los iconos son ~7 KB y el resto plantillas que nunca se
 * ejecutan.
 *
 * QUÉ HACE
 * Lee los datos del paquete instalado (misma versión que el resto del repo, así que
 * el trazo no puede desviarse) y escribe `icon-data.ts` con un objeto plano. El
 * bundle deja de arrastrar componentes y se queda con los datos.
 *
 * QUÉ NO HACE
 * No recorta, no reescribe ni normaliza ningún `path`: copia el `LucideIconData` tal
 * cual, incluidos los `key` que la plantilla usa para el `track` del `@for`. El SVG
 * que se pinta es idéntico al de antes.
 *
 * USO
 *   node scripts/gen-icon-data.mjs            # regenera src/app/shared/ui/icon/icon-data.ts
 *   node scripts/gen-icon-data.mjs --check    # falla si el fichero no está al día
 *
 * Para añadir un icono: añade su nombre kebab a NAMES y vuelve a ejecutar. Si el
 * paquete no lo tiene (o lo renombró), el script falla nombrando el que falta en vez
 * de escribir un `undefined` que reventaría en tiempo de ejecución.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// El vocabulario de FintCart es el de siempre (design/README.md, research D-32):
// nombres kebab propios, no los del paquete. `check-circle` es el ejemplo de por qué:
// Lucide lo llama `circle-check` y el registro conserva el nombre con el que el
// design system lo documenta.
const NAMES = [
  'arrow-right',
  'bell',
  'book-open',
  'calculator',
  'check',
  'check-circle',
  'chevron-right',
  'circle',
  'clipboard-check',
  'clock',
  'corner-up-left',
  'credit-card',
  'file-text',
  'flame',
  'info',
  'loader',
  'mail-check',
  'piggy-bank',
  'plus',
  'save',
  'search',
  'send',
  'settings',
  'shield',
  'shield-check',
];

/**
 * Nombres que FintCart dice de una forma y Lucide de otra. Es UNA entrada, y es
 * deliberada: manda el vocabulario del design system (`icon="check-circle"` está en
 * plantillas que este cambio no toca), así que la traducción se declara aquí en vez de
 * dejar que el script la adivine por alias. Adivinar falló de verdad: `check-circle` es
 * alias de `circle-check-big` —un icono DISTINTO— y el registro de FintCart siempre
 * quiso `circle-check`. Por eso la búsqueda es por nombre exacto y lo único que se
 * traduce es lo que aparece en este mapa.
 */
const LUCIDE_NAME = {
  'check-circle': 'circle-check',
};

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../src/app/shared/ui/icon/icon-data.ts');

/**
 * `@angular/compiler` ANTES del paquete de iconos: los .mjs de Lucide están
 * parcialmente compilados (`ɵɵngDeclareFactory`), así que sin el compilador cargado
 * el import revienta con «JIT compilation failed». El linker de `ng build` lo
 * resuelve solo; aquí hay que dárselo a mano.
 */
async function loadIconData() {
  await import('@angular/compiler');
  const { icons } = await import('@lucide/angular');

  // Índice por nombre REAL: `icons` es el mapa PascalCase→componente y el nombre bueno
  // está en `icon.name`, no en la clave. Nada de alias: un alias puede apuntar a otro
  // icono (ver LUCIDE_NAME).
  const byName = new Map();
  for (const iconComponent of Object.values(icons)) {
    const data = iconComponent?.icon;
    if (data?.name) byName.set(data.name, data);
  }

  const selected = {};
  const missing = [];
  for (const name of NAMES) {
    const data = byName.get(LUCIDE_NAME[name] ?? name);
    if (!data) missing.push(name);
    else selected[name] = data;
  }
  if (missing.length > 0) {
    throw new Error(
      `@lucide/angular no tiene ${missing.length} icono(s) del registro: ${missing.join(', ')}. ` +
        'Comprueba el nombre en https://lucide.dev/icons antes de tocar NAMES.',
    );
  }
  return selected;
}

function render(data) {
  const body = Object.entries(data)
    .map(([name, icon]) => `  '${name}': ${JSON.stringify(icon)},`)
    .join('\n');

  return `/**
 * GENERADO — no se edita a mano.  Regenerar con:  node scripts/gen-icon-data.mjs
 *
 * Datos de los ${Object.keys(data).length} iconos que la interfaz referencia, copiados de
 * \`@lucide/angular\` (el paquete instalado, así que la versión y el trazo son los
 * mismos que documenta \`package.json\`). Se guardan aquí, y no se importan las clases
 * del paquete, porque cada clase arrastra una plantilla Angular completa que este
 * design system no usa: \`fc-icon\` pinta con \`LucideDynamicIcon\` a partir de estos
 * datos. Los \`key\` de cada nodo se conservan: la plantilla los usa para el \`track\`
 * del \`@for\`, y sin ellos el DOM se redibujaría en cada cambio.
 *
 * El SVG resultante es idéntico al que producían las clases.
 */
import type { LucideIconData } from '@lucide/angular';

export const ICON_DATA = {
${body}
} satisfies Record<string, LucideIconData>;
`;
}

const data = await loadIconData();
const output = render(data);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    console.error('✗ icon-data.ts no coincide con scripts/gen-icon-data.mjs — ejecútalo.');
    process.exit(1);
  }
  console.log('✅ icon-data.ts al día con el paquete de iconos instalado.');
} else {
  writeFileSync(target, output, 'utf8');
  console.log(`✅ ${target} — ${Object.keys(data).length} iconos, ${output.length} B`);
}
