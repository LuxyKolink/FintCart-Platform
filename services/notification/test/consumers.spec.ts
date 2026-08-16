/**
 * Pruebas de esquema de evento (productor) y de consumo idempotente (T172, D-13).
 *
 * Dos cosas se comprueban aquí, y ninguna la cubre el resto de la suite:
 *
 *  - que los ONCE eventos del catálogo (`contracts/events/events-catalog.md`) crucen
 *    `notificationFromMessage` con el desenlace correcto: los TRES que llevan
 *    plantilla producen una notificación encolable con la plantilla exacta que asigna
 *    `TEMPLATE_BY_EVENT`; los OCHO restantes se reconocen como válidos y se descartan
 *    sin producir correo (bandeja in-app, N-03) — ninguno de los dos casos es un error;
 *  - que la entrega DUPLICADA de un evento (normal bajo entrega at-least-once, D-07) no
 *    produzca dos filas en la cola ni dos correos, y que el mensaje se confirme (`ack`)
 *    en los dos casos: el duplicado no es un fallo del consumidor.
 */
import type { Channel, ConsumeMessage } from 'amqplib';

import { QueueConsumer } from '../src/amqp/consumer.js';
import { MalformedEventError, notificationFromMessage } from '../src/amqp/mapping.js';
import type { Logger } from '../src/logger.js';
import type { ClaimedNotification, NewNotification, NotificationQueue } from '../src/repo/queue.js';

// ── doble mínimo de la cola: solo `enqueue` importa aquí. El resto del
// contrato (reintentos, agotamiento) ya lo cubre `queue.spec.ts` contra el
// despachador; duplicarlo aquí no probaría nada nuevo sobre el consumidor. ──
class EnqueueOnlyQueue implements NotificationQueue {
  public readonly enqueued: NewNotification[] = [];
  private readonly seen = new Set<string>();

  public enqueue(item: NewNotification): Promise<boolean> {
    // Modela el mismo `event_id UNIQUE` que hace idempotente la fila real.
    if (this.seen.has(item.eventId)) {
      return Promise.resolve(false);
    }
    this.seen.add(item.eventId);
    this.enqueued.push(item);
    return Promise.resolve(true);
  }

  public claimPending(): Promise<ClaimedNotification[]> {
    throw new Error('no usado en estas pruebas');
  }
  public markSent(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  public recordRetry(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  public markFailed(): Promise<void> {
    throw new Error('no usado en estas pruebas');
  }
  public finalizeExhausted(): Promise<number> {
    throw new Error('no usado en estas pruebas');
  }
}

class FakeChannel {
  public readonly acked: ConsumeMessage[] = [];
  public readonly nacked: Array<{ msg: ConsumeMessage; requeue: boolean }> = [];

  public ack(msg: ConsumeMessage): void {
    this.acked.push(msg);
  }

  public nack(msg: ConsumeMessage, _allUpTo: boolean, requeue: boolean): void {
    this.nacked.push({ msg, requeue });
  }
}

const silentLogger: Logger = { info: () => undefined, error: () => undefined };

function envelopeBody(eventType: string, payload: Record<string, unknown>, eventId: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      event_id: eventId,
      event_type: eventType,
      occurred_at: '2026-03-04T05:06:07Z',
      actor_ref: '11111111-1111-4111-8111-111111111111',
      payload,
    }),
  );
}

function toMessage(content: Buffer, routingKey: string): ConsumeMessage {
  return { content, fields: { routingKey } } as unknown as ConsumeMessage;
}

/**
 * Invoca el `handle` privado del consumidor directamente, igual que
 * `consumer_test.go` en Auditoría llama a su `handle` no exportado: es el mismo tipo
 * de prueba (¿qué desenlace produce cada entrada?) y pasar por `channel.consume` real
 * solo añadiría una vuelta de callback sin probar nada más.
 */
async function handleWith(queue: NotificationQueue, msg: ConsumeMessage): Promise<FakeChannel> {
  const consumer = new QueueConsumer(queue, silentLogger);
  const channel = new FakeChannel();
  await (
    consumer as unknown as { handle(channel: Channel, msg: ConsumeMessage): Promise<void> }
  ).handle(channel as unknown as Channel, msg);
  return channel;
}

// ── esquema de evento (productor): los 11 del catálogo ─────────────────────

