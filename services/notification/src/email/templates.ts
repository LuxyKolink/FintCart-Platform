/**
 * Plantillas de los correos salientes.
 *
 * Son tres, exactamente las que admite el CHECK
 * `notification_events_queue_template_valid`, y se corresponden una a una con los tres
 * eventos enlazados a `notification.q` (`events.BindingsNotification` del Orquestador).
 * Esa correspondencia es intencional: un binding sin plantilla entregaría mensajes que
 * este servicio solo puede descartar, y una cola que recibe y tira en silencio es
 * indistinguible de una que funciona.
 *
 * El contenido es TEXTO PLANO. No es una limitación pendiente de mejorar: un correo de
 * verificación con HTML e imágenes remotas es indistinguible de un intento de
 * phishing para la mitad de los clientes de correo, y el enlace de verificación tiene
 * que ser legible tal cual por el usuario que desconfíe.
 */
import type { NotificationPayload, TemplateName } from '../repo/queue.js';

/** Correo listo para entregar. */
export interface RenderedEmail {
  readonly subject: string;
  readonly body: string;
}

/**
 * Lo que las plantillas necesitan del DESPLIEGUE y no del evento.
 *
 * Hoy es solo el dominio público de la SPA. Viaja como parámetro y no se lee de
 * `process.env` aquí: una plantilla que leyera el entorno por su cuenta tendría una
 * dependencia invisible en la firma, y no habría forma de renderizar el correo de
 * pruebas contra otro dominio.
 */
export interface TemplateContext {
  /** Base pública de la SPA, sin barra final. */
  readonly appBaseUrl: string;
}

/** Falta un dato que la plantilla necesita. */
export class TemplateError extends Error {
  public constructor(template: TemplateName, missing: string) {
    super(`notification: la plantilla ${template} requiere el campo ${missing}`);
    this.name = 'TemplateError';
  }
}

/**
 * Renderiza el correo de una notificación.
 *
 * Lanza [[TemplateError]] si falta un campo obligatorio en lugar de escribir
 * `undefined` en el cuerpo. Un correo de verificación con la palabra «undefined» donde
 * debería ir el enlace se entrega con éxito, cuenta como enviado y deja al usuario sin
 * forma de activar su cuenta — un fallo que ninguna métrica de entrega detecta.
 */
export function render(
  template: TemplateName,
  payload: NotificationPayload,
  ctx: TemplateContext,
): RenderedEmail {
  switch (template) {
    case 'verificacion': {
      // Los DOS datos son obligatorios porque `POST /auth/verify-email` exige los
      // dos. Con el token solo, el usuario no tendría con qué identificarse y el
      // correo sería inútil pese a entregarse con éxito.
      const userId = require_(template, payload, 'user_id');
      const token = require_(template, payload, 'verification_token');
      return {
        subject: 'Verifica tu cuenta de Fintcart',
        body: [
          'Te damos la bienvenida a Fintcart.',
          '',
          'Para activar tu cuenta, abre este enlace:',
          `  ${verificationLink(ctx.appBaseUrl, userId, token)}`,
          '',
          // La caducidad se anuncia cuando el evento la trae. Sin este aviso, quien
          // abra el correo pasadas las 24 horas ve un enlace que «no funciona» y no
          // tiene forma de saber que solo tiene que pedir otro.
          ...(payload['verification_expires_at'] !== undefined
            ? [`El enlace caduca el ${payload['verification_expires_at']}.`, '']
            : []),
          'Si no creaste esta cuenta, ignora este mensaje.',
        ].join('\n'),
      };
    }

    case 'cambio_password':
      return {
        subject: 'Tu contraseña de Fintcart cambió',
        body: [
          `La contraseña de tu cuenta se cambió el ${require_(template, payload, 'changed_at')}.`,
          '',
          // El aviso de «no fuiste tú» es la razón de ser de este correo: sin él, un
          // atacante que cambia la contraseña se queda con la cuenta en silencio.
          'Si no fuiste tú, comunícate de inmediato con soporte: tu cuenta puede estar comprometida.',
        ].join('\n'),
      };

    case 'alerta_seguridad':
      return {
        subject: 'Alerta de seguridad en tu cuenta de Fintcart',
        body: [
          'Detectamos actividad inusual en tu cuenta:',
          `  ${require_(template, payload, 'detail')}`,
          '',
          'Si reconoces esta actividad, no tienes que hacer nada.',
        ].join('\n'),
      };
  }
}

/**
 * Compone el enlace de verificación.
 *
 * Los dos valores se codifican con `encodeURIComponent` aunque hoy sean un UUID y un
 * base64url —ninguno de los cuales necesita escape—. El token lo genera Auth y su
 * alfabeto podría cambiar; el día que incluyera un `+` o un `&`, un enlace sin
 * codificar se partiría en manos del usuario y el fallo aparecería como «token
 * inválido», que apunta al sitio equivocado.
 */
function verificationLink(baseUrl: string, userId: string, token: string): string {
  const params = new URLSearchParams({ user_id: userId, token });
  return `${baseUrl}/auth/verify-email?${params.toString()}`;
}

/**
 * Lee un campo obligatorio del payload.
 *
 * El nombre lleva guion bajo final para no chocar con `require` de CommonJS, que en un
 * paquete ESM no existe pero sigue siendo un identificador que confunde al leer.
 */
function require_(template: TemplateName, payload: NotificationPayload, field: string): string {
  const value = payload[field];
  if (value === undefined || value === '') {
    throw new TemplateError(template, field);
  }
  return value;
}
