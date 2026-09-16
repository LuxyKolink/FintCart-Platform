import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';

import {
  BadgeComponent,
  ButtonComponent,
  EmptyStateComponent,
  ErrorStateComponent,
  IconComponent,
  LinkButtonComponent,
  SkeletonComponent,
  type BadgeTone,
} from '../../shared/ui';
import { ProfileService } from '../profile/profile.service';
import { InAppNotification } from '../profile/profile.types';
import { notificationTypeLabel } from './notification-labels';
import { NotificationText, notificationText } from './notification-text';

type LoadState = 'loading' | 'ready' | 'error';

/** Una entrada con su texto ya resuelto, para no resolverlo dos veces por ciclo. */
interface NotificationEntry {
  readonly item: InAppNotification;
  readonly text: NotificationText;
}

const TONE_BY_TYPE: Record<string, BadgeTone> = {
  resultado_cuestionario: 'brand',
  hito_progreso: 'accent',
  nuevo_articulo: 'info',
  recordatorio: 'neutral',
};

/**
 * Bandeja in-app con estado de lectura y marca temporal (FR-023, FR-106, T036).
 *
 * LO LEÍDO Y LO NO LEÍDO SE DISTINGUEN POR TRES SEÑALES, no por color: fondo distinto,
 * peso de la tipografía y la etiqueta «sin leer». El color solo no basta —hay daltonismo
 * y hay pantallas mal calibradas— y FR-106 pide que se distinga «de un vistazo», no
 * «si el matiz se percibe».
 *
 * `MarkNotificationRead` es idempotente y ya se aplicaba de forma optimista; el botón
 * se muestra solo en lo no leído, así que no hay forma de dispararlo dos veces por la
 * misma entrada.
 */
@Component({
  selector: 'fc-notifications',
  standalone: true,
  imports: [
    DatePipe,
    BadgeComponent,
    ButtonComponent,
    LinkButtonComponent,
    EmptyStateComponent,
    ErrorStateComponent,
    IconComponent,
    SkeletonComponent,
  ],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.css',
})
export class NotificationsComponent implements OnInit {
  private readonly api = inject(ProfileService);

  protected readonly state = signal<LoadState>('loading');
  protected readonly items = signal<InAppNotification[]>([]);
  protected readonly nextPageToken = signal<string | undefined>(undefined);
  protected readonly loadingMore = signal(false);

  protected readonly entries = computed<NotificationEntry[]>(() =>
    this.items().map((item) => ({ item, text: notificationText(item) })),
  );

  protected readonly unreadCount = computed(
    () => this.items().filter((item) => item.read_state === 'unread').length,
  );

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
    return notificationTypeLabel(type);
  }

  protected toneOf(type: string): BadgeTone {
    return TONE_BY_TYPE[type] ?? 'neutral';
  }

  private load(): void {
    this.state.set('loading');
    this.api.listNotifications(undefined).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.nextPageToken.set(page.next_page_token);
        this.state.set('ready');
      },
      error: () => this.state.set('error'),
    });
  }
}
