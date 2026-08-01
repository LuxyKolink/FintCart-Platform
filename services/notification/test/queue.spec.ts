/**
 * Pruebas de la cola persistente con estado (T066, §Calidad).
 *
 * Lo que se fija aquí son los TRES DESENLACES y una propiedad que ninguno de ellos
 * tiene por separado: que el estado sobreviva al desencolado.
 *
 *   éxito                          → fuera de la cola + `sent`
 *   fallo con `attempts < MAX`     → sigue en la cola, contador arriba
 *   fallo con `attempts >= MAX`    → fuera de la cola + `failed` (con la causa)
 *
 * El desenlace que de verdad importa es el tercero. `failed` es lo único que permite
 * responder «ese correo no se envió»; sin ese registro, un fallo permanente sería
 * indistinguible de un evento que nunca llegó, y nadie podría decir cuál de los dos
 * ocurrió.
 *
 * ## Qué NO cubre este archivo
 *
 * El SQL de `PostgresNotificationQueue` no se ejecuta: no hay PostgreSQL en las
 * pruebas unitarias. Lo que se prueba es la DECISIÓN —qué transición corresponde a
 * cada desenlace— contra un doble que modela las dos tablas y hace cumplir los CHECK
 * del esquema (`sent` sin error, `failed` con error). Ese doble es lo que convierte
 * las aserciones en algo más que una comprobación de sí mismo: si el despachador
 * eligiera la transición equivocada, el modelo la rechazaría igual que la base.
 */
import { Dispatcher, type Mailer, type OutgoingEmail } from '../src/email/dispatcher.js';
import type { Logger } from '../src/logger.js';
import type { MetricsSink } from '../src/observability.js';
import type { ClaimedNotification, NewNotification, NotificationQueue } from '../src/repo/queue.js';

// ── doble de las dos tablas ────────────────────────────────────────────────

interface QueueRow {
  eventId: string;
  recipient: string;
  template: NewNotification['template'];
  payload: Record<string, string>;
  attempts: number;
}

interface StateRow {
  state: 'not_sent' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
}

/**
 * Modelo en memoria de `notification_events_queue` + `notification_states`.
 *
 * Hace cumplir los mismos CHECK que el esquema. Sin ellos, una transición mal elegida
 * pasaría la prueba y fallaría contra PostgreSQL en el primer despliegue.
 */
class InMemoryQueue implements NotificationQueue {
  public readonly queue = new Map<string, QueueRow>();
  public readonly states = new Map<string, StateRow>();

  public enqueue(item: NewNotification): Promise<boolean> {
    // `event_id UNIQUE`: la entrega del outbox es at-least-once, así que el mismo
    // evento puede llegar dos veces y no puede producir dos correos.
    if (this.states.has(item.eventId)) {
      return Promise.resolve(false);
    }
    this.queue.set(item.eventId, { ...item, payload: { ...item.payload }, attempts: 0 });
    this.states.set(item.eventId, { state: 'not_sent', attempts: 0, lastError: null });
    return Promise.resolve(true);
  }

  public claimPending(limit: number, maxAttempts: number): Promise<ClaimedNotification[]> {
    const claimed: ClaimedNotification[] = [];
    for (const row of this.queue.values()) {
      if (claimed.length >= limit || row.attempts >= maxAttempts) {
        continue;
      }
      // Reclamar E incrementar en la misma operación, como el `UPDATE ... RETURNING`
      // real: es lo que impide que dos réplicas envíen el mismo correo.
      row.attempts += 1;
      claimed.push({ ...row, payload: { ...row.payload } });
    }
    return Promise.resolve(claimed);
  }

  public markSent(eventId: string, attempts: number): Promise<void> {
    this.queue.delete(eventId);
    // CHECK `notification_states_sent_has_no_error`.
    this.states.set(eventId, { state: 'sent', attempts, lastError: null });
    return Promise.resolve();
  }

  public recordRetry(eventId: string, attempts: number, cause: string): Promise<void> {
    this.states.set(eventId, { state: 'not_sent', attempts, lastError: cause });
    return Promise.resolve();
  }

  public markFailed(eventId: string, attempts: number, cause: string): Promise<void> {
    // CHECK `notification_states_failed_has_error`.
    if (cause === '') {
      throw new Error('notification_states_failed_has_error: un fallo debe registrar su causa');
    }
    this.queue.delete(eventId);
    this.states.set(eventId, { state: 'failed', attempts, lastError: cause });
    return Promise.resolve();
  }

  public finalizeExhausted(maxAttempts: number, cause: string): Promise<number> {
    let closed = 0;
    for (const [eventId, row] of [...this.queue]) {
      if (row.attempts >= maxAttempts) {
        void this.markFailed(eventId, row.attempts, cause);
        closed += 1;
      }
    }
    return Promise.resolve(closed);
  }
}

// ── dobles auxiliares ──────────────────────────────────────────────────────

class RecordingMailer implements Mailer {
  public readonly sent: OutgoingEmail[] = [];
  public failures = 0;

  public constructor(private readonly failTimes = 0) {}

  public send(email: OutgoingEmail): Promise<void> {
    if (this.failures < this.failTimes) {
      this.failures += 1;
      return Promise.reject(new Error('el servidor SMTP rechazó el envío'));
    }
    this.sent.push(email);
    return Promise.resolve();
  }
}

const silentLogger: Logger = { info: () => undefined, error: () => undefined };
const noMetrics: MetricsSink = { observe: () => undefined };

const MAX_ATTEMPTS = 3;

