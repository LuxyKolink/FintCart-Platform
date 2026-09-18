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

### Si `apt` falla: el espejo colombiano no es alcanzable

Las dos máquinas del CTIC salen a Internet, pero **no alcanzan `co.archive.ubuntu.com`**, que
es el espejo que trae Ubuntu por defecto en esta región: resuelve a una IPv6 sin ruta y su
IPv4 tampoco responde. El síntoma aparece en el primer `apt update`:

```
W: Fallo al obtener http://co.archive.ubuntu.com/ubuntu/dists/noble/InRelease
E: Fallo al obtener ... No se puede iniciar la conexión a co.archive.ubuntu.com:80
```

Comprobado en las máquinas: `archive.ubuntu.com` y `security.ubuntu.com` responden **200**,
`download.docker.com` responde **200** y `registry-1.docker.io` responde **401** (lo normal
sin credenciales: el registro está vivo). Solo el espejo colombiano está caído desde ahí.
Antes de instalar nada:

```bash
sudo cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
sudo sed -i 's|co\.archive\.ubuntu\.com|archive.ubuntu.com|g' /etc/apt/sources.list.d/ubuntu.sources
sudo apt update
```

La copia de seguridad no es decorativa: esto es un cambio en la máquina, no en el
repositorio, y así se puede volver atrás.

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

**Y una advertencia sobre estas reglas, porque no hacen todo lo que parecen**: Docker
publica los puertos de los contenedores insertando sus propias reglas de `iptables`
**antes** que las de `ufw`, así que las reglas de `ufw` de arriba **no filtran** el tráfico
que va a un puerto publicado por un contenedor. Es decir: a los 5433–5439, al 5672 y al 6379
puede llegar cualquier máquina que tenga ruta hasta `pg_fintcart2`, con independencia de lo
que diga `ufw`. La contención real de esas bases es que **la máquina no tiene IP pública**:
solo la alcanza quien esté en la red interna del CTIC.

Si hace falta restringirlas de verdad a la máquina de aplicación, el sitio donde va la regla
es la cadena que Docker sí respeta (`DOCKER-USER`), no `ufw`:

```bash
sudo iptables -I DOCKER-USER -i enX0 ! -s 10.154.12.157 -j DROP   # enX0: la interfaz privada
```

Comprobado en la máquina de datos: con el `ufw` del paso 2 activo, los puertos publicados
siguen aceptando conexiones de otras direcciones. Se deja escrito aquí porque una regla que
no hace lo que dice es peor que no tenerla: da una sensación de protección que no existe.

## 3. Máquina de datos (`pg_fintcart2`): levantar y migrar

```bash
cd fintcart-platform/deploy/vps
cp .env.data.example .env.data
# Rellenar PG_PASSWORD y RABBITMQ_PASSWORD con:  openssl rand -hex 32
#   (NO `-base64`: su alfabeto trae «/» y «+», y la contraseña viaja dentro de una URL
#    `postgres://usuario:contraseña@host`. Un «/» parte la URL y el fallo que aparece
#    —un error de resolución de nombres— no menciona la contraseña por ningún lado.)
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
#   BOOTSTRAP_ADMIN_EMAIL → el correo que será administrador (ver abajo)

# La construcción compila 5 binarios Go, un binario Rust en modo release y el bundle
# de Angular. En 2 vCPU puede tardar varios minutos — es esperable, no un fallo.
docker compose -f compose.app.yaml --env-file .env.app build

docker compose -f compose.app.yaml --env-file .env.app up -d

