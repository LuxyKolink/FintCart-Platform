/**
 * Pruebas de las plantillas de correo (T098).
 *
 * La plantilla de verificación es el ÚNICO punto del sistema en el que el token de
 * verificación llega a manos del usuario. Si el correo sale sin enlace utilizable, se
 * entrega con éxito, cuenta como enviado en todas las métricas y deja al titular sin
 * forma de activar su cuenta — un fallo que ninguna métrica de entrega detecta y del
 * que solo se entera quien lo sufre.
 *
 * De ahí que lo que se fije aquí no sea la redacción sino tres propiedades: que el
 * enlace lleve LOS DOS parámetros que exige `POST /auth/verify-email`, que un campo
 * ausente falle en lugar de escribir «undefined», y que los valores se codifiquen.
 */
import { render, TemplateError } from '../src/email/templates.js';

const ctx = { appBaseUrl: 'https://app.fintcart.co' };

const USER_ID = '3f0f8b2e-2c53-4a2c-9f0a-1d2e3f4a5b6c';
const TOKEN = 'kK3n-9sZQ0pXvB7wL2mR8tYhN4cJ1dF6gA5eS0uI';

describe('plantilla de verificación', () => {
  it('compone un enlace con los dos parámetros que exige el endpoint', () => {
    const { subject, body } = render(
      'verificacion',
      { user_id: USER_ID, verification_token: TOKEN },
      ctx,
    );

    expect(subject).toContain('Verifica');
    // Con el token solo, el usuario no tendría con qué identificarse: el endpoint
    // exige los dos, y un enlace incompleto es un correo inútil bien entregado.
    expect(body).toContain(`https://app.fintcart.co/auth/verify-email?user_id=${USER_ID}`);
    expect(body).toContain(`token=${TOKEN}`);
  });

  it('anuncia la caducidad cuando el evento la trae', () => {
    const { body } = render(
      'verificacion',
      {
        user_id: USER_ID,
        verification_token: TOKEN,
        verification_expires_at: '2026-08-02T12:00:00Z',
      },
      ctx,
    );

    // Sin este aviso, quien abre el correo al día siguiente ve un enlace que «no
    // funciona» y no tiene forma de saber que solo tiene que pedir otro.
    expect(body).toContain('2026-08-02T12:00:00Z');
  });

  it('sigue siendo utilizable si el evento no trae caducidad', () => {
    const { body } = render('verificacion', { user_id: USER_ID, verification_token: TOKEN }, ctx);

    expect(body).toContain('/auth/verify-email?');
    expect(body).not.toContain('undefined');
  });

  it.each(['user_id', 'verification_token'])('rechaza el correo si falta %s', (missing) => {
    const payload: Record<string, string> = {
      user_id: USER_ID,
      verification_token: TOKEN,
    };
    delete payload[missing];

    // Falla en lugar de escribir «undefined» en el enlace. Un correo con esa palabra
    // donde debería ir el token se entrega con éxito y cuenta como enviado.
    expect(() => render('verificacion', payload, ctx)).toThrow(TemplateError);
  });

  it('codifica los valores en la URL', () => {
    // El alfabeto del token lo decide Auth y podría cambiar. El día que incluyera un
    // `&`, un enlace sin codificar se partiría en manos del usuario y el fallo
    // aparecería como «token inválido», que apunta al sitio equivocado.
    const { body } = render(
      'verificacion',
      { user_id: USER_ID, verification_token: 'a&b=c d' },
      ctx,
    );

    expect(body).toContain('token=a%26b%3Dc+d');
    expect(body).not.toContain('token=a&b=c d');
  });

  it('no deja doble barra si la base viene con barra final', () => {
    const { body } = render(
      'verificacion',
      { user_id: USER_ID, verification_token: TOKEN },
      { appBaseUrl: 'https://app.fintcart.co' },
    );

    expect(body).not.toContain('.co//');
  });
});

describe('las otras dos plantillas', () => {
  it('cambio_password avisa de que puede no haber sido el titular', () => {
    const { body } = render('cambio_password', { changed_at: '2026-08-01T10:00:00Z' }, ctx);

    // El aviso de «no fuiste tú» es la razón de ser de este correo: sin él, un
    // atacante que cambia la contraseña se queda con la cuenta en silencio.
    expect(body).toContain('Si no fuiste tú');
    expect(body).toContain('2026-08-01T10:00:00Z');
  });

  it('alerta_seguridad exige el detalle', () => {
    expect(() => render('alerta_seguridad', {}, ctx)).toThrow(TemplateError);
  });
});
