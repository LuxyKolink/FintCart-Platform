/**
 * Transporte SMTP real, sobre `nodemailer`.
 *
 * Vive aparte del despachador para que la lógica de reintentos y desenlaces no dependa
 * de una librería de correo: `Dispatcher` habla con la interfaz [[Mailer]] y sus
 * pruebas no necesitan un servidor SMTP.
 */
import nodemailer, { type Transporter } from 'nodemailer';

import type { Mailer, OutgoingEmail } from './dispatcher.js';

/** Parámetros del transporte, leídos del entorno en `config.ts` (Principio X). */
export interface SMTPOptions {
  /** `host:puerto` del servidor. */
  readonly addr: string;
  /** Remitente de los correos salientes. */
  readonly from: string;
  /**
   * Si se exige STARTTLS. Viene de `SMTP_REQUIRE_TLS` y por defecto es `true`.
   *
   * Se pasa en vez de deducirse del puerto porque un relé de desarrollo (MailHog en
   * el 1025) no ofrece STARTTLS y la deducción lo daba por supuesto.
   */
  readonly requireTls: boolean;
}

/** Puerto SMTP por defecto si `SMTP_ADDR` no lo incluye. */
const DEFAULT_SMTP_PORT = 587;

/** Transporte SMTP. */
export class SMTPMailer implements Mailer {
  private readonly transporter: Transporter;

  public constructor(private readonly options: SMTPOptions) {
    const { host, port } = splitAddr(options.addr);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      // `secure: false` con `requireTLS` no es «sin cifrar»: es STARTTLS, el modo del
      // puerto 587. `secure: true` corresponde al 465 (TLS implícito) y, puesto en el
      // 587, la conexión se queda colgada en el saludo sin un error que lo explique.
      // Por eso el 465 sigue deduciéndose del puerto: ahí TLS es la forma de hablar,
      // no una política. Lo que ya no se deduce es si se EXIGE cifrado en los demás
      // puertos, que es una decisión de despliegue.
      secure: port === 465,
      requireTLS: port !== 465 && options.requireTls,
      // Una conexión SMTP colgada bloquearía un hueco de concurrencia del despachador
      // indefinidamente. Con plazo, el envío falla, cuenta como intento y se reintenta.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  public async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
  }

  /** Cierra el pool de conexiones en el apagado ordenado. */
  public close(): void {
    this.transporter.close();
  }
}

/**
 * Separa `host:puerto`.
 *
 * Un puerto ilegible NO cae al valor por defecto en silencio: `SMTP_ADDR=smtp:abc`
 * acabaría conectando al 587 y el error diría «connection refused» sobre un puerto que
 * nadie configuró.
 */
function splitAddr(addr: string): { host: string; port: number } {
  const separator = addr.lastIndexOf(':');
  if (separator < 0) {
    return { host: addr, port: DEFAULT_SMTP_PORT };
  }

  const host = addr.slice(0, separator);
  const raw = addr.slice(separator + 1);
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`notification: SMTP_ADDR tiene un puerto inválido: ${JSON.stringify(raw)}`);
  }
  return { host, port };
}
