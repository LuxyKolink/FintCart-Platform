/**
 * Pruebas de la configuración, centradas en el interruptor de STARTTLS.
 *
 * `SMTP_REQUIRE_TLS` apareció al arrancar la plataforma por primera vez: el
 * transporte deducía el cifrado del puerto (`≠ 465 ⇒ STARTTLS`) y contra el relé de
 * desarrollo —que habla SMTP plano— ningún correo de verificación llegaba a salir.
 *
 * Lo que se fija aquí no es que la bandera exista, sino las dos propiedades que la
 * hacen segura: que su ausencia EXIJA cifrado, y que un valor ilegible falle en el
 * arranque. Ambas apuntan al mismo riesgo — que una errata en un fichero de
 * despliegue degrade la conexión sin que nadie se entere — y ese fallo es
 * silencioso: los correos siguen saliendo, solo que sin cifrar.
 */
import { loadConfig, ConfigError } from '../src/config.js';

/** Entorno mínimo con todas las variables obligatorias presentes. */
function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DB_ADDR: 'postgres://u:p@db:5432/notification_db?sslmode=disable',
    AMQP_ADDR: 'amqp://u:p@rabbitmq:5672/',
    SMTP_ADDR: 'smtp.proveedor.co:587',
    SMTP_FROM: 'no-reply@fintcart.co',
    APP_BASE_URL: 'https://app.fintcart.co',
    ...overrides,
  };
}

describe('SMTP_REQUIRE_TLS', () => {
  it('exige cifrado cuando la variable no está', () => {
    expect(loadConfig(baseEnv()).smtpRequireTls).toBe(true);
  });

  it('exige cifrado cuando la variable está vacía', () => {
    // Una variable declarada sin valor es el resultado habitual de una plantilla de
    // despliegue a medio rellenar. Debe comportarse como si no estuviera, no como
    // una desactivación.
    expect(loadConfig(baseEnv({ SMTP_REQUIRE_TLS: '' })).smtpRequireTls).toBe(true);
  });

  it('permite desactivarlo de forma explícita', () => {
    expect(loadConfig(baseEnv({ SMTP_REQUIRE_TLS: 'false' })).smtpRequireTls).toBe(false);
  });

  it('acepta mayúsculas y espacios sobrantes', () => {
    expect(loadConfig(baseEnv({ SMTP_REQUIRE_TLS: ' FALSE ' })).smtpRequireTls).toBe(false);
  });

  it.each(['ture', 'no', '0', 'sí', 'off'])(
    'rechaza %p en lugar de tratarlo como una desactivación',
    (value) => {
      // Es la prueba que justifica la existencia de `boolFlag`. Con la interpretación
      // habitual —«todo lo que no sea "true" es false»— cada uno de estos valores
      // apagaría el cifrado, y `"ture"` es una errata plausible en un YAML.
      expect(() => loadConfig(baseEnv({ SMTP_REQUIRE_TLS: value }))).toThrow(ConfigError);
    },
  );

  it('nombra la variable culpable en el error', () => {
    // Sin el nombre, un fallo de arranque obliga a revisar el fichero entero.
    expect(() => loadConfig(baseEnv({ SMTP_REQUIRE_TLS: 'ture' }))).toThrow(
      /SMTP_REQUIRE_TLS/,
    );
  });
});

describe('SMTP_USER / SMTP_PASSWORD', () => {
  it('son opcionales cuando ninguna de las dos está (MailHog)', () => {
    const config = loadConfig(baseEnv());
    expect(config.smtpUser).toBeUndefined();
    expect(config.smtpPassword).toBeUndefined();
  });

  it('se aceptan juntas', () => {
    const config = loadConfig(
      baseEnv({ SMTP_USER: 'no-reply@fintcart.co', SMTP_PASSWORD: 'app-password' }),
    );
    expect(config.smtpUser).toBe('no-reply@fintcart.co');
    expect(config.smtpPassword).toBe('app-password');
  });

  it.each([
    { SMTP_USER: 'no-reply@fintcart.co' },
    { SMTP_PASSWORD: 'app-password' },
  ])('rechaza que solo una de las dos esté presente (%j)', (overrides) => {
    // Una credencial a medias no debe fallar en silencio en el primer envío: es más
    // barato descubrirla en el arranque que en un correo de verificación perdido.
    expect(() => loadConfig(baseEnv(overrides))).toThrow(
      /SMTP_USER y SMTP_PASSWORD/,
    );
  });
});
