<!--
Sync Impact Report — v1.1.1 (2026-07-27)
========================================
Version change: 1.1.0 → 1.1.1 (PATCH — corrección factual, sin cambio semántico)
Corrección: la tabla §"Convenciones de Estructura y Nomenclatura por Tecnología" listaba
  `src/inapp/` en la columna "Node puro (Notificación)". Era un error heredado de
  `plan.md`: la bandeja in-app es propiedad del **Servicio de Usuarios** (research.md D-09,
  data-model.md), porque Notificación es consumidor puro sin gRPC y no puede servir lecturas
  al usuario. Se elimina `src/inapp/` de esa celda y se añade una nota de alcance a
  §"Entrega de Notificaciones" fijando que esa sección gobierna únicamente el canal email.
Templates/artefactos actualizados en la misma pasada:
  - ✅ specs/001-fintcart-platform/plan.md (regenerado contra v1.1.1; gate ampliado a I–XII;
    árbol de código en rutas normativas; §Notas de Diseño N-01..N-05)
  - ✅ specs/001-fintcart-platform/research.md (D-11 marcado superseded por el Principio XI)
  - ✅ specs/001-fintcart-platform/data-model.md (email_outbox → notification_events_queue +
    notification_states)
  - ✅ specs/001-fintcart-platform/quickstart.md (reescrito sobre los verbos dev/)
  - ✅ CLAUDE.md
Follow-up TODOs: ninguno pendiente de la enmienda v1.1.0.

Sync Impact Report — v1.1.0
===========================
Version change: 1.0.0 → 1.1.0
Rationale: adición de cuatro principios nuevos (IX–XII) y dos secciones nuevas que
codifican los patrones de estructura y desarrollo del repositorio de referencia
https://github.com/dhij/ecomm, generalizados a todas las tecnologías del proyecto
(Go, Rust, TypeScript/NestJS, TypeScript/Node, TypeScript/Angular). No se elimina ni
redefine ningún principio existente → bump MINOR.

Modified principles: ninguno renombrado ni redefinido (I–VIII intactos)
Added principles:
  - IX. Arquitectura en Capas y Mapeo Explícito de Tipos
  - X. Entrypoints Delgados y Configuración por Entorno
  - XI. Migraciones Versionadas y Disciplina de Acceso a Datos
  - XII. Flujo de Desarrollo Local Uniforme
Added sections:
  - Convenciones de Estructura y Nomenclatura por Tecnología
  - Restricciones Tecnológicas → "Entrega de Notificaciones: Cola Persistente con Estado"
Removed sections: ninguna
Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (genérico; "Constitution Check" referencia la
    constitución de forma abstracta — sin cambios necesarios)
  - ✅ .specify/templates/spec-template.md (sin cambios estructurales)
  - ✅ .specify/templates/tasks-template.md (genérico; "Path Conventions" se resuelve
    desde plan.md — sin cambios necesarios)
  - ✅ .specify/templates/checklist-template.md (sin cambios estructurales)
  - ✅ CLAUDE.md (marcadores SPECKIT intactos; sin referencias hardcodeadas a principios)
  - ⚠ specs/001-fintcart-platform/plan.md — la tabla "Constitution Check" cubre I–VIII;
    requiere ampliarse a IX–XII y el árbol "Source Code" requiere reflejar las
    convenciones de capas/`dev/` (ver Follow-up TODOs)
  - ⚠ specs/001-fintcart-platform/quickstart.md — debe reemplazar los pasos manuales por
    la interfaz `dev/build`, `dev/up`, `dev/migrate`, `dev/down` (Principio XII)
Follow-up TODOs:
  - Ejecutar `/speckit-plan` (o editar manualmente) para re-evaluar el gate de
    constitución contra los principios IX–XII en `specs/001-fintcart-platform/plan.md`.
  - Actualizar `specs/001-fintcart-platform/quickstart.md` a los scripts `dev/`.
-->

# Constitución de Fintcart

## Core Principles

### I. Bounded Contexts y Microservicios

Cada microservicio del sistema (API Gateway, Servidor de Autenticación, Orquestador,
Usuarios, Aprendizaje, Simulador, Notificación, Auditoría) representa un bounded
context independiente con responsabilidades aisladas. Un servicio NO DEBE acceder al
estado interno, base de datos, ni lógica de dominio de otro servicio. Toda interacción
ocurre exclusivamente vía contratos gRPC sincrónicos o eventos asíncronos publicados
en RabbitMQ. Compartir tipos de dominio, esquemas de tabla, o utilidades que codifiquen
reglas de negocio entre servicios está PROHIBIDO.

