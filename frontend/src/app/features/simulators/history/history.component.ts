import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';

import {
  BadgeComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  LinkButtonComponent,
  SkeletonComponent,
} from '../../../shared/ui';
import { calcLabelOf, inputRows, provenanceOf, resultRows } from '../history-rows';
import { SimulatorsService } from '../simulators.service';
import { SimulationHistoryEntry } from '../simulators.types';

type LoadState = 'loading' | 'ready' | 'error';

/** Una fila con sus parámetros y su resultado ya resueltos, para no resolverlos dos veces. */
interface HistoryRow {
  readonly entry: SimulationHistoryEntry;
  readonly label: string;
  readonly inputs: readonly { label: string; value: string }[];
  readonly results: readonly { label: string; value: string }[];
  /** Con qué definición se calculó: `v3`, o vacío si no hay versión que citar (T110). */
  readonly version: string;
  /** Indicadores usados, con su valor tal como se resolvió ese día (FR-058). */
  readonly indicators: readonly { label: string; value: string }[];
}

/**
 * Historial de simulaciones (T047, FR-022, FR-110).
 *
 * Una TABLA y no una lista de tarjetas: FR-110 pide poder **comparar** ejecuciones sin
 * abrir cada una, y comparar es mirar valores en la misma columna. Los parámetros y el
 * resultado de cada simulación se muestran en su fila, ya formateados, así que no hay
 * nada que desplegar para verlos.
 *
 * La tabla NO se desplaza en horizontal (frase que sustituye a la que describía FR-127):
 * un desplazamiento dejaba las cifras cortadas en el borde a 360 px, y una cifra cortada
 * es un dato falso (N-15). Por encima de `--bp-md` se lee en cuatro columnas; por debajo,
 * la misma tabla se dispone como fichas apiladas con la etiqueta encima del valor.
 */
@Component({
  selector: 'fc-simulation-history',
  standalone: true,
  imports: [
    DatePipe,
    BadgeComponent,
    ButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    LinkButtonComponent,
    SkeletonComponent,
  ],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent implements OnInit {
  private readonly api = inject(SimulatorsService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly loadingMore = signal(false);

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.load();
  }

  protected loadMore(): void {
    const token = this.nextPageToken();
    if (token === undefined || token === '' || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.api.listHistory(token).subscribe({
      next: (page) => {
        this.rows.set([...this.rows(), ...page.items.map((entry) => this.toRow(entry))]);
        this.nextPageToken.set(page.next_page_token);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private load(): void {
    this.state.set('loading');
    this.api.listHistory(undefined).subscribe({
      next: (page) => {
        this.rows.set(page.items.map((entry) => this.toRow(entry)));
        this.nextPageToken.set(page.next_page_token);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  private toRow(entry: SimulationHistoryEntry): HistoryRow {
    const procedencia = provenanceOf(entry);
    return {
      entry,
      label: calcLabelOf(entry),
      inputs: inputRows(entry),
      results: resultRows(entry),
      version: procedencia.version,
      indicators: procedencia.indicators,
    };
  }
}
