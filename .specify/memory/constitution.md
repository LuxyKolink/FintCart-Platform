<!--
Sync Impact Report
==================
Version change: TEMPLATE → 1.0.0
Modified principles: N/A (constitución inicial)
Added sections:
  - Core Principles (8 principios)
  - Restricciones Tecnológicas y de Infraestructura
  - Disciplina de Desarrollo y Cumplimiento
  - Governance
Removed sections: N/A (reemplazo del template baseline)
Templates requiring updates:
  - ✅ .specify/templates/plan-template.md (sin cambios estructurales; la sección "Constitution Check" referencia esta constitución de forma abstracta)
  - ✅ .specify/templates/spec-template.md (sin cambios estructurales)
  - ✅ .specify/templates/tasks-template.md (sin cambios estructurales)
  - ✅ CLAUDE.md (marcadores SPECKIT intactos; sin referencias hardcodeadas a principios)
Follow-up TODOs: ninguno
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
overflow silencioso. Las pruebas DEBEN incluir casos de borde numérico (montos
extremos, redondeo bancario, división con resto).

**Justificación**: los errores de precisión binaria comprometen la exactitud contable
y violan requerimientos regulatorios del sector financiero colombiano. Esta regla es
NO-NEGOCIABLE y su violación es motivo de rechazo automático en revisión de código.

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
- **Docker**: empaquetado de cada servicio como contenedor independiente.
- **Kubernetes**: orquestación en producción con escalamiento horizontal automático
  y gestión centralizada de configuración y secretos.

### Cumplimiento Financiero Colombiano

El Servicio de Auditoría DEBE persistir un registro inmutable y append-only de todas
las operaciones financieras y de identidad significativas. La trazabilidad provista
por este servicio es la fuente autoritativa para auditorías regulatorias. Los logs
operacionales de cada servicio NO sustituyen al registro de auditoría.

## Disciplina de Desarrollo y Cumplimiento

### Definición de Contratos

- Los contratos gRPC se definen mediante archivos `.proto` versionados en el
  repositorio y revisados antes del cambio de cualquier servicio que los implemente
  o consuma.
- Los esquemas de eventos RabbitMQ se documentan formalmente, incluyendo el
  productor y los consumidores autorizados (Notificación y/o Auditoría).
- Los endpoints REST del API Gateway se documentan vía OpenAPI/Swagger.
- Cambios incompatibles en contratos requieren versionado explícito y migración
  coordinada de consumidores.

### Calidad y Pruebas

- Pruebas de contrato entre productor y consumidores para gRPC.
- Pruebas de integración para flujos Saga, incluyendo escenarios de compensación
  ante fallos en cada paso.
- Pruebas unitarias para la lógica de los simuladores financieros con casos de borde
  numérico (overflow, redondeo, conversión de moneda, montos cercanos a cero).
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
- El archivo `CLAUDE.md` provee guía operativa para agentes en el proyecto.

**Version**: 1.0.0 | **Ratified**: 2026-06-01 | **Last Amended**: 2026-06-01