docker compose -f compose.app.yaml logs -f caddy   # confirmar que emitió el certificado
```

### Sembrar lo que la plataforma necesita para funcionar

Con los servicios ya levantados, una vez por entorno:

```bash
./seed
```

Siembra tres cosas, y ninguna es adorno:

- las **siete calculadoras por defecto** de FR-019 —sin ellas `GET /calculators` no devuelve
  nada, y `gmf` no puede calcular porque depende del indicador `@UVT`;
- los **indicadores del año en curso**, con valores de EJEMPLO;
- el **cliente OAuth de la SPA** (`fintcart-spa`), con la `redirect_uri` de **este** dominio.

Ese tercero se añadió por el **hallazgo 40**: en el primer despliegue la tabla `oauth_clients`
quedaba vacía, así que una cuenta se podía registrar y verificar, pero **al iniciar sesión el
servidor de autenticación no reconocía al cliente y era imposible entrar**. La plataforma se veía
en pie —el SPA cargaba, el catálogo público respondía— y solo fallaba al intentar usarla.

La `redirect_uri` sale del `DOMAIN` de `.env.app` y **tiene que ser la misma** que
`frontend/Dockerfile` escribe en `config.js`: el servidor compara ambas y rechaza el flujo si
difieren. Al cambiar de dominio, se vuelve a sembrar (`ON CONFLICT DO UPDATE` la corrige).

Va **después** de `./migrate`, y el orden no es una formalidad: el sembrado escribe en
tablas que las migraciones crean. Además, a partir de T098 el Simulador resuelve la
definición de una calculadora **desde la base** en el camino de compatibilidad, así que
sobre una base migrada y sin sembrar se quedaría sin ninguna calculadora — es el motivo por
el que ese cambio va después de este paso y no antes (research D-30).

Es **idempotente** y **convergente**: compara la definición almacenada con la compilada y
solo añade una versión nueva cuando difieren. Se puede repetir en cada despliegue sin
duplicar nada, y si una definición semilla cambia en el código, la base deja de servir el
AST viejo.

> **Los indicadores sembrados son cifras de EJEMPLO, no las oficiales.** Son redondos a
> propósito, para que se reconozcan como relleno de puesta en marcha. La fuente de verdad
> es `UpsertIndicator` (FR-060), que los carga un administrador con el valor real de cada
> año. Dejarlos así y olvidarse significa que `gmf` calcula con una UVT inventada.

Por qué no lo hace el servicio al arrancar, ni una migración: el arranque de un servicio no
debe escribir en la base —falla en una réplica de solo lectura y hace que «qué hay en la
base» dependa de qué binario arrancó último—, y `golang-migrate` versiona el ESQUEMA, no el
contenido (Principio XI, research D-28).

### El administrador inicial

`BOOTSTRAP_ADMIN_EMAIL` es la única forma de que exista un administrador en esta
plataforma, y conviene saber por qué antes de dejarlo vacío:

- El rol **no se concede por la API**. Un endpoint capaz de otorgar `administrador`
  anularía la separación de responsabilidades de FR-008 —el mismo motivo por el que
  `dev/seed role` existe—; y `administrador` **no hereda** las atribuciones de
  `coordinador_editorial` (FR-082), así que tampoco sirve conceder el otro.
- El rol **no se siembra en una migración**: quedaría un usuario privilegiado escrito
  en el repositorio, y con él la contraseña del que lo cree (D-21).

Así que la secuencia es: la cuenta se registra desde la SPA por el flujo normal,
y después se pone su correo en `.env.app` y se reinicia `users`:

```bash
docker compose -f compose.app.yaml --env-file .env.app up -d users
```

La promoción es **idempotente**, así que reiniciar de más no duplica nada. Si el
correo todavía no corresponde a ninguna cuenta registrada, el servicio arranca igual
y registra `BOOTSTRAP_ADMIN_EMAIL no corresponde a ninguna cuenta registrada`: no es
un error, es la promoción esperando a que el registro termine. Cualquier **otro**
fallo sí detiene el arranque, porque un `BOOTSTRAP_ADMIN_EMAIL` que no se puede
aplicar es una configuración errónea que conviene ver de inmediato.

Dejarlo vacío deja las pantallas de categorías, indicadores anuales y cuentas
inaccesibles. Nada más falla: el catálogo, los cuestionarios y el simulador funcionan
sin administrador.

### Los dos barridos periódicos

`PURGE_SWEEP_INTERVAL` e `INDICATOR_SWEEP_INTERVAL` gobiernan los dos únicos trabajos
periódicos de la plataforma, y ambos viven en el **Orquestador** por la misma razón
que las sagas: son secuenciación, no dominio. Deciden *cuándo* preguntar; *qué*
responder lo responde el servicio dueño por gRPC —`Users.ListAccountsDueForPurge` para
las purgas y el calendario del Simulador para los indicadores—, nunca leyendo su base
(Principio III).

El formato es el de `time.ParseDuration` de Go (`1h`, `30m`, `12h`). Los valores por
defecto (1h y 12h) son holgados a propósito: la purga tiene un plazo de gracia de 30
días y el aviso de vencimiento se publica con semanas de antelación, así que bajarlos
solo añade consultas. En desarrollo van a 5m para que las dos rutas se puedan recorrer
dentro de una sesión.

## 5. Verificación de punta a punta

```bash
# El catálogo de calculadoras es la comprobación más corta que toca TODAS las piezas:
# entra por Caddy, el borde enruta a Aprendizaje por gRPC, y la respuesta sale de la
# base de datos de la otra máquina.
curl -s https://fintcart.bucaramanga.upb.edu.co/api/calculators | head -c 200
```

Las **sondas de salud no se comprueban por aquí**: viven en un puerto aparte
(`HEALTH_PORT`, 8081 en este despliegue y 9090 en los manifiestos de Kubernetes) que
**no se publica** al exterior a propósito —por ahí no se llega a ninguna ruta de
negocio—, así que `/api/healthz` responde 404 y no es un síntoma de nada. Para mirarlas,
desde dentro de la red de la aplicación:

```bash
docker run --rm --network fintcart-app_fintcart-app curlimages/curl:latest \
  -s http://api-gateway:8081/healthz