**Justificación**: garantiza desacoplamiento, escalabilidad independiente y evolución
autónoma de cada servicio de la plataforma financiera.

### II. Topología de Comunicación: gRPC Interno, REST en el Borde

La comunicación interna entre microservicios DEBE realizarse mediante gRPC con
Protocol Buffers. REST/HTTP es admisible ÚNICAMENTE en el API Gateway como punto de
entrada externo desde el cliente Angular. Ningún servicio interno expone endpoints
REST hacia otros servicios internos; ningún cliente externo invoca gRPC directamente.
El API Gateway es el único componente con responsabilidad de traducción
HTTP/REST ↔ gRPC.

**Justificación**: gRPC ofrece contratos tipados y mejor rendimiento para comunicación
interna de alta frecuencia. REST en el borde mantiene compatibilidad con clientes
web estándar y simplifica la superficie pública del sistema.

### III. Soberanía de Datos: Database-per-Service con PostgreSQL

Cada microservicio DEBE poseer su propia instancia lógica de PostgreSQL,
siguiendo el patrón Database-per-Service. NINGÚN servicio puede acceder a la base de
datos de otro servicio (lecturas o escrituras), ni mediante consultas SQL cruzadas,
vistas compartidas, esquemas compartidos, ni credenciales reutilizadas. El intercambio
de datos entre servicios ocurre exclusivamente vía gRPC o eventos RabbitMQ.
PostgreSQL es la única base de datos relacional permitida en el sistema.

**Justificación**: el aislamiento estricto del estado evita acoplamiento implícito,
permite que cada servicio evolucione su esquema de forma independiente, y preserva
la integridad de los límites de bounded context.

### IV. Uso Acotado de Redis

Redis SOLO PUEDE utilizarse para dos propósitos específicos:

1. Blacklist de tokens JWT revocados y almacenamiento de refresh tokens en el
   Servidor de Autenticación.
2. Rate limiting distribuido en el API Gateway.

Cualquier otro uso de Redis (cache de datos de dominio, cola de mensajes, almacén
de sesiones de negocio, almacenamiento intermedio de cálculos, locks distribuidos,
contadores de dominio, etc.) está PROHIBIDO sin enmienda explícita a esta
constitución. Ningún servicio fuera de Autenticación y API Gateway puede mantener
una conexión activa a Redis.

**Justificación**: evita la proliferación de almacenes auxiliares, mantiene la
coherencia entre la fuente de verdad (PostgreSQL) y los estados volátiles, y reduce
la superficie operacional de infraestructura compartida.

### V. Eventos Asíncronos vía RabbitMQ (Únicamente a Notificación y Auditoría)

RabbitMQ es el broker exclusivo para mensajería asíncrona. Los eventos publicados
por los servicios productores (Usuarios, Aprendizaje, Orquestador, Autenticación)
SOLO PUEDEN ser consumidos por los servicios de Notificación y/o Auditoría. La
mensajería asíncrona dirigida a cualquier otro servicio del sistema está PROHIBIDA;
toda coordinación entre servicios de dominio se ejecuta de forma sincrónica vía
gRPC, o se orquesta mediante el patrón Saga (Principio VI).

Los servicios de Notificación y Auditoría son consumidores puros de eventos: no
exponen gRPC hacia otros servicios y no participan en flujos sincrónicos.

**Justificación**: limita la complejidad de la topología de eventos, mantiene
trazabilidad clara entre actividad operacional y los servicios de notificación y
compliance, y evita acoplamiento asíncrono oculto entre servicios de dominio.

### VI. Transacciones Distribuidas mediante el Patrón Saga

Toda operación que cruce dos o más servicios y requiera consistencia DEBE
implementarse usando el patrón Saga coordinado por el servicio Orquestador. NO se
permiten transacciones distribuidas con commit en dos fases (2PC), locks
distribuidos, ni dependencias sincrónicas en cadena que comprometan la consistencia
del sistema. Cada paso de una saga DEBE definir explícitamente su acción de
compensación correspondiente.

El Orquestador NO DEBE contener lógica de dominio propia. Su única responsabilidad
es la secuenciación de pasos, la invocación de operaciones de servicios participantes
y la ejecución de compensaciones ante fallos.

