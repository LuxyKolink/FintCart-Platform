# Despliegue en Kubernetes

Kustomize, con una base completa y dos overlays:

```
base/                 los ocho servicios: Deployment, Service, probes, HPA, PDB
overlays/dev/         menos recursos, más log, Orquestador a una réplica
overlays/prod/        consumidores a dos réplicas, techo de autoescalado más alto
```

```bash
kubectl apply -k deploy/k8s/overlays/dev
kubectl apply -k deploy/k8s/overlays/prod
```

## Secretos: NO están aquí, y no van a estarlo

El Principio X prohíbe versionar secretos. Los manifiestos los referencian **por
nombre** y esperan que existan en el namespace; crearlos es un paso previo al
`apply`, no parte del árbol:

```bash
kubectl -n fintcart create secret generic fintcart-auth-secrets \
  --from-literal=DB_ADDR='postgres://...' \
  --from-literal=REDIS_ADDR='...' \
  --from-literal=AMQP_ADDR='amqp://...' \
  --from-literal=JWT_SIGNING_KEY='...'
```

Un Secret por servicio y no uno compartido: así la cadena de conexión de `auth_db` no
está montada en el pod de Aprendizaje. El Principio III prohíbe el acceso cruzado a
bases de datos, y darle a un servicio las credenciales de otro convierte esa
prohibición en un acuerdo de caballeros.

| Secret | Servicio | Claves |
|---|---|---|
| `fintcart-gateway-secrets` | api-gateway | `REDIS_ADDR`, `JWT_ALG`, `JWT_KEY`, `CORS_ORIGINS` |
| `fintcart-auth-secrets` | auth | `DB_ADDR`, `REDIS_ADDR`, `AMQP_ADDR`, `JWT_SIGNING_KEY` |
| `fintcart-users-secrets` | users | `DB_ADDR`, `AMQP_ADDR` |
| `fintcart-learning-secrets` | learning | `DB_ADDR`, `AMQP_ADDR` |
| `fintcart-simulator-secrets` | simulator | `DB_ADDR` |
| `fintcart-orchestrator-secrets` | orchestrator | `DB_ADDR`, `AMQP_ADDR` |
| `fintcart-notification-secrets` | notification | `DB_ADDR`, `AMQP_ADDR`, `SMTP_ADDR`, `SMTP_FROM` |
| `fintcart-audit-secrets` | audit | `DB_ADDR`, `AMQP_ADDR` |

El Simulador no tiene `AMQP_ADDR` y eso es diseño, no un olvido: **no es productor de
eventos** (research D-03). Sus operaciones las audita el Orquestador, que es quien lo
invoca.

## Bases de datos y broker

PostgreSQL, Redis y RabbitMQ **no** se despliegan desde aquí. Se referencian por
hostname a través del Secret de cada servicio, y se esperan como instancias
gestionadas. Un `Deployment` de PostgreSQL sin almacenamiento persistente pierde los
datos al reprogramarse un pod: tolerable en un portátil —para eso está
`dev/docker-compose.yaml`—, inaceptable en cualquier otro sitio.

## Réplicas

| Servicio | base | dev | prod |
|---|---|---|---|
| api-gateway, auth, users, learning, simulator | **2** | **2** | **2** (+HPA hasta 20) |
| orchestrator | 2 | 1 | 2 |
| notification, audit | 1 | 1 | 2 |

Los cinco de la primera fila mantienen su mínimo de dos **en todos los entornos**. Es
un requisito constitucional (D-12 / SC-012), y relajarlo «solo en desarrollo» haría que
el escenario probado a diario fuera justo el que producción no usa: los fallos de
concurrencia entre réplicas aparecerían por primera vez en producción.

El Orquestador tiene dos en la base por una razón propia: el rescate de sagas a medias
solo sirve si hay otra réplica viva que las recoja cuando una muere. Con una sola, una
saga interrumpida espera al reinicio de ese mismo pod.

## Sondas

Las tres van en un puerto aparte (`9090`), el mismo en los ocho servicios para que un
solo `ServiceMonitor` los recoja todos.

- `/healthz` — vivacidad. **No consulta ninguna dependencia.** Si comprobara
  PostgreSQL, una caída de la base reiniciaría todas las réplicas a la vez y, al
  volver, se encontraría con un enjambre de procesos arrancando en frío.
- `/readyz` — readiness. Sí consulta las dependencias del servicio. Un pod que no puede
  trabajar deja de recibir tráfico en lugar de responder errores.
- `/metrics` — latencia, tasa de error y throughput en formato Prometheus.

Que servicios gRPC y consumidores abran un puerto HTTP no contradice el Principio II:
no hay ninguna ruta de dominio detrás, y el puerto es distinto del de servicio.
