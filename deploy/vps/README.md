# Despliegue en las máquinas del colegio

Dos VPS del CTIC (UPB Bucaramanga), Ubuntu Server 24.04, 4 GB RAM / 2 vCPU / 80 GB
disco cada una. Con ese presupuesto, el overlay de producción de `deploy/k8s/` (2+
réplicas por servicio, autoescalado hasta 20, bases de datos gestionadas aparte) no
cabe — sus `requests` de CPU/memoria por sí solos superan lo que hay disponible en las
dos máquinas juntas antes de que llegue un solo usuario real. Este árbol es la
alternativa: `docker compose` llano, repartido por NIVEL entre las dos máquinas, sin
capa de orquestación de por medio.

## Máquinas

**El nombre de cada VPS NO indica su rol** — las dos se llaman "pg_fintcart" /
"pg_fintcart2" por convención del CTIC, no porque una aloje PostgreSQL. Lo que
realmente distingue su rol es cuál tiene IP pública:

| | `pg_fintcart` | `pg_fintcart2` |
|---|---|---|
| **Rol en este despliegue** | **Aplicación** | **Datos** |
| IPv4 privada | `10.154.12.157` | `10.154.12.159` |
| IPv4 pública | `207.248.81.119` | — (no aplica) |
| DNS | `fintcart.bucaramanga.upb.edu.co` | — (no aplica) |
| Aloja | 8 servicios, frontend, Caddy | 7× PostgreSQL, Redis, RabbitMQ |

`pg_fintcart` es la única con salida pública, así que es la que ejecuta
`compose.app.yaml` (Caddy incluido). `pg_fintcart2` no tiene IP pública en absoluto —
solo hace falta que `pg_fintcart` la alcance por la red PRIVADA, y por eso
`compose.data.yaml` no necesita ninguna regla de firewall del CTIC hacia Internet en
absoluto, solo `ufw` entre las dos máquinas (paso 2).

Nada con estado corre en la máquina de aplicación; ningún servicio de aplicación corre
en la máquina de datos. La comunicación entre las dos va por la red privada
(`DATA_HOST` en `.env.app`), nunca por disco compartido.

Un solo dominio (`fintcart.bucaramanga.upb.edu.co`), no dos subdominios: Caddy reparte
por RUTA en vez de por subdominio — `/api/*` va al Gateway (con el prefijo quitado
antes de reenviar), todo lo demás va al frontend. Ver `Caddyfile`.

## Antes de empezar

- **Gmail**: en la cuenta que va a enviar los correos, activar verificación en dos
  pasos y generar una «contraseña de aplicación» (Cuenta de Google → Seguridad →
  Contraseñas de aplicaciones). Esa contraseña de 16 caracteres es `SMTP_PASSWORD`, no
  la contraseña normal de la cuenta.
- El DNS y la IP pública de `pg_fintcart` ya están habilitados por el CTIC — no hay
  nada que esperar en ese frente.

## 1. Provisionar las dos máquinas (en cada una)

```bash
sudo apt update && sudo apt upgrade -y

# Docker Engine + Compose plugin (repositorio oficial, no el paquete de Ubuntu)
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"   # cerrar sesión y volver a entrar para que aplique

# 2 GB de swap: con 4 GB de RAM, un pico durante el build de las imágenes (Angular y
# Rust son los que más piden) puede acercarse al límite. Sin swap, el OOM killer mata
# el build a mitad; con ella, se ralentiza mucho antes de fallar del todo.
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

git clone <la URL de este repositorio> fintcart-platform
cd fintcart-platform
```

## 2. Firewall

Por defecto `ufw` no está activo en Ubuntu Server. Activarlo con una política
restrictiva ANTES de levantar nada — un Postgres o un Redis alcanzables desde
cualquier IP, aunque sea por minutos, es una base de datos comprometida. El CTIC ya
filtra el acceso desde fuera del campus a 22/80/443 por su cuenta; lo de aquí abajo es
el firewall DENTRO de cada máquina, que es responsabilidad nuestra.

