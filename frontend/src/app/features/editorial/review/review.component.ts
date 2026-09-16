import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';

import {
  BadgeComponent,
  BannerComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  SkeletonComponent,
  type BadgeTone,
} from '../../../shared/ui';
import { AuthService } from '../../../core/auth/auth.service';
import { EditorialApiService, EditorialError } from '../editorial-api.service';
import { ArticleVersion } from '../editorial.types';
import { authorLabel, versionStateLabel, versionStateTone } from '../version-state';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Bandeja de revisión del coordinador editorial (T168, FR-008; T066/T067 de 003,
 * FR-115/FR-116).
 *
 * Lista las versiones en `en_revision` de CUALQUIER editor y ofrece la decisión de forma
 * destacada: aprobar publica de inmediato (`ApproveAndPublish` es atómico y el Gateway ya
 * exige el rol).
 *
 * ─── POR QUÉ NO HAY «RECHAZAR» (FR-115, hallazgo) ──────────────────────────────
 *
 * FR-115 pide presentar la decisión de aprobar **o rechazar**, y la segunda mitad **no se
 * puede ofrecer**: Aprendizaje no tiene ninguna transición que saque una versión de
 * `en_revision` salvo publicarla. Las cinco que existen son `borrador → en_revision`
 * (SubmitForReview), `en_revision → publicado` (ApproveAndPublish), `publicado → archivado`
 * (Archive) y la edición de un borrador; no hay RPC de rechazo en el proto ni ruta en el
 * contrato. `Archive` **no** sirve: responde `FailedPrecondition` —«la versión … no está
 * publicada (estado actual: en_revision)»— y el Gateway lo colapsa en un `400` sin causa.
 *
 * Se descubrió pulsando el botón contra el servicio real: la prueba unitaria lo daba por
 * bueno porque simulaba la API. Aquí se decidió **quitar el botón** en vez de dejar una
 * acción que siempre falla; inventar la transición sería cambiar una regla de negocio, y
 * 003 es solo presentación (FR-121). Queda como hallazgo para 002 → `findings.md`.
 *
 * ─── LA REGLA DE FR-008 NO SE DUPLICA AQUÍ ─────────────────────────────────────
 *
 * Que un coordinador no pueda aprobar su propio contenido lo decide Aprendizaje, y el
 * Gateway solo puede exigir el ROL. Esta pantalla no lo comprueba por su cuenta: **explica**
 * el desenlace cuando el borde lo rechaza (`EditorialError.kind === 'forbidden'`), con un
 * aviso distinto del de un error genérico, porque el dato no es el problema. Lo único que se
 * añade es la frase que describe la regla, que no decide nada (FR-116).
 */
@Component({
  selector: 'fc-review',
  standalone: true,
  imports: [
    DatePipe,
    BadgeComponent,
    BannerComponent,
    ButtonComponent,
      EmptyStateComponent,
    ErrorStateComponent,
    SkeletonComponent,
  ],
  templateUrl: './review.component.html',
  styleUrl: './review.component.css',
})
export class ReviewComponent implements OnInit {
  private readonly api = inject(EditorialApiService);
  private readonly auth = inject(AuthService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<ArticleVersion[]>([]);
  /** `version_id` de la versión cuya decisión está en vuelo. */
  protected readonly deciding = signal<string | null>(null);
  protected readonly errorMessage = signal<string | null>(null);
  /** El rechazo de FR-008: merece un aviso distinto, no el error genérico. */
  protected readonly selfApprovalBlocked = signal(false);

  public ngOnInit(): void {
    this.load();
  }

  protected retry(): void {
    this.state.set('loading');
    this.load();
  }

  protected preview(version: ArticleVersion): string {
    const body = version.body ?? '';
    return body.length > 240 ? `${body.slice(0, 240)}…` : body;
  }

  protected authorOf(version: ArticleVersion): string {
    return authorLabel(version.created_by, this.auth.userId());
  }

  protected stateLabel(state: string): string {
    return versionStateLabel(state);
  }

  protected stateTone(state: string): BadgeTone {
    return versionStateTone(state);
  }

  protected isBusy(version: ArticleVersion): boolean {
    return this.deciding() === version.version_id;
  }

  protected onApprove(version: ArticleVersion): void {
    this.decide(version, this.api.approveAndPublish(version.version_id));
  }

  private decide(version: ArticleVersion, request: ReturnType<EditorialApiService['approveAndPublish']>): void {
    if (this.deciding() !== null) {
      return;
    }
    this.deciding.set(version.version_id);
    this.errorMessage.set(null);
    this.selfApprovalBlocked.set(false);

    request.subscribe({
      next: () => {
        this.deciding.set(null);
        // La decisión saca la versión de la cola: ya no está pendiente.
        this.items.set(this.items().filter((candidate) => candidate.version_id !== version.version_id));
      },
      error: (err: unknown) => {
        this.deciding.set(null);
        if (err instanceof EditorialError && err.kind === 'forbidden') {
          this.selfApprovalBlocked.set(true);
          this.errorMessage.set(err.message);
          return;
        }
        this.errorMessage.set(err instanceof EditorialError ? err.message : 'No pudimos publicar el artículo.');
      },
    });
  }

  private load(): void {
    this.state.set('loading');
    this.api.listVersions({ state: 'en_revision' }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
