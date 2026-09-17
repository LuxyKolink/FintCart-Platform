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

    case 'indicator_calendar_alert':
      return indicatorAlert(payload);
  }
}

/**
 * Correo del procedimiento anual de indicadores (T106, FR-061).
 *
 * ## Qué dice y qué NO dice
 *
 * Dice QUÉ indicador y QUÉ hay que hacer, y no menciona cifras: quien lo recibe es quien
 * administra el catálogo y las teclea él mismo. Un correo con «el UVT vence el 1 de enero»
 * es accionable; uno con el valor dentro invita a copiarlo de un correo, que es como se
 * cargan cifras equivocadas.
 *
 * ## Las dos clases de aviso, con textos distintos
 *
 * `sin_vigencia` —el indicador se quedó sin valor para hoy— es un problema ACTIVO: hay
 * calculadoras que lo referencian y no pueden calcular, o que calculan con una cifra que la
 * plataforma ya no puede confirmar. `por_vencer` es un aviso ANTICIPADO de treinta días. El
 * mismo texto para los dos haría parecer urgente lo que no lo es, y dejaría sin urgencia lo
 * que sí lo es.
 *
 * ## El aviso `sin_vigencia` nombra las DOS consecuencias, y eso se midió
 *
 * La versión anterior decía que «las calculadoras que lo referencian están dando resultados
 * con el valor anterior». Es verdad en el camino NATIVO —donde el valor llega escrito por el
 * usuario (`valor_uvt`)— y es FALSO en el camino por definición: `Indicators::resolve`
 * devuelve solo la vigencia que cubre HOY y no tiene respaldo al valor anterior, así que una
 * calculadora que lee `@UVT` del catálogo **falla** con «no hay valor vigente» (comprobado en
 * vivo, hallazgo 19 de 002). Un aviso que diagnostica mal es el que enseña a no creerle: si el
 * administrador comprueba que la calculadora no falla «por el valor viejo» sino que
 * directamente no calcula, deja de fiarse del siguiente.
 *
 * El asunto lo distingue también, porque es lo único que se ve en la bandeja de entrada.
 */
function indicatorAlert(payload: NotificationPayload): RenderedEmail {
  const name = require_('indicator_calendar_alert', payload, 'name');
  const kind = require_('indicator_calendar_alert', payload, 'kind');

  if (kind === 'sin_vigencia') {
    return {
      subject: `Acción requerida: el indicador ${name} no tiene vigencia`,
      body: [
        `El indicador ${name} no tiene un valor vigente para hoy.`,
        '',
        'Las calculadoras que lo referencian están afectadas: las que toman el valor del ' +
          'catálogo no pueden calcular hasta que se cargue, y las que lo reciben escrito ' +
          'siguen calculando con el valor que se les dé, que la plataforma ya no puede ' +
          'confirmar.',
        '',
        'Carga el valor del período en curso en la pantalla de indicadores.',
      ].join('\n'),
    };
  }

  if (kind === 'por_vencer') {
    // `valid_to` y `days_remaining` son obligatorios en esta clase: el aviso existe para
    // decir CUÁNDO, y sin la fecha el texto no tendría nada que decir. Se leen con
    // `require_` para que un payload incompleto falle en lugar de entregar un correo que
    // dice «vence el undefined».
    const validTo = require_('indicator_calendar_alert', payload, 'valid_to');
    const days = require_('indicator_calendar_alert', payload, 'days_remaining');

    return {
      subject: `Aviso: el indicador ${name} deja de aplicar el ${validTo}`,
      body: [
        `El indicador ${name} deja de estar vigente el ${validTo}: quedan ${days} días.`,
        '',
        'Carga el valor del período siguiente antes de esa fecha para que las calculadoras ' +
          'que lo usan sigan al día.',
      ].join('\n'),
    };
  }

  // Una clase desconocida es un fallo de contrato, no un texto genérico: el servicio de
  // Notificación no puede inventarse qué hacer con un aviso que no entiende, y entregarlo
  // «a medias» lo dejaría contado como enviado.
  throw new TemplateError('indicator_calendar_alert', `kind desconocido: ${kind}`);
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
