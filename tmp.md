 1 · Credenciales

 Despliegue (https://fintcart.bucaramanga.upb.edu.co) — las cuatro con la misma contraseña, Luxy_kolink22:

 ┌─────────────────────────────────────┬───────────────────────┬────────────────────────────────────────────────────────────────────────────────┐
 │ Correo                              │ Rol                   │ Qué ve                                                                         │
 ├─────────────────────────────────────┼───────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
 │ garciasanti440+aprendiz@gmail.com   │ usuario_final         │ catálogo, artículos, cuestionarios, simuladores, progreso, notificaciones      │
 ├─────────────────────────────────────┼───────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
 │ garciasanti440+admin@gmail.com      │ administrador         │ panel de administración (categorías, indicadores, depuración). No ve el menú   │
 │                                     │                       │ editorial (FR-082)                                                             │
 ├─────────────────────────────────────┼───────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
 │ garciasanti440+coordinador@gmail.co │ coordinador_editorial │ bandeja de revisión: aprobar, rechazar, publicar, historial de versiones       │
 │ m                                   │                       │                                                                                │
 ├─────────────────────────────────────┼───────────────────────┼────────────────────────────────────────────────────────────────────────────────┤
 │ garciasanti440+editor@gmail.com     │ editor                │ crea y edita borradores; no aprueba ni publica                                 │
 └─────────────────────────────────────┴───────────────────────┴────────────────────────────────────────────────────────────────────────────────┘

 Hay que volver a iniciar sesión tras un cambio de rol: el token viejo ya no lo lleva.

 2 · Cómo ejecutarlos tú

 a) El humo del despliegue, dentro de la máquina — esta es la que manda, ~19 s, determinista:

 ```bash
   ssh fintcart-app
   cd ~/fintcart-platform
   deploy/vps/e2e                      # las 14
   deploy/vps/e2e editorial            # solo las 2 de editor/coordinador
   deploy/vps/e2e autenticado          # solo las 4 con sesión
   deploy/vps/e2e --grep "coordinador"
 ```

 b) El mismo humo desde tu portátil, contra la URL pública (lo que preguntabas):

 ```bash
   cd ~/Projects/tmp/FintCart-Platform/frontend
   export E2E_BASE_URL=https://fintcart.bucaramanga.upb.edu.co
   export E2E_USUARIO_EMAIL=garciasanti440+aprendiz@gmail.com      E2E_USUARIO_PASSWORD='Luxy_kolink22'
   export E2E_ADMIN_EMAIL=garciasanti440+admin@gmail.com           E2E_ADMIN_PASSWORD='Luxy_kolink22'
   export E2E_EDITOR_EMAIL=garciasanti440+editor@gmail.com         E2E_EDITOR_PASSWORD='Luxy_kolink22'
   export E2E_COORDINADOR_EMAIL=garciasanti440+coordinador@gmail.com E2E_COORDINADOR_PASSWORD='Luxy_kolink22'
   npx playwright test --config=playwright.prod.config.ts
 ```

 Funciona desde casa (lo acabo de correr así: 14/14 dos veces), pero su color depende del enlace: cada prueba abre un contexto sin caché y se
 baja el paquete entero por el perímetro del CTIC. Si sale un rojo aquí, mira antes la ejecución de (a) — está medido que el servidor responde en
 milisegundos y que un navegador limpio desde casa entra en 3 s.

 c) La suite de desarrollo (59 pruebas) — la que ejecuta el recorrido editorial completo, borrador → aprobación de otro coordinador →
 publicación:

 ```bash
   cd ~/Projects/tmp/FintCart-Platform
   dev/up && dev/migrate up && dev/seed          # pila completa, si no está ya
   cd frontend
   npm run e2e                                    # 59 pruebas, ~4,7 min
   npm test                                       # unitarias (Karma/ChromeHeadless)
   npm run lint                                    # eslint + oxlint + las tres barreras
 ```

 Ojo: frontend/e2e/ no se toca (N-13). Si una prueba de ahí falla tras un cambio, el fallo es del cambio.

 d) Comprobaciones sueltas del despliegue

 ```bash
   ssh fintcart-app 'cd ~/fintcart-platform && deploy/vps/seed-contenido --comprobar'   # catálogo, sin escribir
   deploy/vps/rol <correo> <rol>          # conceder editor/coordinador_editorial/administrador
 ```

 3 · Funcionalidades implementadas

 Acceso e identidad — registro con verificación por correo (asíncrona, vía saga), inicio de sesión OAuth2 Authorization Code + PKCE, refresh,
 cierre de sesión con revocación real (blacklist en Redis), recuperación/cambio de contraseña, bloqueo por intentos fallidos.

 Aprendizaje — catálogo por categorías con buscador y destacados, artículo con bloques enriquecidos (texto, imagen, calculadora incrustada,
 avisos), cuestionarios con N preguntas al azar y opciones barajadas, puntaje en porcentaje sobre 100, progreso con hitos, bandeja de
 notificaciones in-app.

 Simuladores y calculadoras — 7 definiciones sembradas, ejecución con precisión decimal exacta, historial de simulaciones e indicadores
 financieros vigentes (@NOMBRE) con el snapshot usado en cada corrida.

 Constructor de calculadoras — editor de fórmulas con analizador y AST persistido, catálogo de funciones (pot exacta vs. potd aproximada),
 validación de coste acotado, vista previa, calculadora propia ejecutable e incrustable en un artículo, curaduría y publicación por un
 coordinador.

 Contenido y flujo editorial — editor TipTap con documento de bloques de vocabulario cerrado validado en servidor, imágenes con tope de 2 MB e
 identificador SHA-256, borradores, revisión por un coordinador distinto del autor, aprobación/rechazo/publicación y versionado con historial.

 Administración — cuarto rol administrador: catálogo de categorías, indicadores anuales con vigencia, depuración de cuentas con estado
 pending_deletion y gracia de 30 días.

 Perfil y privacidad — datos de la cuenta, cambio de contraseña, reporte de actividad, eliminación de cuenta.

 Plataforma — API Gateway REST en el borde con gRPC interno, 7 bases PostgreSQL (una por servicio), RabbitMQ con orquestación por sagas y
 compensaciones, auditoría, notificación por email, métricas Prometheus, pruebas de carga k6.

 Frontend (003) — sistema de diseño propio (shared/ui), tokens, responsive definido en cuatro puntos de corte desde 360 px, accesibilidad
 verificada por barrera automática, y ninguna cifra monetaria truncada.