```

Luego, desde un navegador: entrar a `https://fintcart.bucaramanga.upb.edu.co`,
registrar una cuenta con un correo real, y confirmar que la verificación llega a la
bandeja de entrada (no a spam — Gmail SMTP saliente desde una IP de VPS nueva a veces
aterriza ahí las primeras veces). Completar el flujo de verificación y login confirma
que las 8 piezas — Gateway, Auth, Usuarios, Redis, RabbitMQ, Orquestador,
Notificación, Postgres — están conectadas correctamente entre las dos máquinas.

## 6. Desplegar esta enmienda: el constructor de calculadoras, categorías y administración

La enmienda `002` no añade servicios ni infraestructura: todo cabe en las mismas dos
máquinas. Lo que sí añade son **18 migraciones** repartidas por cinco de las siete bases, un
rol nuevo (`administrador`) y siete definiciones de calculadora que viven en la base.

### Orden

El orden no se elige: `migrate` aplica las migraciones **en orden de nombre de fichero**, y
las que trae esta enmienda van después de las de 001. Lo único que hay que respetar es que
**primero se migra y después se arranca el código nuevo** — el código de esta enmienda lee
columnas que antes no existían (`body_doc`, `categories`, `served_snapshot`), así que
arrancarlo contra el esquema viejo falla; y al revés no falla, porque estas migraciones solo
añaden y rellenan.

```bash
# 1) En pg_fintcart2 (datos) — 18 migraciones nuevas
cd fintcart-platform && git pull
cd deploy/vps && ./migrate

# 2) En pg_fintcart (aplicación) — reconstruir y levantar
cd fintcart-platform && git pull
cd deploy/vps
docker compose -f compose.app.yaml --env-file .env.app build
docker compose -f compose.app.yaml --env-file .env.app up -d

# 3) Y sembrar las siete calculadoras y los indicadores del año (una sola vez)
./seed
```

**El paso 3 no es opcional en esta enmienda**: las siete definiciones semilla cambian (las
cinco de FR-019 se reescriben como siete definiciones parametrizadas en un motor de
fórmulas), y si la base se queda con las viejas el servicio ejecutaría una fórmula que ya no
está en el código. `deploy/vps/seed` es idempotente y solo añade versiones cuando la
definición difiere, así que repetirlo no rompe nada.

Y para que exista el cuarto rol hace falta que `BOOTSTRAP_ADMIN_EMAIL` esté puesto en
`.env.app` antes de levantar `users` (D-21, ver «El administrador inicial» más arriba): el rol
`administrador` **no se hereda** de `coordinador_editorial` ni se concede por la API.

