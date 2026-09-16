/**
 * Barrera de accesibilidad de 003 (FR-093…FR-096, SC-030…SC-032).
 *
 * POR QUÉ NO HAY UNA LIBRERÍA DE AXE: el Technical Context prohíbe dependencias
 * nuevas, y `@axe-core/playwright` no está instalado. Las tres comprobaciones que el
 * feature exige —recorrido por teclado, etiqueta asociada y contraste AA— se miden
 * aquí contra el navegador real, que es además el único juez válido: el contraste
 * depende del color computado, no del token que se escribió.
 *
 * ALCANCE HONESTO: esto NO es una auditoría WCAG completa. Verifica lo que los
 * criterios de éxito piden y lo que las suites ya ejercitan por rol; no cubre, por
 * ejemplo, regiones vivas ni orden de lectura de lectores de pantalla.
 */
import { expect, type Locator, type Page } from '@playwright/test';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface ContrastFailure {
  text: string;
  ratio: number;
  minimum: number;
  color: string;
  background: string;
}

interface FocusObservation {
  key: string;
  name: string;
  hasRing: boolean;
  hasShadow: boolean;
}
/** Controles que un lector de pantalla debe poder anunciar con un nombre. */
const CONTROLS = 'input:not([type="hidden"]), select, textarea';

/**
 * Nombre accesible para un subconjunto suficiente de casos: `aria-label`,
 * `aria-labelledby`, `<label for>`/`<label>` envolvente y `title`. No es el algoritmo
 * completo de ARIA (no resuelve `aria-description` ni roles), pero es exactamente el
 * que usa esta interfaz.
 */
async function accessibleName(locator: Locator): Promise<string> {
  return locator.evaluate((element: HTMLElement) => {
    const labelledBy = element.getAttribute('aria-labelledby');
    const referenced =
      labelledBy === null
        ? ''
        : labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ');
    const labels =
      element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
        ? Array.from(element.labels ?? [])
            .map((label) => label.textContent ?? '')
            .join(' ')
        : '';
    const candidates = [
      element.getAttribute('aria-label'),
      referenced,
      labels,
      element.getAttribute('title'),
    ];
    const found = candidates.find((candidate) => candidate !== null && candidate.trim() !== '');
    return (found ?? '').trim().replace(/\s+/gu, ' ');
  });
}

async function describe(locator: Locator): Promise<string> {
  return locator.evaluate((element: HTMLElement) => {
    const tag = element.tagName.toLowerCase();
    const type = element.getAttribute('type');
    const id = element.id;
    return `<${tag}${type === null ? '' : ` type="${type}"`}${id === '' ? '' : ` id="${id}"`}>`;
  });
}

/** FR-095 / SC-031: todo control de formulario tiene etiqueta asociada y anunciable. */
export async function expectControlsAreLabelled(page: Page): Promise<void> {
  const controls = page.locator(CONTROLS);
  const total = await controls.count();
  const unnamed: string[] = [];

  for (let index = 0; index < total; index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) {
      continue;
    }
    const name = await accessibleName(control);
    if (name === '') {
      unnamed.push(await describe(control));
    }
  }

  expect(unnamed, 'controles de formulario sin nombre accesible (FR-095)').toEqual([]);
}

/**
 * FR-093/FR-094 / SC-030: la pantalla se recorre con Tab, y cada parada muestra un
 * indicador de foco VISIBLE. No se fija el orden exacto —eso ataría el test a la
 * maquetación—, pero sí que las acciones declaradas sean alcanzables: si el teclado
 * no llega a «Enviar», la pantalla no cumple.
 */
