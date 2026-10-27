# Entorno, comandos y modelos

> Archivo operativo. Acompaña a [`00-plan.md`](./00-plan.md) — ahí están las decisiones y el alcance; aquí está **qué se ejecuta y con qué**.
> Verificado el 2026-10-24 sobre esta máquina.

---

## 1. Estado de la máquina (verificado, no asumido)

| Herramienta | Estado | Nota |
|---|---|---|
| `docker` | ✅ `/usr/bin/docker`, **funciona sin `sudo`** | resuelve LaTeX y k6 |
| LaTeX | ✅ imagen `texlive/texlive` descargada | **smoke test superado**: el autor compiló un PDF de prueba (2026-10-24) |
| k6 | ✅ imagen `grafana/k6` descargada | verificado por el autor |
| `pdftotext` | ✅ `/usr/bin/pdftotext` | sirve para extraer diagramas y citas de PDFs |
| Node | ✅ v24.18.0, npm 12.2.1 | |
| Chromium (sistema) | ❌ ninguno | **pero** Playwright 1.62 ya trae uno |
| Chromium (Playwright) | ✅ `~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome` | es el que usa Lighthouse |
| `draw.io` CLI | ❌ no instalado | `dot` y `convert` sí están |
| Espacio libre en `/home` | 434 GB | suficiente para `texlive` |

---

## 2. Lo primero que debes hacer (en este orden)

### Paso 1 — Decidir las 4 cosas que me bloquean

No puedo empezar sin esto. Están en `00-plan.md` §10–11:

1. **La fecha de entrega** (aunque sea aproximada, en semanas). Decide ruta rápida vs. ruta completa.
2. **Consolidar los objetivos de 10 a 5** — sí o no.
3. **`tmp.md`**: ¿se depura o se borra? Contiene credenciales de producción en texto plano.
4. **Autorización para arrancar** las fases 1 y 3 en paralelo.

### Paso 2 — ✅ HECHO: imagen de LaTeX y smoke test

```bash
docker pull texlive/texlive:latest
docker run --rm -v /tmp/tex-smoke:/src -w /src texlive/texlive:latest \
  pdflatex -interaction=nonstopmode smoke.tex
```

Confirmado por el autor el 2026-10-24: el PDF de prueba compila. La plantilla UPB se puede escribir sin adivinar.

### Paso 3 — ✅ HECHO: métricas

`grafana/k6` funciona. Chromium de Playwright disponible en
`$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`.

### Paso 4 — Pendiente: stack local y capturas

```bash
dev/build && dev/up && dev/migrate && dev/seed
npm --prefix frontend start
npm --prefix frontend run e2e
```

### Paso 5 — Reclutar participantes (no urgente, pero es el cuello de botella real)

5–8 personas para sesiones moderadas + 15–30 respuestas de encuesta. Es la única fase que el calendario no perdona, y la que el evaluador exigió explícitamente.

---

## 3. Comandos de referencia

### 3.1 Compilar el informe

```bash
# desde la raíz del repo
docker run --rm -v "$PWD/docs/informe:/src" -w /src \
  texlive/texlive:latest \
  latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex

# iteración limpia (borra auxiliares)
docker run --rm -v "$PWD/docs/informe:/src" -w /src \
  texlive/texlive:latest latexmk -C
```

### 3.2 Alternativa rápida: Tectonic

```bash
cd ~/.local/bin
curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh
./tectonic --version
./tectonic ~/Projects/tmp/FintCart-Platform/docs/informe/main.tex
```

> La red sí funciona en esta máquina (verificado: `curl` a `doi.org` responde 302). No llegué a probar el instalador de Tectonic porque el contenedor `texlive` ya está resuelto y funcionando, así que **Tectonic es opcional**. Si se usa, descarga paquetes en el primer build: necesita red en cada máquina nueva; el contenedor no. Si el instalador no responde, bajar el release `x86_64-unknown-linux-musl` desde `github.com/tectonic-typesetting/tectonic/releases`.

### 3.3 Stack local para e2e y capturas