### Cuánto tarda: medido en las máquinas reales

Ensayo sobre las máquinas del colegio, con las bases vacías (que es como estaban al recibirlas:
el despliegue inicial no se había hecho):

| | |
|---|---|
| Máquinas | `pg_fintcart2` (datos), Ubuntu 24.04.3, 2 vCPU / 4 GB |
| Migraciones aplicadas | **31 en las 7 bases** (18 de esta enmienda) |
| Duración total | **3,9 s** de reloj, incluidos los `docker run` de `golang-migrate` |
| Más lenta | `20260902130000 calculator_published_version` — **233 ms** |
| Resultado | 7 bases con `schema_migrations` sin marcar sucia, y las versiones idénticas a las de desarrollo |

Las cifras por servicio son de decenas de milisegundos porque las bases estaban vacías: en una
instalación **con datos**, las migraciones que recorren tablas enteras —la de categorías, la
del documento de bloques, la del `served_snapshot`— crecen con el número de filas. El «3,9 s»
no es una promesa; es el piso de lo que se tarda.

### Plan de reversión

**Lo primero, y lo que de verdad importa**: `./migrate down` **no revierte la última
migración, revierte la cadena entera de las 7 bases** y borra sus datos (pide confirmación
escribiendo `yes`). No es un botón de deshacer: es un borrado.

Por eso, para una instalación con datos, la reversión empieza **antes** de migrar:

```bash
# Antes de aplicar nada, en pg_fintcart2:
docker exec fintcart-data-postgres-learning-1 pg_dump -U fintcart learning_db > learning_db.sql
# (una por cada base que se quiera poder recuperar)
```

Si hay que volver atrás **después** de haber migrado, el orden es: (1) restaurar los `pg_dump`
en las bases, (2) volver al commit anterior del repositorio en las dos máquinas y reconstruir
la imagen de aplicación (`compose.app.yaml build && up -d`), porque el esquema y el código
tienen que moverse juntos. Bajar solo el código, o solo el esquema, deja una mitad que no
entiende a la otra.

Lo que un `migrate down` **pierde** en esta enmienda, en concreto —y por eso no se usa para
revertir con datos—:

- `20260902150000` **reconstruye** `article_versions.body` a partir del documento de bloques,
  y la reconstrucción no es el original: los espacios en blanco vuelven normalizados, un
  encabezado y cada elemento de una lista pasan a ser una línea de texto, y las imágenes y
  calculadoras incrustadas no aparecen. El texto que el documento dice es el mismo; el texto
  que había, no.
- `20260902113000` borra las imágenes (`BYTEA`), y `20260902100000` deja los artículos sin su
  categoría.

### Dos cosas que encontró este ensayo, y que ya están arregladas

Se escriben aquí porque son la razón de ser de un ensayo, no a pesar de él:

1. **La contraseña que este README mandaba generar no servía.** `openssl rand -base64 32`
   produce un alfabeto donde entran «/» y «+», y `PG_PASSWORD` viaja **dentro de una URL**
   (`postgres://fintcart:<contraseña>@host:5433/auth_db`). Un «/» parte la URL y el fallo que
   aparece es `error: dial tcp: lookup ... server misbehaving`, que no menciona la contraseña
   por ningún lado. Ahora la receta es `openssl rand -hex 32`, y `./migrate` **se niega** a
   trabajar con una contraseña que rompa la URL, con el motivo en el mensaje.
2. **`deploy/vps/migrate` y `deploy/vps/seed` no tenían bit de ejecución**, aunque este README
   los invoca como `./migrate`. El primer intento en la máquina real terminó en
   `Permission denied`. Ya son ejecutables en el repositorio (`git` versiona ese bit).

### Lo que esta enmienda NO trae

El **bloque de baja de cuentas** (plazo de gracia de 30 días, aviso de purga, barrido de
cuentas) se descartó: no existe `pending_deletion`, no hay barrido de purgas y no hay variable
`PURGE_SWEEP_INTERVAL` (el archivo de plantilla la anunciaba y se quitó). La eliminación de
una cuenta la cubre la anonimización de 001 (FR-030).

