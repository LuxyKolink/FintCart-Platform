# Modelo de Negocio

El modelo de negocio para la plataforma Fintcart esta compuesto a través de los siguientes componentes funcionales:

## Servicio de Aplicación

- Es el servicio encargado de orquestar las operaciones en el sistemas, lo cuál permite coordinar operaciones de diferentes componentes y manejar transacciones de forma distribuida. Dentro de sus funciones, el servicio de aplicación es responsable de la autenticación del usuario y generación de tokens JWT, también realiza acciones como enrutar APIs de forma central a sus respectivos servicios Backend, establece CORS y métricas de seguridad, mantiene comunicación con los demás servicios a través de la comunicación gRPC y realiza operaciones hacia base de datos propia para persistir la información relacionada con las sesiones del usuario.

## Servicio de Usuarios

- Es el servicio responsable de la administración de usuarios, comprende información del usuario y configuraciones relacionadas a las preferencias del usuario en cuanto al uso de la plataforma; Es el encargado de la autorización y el manejo de permisos por usuario, registro y almacenamiento de las credenciales del usuario, y genera reportes e históricos de la actividad del usuario hacia la plataforma y sus recursos.

## Servicio de Aprendizaje

- Este servicio es el administrador principal del contenido publicado de la plataforma; realiza operaciones para la creación, edición y publicación de los artículos educativos, suministrando además el control de versiones de los artículos y las prácticas recomendadas en la aplicación de conceptos de los artículos. El servicio proporciona categorización de los contenidos publicados, un flujo de publicación para la aprobación del contenido de los artículos, y la integración de cuestionarios para afianzar los conocimientos de l usuario.

## Servicio de Simulador

- El servicio de aprendizaje implementa 5 calculadoras principales dentro del sistema, los cuales corresponden a: Ahorros, Créditos, presupuesto, inversión y calculadoras específicas dentro del contexto colombiano para el análisis financiero del usuario en cuanto a la planeación de metas financieras o el análisis de riesgos en cuentao a inversiones o gastos específicos; el servicio mantiene un historial de operaciones en cuanto al uso de las calculadoras por operaciones de usuario.
