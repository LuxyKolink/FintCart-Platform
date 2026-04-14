# Alcance

## Servidor de Aplicación / API Gateway

El servidor de aplicación actúa como el punto de entrada principal del sistema, manejando las siguientes funcionalidades:

- Enrutador central para el acceso a los recursos y operaciones de los distintos módulos backend desde las peticiones del cliente, traduciendo las solicitudes HTTP/REST hacia comunicación gRPC interna.
- Maneja configuración de seguridad, utilizando CORS y límite de peticiones a través de Redis.
- Validación de tokens JWT en cada solicitud entrante, verificando el estado del token contra la lista de revocación en Redis.

## Servidor de Autenticación

El servidor de autenticación es el componente responsable de la gestión de identidad dentro del sistema:

- Implementa el flujo OAuth2 con extensión PKCE para la autenticación de usuarios desde la aplicación frontend (cliente público SPA).
- Implementa el flujo Client Credentials para la comunicación segura entre servicios (machine-to-machine).
- Gestión del ciclo de vida de tokens JWT, incluyendo emisión, validación, cierre de sesión y mecanismos para el manejo de tokens de refresco y la rotación de los mismos.
- Revocación de tokens a través de una lista negra persistida en Redis.

## Orquestador

El orquestador es el componente responsable de coordinar las operaciones distribuidas del sistema:

- Coordina transacciones distribuidas entre los distintos microservicios a través del patrón Saga, garantizando la consistencia eventual de las operaciones.
- Implementa lógica de compensación para el manejo de fallos en los pasos de cada saga, revirtiendo operaciones previas cuando sea necesario.
- No posee lógica de dominio propia; su responsabilidad es exclusivamente la coordinación y secuenciación de operaciones entre servicios.

## Servicio de Usuarios

- Es responsable del registro de usuario con verificación de correo y administración de perfiles.
- Gestiona la autorización y el manejo de permisos por usuario dentro de la plataforma.
- Los usuarios tendrán una barra de progreso, la cual aumentará de acuerdo a las calificaciones del material publicado en el módulo de aprendizaje.
- Historial de publicaciones vistas y calificaciones realizadas en el módulo de aprendizaje.
- Reportes de estadísticas de operaciones de usuarios realizados en el módulo de aprendizaje.

## Módulo de Aprendizaje

- Este módulo es encargado de la creación, edición, versionamiento y publicación de artículos educativos y lecciones, junto con sistema de calificación y flujo de aprobación de contenido.
- Cada artículo o módulo de aprendizaje posee ejercicios prácticos, como por ejemplo, test de validación de conocimientos.
- Las publicaciones en el módulo poseen estadísticas para el análisis de la interacción del usuario con el módulo de aprendizaje y sus artículos.

## Servicio de Simulador

- El simulador implementa cinco calculadoras principales para simular operaciones financieras: ahorros, créditos, presupuesto, inversión y calculadoras específicas dentro del contexto colombiano para el análisis financiero del usuario.
- Los simuladores poseen interacción con diferentes tipos de moneda.
- El simulador es encargado de manejar la lógica matemática y operaciones concurrentes para obtener resultados precisos y permitir el análisis y toma de decisiones.
- Mantiene un historial de operaciones por usuario.

## Servicio de Notificación

- Consume eventos a partir de la cola de mensajería RabbitMQ de forma asíncrona; esto comprende verificación de correos electrónicos, cambio de contraseñas, notificaciones de la aplicación, y eventos generados a partir de la actividad de los usuarios.
- Es un servicio puramente orientado a eventos; no expone comunicación gRPC ni recibe solicitudes directas de otros servicios.

## Servicio de Auditoría

- Consume eventos desde RabbitMQ y persiste un registro inmutable y append-only de todas las operaciones significativas del sistema.
- Provee trazabilidad de operaciones financieras y de usuario para el cumplimiento de requerimientos de compliance dentro del contexto financiero colombiano.

## Aplicación Frontend

- La aplicación frontend corresponde a la herramienta de interacción principal entre el usuario y los diferentes módulos que comprende el sistema.
- Los usuarios podrán visualizar la experiencia adquirida a través de barras de progreso, también podrán editar la información de su perfil y las preferencias en el uso del aplicativo.
- Comprende una interfaz de interacción con el módulo de aprendizaje y los artículos publicados en este; los usuarios podrán visualizar el contenido, y realizar encuestas y test para adquirir puntos de progreso para el usuario, y comprobar la adquisición de los temas presentados en el módulo de aprendizaje.
- Posee integración con los módulos de notificación y simulador, para visualizar acciones rápidas dentro del sistema.
- Implementa el flujo de autenticación OAuth2 con extensión PKCE para la comunicación segura con el servidor de autenticación.