**En `pg_fintcart2` (datos)** — sustituir `<IP_APP>` por la IP PRIVADA de
`pg_fintcart` (`10.154.12.157`):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow from 10.154.12.157 to any port 5433:5439 proto tcp   # los 7 Postgres
sudo ufw allow from 10.154.12.157 to any port 5672 proto tcp        # RabbitMQ (AMQP)
sudo ufw allow from 10.154.12.157 to any port 6379 proto tcp        # Redis
sudo ufw allow from <TU_IP> to any port 15672 proto tcp             # opcional: consola RabbitMQ, desde tu propia IP
sudo ufw enable
```

**En `pg_fintcart` (aplicación)**:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Ningún puerto de los 8 servicios ni del frontend se publica al host en
`compose.app.yaml` — se hablan entre sí por la red interna de Compose y solo Caddy
queda expuesto, así que no hace falta abrir nada más aquí.

## 3. Máquina de datos (`pg_fintcart2`): levantar y migrar

```bash
cd fintcart-platform/deploy/vps
cp .env.data.example .env.data
# Rellenar PG_PASSWORD y RABBITMQ_PASSWORD con:  openssl rand -base64 32
nano .env.data

docker compose -f compose.data.yaml --env-file .env.data up -d

# Esperar a que las 7 instancias y el broker estén "healthy":
watch docker compose -f compose.data.yaml ps

./migrate
```

## 4. Máquina de aplicación (`pg_fintcart`): configurar, construir y levantar

```bash
cd fintcart-platform/deploy/vps
cp .env.app.example .env.app
nano .env.app
#   DATA_HOST          → ya viene prellenado con 10.154.12.159 (la IP privada de pg_fintcart2)
#   PG_PASSWORD         → EXACTAMENTE el mismo valor que en .env.data de la otra máquina
#   RABBITMQ_PASSWORD   → ídem
#   JWT_SIGNING_KEY     → openssl rand -base64 48
#   DOMAIN              → ya viene prellenado con fintcart.bucaramanga.upb.edu.co
#   SMTP_FROM / SMTP_USER → tu cuenta de Gmail
#   SMTP_PASSWORD       → la contraseña de aplicación de 16 caracteres

# La construcción compila 5 binarios Go, un binario Rust en modo release y el bundle
# de Angular. En 2 vCPU puede tardar varios minutos — es esperable, no un fallo.
docker compose -f compose.app.yaml --env-file .env.app build

docker compose -f compose.app.yaml --env-file .env.app up -d

docker compose -f compose.app.yaml logs -f caddy   # confirmar que emitió el certificado
```

## 5. Verificación de punta a punta

```bash
curl -s https://fintcart.bucaramanga.upb.edu.co/api/healthz
```

Luego, desde un navegador: entrar a `https://fintcart.bucaramanga.upb.edu.co`,
registrar una cuenta con un correo real, y confirmar que la verificación llega a la
bandeja de entrada (no a spam — Gmail SMTP saliente desde una IP de VPS nueva a veces
aterriza ahí las primeras veces). Completar el flujo de verificación y login confirma
que las 8 piezas — Gateway, Auth, Usuarios, Redis, RabbitMQ, Orquestador,
Notificación, Postgres — están conectadas correctamente entre las dos máquinas.

## Redesplegar tras un cambio de código

```bash
# En pg_fintcart (aplicación):
cd fintcart-platform && git pull
cd deploy/vps
docker compose -f compose.app.yaml --env-file .env.app build
docker compose -f compose.app.yaml --env-file .env.app up -d
```

Las migraciones (`./migrate` en `pg_fintcart2`) solo hace falta repetirlas cuando el
cambio añade una nueva bajo `services/*/migrations/`.

## Lo que este árbol NO cubre

- **Copias de seguridad**: los 7 volúmenes de `compose.data.yaml` no tienen backup
  automático. Para un proyecto de curso puede bastar un `pg_dump` manual antes de una
  demo importante; para cualquier otra cosa, hace falta un cron con rotación.
- **Alta disponibilidad**: una réplica por servicio. Si un contenedor muere, Compose lo
  reinicia (`restart: unless-stopped`), pero hay una ventana de caída — el mínimo de 2
  réplicas del overlay de producción (D-12/SC-012) no es alcanzable con este
  presupuesto de máquinas.
- **Redis sin autenticación**: protegido solo por el firewall del paso 2, no por
  contraseña — ver el comentario en `compose.data.yaml` sobre por qué (auth-server y
  api-gateway no saben hablar Redis con `AUTH` todavía).