function newDispatcher(queue: NotificationQueue, mailer: Mailer): Dispatcher {
  return new Dispatcher(queue, mailer, silentLogger, noMetrics, {
    maxAttempts: MAX_ATTEMPTS,
    batchSize: 10,
    concurrency: 4,
    intervalMs: 1,
    template: { appBaseUrl: 'https://app.fintcart.co' },
  });
}

const evento: NewNotification = {
  eventId: '22222222-2222-4222-8222-222222222222',
  recipient: 'persona@ejemplo.co',
  template: 'verificacion',
  payload: {
    email: 'persona@ejemplo.co',
    user_id: '3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c',
    verification_token: 'tok-123',
  },
};

// ── los tres desenlaces ────────────────────────────────────────────────────

describe('desenlaces de la cola de notificaciones', () => {
  it('éxito: sale de la cola y queda como sent', async () => {
    const queue = new InMemoryQueue();
    const mailer = new RecordingMailer();
    await queue.enqueue(evento);

    await newDispatcher(queue, mailer).drainOnce();

    expect(mailer.sent).toHaveLength(1);
    expect(queue.queue.has(evento.eventId)).toBe(false);
    expect(queue.states.get(evento.eventId)).toEqual({
      state: 'sent',
      attempts: 1,
      lastError: null,
    });
  });

  it('fallo reintentable: sigue en la cola con el contador arriba', async () => {
    const queue = new InMemoryQueue();
    // Falla una vez; con MAX_ATTEMPTS = 3 el primer intento es reintentable.
    const mailer = new RecordingMailer(1);
    await queue.enqueue(evento);

    await newDispatcher(queue, mailer).drainOnce();

    expect(queue.queue.get(evento.eventId)?.attempts).toBe(1);
    const state = queue.states.get(evento.eventId);
    expect(state?.state).toBe('not_sent');
    expect(state?.lastError).toContain('SMTP');
  });

  it('fallo terminal: sale de la cola y queda como failed con su causa', async () => {
    const queue = new InMemoryQueue();
    const mailer = new RecordingMailer(MAX_ATTEMPTS);
    await queue.enqueue(evento);

    const dispatcher = newDispatcher(queue, mailer);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await dispatcher.drainOnce();
    }

    expect(mailer.sent).toHaveLength(0);
    expect(queue.queue.has(evento.eventId)).toBe(false);
    const state = queue.states.get(evento.eventId);
    expect(state?.state).toBe('failed');
    expect(state?.attempts).toBe(MAX_ATTEMPTS);
    expect(state?.lastError).not.toBeNull();
  });
});

// ── la propiedad que justifica las dos tablas ──────────────────────────────

describe('el estado sobrevive al desencolado', () => {
  it('un evento entregado deja rastro consultable aunque ya no esté en la cola', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue(evento);

    await newDispatcher(queue, new RecordingMailer()).drainOnce();

    expect(queue.queue.size).toBe(0);
    expect(queue.states.size).toBe(1);
  });

  it('un evento descartado deja constancia de que NO se envió', async () => {
    const queue = new InMemoryQueue();
    const dispatcher = newDispatcher(queue, new RecordingMailer(MAX_ATTEMPTS));
    await queue.enqueue(evento);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await dispatcher.drainOnce();
    }

    // Con una sola tabla habría que elegir entre borrar —y no poder responder nunca
    // qué pasó— o dejarlo dentro y confundir un fallo terminal con un pendiente.
    expect(queue.queue.size).toBe(0);
    expect(queue.states.get(evento.eventId)?.state).toBe('failed');
  });
});

// ── invariantes de la cola ─────────────────────────────────────────────────

describe('invariantes', () => {
  it('el mismo evento no se encola dos veces', async () => {
    const queue = new InMemoryQueue();

    // La entrega del outbox es AT-LEAST-ONCE (D-07): recibir el mismo evento dos
    // veces es normal y no puede producir dos correos al usuario.
    expect(await queue.enqueue(evento)).toBe(true);
    expect(await queue.enqueue(evento)).toBe(false);
    expect(queue.queue.size).toBe(1);
  });

  it('un evento agotado no se vuelve a reclamar', async () => {
    const queue = new InMemoryQueue();
    const mailer = new RecordingMailer(MAX_ATTEMPTS + 5);
    const dispatcher = newDispatcher(queue, mailer);
    await queue.enqueue(evento);

    for (let i = 0; i < MAX_ATTEMPTS + 3; i += 1) {
      await dispatcher.drainOnce();
    }

    // Sin este freno, un destinatario inválido se reintentaría para siempre.
    expect(queue.states.get(evento.eventId)?.attempts).toBe(MAX_ATTEMPTS);
  });

  it('una fila que agotó los intentos sin registrar desenlace se cierra sola', async () => {
    const queue = new InMemoryQueue();
    await queue.enqueue(evento);
    // Simula el proceso que murió entre el último envío fallido y su `markFailed`.
    const row = queue.queue.get(evento.eventId);
    if (row !== undefined) {
      row.attempts = MAX_ATTEMPTS;
    }

    await newDispatcher(queue, new RecordingMailer()).drainOnce();

    expect(queue.queue.size).toBe(0);
    expect(queue.states.get(evento.eventId)?.state).toBe('failed');
  });

  it('el lote entero se procesa aunque un envío falle', async () => {
    const queue = new InMemoryQueue();
    // El primer envío falla; los otros dos deben salir igualmente. Si el fallo se
    // propagara, esos eventos se quedarían con un intento gastado y sin desenlace.
    const mailer = new RecordingMailer(1);
    for (const id of ['a', 'b', 'c']) {
      await queue.enqueue({ ...evento, eventId: id });
    }

    await newDispatcher(queue, mailer).drainOnce();

    expect(mailer.sent).toHaveLength(2);
    expect(queue.states.size).toBe(3);
  });
});