**Justificación**: asegura consistencia eventual de forma robusta y auditable,
manteniendo el desacoplamiento entre los servicios de dominio.

### VII. Autenticación y Autorización Estandarizada

La gestión de identidad DEBE seguir exclusivamente los siguientes flujos OAuth2:

- **Frontend (cliente público SPA Angular)**: Authorization Code con extensión PKCE.
- **Comunicación machine-to-machine**: Client Credentials.

Los tokens emitidos DEBEN ser JWT firmados. La revocación se gestiona contra la
blacklist en Redis del Servidor de Autenticación (Principio IV). NINGÚN servicio
puede implementar mecanismos propios de autenticación —API keys estáticas, tokens
custom, basic auth, secretos compartidos hardcodeados, etc.—; toda identidad se
delega al Servidor de Autenticación.

La verificación de identidad y de rol se implementa como **middleware/interceptor
explícito en la capa de transporte**, nunca dispersa dentro de la lógica de negocio:
un middleware de autenticación (validez y no-revocación del JWT) y middlewares de
autorización por rol (por ejemplo, administrador o editor). El hash de contraseñas y
las utilidades de emisión/validación de tokens residen en módulos dedicados y
aislados del Servidor de Autenticación (`token/`, `util/`), y NO se replican en otros
servicios.

**Justificación**: centraliza la gestión de identidad, elimina superficie de ataque
fragmentada, cumple con estándares aceptados para autenticación de SPAs y
comunicación de servicios, y produce un único punto de revocación efectiva.

### VIII. Precisión Aritmética para Valores Monetarios (NON-NEGOTIABLE)

TODOS los valores monetarios, tasas de interés, porcentajes de cálculo financiero,
resultados de simulación y montos persistidos DEBEN representarse usando tipos de
precisión arbitraria (arbitrary-precision decimals). El uso de `float`, `double`,
IEEE 754 binary floating point, o cualquier tipo numérico de punto flotante binario
para representar dinero está ESTRICTAMENTE PROHIBIDO en todas las capas del sistema:
persistencia, lógica de negocio, contratos gRPC, eventos RabbitMQ, y serialización
hacia el frontend.

Aplicación por tecnología:

- **PostgreSQL**: columnas `NUMERIC(precision, scale)` con escala adecuada al dominio
  (mínimo 4 decimales para tasas; mínimo 2 para montos en COP). Prohibido `REAL`,
  `DOUBLE PRECISION`, `FLOAT`.
- **Go**: librería `shopspring/decimal` (o equivalente arbitrary-precision verificada).
  Prohibido `float32`, `float64`.
- **Rust** (Simulador): `rust_decimal::Decimal` o `bigdecimal::BigDecimal`. Prohibido
  `f32`, `f64` para representar dinero o tasas.
- **TypeScript** (NestJS y Angular): `decimal.js` o `big.js`. Prohibido `number`
  nativo para representar montos o tasas.
- **Protocol Buffers**: representar como `string` decimal canónica. Prohibido `float`,
  `double`.
- **JSON en el borde REST**: serializar como `string` decimal canónica; nunca como
  número JSON.

Toda conversión entre tipos en frontera de servicio DEBE validar precisión y rechazar
overflow silencioso, y DEBE ocurrir exclusivamente en los módulos de mapeo definidos
por el Principio IX. Las pruebas DEBEN incluir casos de borde numérico (montos
extremos, redondeo bancario, división con resto).

**Justificación**: los errores de precisión binaria comprometen la exactitud contable
y violan requerimientos regulatorios del sector financiero colombiano. Esta regla es
NO-NEGOCIABLE y su violación es motivo de rechazo automático en revisión de código.

### IX. Arquitectura en Capas y Mapeo Explícito de Tipos

Todo servicio, sin importar su lenguaje, DEBE organizarse en tres capas con
dependencia estrictamente unidireccional:

```text
transporte  →  aplicación  →  persistencia
(handler)      (server)       (storer)
```

- **Transporte** (`handler`): adapta el protocolo externo (REST en el Gateway, gRPC en
  los servicios internos, consumo AMQP en Notificación/Auditoría). Decodifica la
  petición, aplica middlewares de autenticación/autorización, delega y serializa la
  respuesta. NO contiene reglas de negocio ni SQL.
