import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';

import { ProfileService } from '../profile/profile.service';
import { InAppNotification } from '../profile/profile.types';

type LoadState = 'loading' | 'ready' | 'error';

const TYPE_LABELS: Record<string, string> = {
  nuevo_articulo: 'Nuevo artículo',
  recordatorio: 'Recordatorio',
  hito_progreso: 'Hito de progreso',
  resultado_cuestionario: 'Resultado de cuestionario',
};

/** Bandeja in-app con estado de lectura y marca temporal (T149, FR-023). */
@Component({
  selector: 'fc-notifications',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './notifications.component.html',
})
export class NotificationsComponent implements OnInit {
  private readonly api = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<InAppNotification[]>([]);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly loadingMore = signal(false);

  public ngOnInit(): void {
    this.api.listNotifications(undefined).subscribe({
      next: (page) => {
        this.items.set(page.items);
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
    this.api.listNotifications(token).subscribe({
      next: (page) => {
        this.items.set([...this.items(), ...page.items]);
        this.nextPageToken.set(page.next_page_token);
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  /**
   * Marca como leída de forma OPTIMISTA: la bandeja actualiza el estado local
   * de inmediato y solo lo revierte si el borde rechaza la petición. Esperar
   * la respuesta antes de reflejar el clic haría que cada notificación tardara
   * un viaje de red en dejar de verse «no leída».
   */
  protected markRead(item: InAppNotification): void {
    if (item.read_state === 'read') {
      return;
    }
    this.items.set(this.items().map((n) => (n.id === item.id ? { ...n, read_state: 'read' } : n)));
    this.api.markNotificationRead(item.id).subscribe({
      error: () => {
        this.items.set(this.items().map((n) => (n.id === item.id ? { ...n, read_state: 'unread' } : n)));
      },
    });
  }

  protected typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }
}
