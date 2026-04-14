# Modelo de Negocio

El modelo de negocio para la plataforma Fintcart está compuesto a través de los siguientes componentes funcionales:

## Servidor de Aplicación / API Gateway

Es el componente encargado de ser el punto de entrada del sistema desde el cliente. Actúa como enrutador central de APIs hacia sus respectivos servicios backend, establece CORS y métricas de seguridad como el límite de peticiones a través de Redis, y valida los tokens JWT en cada solicitud entrante antes de traducirlas hacia comunicación gRPC interna.

## Servidor de Autenticación

Es el componente responsable de la gestión de identidad del sistema. Implementa el protocolo OAuth2 con extensión PKCE para la autenticación de usuarios desde la aplicación frontend, y el flujo Client Credentials para la comunicación segura entre servicios. Gestiona la emisión, renovación y revocación de tokens JWT, persistiendo la lista de tokens revocados en Redis para garantizar el cierre de sesión inmediato.

## Orquestador

Es el componente responsable de coordinar las transacciones distribuidas del sistema a través del patrón Saga. Gestiona la secuencia de operaciones entre múltiples servicios y ejecuta la lógica de compensación necesaria ante fallos, garantizando la consistencia eventual del sistema. No posee lógica de dominio propia.

## Servicio de Usuarios

Es el servicio responsable de la administración de usuarios; comprende información del usuario y configuraciones relacionadas a las preferencias del usuario en cuanto al uso de la plataforma. Es el encargado de la autorización y el manejo de permisos por usuario, registro y almacenamiento de las credenciales del usuario, y genera reportes e históricos de la actividad del usuario hacia la plataforma y sus recursos.

## Servicio de Aprendizaje

Este servicio es el administrador principal del contenido publicado de la plataforma; realiza operaciones para la creación, edición, versionamiento y publicación de los artículos educativos, suministrando además el control de versiones de los artículos y las prácticas recomendadas en la aplicación de conceptos. El servicio proporciona categorización de los contenidos publicados, un flujo de publicación para la aprobación del contenido de los artículos, y la integración de cuestionarios para afianzar los conocimientos del usuario.

## Servicio de Simulador

El servicio de simulador implementa cinco calculadoras principales dentro del sistema, las cuales corresponden a: ahorros, créditos, presupuesto, inversión y calculadoras específicas dentro del contexto colombiano para el análisis financiero del usuario en cuanto a la planeación de metas financieras o el análisis de riesgos en cuanto a inversiones o gastos específicos. El servicio mantiene un historial de operaciones en cuanto al uso de las calculadoras por operaciones de usuario.

## Servicio de Notificación

Es el componente encargado del despacho de notificaciones hacia el usuario. Consume eventos desde RabbitMQ de forma asíncrona y gestiona la entrega de verificaciones de correo electrónico, cambios de contraseña, notificaciones de la aplicación y eventos generados a partir de la actividad del usuario en la plataforma.

## Servicio de Auditoría

Es el componente responsable de la trazabilidad operacional del sistema. Consume eventos desde RabbitMQ y persiste un registro inmutable de todas las operaciones significativas realizadas en la plataforma, proveyendo la trazabilidad necesaria para el cumplimiento de requerimientos de compliance dentro del contexto financiero colombiano.