- **Aplicación** (`server`): implementa el contrato del servicio y contiene las reglas
  de negocio del bounded context. Depende de la persistencia **a través de una
  interfaz**, nunca de una implementación concreta.
- **Persistencia** (`storer`): única capa autorizada a emitir SQL. Se declara como
  interfaz explícita y se implementa con un tipo nombrado según el motor
  (`PostgresStorer`, constructor `NewPostgresStorer(db)`).

Reglas obligatorias:

1. **Sin dependencias ascendentes**: la persistencia NO DEBE importar tipos de
   transporte ni tipos generados por Protocol Buffers; el transporte NO DEBE importar
   tipos de fila de base de datos.
2. **Inyección por constructor**: las dependencias (conexión a BD, cliente gRPC,
   canal AMQP, emisor de tokens) se reciben en el constructor. PROHIBIDAS las
   conexiones globales, singletons implícitos y variables de paquete mutables.
3. **Mapeo explícito**: cada cruce de frontera tiene un módulo de mapeo dedicado
   (`mapping`) y un módulo de tipos de transporte (`types`). La conversión
   `string` decimal ↔ tipo decimal (Principio VIII) ocurre ÚNICAMENTE ahí.
4. **Doble juego de tipos**: los DTO de petición/respuesta son distintos de los tipos
   de dominio y de los tipos de fila. Reutilizar un tipo a través de las tres capas
   está PROHIBIDO.

**Justificación**: la separación en capas con interfaz en la persistencia permite
probar la lógica de negocio sin base de datos y sustituir el motor sin tocar el
dominio. El mapeo explícito concentra en un único lugar las conversiones de
precisión decimal, que son el punto de fallo de mayor riesgo del sistema (Principio
VIII), y evita que el esquema de base de datos se filtre a la API pública.

### X. Entrypoints Delgados y Configuración por Entorno

Cada binario desplegable tiene un único entrypoint cuya ÚNICA responsabilidad es:
leer configuración del entorno, abrir conexiones, ensamblar las capas del Principio
IX, arrancar el servidor y gestionar el apagado ordenado (graceful shutdown).

Está PROHIBIDO en el entrypoint: lógica de negocio, consultas SQL, definición de
handlers, y cálculos financieros.

Reglas obligatorias:

1. **Ubicación**: `cmd/<binario>/main.go` (Go), `src/main.rs` (Rust),
   `src/main.ts` (NestJS y Node). Un directorio por binario desplegable.
2. **Configuración solo por variables de entorno** (`DB_ADDR`, `GRPC_SVC_ADDR`,
   `REDIS_ADDR`, `AMQP_ADDR`, `JWT_SECRET_KEY`, …). PROHIBIDO hardcodear hosts,
   puertos, credenciales o URLs en el código fuente o en los archivos de configuración
   versionados.
3. **Descubrimiento por hostname**: los servicios se localizan por el nombre lógico del
   servicio (nombre en `docker-compose` en local, nombre de `Service` en Kubernetes),
   nunca por IP.
4. **Secretos fuera del repositorio**: gestionados por Secrets de Kubernetes o el
   mecanismo equivalente del entorno. Ningún secreto real se versiona.

**Justificación**: un entrypoint delgado hace que el grafo de dependencias del
servicio sea legible de un vistazo y mantiene el mismo binario desplegable en todos
los entornos, con el entorno como única variable — condición necesaria para el
escalamiento horizontal en Kubernetes.

### XI. Migraciones Versionadas y Disciplina de Acceso a Datos

Todo cambio de esquema DEBE expresarse como una migración versionada, en el directorio
`migrations/` del servicio propietario (Principio III).

Reglas obligatorias:

1. **Nomenclatura y emparejamiento**: `<YYYYMMDDHHMMSS>_<nombre_snake_case>.up.sql` y
   su `.down.sql` correspondiente. Toda migración `up` DEBE tener un `down` que
   revierta efectivamente el cambio.
2. **Herramienta uniforme**: `golang-migrate` para TODOS los servicios,
   independientemente del lenguaje, ejecutado como contenedor contra la base de datos
   del servicio. PROHIBIDO el auto-sincronizado de esquema por ORM
   (`synchronize: true` de TypeORM y equivalentes) en cualquier entorno.
3. **Inmutabilidad de lo aplicado**: una migración ya aplicada fuera de local NO DEBE
   editarse; el cambio se expresa como una migración nueva.
