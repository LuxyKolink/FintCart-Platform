import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CalculatorMode, FieldKind, ResultKind, calculatorFor } from '../calculators.config';
import * as resultFormat from '../result-format';
import { SimulatorsService } from '../simulators.service';
import { SimulationHistoryEntry } from '../simulators.types';

type LoadState = 'loading' | 'ready' | 'error';

interface Row {
  label: string;
  value: string;
}

/** Historial de simulaciones del usuario (T127, FR-022). */
@Component({
  selector: 'fc-simulation-history',
  standalone: true,
  imports: [RouterLink, DatePipe],
  templateUrl: './history.component.html',
})
export class HistoryComponent implements OnInit {
  private readonly api = inject(SimulatorsService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly entries = signal<SimulationHistoryEntry[]>([]);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly loadingMore = signal(false);

  public ngOnInit(): void {
    this.state.set('loading');
    this.api.listHistory(undefined).subscribe({
      next: (page) => {
        this.entries.set(page.items);
        this.nextPageToken.set(page.next_page_token);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  protected loadMore(): void {
    const token = this.nextPageToken();
    if (token === undefined || token === '' || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.api.listHistory(token).subscribe({
      next: (page) => {
        this.entries.set([...this.entries(), ...page.items]);
        this.nextPageToken.set(page.next_page_token);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  protected calcLabel(entry: SimulationHistoryEntry): string {
    return calculatorFor(entry.calc_type)?.label ?? entry.calc_type;
  }

  protected inputRows(entry: SimulationHistoryEntry): Row[] {
    const mode = this.modeFor(entry);
    return Object.entries(entry.inputs)
      .filter(([key]) => key !== 'operacion')
      .map(([key, value]) => {
        const field = mode?.fields.find((f) => f.key === key);
        return { label: field?.label ?? key, value: this.formatValue(value, field?.kind) };
      });
  }

  protected resultRows(entry: SimulationHistoryEntry): Row[] {
    const mode = this.modeFor(entry);
    return Object.entries(entry.result).map(([key, value]) => {
      const resultField = mode?.resultFields.find((f) => f.key === key);
      return { label: resultField?.label ?? key, value: this.formatValue(value, resultField?.kind) };
    });
  }

  private modeFor(entry: SimulationHistoryEntry): CalculatorMode | undefined {
    const def = calculatorFor(entry.calc_type);
    if (def === undefined) {
      return undefined;
    }
    if (def.modes.length === 1) {
      return def.modes[0];
    }
    const operation = entry.inputs['operacion'];
    return def.modes.find((m) => m.value === operation) ?? def.modes[0];
  }

  private formatValue(raw: string, kind: FieldKind | ResultKind | undefined): string {
    try {
      if (kind === 'money') {
        return resultFormat.formatMoney(raw);
      }
      if (kind === 'rate') {
        return resultFormat.formatRate(raw);
      }
    } catch {
      // Un valor histórico que ya no cumple el formato canónico (no debería ocurrir)
      // se muestra tal cual en lugar de romper toda la fila.
    }
    return raw;
  }
}
