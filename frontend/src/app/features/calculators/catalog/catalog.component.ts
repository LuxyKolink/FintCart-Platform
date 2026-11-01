import { Component, OnInit, inject, signal } from '@angular/core';

import {
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  SkeletonComponent,
  TagComponent,
} from '../../../shared/ui';
import { calculatorTitle } from '../calculator-title';
import { CalculatorsApiService } from '../calculators-api.service';
import { Calculator } from '../calculator.types';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Catálogo público de calculadoras (T119, FR-052, FR-111).
 *
 * ## Por qué es una pantalla y no una sección de la de simuladores
 *
 * Las cinco calculadoras de la plataforma están EN EL CÓDIGO: su formulario, sus campos y sus
 * textos son configuración (`calculators.config.ts`, `simulators/`). Una calculadora de usuario
 * no está en el código —lo que la define es su fila en la base, con su AST— y por eso su
 * ejecución arma el formulario a partir de la definición (ver `runner.component.ts`). Son dos
 * mecanismos distintos, y mezclarlos en una lista dejaría al usuario sin saber si está ante una
 * calculadora de la plataforma o de otra persona.
 *
 * ## Lo que el catálogo NO filtra
 *
 * No pide «solo las publicadas» y luego filtra en el cliente: pide `GET /calculators`, que es
 * público y devuelve **únicamente** lo aprobado. El filtro vive en la consulta del Simulador, no
 * en esta pantalla — una lista que recibiera todo y escondiera parte estaría a un error de
 * plantilla de enseñar una calculadora privada (FR-051).
 *
 * ## Por qué el título no es `calculator.name` tal cual
 *
 * En las diez definiciones semilla ese campo es el IDENTIFICADOR (`ahorro`, `cdt_dias`,
 * `mv_a_ea`): imprimirlo daba títulos en minúsculas con guiones bajos, que a un lector no le
 * dicen qué calculadora abre. `calculatorTitle` lo convierte en una frase sin inventar
 * contenido financiero —ver el porqué completo en `calculator-title.ts`— y deja intacto el
 * nombre que un autor escribió a mano.
 */
@Component({
  selector: 'fc-calculators-catalog',
  standalone: true,
  imports: [
    EmptyStateComponent,
    ErrorStateComponent,
    LinkButtonComponent,
    SkeletonComponent,
    TagComponent,
  ],
  templateUrl: './catalog.component.html',
  styles: `
    :host {
      display: block;
      max-width: var(--content-max);
    }

    .fc-catc__head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    /* h1 de página: escalón display del brief §3 (38 / 1.15 / 500 / -0.02em). */
    .fc-catc__title {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-display);
      line-height: var(--lh-display);
      font-weight: var(--fw-display);
      letter-spacing: var(--ls-display);
      color: var(--text-strong);
      overflow-wrap: anywhere;
    }

    .fc-catc__intro {
      margin: 0;
      max-width: var(--reading-max);
      font-size: var(--fs-ui);
      color: var(--text-body);
    }

    .fc-catc__lista {
      list-style: none;
      margin: var(--space-6) 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      border-top: var(--border-hairline) solid var(--fc-line);
    }

    .fc-catc__fila + .fc-catc__fila {
      border-top: var(--border-hairline) solid var(--fc-line);
    }

    .fc-catc__calculadora {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      padding: var(--space-5) 0;
    }

    .fc-catc__cabecera {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      flex-wrap: wrap;
    }

    /* Título de bloque: el escalón h3 del brief §3 (19 / 1.35 / 600). */
    .fc-catc__nombre {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-h3);
      line-height: var(--lh-h3);
      font-weight: var(--fw-h3);
      letter-spacing: var(--ls-h3);
      color: var(--text-strong);
    }

    .fc-catc__descripcion {
      margin: 0;
      max-width: var(--reading-max);
      font-size: var(--fs-ui);
      color: var(--text-body);
    }

    .fc-catc__pie {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2) var(--space-4);
      flex-wrap: wrap;
    }

    .fc-catc__procedencia {
      color: var(--text-muted);
      font-size: var(--fs-meta);
    }
  `,
})
export class CalculatorsCatalogComponent implements OnInit {
  private readonly api = inject(CalculatorsApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<Calculator[]>([]);

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  /** Las de la plataforma y las de usuarios, separadas para poder decirlo. */
  protected isBuiltin(calculator: Calculator): boolean {
    return calculator.is_builtin;
  }

  /** El nombre legible: el de la semilla es un identificador, no un título. */
  protected title(calculator: Calculator): string {
    return calculatorTitle(calculator.name);
  }

  private load(): void {
    this.state.set('loading');
    this.api.listCatalog().subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