4. **Transacciones**: toda escritura que afecte a más de una tabla DEBE ejecutarse
   dentro de una única transacción, mediante un helper centralizado
   (`execTx(ctx, fn)` o equivalente) que concentre `begin`/`rollback`/`commit`.
   PROHIBIDO replicar la lógica de transacción en cada método.
5. **Propagación de contexto**: toda operación de E/S (SQL, gRPC, AMQP, HTTP) DEBE
   recibir y propagar el contexto de cancelación/deadline de la petición.
6. **Errores envueltos**: todo error devuelto hacia arriba DEBE envolverse conservando
   la causa original y añadiendo contexto de la operación (`fmt.Errorf("...: %w", err)`
   en Go; `thiserror`/`anyhow` con `source` en Rust; `cause` en TypeScript).
   PROHIBIDO descartar errores silenciosamente o devolver el error desnudo sin
   contexto.

**Justificación**: las migraciones emparejadas y una única herramienta hacen que
cualquier servicio se pueda levantar y revertir con el mismo procedimiento, sin
importar el lenguaje. El helper de transacción y la propagación de contexto son las
dos defensas prácticas contra escrituras parciales y peticiones colgadas en un sistema
distribuido con compensaciones (Principio VI).

### XII. Flujo de Desarrollo Local Uniforme

El sistema completo DEBE poder levantarse localmente mediante una interfaz de comandos
idéntica para todos los servicios, sin importar el lenguaje de cada uno.

Reglas obligatorias:

1. **Scripts `dev/` en la raíz del repositorio**, ejecutables y con verbos fijos:
   `dev/build` (construir imágenes), `dev/up` (levantar la topología),
   `dev/migrate` (aplicar migraciones de todos los servicios), `dev/down` (detener y
   limpiar). Añadir verbos está permitido; renombrar los existentes NO.
2. **`dev/docker-compose.yaml`** declara la topología completa —los 7 PostgreSQL,
   Redis, RabbitMQ y los 8 servicios más el frontend— sobre una red bridge nombrada,
   con `depends_on` explícito y configuración por variables de entorno (Principio X).
3. **`Dockerfile.dev`** por servicio para el ciclo de desarrollo local; el `Dockerfile`
   de producción es un artefacto distinto y optimizado.
4. **Cero pasos manuales**: un desarrollador con Docker instalado DEBE poder ejecutar
   `dev/build && dev/up && dev/migrate` y obtener el sistema funcionando. Cualquier
   paso manual adicional es un defecto y se corrige en los scripts, no en la
   documentación.
5. **Documentación ejecutable**: `README.md` y `quickstart.md` contienen comandos
   copiables y verificados, más el diagrama de arquitectura vigente. Los comandos
   documentados DEBEN coincidir con los scripts `dev/`.

**Justificación**: en un monorepo poliglota con cinco stacks distintos, la mayor
fricción de incorporación es recordar cómo se arranca cada servicio. Una interfaz de
comandos uniforme elimina ese costo y hace que el entorno local sea reproducible y
verificable en integración continua.

## Convenciones de Estructura y Nomenclatura por Tecnología

Las capas del Principio IX se materializan así en cada stack del proyecto. Los nombres
de directorio son NORMATIVOS.

| Capa | Go (Gateway, Auth, Orquestador, Usuarios, Auditoría) | Rust (Simulador) | NestJS (Aprendizaje) | Node puro (Notificación) | Angular (Frontend) |
|------|------------------------------------------------------|------------------|----------------------|--------------------------|--------------------|
| Entrypoint | `cmd/<svc>/main.go` | `src/main.rs` | `src/main.ts` | `src/main.ts` | `src/main.ts` |
| Transporte | `internal/handler/` (`handler.go`, `routes.go`, `middleware.go`, `types.go`, `mapping.go`) | `src/grpc/` | `*.controller.ts` + `*.dto.ts` | `src/consumers/` | `core/` (interceptores, guards) |
| Aplicación | `internal/server/` (`server.go`, `mapping.go`) | `src/domain/`, `src/calculators/` | `*.service.ts` | `src/email/` | `features/*/services/` |
| Persistencia | `internal/storer/` (`storer_postgres.go`, `types.go`) | `src/repo/` | `*.repository.ts` | `src/repo/` | — |
| Stubs generados | `gen/` | `src/pb/` | `src/pb/` | `src/pb/` | `src/app/pb/` |
| Migraciones | `migrations/` | `migrations/` | `migrations/` | `migrations/` | — |
| Pruebas | `*_test.go` junto al código | `tests/` | `test/` | `test/` | `*.spec.ts` + `e2e/` |