```bash
dev/build
dev/up
dev/migrate
dev/seed

# otra terminal
npm --prefix frontend start

# suites
npm --prefix frontend run e2e          # 19 archivos en e2e/
npm --prefix frontend run e2e:prod     # 3 archivos en e2e-prod/
npm --prefix frontend test             # Karma
npm --prefix frontend run lint         # ESLint + oxlint + barricadas
```

### 3.4 Lighthouse por breakpoint

```bash
export CHROME_PATH="$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"

for bp in 360 480 768 1024 1280; do
  npx -y lighthouse http://localhost:4200 \
    --chrome-path="$CHROME_PATH" \
    --preset=desktop \
    --output=json --output=html \
    --output-path="./lighthouse-$bp" \
    --chrome-flags="--headless --window-size=$bp,900"
done
```

Producción (es el número que va al informe, porque incluye TLS y red real):

```bash
npx -y lighthouse https://fintcart.bucaramanga.upb.edu.co \
  --chrome-path="$CHROME_PATH" --output=json --output=html \
  --output-path=./lighthouse-prod
```

### 3.5 k6

```bash
docker run --rm -i grafana/k6 run - < deploy/loadtest/k6-scenarios.js
```

### 3.6 Diagramas

```bash
# nuevos diagramas (despliegue, C4 L3) — Mermaid versionable
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/nuevo.mmd -o docs/diagrams/nuevo.pdf

# existentes .drawio: exportar a mano
#   app.diagrams.net -> Abrir -> docs/diagrams/*.drawio -> Exportar como -> PDF
```

---

## 4. Referencias — de dónde salen y cómo se consolidan

### 4.1 Inventario

| Archivo | Entradas | URLs | Formato |
|---|---|---|---|
| **`docs/anteproyecto/referencias.md`** | **51** (467 líneas) | **41** | Lista anotada con encabezados emoji. **No es APA** |
| `docs/anteproyecto/marco-referencial.md` | citas en prosa | 6 | Autor-año en prosa, URLs malformadas, duplica fuentes |
| PDF anteproyecto, pp. 25–26 | ~30 | — | APA generado con gestor. **Conjunto distinto** |

### 4.2 Procedimiento (Fase 1, antes de escribir un solo párrafo)

1. Extraer las tres fuentes a `docs/informe/refs-inventory.md`: clave de cita, autores, año, título, revista/editorial, DOI/URL, y **de qué archivo salió**.
2. Marcar duplicados (mismo DOI, distinto metadato) y quedarse con el más completo.
3. **Verificar cada URL** (debe responder 200) y cada DOI (`https://doi.org/…` debe resolver). Las que no resuelvan: se citan sin URL o se descartan.
4. Emitir **un único `docs/informe/referencias.bib`** en `biblatex` con `style=apa`.
5. Escribir el capítulo de Marco referencial **citando desde el `.bib`**, nunca al revés.

Regla: **una fuente, una entrada, un formato.** Si aparece dos veces con metadatos distintos, es un error de APA.

### 4.3 Entradas a auditar con lupa

`referencias.md` mezcla papers con páginas de marketing (`codesuite.org`, `atlassian.com`, `encore.cloud`, Medium). En APA 7 son citables, pero un trabajo de grado no debería apoyar el marco teórico en blogs. Se marcan como *fuentes técnicas* (van al marco tecnológico, no al referencial) y se busca el paper equivalente.

---

## 5. Modelos y nivel de esfuerzo

Disponibles en esta instalación (`~/.pi/agent/models-store.json`):

| Modelo | ID | Contexto | Imágenes | Thinking | Costo /M in → out |
|---|---|---|---|---|---|
| DeepSeek V4.1 Flash | `deepseek-flash` | 1M | **sí** | `low` · `high` · `max` | $0.30 → $1.20 |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1M | **no** | `high` · `max` | $1.32 → $3.96 |

Pro cuesta 4.4× la entrada y 3.3× la salida. El criterio: **Pro donde un error cuesta más que el token; Flash donde el trabajo es mecánico o necesita ojos.**

