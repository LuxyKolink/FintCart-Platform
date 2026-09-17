import { Component, OnInit, inject, signal } from '@angular/core';

import {
  BannerComponent,
  CardComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  ModuleBoxComponent,
  SkeletonComponent,
  TagComponent,
} from '../../../shared/ui';
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
 */
@Component({
  selector: 'fc-calculators-catalog',
  standalone: true,
  imports: [
    BannerComponent,
    CardComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LinkButtonComponent,
    ModuleBoxComponent,
    SkeletonComponent,
    TagComponent,
  ],
  templateUrl: './catalog.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-catc__intro {
      max-width: 68ch;
      color: var(--text-body);
    }
    .fc-catc__rejilla {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    .fc-catc__tarjeta {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      height: 100%;
    }
    .fc-catc__cabecera {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-catc__nombre {
      margin: 0;
      font-size: var(--fs-md);
      font-weight: var(--fw-semibold);
    }
    .fc-catc__descripcion {
      flex: 1 1 auto;
      color: var(--text-body);
    }
    .fc-catc__pie {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fc-catc__procedencia {
      color: var(--text-faint);
      font-size: var(--fs-sm);
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