Y una nota sobre los avisos de migración, por si alguien los espera: **`golang-migrate` no
imprime los `RAISE NOTICE` de las migraciones**. Comprobado en la máquina de datos con una
migración de prueba: la migración se aplica, el aviso no se ve. Un mensaje de este tipo no es
un canal para el operador, así que la información de las migraciones que solo viajaba ahí
—como el recuento que el plan pedía para la migración de `served_snapshot`— no era
recuperable de ninguna forma; y en ese caso concreto tampoco era calculable, porque el
conjunto de preguntas que se sirvió antes de esta enmienda **no se registraba** en ningún
sitio.

## 7. Humo del despliegue (`frontend/e2e-prod/`)

La suite de `frontend/e2e/` comprueba la **plataforma** contra la pila de desarrollo: obtiene
su cuenta leyendo el correo de verificación en MailHog y dos de sus specs hablan con el borde
por `http://localhost:8080`. Ninguna de las dos cosas existe aquí —el correo sale por SMTP
real y el borde vive detrás de Caddy—, así que contra el despliegue se registraban usuarios de
verdad y se llenaba de intentos la base de datos de producción.

Por eso hay una segunda suite, la del **despliegue**, que comprueba lo que solo existe una vez
desplegado (el borde, el paquete construido, el certificado, la redirección de las rutas
protegidas y el contrato del sembrado) y **no escribe nada**.

**Se puede lanzar de dos maneras, y conviene saber qué comprueba cada una:**

**a) Como pieza del despliegue, dentro de la máquina de aplicación** (lo normal aquí):

```bash
# En pg_fintcart (aplicación):
cd ~/fintcart-platform
deploy/vps/e2e                 # contra el dominio de .env.app
E2E_BASE_URL=http://frontend:8080 deploy/vps/e2e   # la pila por dentro, sin Caddy de por medio
```

Es un servicio del `compose.app.yaml` bajo el perfil `e2e` —no arranca con `up`, solo existe
cuando se pide— con su imagen (`deploy/vps/Dockerfile.e2e`, navegadores incluidos) y sus
capturas en `deploy/vps/e2e-results/`. La máquina **no** necesita Node ni Playwright
instalados: nada de eso queda en ella.

Dos detalles que cuestan un rato si no se saben: la imagen oficial de Playwright trae los
navegadores pero **no** el paquete de Node, así que la versión se instala fija en la imagen y
se comprueba arrancando un navegador en la construcción (si divergen, se ve al construir, no
al ejecutar el primer test); y `deploy/vps/e2e` no se construye desde el repositorio de una
máquina sin red, sino en la propia máquina (tarda ~2 min la primera vez).

**b) Desde cualquier máquina con Node y Playwright** (útil para comprobar el despliegue desde
fuera, que es el camino real del usuario: DNS, Caddy, certificado, enrutado de `/api/*`):

```bash
cd frontend
E2E_BASE_URL=https://fintcart.bucaramanga.upb.edu.co npm run e2e:prod
```

Con la CA de Caddy instalada en la máquina que la ejecuta (ver arriba), `E2E_TLS_ESTRICTO=true`
convierte la tolerancia al certificado propio en una comprobación de verdad.

**La parte autenticada** —catálogo de artículos, lectura, simulador y panel de administración—
necesita cuentas ya verificadas, porque el registro manda un correo real y el enlace de
verificación solo lo puede leer quien tiene el buzón. Se crean **una sola vez**, a mano, con
dos cuentas del mismo buzón (el «+» de Gmail): `usuario+aprendiz@…` y `usuario+admin@…`. La
primera se queda como aprendiz; el correo de la segunda va en `BOOTSTRAP_ADMIN_EMAIL` y con
`docker compose -f compose.app.yaml --env-file .env.app up -d users` recibe el rol `administrador`.

