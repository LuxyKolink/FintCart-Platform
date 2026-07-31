/**
 * Conversión sobre de evento → fila de la cola (Principio IX regla 3).
 *
 * Es la ÚNICA frontera de traducción del servicio, y aquí se decide si un mensaje es
 * interpretable. Esa decisión determina su destino en el broker: lo que no se puede
 * interpretar va a la dead-letter, porque no va a mejorar reintentándolo; lo que sí,
 * se encola y se acepta.
 *
 * Alcance EMAIL únicamente. La bandeja in-app pertenece al Servicio de Usuarios
 * (plan.md N-03) y se alimenta por `Users.AppendInAppNotification` desde el paso de la
 * saga, no por evento: Notificación es un consumidor puro sin gRPC y no podría servir
 * la lectura de una bandeja de la que fuera dueño.
 */
import type { NewNotification, NotificationPayload, TemplateName } from '../repo/queue.js';

/** Sobre común de los eventos (`contracts/events/events-catalog.md`). */
export interface Envelope {
  readonly event_id?: string;
  readonly event_type?: string;
  readonly occurred_at?: string;
  readonly actor_ref?: string;
  readonly payload?: Record<string, unknown>;
}

/** Un mensaje que este servicio no puede interpretar. */
export class MalformedEventError extends Error {
  public constructor(reason: string) {
    super(`notification: evento mal formado: ${reason}`);
    this.name = 'MalformedEventError';
  }
}

/**
 * Eventos que producen un correo, y con qué plantilla.
 *
 * Coincide exactamente con `events.BindingsNotification` del Orquestador y con el
 * CHECK `notification_events_queue_template_valid`. Los tres tienen que decir lo mismo:
 * un binding sin entrada aquí entregaría mensajes que este servicio solo puede
 * descartar, y una entrada aquí sin plantilla en la base fallaría al insertar con el
 * evento ya consumido.
 */
const TEMPLATE_BY_EVENT: Readonly<Record<string, TemplateName>> = {
  'user.registered': 'verificacion',
  'auth.password_changed': 'cambio_password',
  'auth.security_alert': 'alerta_seguridad',
};

/**
 * Convierte el cuerpo de un mensaje en una notificación encolable.
 *
 * Devuelve `null` cuando el evento es válido pero NO produce correo. Es un caso
 * distinto de un error: el mensaje se confirma y se descarta a propósito, en lugar de
 * mandarse a la dead-letter como si estuviera roto.
 *
 * @throws {MalformedEventError} si el sobre no se puede interpretar.
 */
export function notificationFromMessage(body: Buffer): NewNotification | null {
  let env: Envelope;
  try {
    env = JSON.parse(body.toString('utf8')) as Envelope;
  } catch (err) {
    throw new MalformedEventError(`JSON ilegible (${(err as Error).message})`);
  }

  if (typeof env.event_id !== 'string' || env.event_id === '') {
    throw new MalformedEventError('falta event_id, que es la clave de idempotencia');
  }
  if (typeof env.event_type !== 'string' || env.event_type === '') {
    throw new MalformedEventError(`el evento ${env.event_id} no declara event_type`);
  }

  const template = TEMPLATE_BY_EVENT[env.event_type];
  if (template === undefined) {
    return null;
  }

  const payload = stringPayload(env.payload ?? {});
  const recipient = payload['email'];
  if (recipient === undefined || recipient.trim() === '') {
    // Sin destinatario no hay correo posible, y encolarlo solo gastaría los tres
    // intentos para acabar en `failed`. El CHECK
    // `notification_events_queue_recipient_not_blank` lo rechazaría de todos modos,
    // pero entonces el fallo llegaría como un error de la base y no como lo que es.
    throw new MalformedEventError(`el evento ${env.event_id} no trae email de destino`);
  }

  return { eventId: env.event_id, recipient, template, payload };
}

/**
 * Normaliza el payload a `Record<string, string>`.
 *
 * Todo valor acaba como `string`, incluidos los numéricos. Un importe o un puntaje que
 * viajara como `number` hasta la plantilla habría pasado por el `double` de
 * JavaScript, que es exactamente lo que el Principio VIII prohíbe para dinero — y en
 * un correo el redondeo no se nota hasta que un usuario lo compara con su saldo.
 */
function stringPayload(raw: Record<string, unknown>): NotificationPayload {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) {
      continue;
    }
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}
