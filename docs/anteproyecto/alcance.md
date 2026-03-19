# ALcance

## Servidor de Aplicación

EL servidor de aplicación manejará las siguientes funcionalidades principales:

- Sistema de autenticación, a través del uso de tokens JWT para la autenticación del usuario, así como validación de credenciales, cierre de sesión, gestión de la sesión y mecanismos para el manejo de tokens de refresco y la rotación de los mismos.
- Enrutador central para el acceso a los recursos y operaciones de los distintos módulos Backend desde las peticiones del cliente.
- Maneja configuración de seguridad, utilizando CORS y límite de peticiones.
- EL servidor posee la responsabilidad de orquestar las operaciones de los distintos módulos de la aplicación a través del manejo de transacciones distribuidas.

## Servicio de Usuarios

- Es responsable de del registro de usuario con verificación de correo y administración de perfiles.
- Los usuarios tendrán una barra de progreso, el cuál aumentará de acuerdo a las calificaciones del material publicado en el módulo de aprendizaje.
- Historial de publicaciones vistas y calificaciones realizadas en el módulo de aprendizaje.
- Reportes de estadísticas de operaciones de usuarios realizados en el módulo de aprendizaje.

## Modulo de Aprendizaje

- Este módulo es encargado de la creación, edición y publicación de artículos educativos y lecciones, junto con sistema de calificación.
- Cada articulo o módulo de aprendizaje posee ejercicios prácticos, como por ejemplo, test de validación de conocimientos.
- Las publicaciones en el módulo poseen estadísticas para el análisis de la interacción del usuario con el módulo de aprendizaje y sus artículos.

## Servicio de Simulador

- El simulador implementa una variedad especifica de calculadoras para simular operaciones financieras, como lo son calculadora para ahorros, planeación de presupuesto y análisis de deuda.
- Los simuladores poseen interacción con diferentes tipos de moneda.
- El simulador es encargado de manejar la lógica matemática, y operaciones concurrentes para obtener resultados precisos y permitir el análisis y toma de decisiones.

## Servicio de Notificación

- Consume eventos a partir de la cola de notificaciones; esto comprende verificación de correos electrónicos, cambio de contraseñas, notificaciones de la aplicación, y eventos generados a partir de la actividad de los usuarios.

## Aplicación Frontend

- La aplicación frontend corresponde a la herramienta de interacción principal entre el usuario y los diferentes módulos que comprende el sistema.
- Los usuarios podrán visualizar la experiencia adquirida a través de barras de progreso, también podrán editar la información de su perfil y las preferencias en el uso del aplicativo.
- Comprende una interface de interacción con el módulo de aprendizaje y los artículos publicados en este; los usuarios podrán visualizar el contenido, y realizar encuestas y test para adquirir puntos de progreso para el usuario, y comprobar la adquisición de los temas presentados en el módulo de aprendizaje.
- Posee integración con los módulos de notificación y simulador, para visualizar acciones rápidas dentro del sistema.
