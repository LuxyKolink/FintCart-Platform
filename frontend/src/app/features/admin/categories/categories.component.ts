import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import {
  BadgeComponent,
  ButtonComponent,
  InputComponent,
  ModuleBoxComponent,
} from '../../../shared/ui';
import { Category } from '../../learning/learning.types';

import { AdminApiService, AdminError } from '../admin-api.service';

type LoadState = 'loading' | 'ready' | 'error';
type Busy = 'create' | 'update' | 'deactivate' | null;

/**
 * Administración del catálogo de categorías (US1, T058 — FR-032…FR-035).
 *
 * Alta, edición (incluido el reordenamiento por posición) y desactivación lógica.
 * La lista consume `/admin/categories`, que SÍ incluye las desactivadas — la pantalla
 * debe poder verlas para no perder de vista el orden histórico, pero no puede ofrecer
 * editarlas: el repositorio de Aprendizaje rechaza editar una categoría inactiva y no
 * existe RPC de reactivación en US1 (FR-033).
 *
 * El desenlace de FR-035 (desactivar con artículos publicados) llega como un `409` con
 * `published_count` traducido por `AdminError` a un mensaje que dice CUÁNTOS artículos
 * hay que reasignar — nunca un «no se puede» seco.
 */
@Component({
  selector: 'fc-admin-categories',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModuleBoxComponent,
    InputComponent,
    ButtonComponent,
    BadgeComponent,
  ],
  templateUrl: './categories.component.html',
  styles: `
    :host {
      display: block;
    }
    .fc-admin-form {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .fc-admin-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .fc-admin-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .fc-admin-row__main {
      flex: 1 1 240px;
      min-width: 0;
    }
    .fc-admin-field {
      flex: 1 1 200px;
      min-width: 0;
    }
    .fc-admin-row__name {
      font-weight: var(--fw-semibold);
    }
    .fc-admin-row__meta {
      margin-top: var(--space-1);
      color: var(--text-faint);
      font-size: var(--fs-sm);
    }
    .fc-admin-actions {
      display: flex;
      gap: var(--space-2);
    }
  `,
})
export class CategoriesComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(AdminApiService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly categories = signal<Category[]>([]);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly successMessage = signal<string | null>(null);
  protected readonly busy = signal<Busy>(null);
  /** `category_id` de la fila en edición, o `null` si ninguna. */
  protected readonly editingId = signal<string | null>(null);

  protected readonly activeCategories = computed<Category[]>(() =>
    this.categories().filter((category) => category.active),
  );
  protected readonly inactiveCategories = computed<Category[]>(() =>
    this.categories().filter((category) => !category.active),
  );

  protected readonly createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
  });

  protected readonly editForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    description: [''],
    position: ['', [Validators.required, Validators.pattern(/^[1-9]\d*$/)]],
  });

  public ngOnInit(): void {
    this.reload();
  }

  protected onCreate(): void {
    if (this.createForm.invalid || this.busy() !== null) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.busy.set('create');
    this.clearBanners();
    const raw = this.createForm.getRawValue();
    // Sin posición: `≤ 0` anexa al final de las activas (semántica del servicio).
    this.api
      .createCategory({ name: raw.name.trim(), description: raw.description.trim() })
      .subscribe({
        next: (created) => {
          this.busy.set(null);
          this.createForm.reset();
          this.successMessage.set(`Categoría «${created.name}» creada.`);
          this.reload();
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.errorMessage.set(this.messageOf(err));
        },
      });
  }

  protected startEdit(category: Category): void {
    this.editingId.set(category.category_id);
    this.clearBanners();
    this.editForm.setValue({
      name: category.name,
      description: category.description,
      position: String(category.position),
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.editForm.reset();
  }

  protected onSaveEdit(category: Category): void {
    if (this.editForm.invalid || this.busy() !== null) {
      this.editForm.markAllAsTouched();
      return;
    }
    this.busy.set('update');
    this.clearBanners();
    const raw = this.editForm.getRawValue();
    this.api
      .updateCategory(category.category_id, {
        name: raw.name.trim(),
        description: raw.description.trim(),
        position: Number(raw.position),
      })
      .subscribe({
        next: (updated) => {
          this.busy.set(null);
          this.editingId.set(null);
          this.editForm.reset();
          this.successMessage.set(`Categoría «${updated.name}» guardada.`);
          this.reload();
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.errorMessage.set(this.messageOf(err));
        },
      });
  }

  protected onDeactivate(category: Category): void {
    if (this.busy() !== null) {
      return;
    }
    this.busy.set('deactivate');
    this.clearBanners();
    this.api.deactivateCategory(category.category_id).subscribe({
      next: () => {
        this.busy.set(null);
        this.successMessage.set(
          `Categoría «${category.name}» desactivada: ya no se ofrece al editor.`,
        );
        this.reload();
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.errorMessage.set(this.messageOf(err));
      },
    });
  }

  private reload(): void {
    this.state.set('loading');
    this.api.listCategories().subscribe({
      next: (categories) => {
        this.categories.set(categories);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }

  private clearBanners(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }

  private messageOf(error: unknown): string {
    return error instanceof AdminError
      ? error.message
      : 'No pudimos completar la operación. Intenta de nuevo.';
  }
}