| Tarea | Modelo | Thinking |
|---|---|---|
| Orquestación, plan, decisiones de arquitectura | `v4-pro` | `high` |
| Dirección de arte (brief, tokens, crítica) | `v4-pro` | `high` |
| Redacción de capítulos (prosa + APA) | `v4-pro` | `high` |
| Plantilla LaTeX y fidelidad institucional | `v4-pro` | `max` |
| Ciclo de arreglo de errores de compilación | `flash` | `high` |
| Exploración de repo, lectura, grep | `flash` | `low` |
| Design system (19 primitivas + tokens) | `flash` | `high` |
| **Revisión visual de capturas** | `flash` | `high` |
| Matriz de factibilidad de calculadoras | `v4-pro` | `high` |
| Semillas en Rust | `flash` | `high` |
| Recolección de evidencia (suites, JSON) | `flash` | `low` |
| Investigación web (benchmark) | `flash` | `high` |
| Auditoría final de APA y consistencia | `v4-pro` | `high` |

**Restricción dura:** `v4-pro` **no acepta imágenes**. Todo lo que sea mirar capturas va por `deepseek-flash`, sin excepción.

**Cómo se cambia:** `/model` para esta sesión; los subagentes aceptan override por tarea, así que el gasto se concentra en las cinco filas de `v4-pro`.

---

---

## 6. Trampas de esta máquina (medidas, no supuestas)

### 6.1 Montajes idmapped: el contenedor root ES tu usuario

Mapeo medido el 2026-10-27 en este equipo:

| uid dentro del contenedor | uid en el host |
|---|---|
| `0` (root) | `1000` (`sxnty`) |
| `1000` | `525287` (sin mapear) |

Tres consecuencias, y las tres se vivieron en carne propia:

- **Nunca pasar `-u $(id -u)` a Docker.** El contenedor no puede escribir y falla con
  `Cannot write file 'main.aux'`. Correr como root por defecto es lo correcto.
- **Nunca hacer `chown -R` dentro del contenedor.** Reescribe todo el árbol a `525287`, y desde
  el host quedan archivos que no puedes editar ni borrar. Ya pasó una vez con `docs/informe/`;
  se reparó con `chown 0:0` desde el contenedor (ver la nota en `build.sh`).
- Para reparar dueños: `find /src -mindepth 1 -exec chown 0:0 {} +` desde el contenedor.

### 6.2 `biblatex-apa` + `babel` en español rompe la compilación

Síntoma: `! LaTeX hooks Error: Generic hooks cannot be added to '\@makecaption'` en
`\begin{document}`, sin PDF. Causa: `apa.cbx` instala `\AddToHook{cmd/@makecaption/before}` y los
*shorthands* activos del español (`"`, `~`, `...`) hacen `\@makecaption` no retokenizable.

Solución: `\usepackage[spanish, es-noshorthands, main=english]{babel}`. El documento no usa
ninguno de esos shorthands, así que no se pierde nada.

### 6.3 Rust no existe en el host: solo en imágenes

No hay `cargo`, `rustc` ni `rustup`. El `Cargo.lock` exige **1.97**; la imagen `1.85` que había
local no compila el árbol. Para compilar o correr `tests/seed_regression.rs`:

```bash
bash /tmp/rust-build.sh     # o el equivalente con rust:1.97-slim-bookworm
```

`CARGO_HOME` se persiste en `~/.cargo-docker` para no re-descargar crates en cada corrida.

---

## 7. Checklist de arranque

- [ ] Fecha de entrega definida
- [ ] Objetivos 10 → 5: aprobado o vetado
- [ ] `tmp.md`: depurar o borrar
- [ ] Go para fases 1 y 3 en paralelo
- [ ] `docker pull texlive/texlive:latest` completado ✅
- [ ] Smoke test de LaTeX genera `smoke.pdf` ✅
- [ ] `grafana/k6` y Chromium de Playwright verificados ✅
- [ ] Imagen `rust:1.97-slim-bookworm` descargada ✅
- [ ] Participantes de validación identificados