Convenciones transversales:

- **Contratos en `contracts/`** (raíz): los `.proto`, los esquemas de eventos y el
  OpenAPI del Gateway son la única superficie compartida del monorepo (Principio I).
  Cada servicio genera sus stubs desde ahí hacia su propio directorio de stubs.
- **Stubs generados versionados**: los stubs gRPC generados se commitean al
  repositorio, de modo que compilar el servicio no exija tener `protoc` instalado. Se
  regeneran únicamente al cambiar el contrato, en un commit separado del cambio de
  lógica.
- **`internal/` en Go**: todo lo que no sea contrato público vive bajo `internal/`,
  haciendo el aislamiento del bounded context verificable por el compilador.
- **Un archivo, una responsabilidad**: `routes` solo enruta, `middleware` solo
  intercepta, `mapping` solo convierte, `types` solo declara.

## Restricciones Tecnológicas y de Infraestructura

### Lenguajes por Servicio

- **Go**: API Gateway, Servidor de Autenticación, Orquestador, Servicio de Usuarios,
  Servicio de Auditoría.
- **Rust**: Servicio de Simulador (motivado por seguridad de memoria y precisión
  numérica en cálculos financieros concurrentes).
- **TypeScript + NestJS**: Servicio de Aprendizaje (motivado por la complejidad del
  dominio de contenido educativo y la madurez del ecosistema NestJS para arquitectura
  modular).
- **TypeScript (Node.js puro)**: Servicio de Notificación (consumidor puro de eventos).
- **TypeScript + Angular**: Aplicación Frontend (SPA).

Cualquier desviación de esta asignación requiere enmienda formal a esta constitución.

### Infraestructura

- **PostgreSQL**: única base de datos relacional permitida. Una instancia lógica por
  servicio (Principio III).
- **Redis**: usado únicamente para los propósitos descritos en el Principio IV.
- **RabbitMQ**: usado únicamente para los flujos descritos en el Principio V.
- **Docker**: empaquetado de cada servicio como contenedor independiente;
  `Dockerfile.dev` para desarrollo local (Principio XII).
- **Kubernetes**: orquestación en producción con escalamiento horizontal automático
  y gestión centralizada de configuración y secretos.

### Entrega de Notificaciones: Cola Persistente con Estado

El Servicio de Notificación DEBE implementar la entrega mediante una **cola persistente
con estado en PostgreSQL**, y no confiar únicamente en el reintento del broker:

1. Al consumir un evento de RabbitMQ, el servicio lo **encola** en una tabla de eventos
   pendientes (`notification_events_queue`) con su contador de intentos.
2. Una tabla separada de estados (`notification_states`) registra el resultado
   (`not_sent` / `sent` / `failed`) y **sobrevive al desencolado**, quedando como
   registro consultable de lo ocurrido.
> **Alcance**: esta cola gobierna el canal **email**, que es la única responsabilidad de entrega
> del Servicio de Notificación. La **bandeja in-app es propiedad del Servicio de Usuarios**
> (Notificación es consumidor puro sin gRPC y no puede servir lecturas al usuario); se alimenta
> por el paso gRPC `Users.AppendInAppNotification` de la saga de actividad.

3. Un proceso de despacho lista los eventos pendientes ordenados por `created_at` e
   intenta la entrega de cada uno de forma concurrente y acotada:
   - **Éxito** → desencolar el evento y marcar su estado como `sent`.
   - **Fallo con intentos < máximo** → incrementar el contador; el evento permanece en
     la cola para la siguiente ronda.
   - **Fallo con intentos ≥ máximo** → desencolar y marcar el estado como `failed`.
4. El número máximo de intentos es configurable por entorno (Principio X) y su valor
   por defecto se documenta.
5. La entrega DEBE ser idempotente respecto al evento de origen: reprocesar el mismo
   evento no puede producir una notificación duplicada al usuario.

**Justificación**: separar la cola del estado hace que el resultado de cada intento
sea auditable después de que el evento deja la cola, y sitúa la política de reintentos
en el dominio del servicio en lugar de delegarla a la configuración del broker.

### Cumplimiento Financiero Colombiano