export async function expectKeyboardReaches(
  page: Page,
  expected: readonly string[],
  maxStops = 60,
): Promise<void> {
  /**
   * El recorrido empieza SIEMPRE por el principio del documento.
   *
   * Sin esto, mediría otra cosa: tras una navegación interna (`routerLink`), Chromium
   * sigue tabulando desde donde estaba el enlace que se acaba de pulsar, así que el
   * recorrido arrancaría a mitad de la página y el armazón —cabecera y navegación—
   * quedaría para el final. Se vio en el lector: el primer tabulador entraba en el
   * cuerpo del artículo y la barra superior no aparecía hasta después de dar la vuelta.
   *
   * El contador de identidad de parada también se limpia: en una SPA el contenedor del
   * documento sobrevive a la navegación, y los índices de la pantalla anterior dejaron
   * de corresponder a elementos que ya no existen.
   */
  await page.evaluate((): void => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    document.body.tabIndex = -1;
    document.body.focus();
    for (const tagged of document.querySelectorAll('[data-fc-focus]')) {
      tagged.removeAttribute('data-fc-focus');
    }
    document.documentElement.dataset['fcFocusCounter'] = '0';
  });

  const reached: string[] = [];
  const withoutIndicator: string[] = [];
  const focusKeys = new Set<string>();

  for (let stop = 0; stop < maxStops; stop += 1) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate((): FocusObservation | null => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) {
        return null;
      }

      /**
       * FR-094: ¿señala el foco este elemento? El design system lo señala de dos
       * maneras: un `outline` (enlaces, controles nativos) o un anillo de
       * `box-shadow`, que a veces vive en el contenedor que envuelve al control
       * (`fc-input` pinta el anillo en `.fc-field__control:focus-within`). Por eso
       * se sube por los ancestros: el anillo del contenedor es una señal legítima.
       *
       * Un `box-shadow` solo cuenta si su color es opaco. Las sombras decorativas
       * del sistema van con alfa 0.04–0.16, así que exigir alfa ≥ 0.4 convierte la
       * comprobación en algo que una sombra estática no satisface por accidente:
       * antes, un botón sin anillo pasaba por llevar `--shadow-xs`.
       */
      const focusIndicator = (start: HTMLElement): Pick<FocusObservation, 'hasRing' | 'hasShadow'> => {
        const isStrongShadow = (value: string): boolean => {
          if (value === 'none') {
            return false;
          }
          const colors = value.match(/rgba?\([^)]+\)/g) ?? [];
          return colors.some((color) => {
            const parts =
              /rgba?\(([^)]+)\)/u
                .exec(color)?.[1]
                .split(',')
                .map((part) => Number.parseFloat(part.trim())) ?? [];
            return (parts.length > 3 ? parts[3] : 1) >= 0.4;
          });
        };

        let ring = false;
        let shadow = false;
        let node: HTMLElement | null = start;
        for (let depth = 0; node !== null && depth < 4; depth += 1, node = node.parentElement) {
          const style = getComputedStyle(node);
          ring = ring || (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0);
          shadow = shadow || isStrongShadow(style.boxShadow);
          if (ring || shadow) {
            break;
          }
        }
        return { hasRing: ring, hasShadow: shadow };
      };

      // Identidad de parada por índice asignado una sola vez: `tag+class` colisiona
      // entre enlaces hermanos y haría creer que el recorrido cicló antes de tiempo.
      const root = document.documentElement;
      let index = element.dataset['fcFocus'];
      if (index === undefined) {
        const next = (Number.parseInt(root.dataset['fcFocusCounter'] ?? '0', 10) + 1).toString();
        root.dataset['fcFocusCounter'] = next;
        element.dataset['fcFocus'] = next;
        index = next;
      }

      const labelledBy = element.getAttribute('aria-labelledby');
      const referenced =
        labelledBy === null
          ? ''
          : labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? '')
              .join(' ');
      const labels =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? Array.from(element.labels ?? [])
              .map((label) => label.textContent ?? '')
              .join(' ')
          : '';
      const name = [
        element.getAttribute('aria-label'),
        referenced,
        labels,
        element.textContent,
        element.getAttribute('name'),
      ]
        .find((candidate) => candidate !== null && candidate.trim() !== '')
        ?.trim()
        .replace(/\s+/gu, ' ')
        .slice(0, 60) ?? '';

      return {
        key: index,
        name,
        ...focusIndicator(element),
      };
    });

    if (focused === null) {
      break;
    }
    if (reached.length > 0 && focusKeys.has(focused.key)) {
      break;
    }
    focusKeys.add(focused.key);
    reached.push(focused.name);
    if (!focused.hasRing && !focused.hasShadow) {
      withoutIndicator.push(focused.name);
    }
  }

  for (const action of expected) {
    expect(
      reached.some((name) => name.includes(action)),
      `el teclado no alcanzó «${action}». Paradas: ${reached.join(' | ')}`,
    ).toBe(true);
  }
  expect(withoutIndicator, 'controles enfocados sin indicador visible (FR-094)').toEqual([]);
}

/**
 * FR-096 / SC-032: contraste AA del texto visible. El fondo efectivo se busca
 * subiendo por los ancestros hasta encontrar un color opaco, porque el color de
 * fondo computado de un elemento con degradado es transparente.
 */
export async function expectTextMeetsAaContrast(page: Page): Promise<void> {
  const failures = await page.evaluate((): ContrastFailure[] => {
    const parseColor = (value: string): Rgba | null => {
      const match = /rgba?\(([^)]+)\)/u.exec(value);
      if (match === null) {
        return null;
      }
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };

    const channel = (value: number): number => {
      const normalized = value / 255;
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };

    const luminance = (color: Rgba): number =>
      0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);

    const ratio = (one: Rgba, other: Rgba): number => {
      const a = luminance(one);
      const b = luminance(other);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const effectiveBackground = (element: HTMLElement): Rgba => {
      let node: HTMLElement | null = element;
      while (node !== null) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color !== null && color.a > 0.05) {
          return color;
        }
        node = node.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };

    const results: ContrastFailure[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node !== null) {
      const text = (node.textContent ?? '').trim();
      const element = node.parentElement;
      if (text === '' || element === null) {
        node = walker.nextNode();
        continue;
      }
      if (
        element.closest('[aria-hidden="true"]') !== null ||
        ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName)
      ) {
        node = walker.nextNode();
        continue;
      }

      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const foreground = parseColor(style.color);
      const hidden =
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        Number.parseFloat(style.opacity) < 0.1 ||
        rect.width === 0 ||
        rect.height === 0;

      if (!hidden && foreground !== null && foreground.a >= 0.5) {
        const background = effectiveBackground(element);
        const actual = ratio(foreground, background);
        const size = Number.parseFloat(style.fontSize);
        const bold = Number.parseInt(style.fontWeight, 10) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const minimum = large ? 3 : 4.5;
        if (actual < minimum) {
          results.push({
            text: text.slice(0, 48),
            ratio: Math.round(actual * 100) / 100,
            minimum,
            color: style.color,
            background: `rgb(${background.r}, ${background.g}, ${background.b})`,
          });
        }
      }

      node = walker.nextNode();
    }

    return results;
  });

  expect(failures, 'texto por debajo del contraste AA (FR-096)').toEqual([]);
}

/** Ejecuta las tres comprobaciones sobre la pantalla en la que está la página. */
export async function expectScreenIsAccessible(page: Page, expectedActions: readonly string[]): Promise<void> {
  await expectControlsAreLabelled(page);
  await expectTextMeetsAaContrast(page);
  await expectKeyboardReaches(page, expectedActions);
}