(Ojo: **`restart` no sirve**. Reiniciar un contenedor lo arranca otra vez con las variables que ya tenía, así que no relee `.env.app`: hay que **recrearlo** con `up -d`, que sí las vuelve a leer. Costó media hora y quedó como hallazgo 43. A partir de
ahí, `autenticado.spec.ts` inicia sesión con ellas y no vuelve a tocar el registro.

Esas cuatro credenciales se le pasan al humo por entorno (para el guion, en `.env.app`):

```bash
E2E_USUARIO_EMAIL=usuario+aprendiz@…
E2E_USUARIO_PASSWORD=…
E2E_ADMIN_EMAIL=usuario+admin@…
E2E_ADMIN_PASSWORD=…
```

**Sin ellas no se cae nada**: esas tres pruebas se saltan y lo dicen con todas las letras
(«sin E2E_USUARIO_EMAIL: la parte autenticada NO se comprobó»). Un salto ahí no significa que
no hiciera falta comprobarlo, significa que no se comprobó — por eso el mensaje nombra la
variable y este apartado.

**Lo único que escribe** el humo autenticado es la simulación que ejecuta el usuario de
prueba, que es justo lo que hace un usuario de verdad al usar el simulador; la cuenta de
administración solo lee. No registra a nadie, no publica contenido y no borra nada.

**Lo que sigue sin cubrirse desde el despliegue**, para que no se lea como cubierto: los
recorridos completos de US1–US4 y la limpieza de datos son de `frontend/e2e/` contra la pila
de desarrollo (59 pruebas). Este humo comprueba que el despliegue está **en pie**, no que la
plataforma esté bien: eso lo comprobaron las 59 pruebas antes de subirla.

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

El árbol de `~/fintcart-platform` es un **clon del repositorio** (público, por HTTPS), no una
copia suelta: `git pull` funciona, y así lo que corre en la máquina se puede comparar con lo
que dice el repositorio (`git -C ~/fintcart-platform log --oneline -1`). Los ficheros de
entorno (`.env.app`, `.env.data`) no están versionados —viven solo aquí— y `git pull` no los
toca.

El sembrado (`./seed` en `pg_fintcart`) hay que repetirlo cuando el cambio toca las
**definiciones semilla** de `services/simulator/src/domain/seeds/`. No es por prudencia:
una definición semilla es un AST que se guarda en la base, así que si el código cambia y la
fila no, el servicio ejecutaría la fórmula vieja mientras el binario tiene la nueva, y nada
fallaría. El binario compara y añade una versión nueva cuando difieren, de modo que
repetirlo es seguro y **no** repetirlo deja la base sirviendo algo que ya no está en el
código.

## Si el dominio no responde con HTTPS: falta el certificado, y depende del CTIC

Caddy pide el certificado a Let's Encrypt la primera vez que arranca, y **necesita que los
validadores de Let's Encrypt lleguen a esta máquina por 80 o 443**. El perímetro del CTIC deja
pasar el tráfico de Internet —comprobado el 18 de septiembre desde una red doméstica: los tres
puertos responden y `/` sirve el SPA— pero **filtra a los validadores de Let's Encrypt**, que
siguen recibiendo `Timeout during connect` en `http-01` (tanto en producción como en su entorno
de pruebas). El síntoma, en el registro de Caddy:

```
challenge failed ... challenge_type":"http-01" ... "detail":"207.248.81.119: Fetching
http://<dominio>/.well-known/acme-challenge/...: Timeout during connect (likely firewall problem)"
```

**Cómo está resuelto en este despliegue —dos emisores, y no hay nada que revertir:**

```caddyfile
{$DOMAIN} {
	tls {
		issuer acme      # primero el certificado de verdad
		issuer internal  # si no lo consigue, la autoridad propia de Caddy
	}
	...
}
```

Con esto el sitio **nunca se queda sin HTTPS**: Caddy intenta ACME y, mientras el perímetro no
lo deje pasar, sirve con su autoridad interna. En cada renovación vuelve a intentarlo, así que el
día que el CTIC abra 80/443 a los validadores **el certificado de verdad entra solo** y el aviso
del navegador desaparece sin tocar la máquina. La configuración se valida antes de aplicarla:

```bash
cd ~/fintcart-platform/deploy/vps
docker run --rm -e DOMAIN="$(sed -n 's/^DOMAIN=//p' .env.app)" \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

**Por qué no basta con `tls internal` a secas**, que es lo que hubo que poner a mano el primer
día: funciona siempre, pero obliga a que alguien se acuerde de quitarlo el día que el perímetro
se abra, y mientras tanto nadie puede verificar el certificado de verdad. Un despliegue no
debería depender de que alguien recuerde deshacer un apaño.

**Y por qué no basta con solo ACME**, que es lo que decía este apartado al principio: mientras
Let's Encrypt no pueda validar, **Caddy no tiene ningún certificado que servir y el sitio se
cae entero** —HTTPS devolvía `tlsv1 alert internal error` y la plataforma quedaba inaccesible
por más que todo lo demás estuviera bien—. Pasó al intentar recuperar el certificado de verdad
tras el primer despliegue, y es la razón de que la configuración tenga dos emisores.

**Para quitar el aviso del navegador mientras tanto** (opcional; la CA propia de Caddy, en el
portátil del que enseña — Fedora; en Firefox hay que importarla además en su propio almacén,
porque no usa el del sistema):

```bash
scp fintcart-app:~/fintcart-caddy-root.crt ~/
sudo cp ~/fintcart-caddy-root.crt /etc/pki/ca-trust/source/anchors/
sudo update-ca-trust
```

Comprobado el 18 de septiembre: por el dominio público y desde fuera del campus, `/` y
`/api/calculators` responden **200**, y el humo del despliegue pasa **7/7 desde casa y 7/7 desde
la máquina** (ver §7). El certificado que se sirve hoy es el de la autoridad interna de Caddy,
porque los validadores de Let's Encrypt no pueden entrar.

## Si el SPA se ve pero no funciona nada: `405 Not Allowed` de nginx

Síntoma: la plataforma carga, las pantallas se ven, y cualquier acción que llame al API
—registrarse, entrar, listar— devuelve `405 Not Allowed` con la firma de nginx.

Significa que el SPA está pidiendo a una ruta que **no pasa por el borde** y Caddy se la entrega
al frontend, que responde `405` a un POST contra un fichero estático (y `200` con HTML a un GET,
que es aún más silencioso). La causa es la configuración de tiempo de ejecución: el paquete usa
el valor compilado (`/v1`) en lugar del que sirve `/config.js`.

Comprobaciones, en orden:

```bash
# 1) ¿Qué sirve el borde?
curl -s https://<dominio>/config.js        # debe traer apiBaseUrl y oauth

# 2) ¿Lo carga el SPA? Debe aparecer un <script src="/config.js"> en el índice
curl -s https://<dominio>/ | grep config.js

# 3) ¿La petición va al API del propio origen? (401 del borde = bien; 405 de nginx = mal)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<dominio>/api/auth/register \
  -H 'Content-Type: application/json' -d '{}'   # 400 = borde · 405 = nginx · 404 = ruta mal
```

Lo cubre el humo (`deploy/vps/e2e`), con una prueba que navega y comprueba **a dónde va la
petición**, no solo el contenido del fichero: ese fue el hueco por el que se escapó este fallo
(hallazgo 39).

Si se cambia `DOMAIN`, hay que **recrear el frontend**: `config.js` se escribe al arrancar el
contenedor.

## El `git pull` de la máquina no basta para los ficheros montados

El árbol de `~/fintcart-platform` es un clon, así que desplegar empieza por `git pull`. Pero un
**montaje por bind ata el contenedor a un inodo, no a un nombre**: `git checkout` no edita el
fichero, escribe uno nuevo y lo renombra encima, de modo que el contenedor sigue viendo el viejo
—y `up -d` informa de que todo está «up-to-date» mientras corre una configuración que ya no está
en el repositorio—. Le pasó a `Caddyfile` (hallazgo 38).

Los servicios con el código horneado en la imagen no tienen este problema: cambia el identificador
de la imagen y Compose los recrea solo. Para los ficheros montados, hay que recrear a mano:

```bash
docker compose -f compose.app.yaml --env-file .env.app up -d --force-recreate --no-deps caddy
```

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