El Servicio de Auditoría DEBE persistir un registro inmutable y append-only de todas
las operaciones financieras y de identidad significativas. La trazabilidad provista
por este servicio es la fuente autoritativa para auditorías regulatorias. Los logs
operacionales de cada servicio NO sustituyen al registro de auditoría.

## Disciplina de Desarrollo y Cumplimiento

### Definición de Contratos

- Los contratos gRPC se definen mediante archivos `.proto` versionados en `contracts/`
  y revisados antes del cambio de cualquier servicio que los implemente o consuma.
- Los stubs generados se commitean al repositorio y se regeneran en un commit separado
  del cambio de lógica de negocio.
- Los esquemas de eventos RabbitMQ se documentan formalmente, incluyendo el
  productor y los consumidores autorizados (Notificación y/o Auditoría).
- Los endpoints REST del API Gateway se documentan vía OpenAPI/Swagger.
- Cambios incompatibles en contratos requieren versionado explícito y migración
  coordinada de consumidores.

### Calidad y Pruebas

- Pruebas de contrato entre productor y consumidores para gRPC.
- **Pruebas unitarias de la capa de persistencia contra un driver SQL simulado**
  (`sqlmock` en Go y equivalentes por stack), verificando la sentencia emitida y el
  mapeo de filas sin requerir una base de datos viva.
- Pruebas unitarias de la capa de aplicación contra un doble de la interfaz de
  persistencia (Principio IX), sin infraestructura real.
- Pruebas de integración para flujos Saga, incluyendo escenarios de compensación
  ante fallos en cada paso.
- Pruebas unitarias para la lógica de los simuladores financieros con casos de borde
  numérico (overflow, redondeo, conversión de moneda, montos cercanos a cero).
- Pruebas de la cola de notificaciones cubriendo los tres desenlaces: éxito, fallo
  reintentable y fallo terminal.
- Las violaciones al Principio VIII se detectan vía análisis estático cuando sea
  factible (e.g., reglas de lint que prohíban `float64` en módulos financieros).

### Observabilidad

- Cada servicio expone logs estructurados, métricas básicas (latencia, tasa de error,
  throughput) y health checks consumibles por Kubernetes.
- El Servicio de Auditoría es la única fuente para trazabilidad operacional
  regulatoria; los logs operacionales NO sustituyen al registro de auditoría
  (ver sección "Cumplimiento Financiero Colombiano").

## Governance

Esta constitución prevalece sobre cualquier otra práctica, convención o decisión
técnica dentro del proyecto Fintcart. En caso de conflicto entre esta constitución y
otros documentos (`CLAUDE.md`, briefs, READMEs, ADRs), la constitución prevalece.

### Enmiendas

- Toda enmienda DEBE documentar justificación, impacto en los servicios afectados, y
  plan de migración cuando aplique.
- Cambios MAYORES (eliminación o redefinición incompatible de un principio): bump
  de versión MAJOR.
- Cambios MENORES (adición de un principio o expansión material de uno existente):
  bump de versión MINOR.
- PATCH: clarificaciones, correcciones de redacción, refinamientos no semánticos.

### Revisión de Cumplimiento

- Todo Pull Request DEBE verificar el cumplimiento de los principios aplicables.
- Las violaciones a principios NON-NEGOTIABLE (Principio VIII en particular) son
  motivo de rechazo automático en revisión.
- Justificaciones para desviaciones a principios no NON-NEGOTIABLE se documentan en
  la sección "Complexity Tracking" del plan de implementación correspondiente.

### Guía Operativa

- Los documentos en `docs/anteproyecto/brief/` complementan esta constitución con
  contexto del modelo de negocio, alcance funcional y marco tecnológico.
- El repositorio de referencia para las convenciones de estructura, capas y flujo de
  desarrollo (Principios IX–XII) es <https://github.com/dhij/ecomm>; su estilo se
  adopta y se generaliza a todos los stacks del proyecto, subordinado siempre a los
  Principios I–VIII cuando haya conflicto (en particular, Fintcart mantiene
  database-per-service con PostgreSQL frente al esquema único con MySQL del
  repositorio de referencia, y no comparte paquetes de dominio entre servicios).
- El archivo `CLAUDE.md` provee guía operativa para agentes en el proyecto.

**Version**: 1.1.1 | **Ratified**: 2026-06-01 | **Last Amended**: 2026-07-27
