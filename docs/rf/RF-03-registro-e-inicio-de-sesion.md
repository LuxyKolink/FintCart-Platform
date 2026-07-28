# RF-03 — Registro e Inicio de Sesión de Usuario

## Nombre del requerimiento

Registro e Inicio de Sesión de Usuario.

## Descripción del requerimiento

Este requerimiento cubre la gestión de identidad y acceso del usuario: registro mediante correo electrónico y contraseña con unicidad garantizada, verificación de correo, inicio de sesión seguro mediante OAuth2 Authorization Code + PKCE, cierre de sesión con revocación inmediata y restablecimiento o cambio de contraseña con notificación al usuario. Materializa los requerimientos FR-001 a FR-005 y se apoya en el Servidor de Autenticación con JWT firmados, refresh tokens rotativos y blacklist en Redis.

## Precondiciones

Para el registro, el correo electrónico no debe existir previamente en el sistema, garantizando su unicidad (FR-001). Para iniciar sesión, el usuario debe tener una cuenta registrada y su correo verificado a fin de obtener acceso pleno (FR-002). Para cerrar sesión o cambiar la contraseña, debe existir una sesión o identidad válida asociada al usuario.

## Postcondiciones

Tras el registro se crea la credencial en estado `pending_verification` y se envía el correo de verificación de forma asíncrona; tras la verificación, la credencial pasa a `active` y el perfil del usuario queda activo. Tras un inicio de sesión exitoso, el usuario recibe tokens válidos (access y refresh). Tras el cierre de sesión, el `jti` del token queda en la blacklist de Redis con efecto inmediato (FR-004). Tras un cambio de contraseña, se notifica al usuario, que deberá usar la nueva credencial en su próximo acceso.

## Casos de uso con los que se relaciona

Habilita el primer escenario de la Historia de Usuario 1 (registro y verificación previos al consumo de contenido) y es prerrequisito transversal de todas las demás historias de usuario; se relaciona con RF-03-1 (administración del perfil y los roles del usuario ya identificado), con el servicio de Notificación (correos de verificación y de seguridad) y con la Saga de registro y verificación coordinada por el Orquestador.

## Flujo Básico

El usuario se registra (`POST /auth/register`), lo que inicia la Saga de registro que crea la credencial, dispara el correo de verificación y prepara el perfil; el usuario confirma su correo (`POST /auth/verify-email`) y su cuenta queda activa; posteriormente inicia sesión mediante el flujo OAuth2 Authorization Code + PKCE contra el Servidor de Autenticación, obtiene su JWT y accede a la plataforma; al finalizar, cierra sesión (`POST /auth/logout`) revocando el token de forma inmediata.

## Flujo Alternativo

Si el correo ya está registrado, el registro responde 409; si el enlace o token de verificación expira o es inválido, el sistema responde 400 y permite reenviar la verificación; si el usuario olvida su contraseña, solicita el restablecimiento y recibe el flujo de cambio con su correspondiente notificación (FR-005); y ante múltiples intentos fallidos de inicio de sesión contra una misma cuenta, el sistema aplica medidas de protección frente a ataques de fuerza bruta.

## Restricciones y/o Excepciones

La autenticación se realiza exclusivamente mediante OAuth2 (Authorization Code + PKCE para la SPA; Client Credentials para comunicación M2M) con JWT firmados; en la versión inicial no hay integración con proveedores externos de identidad. Las contraseñas se almacenan con Argon2id y nunca en claro ni en logs; la revocación de sesión es inmediata mediante la blacklist de Redis; el acceso pleno permanece bloqueado hasta verificar el correo; y el Gateway aplica rate limiting a los endpoints de identidad.