describe('esquema de los 11 eventos del catálogo (productor)', () => {
  const CON_PLANTILLA: Record<string, { template: string; payload: Record<string, unknown> }> = {
    'user.registered': {
      template: 'verificacion',
      payload: {
        user_id: 'u-1',
        email: 'a@b.co',
        display_name: 'A',
        verification_token: 'tok',
        verification_expires_at: '2026-01-01T00:00:00Z',
      },
    },
    'auth.password_changed': {
      template: 'cambio_password',
      payload: { user_id: 'u-1', email: 'a@b.co', changed_at: '2026-01-01T00:00:00Z' },
    },
    'auth.security_alert': {
      template: 'alerta_seguridad',
      payload: { user_id: 'u-1', email: 'a@b.co' },
    },
  };

  // Los ocho restantes del catálogo: válidos, sin plantilla — la bandeja in-app la
  // sirve Usuarios por gRPC desde la saga, no Notificación por evento (N-03).
  const SIN_PLANTILLA = [
    'user.email_verified',
    'auth.session_revoked',
    'learning.article_published',
    'learning.quiz_graded',
    'user.progress_milestone',
    'user.activity',
    'simulation.executed',
    'account.anonymized',
  ];

  it.each(Object.entries(CON_PLANTILLA))('%s produce una notificación con su plantilla', (eventType, spec) => {
    const body = envelopeBody(eventType, spec.payload, '22222222-2222-4222-8222-222222222222');

    const result = notificationFromMessage(body);

    expect(result).not.toBeNull();
    expect(result?.template).toBe(spec.template);
    expect(result?.recipient).toBe('a@b.co');
  });

  it.each(SIN_PLANTILLA)('%s es válido pero no produce correo (N-03)', (eventType) => {
    const body = envelopeBody(eventType, { algo: 'valor' }, '22222222-2222-4222-8222-222222222222');

    expect(notificationFromMessage(body)).toBeNull();
  });

  it('los 11 eventos del catálogo están cubiertos, ninguno queda fuera de las dos listas', () => {
    expect(Object.keys(CON_PLANTILLA).length + SIN_PLANTILLA.length).toBe(11);
  });

  it('rechaza un evento sin event_id (la clave de idempotencia) como mal formado', () => {
    const body = Buffer.from(JSON.stringify({ event_type: 'user.registered', payload: {} }));
    expect(() => notificationFromMessage(body)).toThrow(MalformedEventError);
  });

  it('rechaza `user.registered` sin email de destino', () => {
    const body = envelopeBody('user.registered', { user_id: 'u-1' }, '22222222-2222-4222-8222-222222222222');
    expect(() => notificationFromMessage(body)).toThrow(MalformedEventError);
  });
});

// ── consumo idempotente ──────────────────────────────────────────────────

describe('consumo idempotente (T172, D-07: entrega at-least-once)', () => {
  it('la misma entrega dos veces encola una sola vez y confirma las dos', async () => {
    const queue = new EnqueueOnlyQueue();
    const eventId = '33333333-3333-4333-8333-333333333333';
    const body = (): Buffer => envelopeBody('user.registered', { email: 'persona@ejemplo.co' }, eventId);

    const channel1 = await handleWith(queue, toMessage(body(), 'user.registered'));
    const channel2 = await handleWith(queue, toMessage(body(), 'user.registered'));

    expect(queue.enqueued).toHaveLength(1);
    expect(channel1.acked).toHaveLength(1);
    expect(channel2.acked).toHaveLength(1);
    expect(channel1.nacked).toHaveLength(0);
    expect(channel2.nacked).toHaveLength(0);
  });

  it('un evento sin plantilla se confirma sin encolar (no es un error)', async () => {
    const queue = new EnqueueOnlyQueue();
    const msg = toMessage(
      envelopeBody('simulation.executed', { user_id: 'u-1' }, '44444444-4444-4444-8444-444444444444'),
      'simulation.executed',
    );

    const channel = await handleWith(queue, msg);

    expect(queue.enqueued).toHaveLength(0);
    expect(channel.acked).toHaveLength(1);
    expect(channel.nacked).toHaveLength(0);
  });

  it('un evento mal formado va a la dead-letter sin reintento (no va a mejorar reintentándolo)', async () => {
    const queue = new EnqueueOnlyQueue();
    const msg = toMessage(Buffer.from('{no es json'), 'x');

    const channel = await handleWith(queue, msg);

    expect(channel.nacked).toEqual([{ msg, requeue: false }]);
    expect(channel.acked).toHaveLength(0);
  });

  it('un fallo de escritura al encolar se reintenta (con requeue), no se descarta', async () => {
    const failingQueue: NotificationQueue = {
      enqueue: () => Promise.reject(new Error('la base no responde')),
      claimPending: () => Promise.reject(new Error('no usado')),
      markSent: () => Promise.reject(new Error('no usado')),
      recordRetry: () => Promise.reject(new Error('no usado')),
      markFailed: () => Promise.reject(new Error('no usado')),
      finalizeExhausted: () => Promise.reject(new Error('no usado')),
    };
    const msg = toMessage(
      envelopeBody('user.registered', { email: 'persona@ejemplo.co' }, '55555555-5555-4555-8555-555555555555'),
      'user.registered',
    );

    const channel = await handleWith(failingQueue, msg);

    expect(channel.nacked).toEqual([{ msg, requeue: true }]);
    expect(channel.acked).toHaveLength(0);
  });
});
