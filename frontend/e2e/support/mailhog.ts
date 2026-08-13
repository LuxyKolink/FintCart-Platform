/**
 * Cliente mínimo de la API de MailHog (`dev/docker-compose.yaml`, puerto 8025)
 * para extraer el enlace de verificación de un correo real capturado en
 * desarrollo — la única forma de completar FR-002 de punta a punta sin un
 * backdoor de pruebas en Auth.
 */

const MAILHOG_BASE_URL = process.env['E2E_MAILHOG_URL'] ?? 'http://localhost:8025';

interface MailHogMessage {
  Content: { Body: string; Headers: Record<string, string[]> };
  To: { Mailbox: string; Domain: string }[];
}

interface MailHogList {
  items: MailHogMessage[];
}

function toAddress(msg: MailHogMessage): string {
  const [first] = msg.To;
  return first === undefined ? '' : `${first.Mailbox}@${first.Domain}`;
}

/**
 * `notification` envía el correo con `Content-Transfer-Encoding: quoted-printable`
 * (MIME estándar para texto con acentos, `templates.ts`), pero `Content.Body` de la
 * API de MailHog devuelve el cuerpo TAL CUAL llegó por SMTP — todavía codificado.
 * Sin decodificar, un salto de línea suave (`=\n`) parte la URL a la mitad y un
 * `=3D` literal reemplaza cada `=`, corrompiendo justo el query string que se
 * necesita leer. Ver RFC 2045 §6.7.
 */
function decodeQuotedPrintable(body: string): string {
  return body
    .replace(/=\r\n/gu, '')
    .replace(/=\n/gu, '')
    .replace(/=([0-9A-Fa-f]{2})/gu, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Sondea MailHog hasta encontrar el correo de verificación dirigido a `email`
 * y devuelve la URL completa del enlace (`.../auth/verify-email?user_id=...&token=...`,
 * ver `services/notification/src/email/templates.ts::verificationLink`).
 */
export async function waitForVerificationLink(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG_BASE_URL}/api/v2/messages?limit=50`);
    if (res.ok) {
      const data = (await res.json()) as MailHogList;
      const match = data.items.find((msg) => toAddress(msg).toLowerCase() === email.toLowerCase());
      if (match !== undefined) {
        const decoded = decodeQuotedPrintable(match.Content.Body);
        const linkMatch = /https?:\/\/\S+\/auth\/verify-email\?\S+/u.exec(decoded);
        if (linkMatch !== null) {
          return linkMatch[0];
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`mailhog: no llegó el correo de verificación para ${email} en ${timeoutMs}ms`);
}
