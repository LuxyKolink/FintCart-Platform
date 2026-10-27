# Plan de trabajo — Informe final de trabajo de grado

> Documento de alineación. No forma parte del informe; es el contrato de trabajo.
> Estado: **aprobado** (decisiones cerradas 2026-10-24). Plazo: **1–2 semanas**.
> Repo: `FintCart-Platform`

---

## 0. Punto de partida verificado

| Hecho | Verificación |
|---|---|
| Los tres specs están implementados | `001` T001–T184 · `002` T001–T173 · `003` T001–T093 — **450 tareas, 0 sin marcar** |
| El sistema está desplegado de verdad | `https://fintcart.bucaramanga.upb.edu.co` (Caddy + TLS, Compose, manifiestos K8s) |
| Hay historial de desarrollo | 191 commits con mensajes convencionales |
| El documento final **no existe** | 0 archivos `.tex`, 0 `.bib`, 0 `.docx`. Solo un PDF de 26 pp. exportado de Word |
| La plantilla institucional es recuperable | PDF del anteproyecto: portada ×2, contenido, resumen ES/EN, 7 secciones |
| `styles.scss` fue eliminado | Verificado: no existe en el árbol; `design-debt.mjs` = 0 |

**Conclusión:** el problema no es construir software. Es que el software existe y la evidencia académica de que existe no está escrita, ni medida, ni validada.

---

## 1. Decisiones cerradas

| # | Decisión | Elección |
|---|---|---|
| 1 | Documento | Informe final de trabajo de grado, plantilla UPB, reemplaza el PDF de 26 pp. |
| 2 | Frontend | Dirección de arte **+ estructura/shell** — se retira la metáfora de portal |
| 3 | Referente visual | **Institucional sobrio** (registro BanRep / Asobancaria / BVC) |
| 4 | Calculadoras | **4–5 semillas nuevas**, colombianas, expresables con el DSL actual |
| 5 | Idioma | **Fuente completa en inglés**, traducción posterior del autor; boilerplate en español fijo |
| 6 | Validación | Encuesta + **5–8 sesiones moderadas**, SUS + tasa de éxito de tarea |

---

## 2. Entregable 1 — el documento

La rúbrica es una **lista de cobertura**, no un índice. Se conserva la columna vertebral de la plantilla y se garantiza que cada ítem sea demostrable:

| Exigencia de la rúbrica | Dónde queda |
|---|---|
| Definición clara del problema | Cap. 1 — reescrito según el evaluador + **árbol de causas/efectos** (hoy no existe) |
| Requerimientos estructurados | Cap. 3 — FR/NFR de los tres specs + los seis `docs/rf/RF-*.md` (estilo IEEE-830) |
| Arquitectura del sistema | Cap. 4 — C4 L1/L2/**L3 (nuevo)**, contenedores, componentes |
| Modelo de datos | Cap. 5 — `data-model.md` por servicio + ER por base |
| Diseño UI/UX | Cap. 6 — tokens, 19 primitivas, accesibilidad, 5 breakpoints + **benchmark de productos de referencia** |
| Implementación funcional | Cap. 7 — los 8 servicios + motor de fórmulas |
| Pruebas documentadas | Cap. 8 — unitarias, integración, e2e, `seed_regression` |
| Despliegue real o simulado | Cap. 9 — VPS + TLS + Compose + K8s + CI. **Real, no simulado** |
| Evaluación del sistema | Cap. 10 — Lighthouse, k6, SUS, sesiones |
| Tipo de enfoque | Cap. 2 — híbrido Kanban + XP, 4 incrementos, cronograma |
| Fases del proyecto | Cap. 2 |
| Artefactos: historias, requerimientos, iteraciones | Cap. 2 + anexos (450 tareas, 25 historias) |
| Diagramas: arquitectura, casos de uso, clases, despliegue | Cap. 4/5 + **diagrama de despliegue (nuevo)** |
| Medir rendimiento | Cap. 10 — Lighthouse + k6 |
| Documentar APIs | Cap. 7.3 + anexo (OpenAPI + 6 protos) |
| Justificar decisiones tecnológicas | Cap. 4.5 — `D-13…D-32` promovidas a ADR |
| APA 7 | Global — **un solo `.bib` canónico** |
| Trazabilidad objetivos → desarrollo | Cap. 2.6 — matriz objetivos → FR → pruebas → evidencia |

### Metodología (respuesta a "qué modelo aplicar")

> **Marco híbrido declarado: Kanban (flujo y límites WIP) + XP (CI, pruebas automatizadas, refactorización continua) dentro de una estructura documental en cascada, ejecutado como 4 incrementos con criterios de aceptación verificables.**

Por qué no Scrum: un solo desarrollador, sin equipo, sin Product Owner, sin sprints — el historial real es flujo con límites WIP, que es Kanban. Por qué no cascada pura: el trabajo es transparentemente incremental (`001`→`002`→`003`, cada uno con compuerta constitucional y criterios numéricos `SC-013…SC-026`).

Esto entrega las tres cosas que la rúbrica pide: metodología **nombrada**, fases y — lo crítico — *metodología → resultados*, porque cada incremento ya tiene criterios de salida cuantificados y un registro de hallazgos (1.399 líneas en `002`).

### Objetivos: propuesta de consolidación (10 → 5)

El evaluador pide un objetivo de validación y, en el mismo párrafo, advierte: *"5 objetivos proyectan un volumen de trabajo grande, ahora seis pues aún más, por ende, también revisar la cantidad de los objetivos me parece prudente"*. Propuesta: **consolidar para no inflar**.

| # | Objetivo consolidado | CÓMO (nombrado) | PARA QUÉ |
|---|---|---|---|
| OE1 | Establecer requerimientos y arquitectura | Historias de usuario, `spec-kit`, UML y **C4** (draw.io), ADR | delimitar alcance y estándares |
| OE2 | Diseñar la experiencia y el sistema visual | **Figma/design tokens**, benchmark de productos de referencia | interacción del contenido educativo |
| OE3 | Implementar la plataforma | Go, NestJS, Rust, Angular, **gRPC**, PostgreSQL, RabbitMQ, Docker | proveer los servicios de la plataforma |
| OE4 | Verificar funcionamiento e integración | Pruebas unitarias, de integración y **E2E (Playwright)**, CI/CD, despliegue en contenedores | asegurar cumplimiento de requerimientos |
| OE5 | **Validar con usuarios y medir el impacto educativo** | Pruebas de usabilidad, **SUS**, encuesta, **Lighthouse**, k6 | demostrar que la plataforma enseña, no solo que existe |

Además, dos correcciones del evaluador se absorben como contenido, no como errata:
- **Gamificación**: hoy está en la justificación y en ningún objetivo. Se ancla en OE5 (progreso medible) o se elimina de la justificación.
- **Público objetivo**: se delimita una vez, y solo una, en todo el documento.

---

## 3. Entregable 2 — redesign del frontend

**Brief: institucional sobrio, una columna, reglas en lugar de cajas.**

- **Shell**: columna de contenido ~900 px, índice izquierdo *silencioso* (sin tarjeta con borde), **sin rail derecho** — progreso y notificaciones se van a la barra superior o al flujo. `fc-module-box` pierde borde y cabecera con acento.
- **Paleta**: tinta sobre blanco cálido, **un solo acento** azul institucional. Los colores de feedback solo para feedback. Se elimina la colisión de tres acentos (coral + marigold + púrpura → uno).
- **La tipografía carga la jerarquía**: escala display real, de modo que el título de una fila sea visiblemente mayor que el cuerpo. El mono se queda para cifras (mantiene N-15: una cifra nunca trunca).
- **Se retiran**: eyebrows, divisores punteados, cabeceras con barra de acento de 3 px, tarjetas hero con fondo tintado.
- **Invariantes que no se tocan**: mínimo 360 px, cuatro tokens de breakpoint, contraste AA (la suite a11y lo verifica sobre estilos computados, así que es exigible, no aspiracional), panel de marca nunca oculto en móvil, decimales nunca renderizados como float.

**Radio de impacto**: `styles/tokens/*`, `shared/ui/*` (19 primitivas) y plantillas de pantalla. **No** los selectores e2e, que van por rol y etiqueta.

**Deuda declarada, fuera de alcance**: `features/simulators/calculators.config.ts` es un espejo hardcodeado de las 5 calculadoras heredadas — segunda fuente de verdad. No se toca, pero se documenta como hallazgo.

---

## 4. Entregable 3 — calculadoras

### El muro técnico (verificado)

Funciones del DSL: `pot`, `potd`, `cuota`, `vf_serie`, `tasa_periodica`, `redondear`, `redondear_dinero`, `min`, `max`, `abs`.

- `pot` exige exponente **entero y no negativo** (`services/simulator/src/domain/formula/functions.rs:72`, `checked_powu`) → **`(1+i)^-n` no es expresable**.
- No hay `ln`, `raíz` ni `raíz_n` → no hay despeje de tiempo.
- No hay bucles ni sumatorias → no hay tablas de amortización.
- Presupuesto de 64 nodos / 16 niveles → los `si(...)` anidados de renta quedan justos.

### Matriz de factibilidad

| Calculadora propuesta | ¿Expresable hoy? | Fórmula |
|---|---|---|
| Fondo de emergencia | ✅ | `gastos_mensuales * meses` |
| Ahorro para una meta | ✅ | `meta*tasa/(pot(1+tasa,meses)-1)` con `si(tasa==0, meta/meses, …)` |
| CDT a días | ✅ | `capital*potd(1+ea, dias/365)` |
| Poder adquisitivo (IPC) | ✅ | `monto/pot(1+@IPC, años)` |
| Cuota + seguros y comisión | ✅ | `cuota(monto,i,n) + comisiones` |
| Interés simple vs compuesto | ✅ | dos salidas comparadas |
| Tope de tasa de usura | ✅ | requiere indicador nuevo `@TASA_USURA` |
| Capacidad de endeudamiento | ❌ | necesita exponente negativo |
| TIR / VPN con flujos variables | ❌ | necesita potencias fraccionarias y sumatorias |
| "¿En cuántos meses pago?" | ❌ | necesita logaritmo |

**Decisión:** 4–5 semillas nuevas, todas de la columna ✅, cada una con su tabla en el informe.
**Hallazgo para el Cap. 4:** la matriz es, en sí misma, evidencia de diseño del lenguaje — documenta qué se decidió *no* poder expresar y por qué.

### Base fundacional (lo que pediste)

Un capítulo de fundamentos que mapee cada calculadora a su régimen de matemática financiera (nominal vs efectiva, amortización francesa, simple vs compuesto) y a sus anclas regulatorias colombianas: `UVT`, `GMF 4×1000`, tasa de usura, IPC. Alimenta a la vez el `Marco referencial`, el `Cap. 6` y el `OE5`.

---

## 5. Fuentes de referencias — dónde están los URLs

**Respuesta directa: `docs/anteproyecto/referencias.md`.**

| Archivo | Contenido | URLs | Estado |
|---|---|---|---|
| `docs/anteproyecto/referencias.md` | **467 líneas · 51 entradas anotadas** bajo 6 encabezados temáticos con emoji | **41** | Lista de investigación, **no es APA**: sin autor primero, sin orden alfabético, sin sangría francesa |
| `docs/anteproyecto/marco-referencial.md` | Citas autor-año en prosa (`Lusardi y Mitchell (2019)`) | 6 | Varias URLs malformadas; **duplica** fuentes de `referencias.md` con metadatos distintos |
| PDF del anteproyecto, pp. 25–26 | Sección `Referencias` del documento entregado | — | Formato APA generado con gestor (Mendeley/Zotero), **conjunto distinto** al de `referencias.md` |

**Hallazgo:** existen **dos bibliografías divergentes** y ninguna es canónica. Eso es un problema de APA 7 directo.

**Plan de consolidación (Fase 1):**
1. Extraer las tres fuentes a un solo inventario (`refs-inventory.md`): entrada, año, autores, DOI/URL, de qué archivo salió.
2. Depurar duplicados y entradas no académicas (blogs, páginas de marketing).
3. **Verificar cada URL** (HTTP 200) y cada DOI (`doi.org`) — las que no resuelvan se citan sin URL o se descartan.
4. Emitir **un único `referencias.bib`** en formato APA 7 (`biblatex` + `style=apa`), fuente de verdad para el LaTeX.
5. Redactar el Cap. de `Marco referencial` **desde las citas del `.bib`**, nunca al revés.

---

## 6. Fases, compuertas y paralelización

| Fase | Salida | Compuerta |
|---|---|---|
| **1. Esqueleto LaTeX** | Plantilla UPB (2×portada, TOC, resumen bilingüe, APA vía `biblatex`), pipeline de diagramas, `main.tex` compilando con los 7 capítulos en stub | El PDF compila y la plantilla coincide con la institucional |
| **2. Dirección de arte** | Tokens nuevos + 19 primitivas + shell; `/interno/galeria` como superficie de revisión | E2E verde, a11y verde, `design-debt.mjs` = 0, suite visual en 5 breakpoints |
| **3. Calculadoras** | Documento de fundamentos + matriz + 4–5 semillas + 1–2 artículos que las usen | `seed_regression` verde, `dev/seed` idempotente |
| **4. Evidencia** | Lighthouse ×5 breakpoints, k6, cobertura, conteos de pruebas, capturas nuevas, anexo de API | Toda cifra del Cap. 8–10 rastreable a un artefacto versionado |
| **5. Validación** | Instrumento + 5–8 sesiones + SUS | **El autor** ejecuta las sesiones |

Paralelización: **1 y 3 no dependen de nada** y pueden correr mientras se decide 2. La 4 exige 2 y 3 cerradas. La 5 exige 4 (no se puede validar un build obsoleto). Los capítulos se escriben al final, contra evidencia, uno por uno.

---

## 7. Comandos que debes ejecutar tú

Mi shell está bloqueado para `sudo`, y las descargas largas de imágenes conviene que las controles tú. **Docker funciona sin `sudo` en esta máquina** (verificado), lo que resuelve casi todo.

### 7.1 LaTeX — elige una vía

**Vía A — Docker `texlive` (recomendada: reproducible, nada se instala en el sistema)**

```bash
docker pull texlive/texlive:latest          # ~5 GB, una sola vez
docker images | grep texlive                # verificar

# compilar (desde la raíz del repo, cuando exista docs/informe/main.tex)
docker run --rm -v "$PWD/docs/informe:/src" -w /src \
  texlive/texlive:latest \
  latexmk -pdf -interaction=nonstopmode -halt-on-error main.tex
```

**Vía B — Tectonic (rápido, binario único, sin root, descarga paquetes bajo demanda)**

```bash
cd ~/.local/bin
curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh
./tectonic --version        # verificar que imprime versión
./tectonic ~/Projects/tmp/FintCart-Platform/docs/informe/main.tex
```

> No pude verificar el instalador de Tectonic desde aquí (sin red en mi shell). Si el `--version` no imprime, la alternativa es bajar el release manual de `github.com/tectonic-typesetting/tectonic/releases` para `x86_64-unknown-linux-musl`.

Mi recomendación: **Vía A** para el build oficial (lo que se entrega) y Vía B si la iteración con `latexmk` te resulta lenta. Ambas pueden convivir.

### 7.2 Métricas de rendimiento

```bash
# k6 no está instalado; se usa la imagen oficial
docker run --rm -i grafana/k6 version

# Lighthouse SÍ puede usar el Chromium que ya tiene Playwright (1.62.0)
export CHROME_PATH="$HOME/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome"
npx -y lighthouse http://localhost:4200 \
  --chrome-path="$CHROME_PATH" --preset=desktop \
  --output=json --output=html --output-path=./lighthouse-desktop
```

Repetir por breakpoint (360 / 480 / 768 / 1024 / 1280) y contra la URL de producción.

### 7.3 Levantar el stack para e2e y capturas

Los comandos son del propio repo (`README.md`, `dev/`); son largos y conviene que los lances tú:

```bash
dev/build
dev/up
dev/migrate
dev/seed
# luego, en otra terminal:
npm --prefix frontend start
# y la suite:
npm --prefix frontend run e2e
```

### 7.4 Diagramas

No hay CLI de draw.io instalada (sí hay `dot`, `convert`).

- **Diagramas existentes** (`docs/diagrams/**/*.drawio`): exportarlos a PDF/SVG **a mano** desde `app.diagrams.net` (Archivo → Exportar como → PDF). Es un paso único, sin instalar nada.
- **Diagramas nuevos** (despliegue, C4 L3): los genero como **Mermaid** versionable y se renderizan con
  `npx -y @mermaid-js/mermaid-cli -i diagrama.mmd -o diagrama.pdf`, o directamente en TikZ dentro del LaTeX.

### 7.5 Nada más

Para el rediseño del frontend y para las semillas de calculadoras **no necesitas instalar nada**: se trabaja con `npm` y `cargo`/`dev/seed`.

---

## 8. Modelo y esfuerzo por tarea

Modelos disponibles en esta instalación (verificado en `~/.pi/agent/models-store.json`):

| Modelo | ID | Contexto | Entrada de imagen | Thinking | Costo /M (in → out) |
|---|---|---|---|---|---|
| DeepSeek V4.1 Flash | `deepseek-flash` | 1M | **sí** | `low`, `high`, `max` | $0.30 → $1.20 |
| DeepSeek V4 Pro | `deepseek-v4-pro` | 1M | **no** | solo `high`, `max` | $1.32 → $3.96 |

Pro cuesta **4.4×** la entrada y **3.3×** la salida. La regla: **Pro donde un error cuesta más que el token; Flash donde el trabajo es mecánico o necesita ojos.**

| Tarea | Modelo | Thinking | Razón |
|---|---|---|---|
| Orquestación, plan, decisiones de arquitectura | `v4-pro` | `high` | juicio, contexto largo, sin imágenes |
| Dirección de arte (brief, tokens, crítica de diseño) | `v4-pro` | `high` | es criterio, no ejecución |
| Redacción de capítulos (prosa + APA) | `v4-pro` | `high` | la calidad es el producto |
| Plantilla LaTeX y fidelidad institucional | `v4-pro` | `max` | un bug de plantilla se paga en horas |
| Ciclo de arreglo de errores de compilación | `flash` | `high` | iterativo y barato |
| Exploración de repo, lectura, grep | `flash` | `low` | puramente mecánico |
| Implementación del design system (19 primitivas + tokens) | `flash` | `high` | muchas ediciones pequeñas, bien especificadas |
| **Revisión visual de capturas** | `flash` | `high` | **Pro no acepta imágenes** — obligatorio |
| Matriz de factibilidad de calculadoras | `v4-pro` | `high` | corrección matemática |
| Implementación de semillas en Rust | `flash` | `high` | acotado por `seed_regression` |
| Recolección de evidencia (correr suites, parsear JSON) | `flash` | `low` | mecánico |
| Investigación web (benchmark de productos) | `flash` | `high` | recolección + síntesis |
| Auditoría final de APA y consistencia entre capítulos | `v4-pro` | `high` | cruza 10 capítulos a la vez |

**Cómo se aplica:** yo corro en `deepseek-flash` + `high`. Los subagentes aceptan override por tarea (`model`), así que el gasto se concentra en las cinco filas de `v4-pro` y todo lo demás queda en Flash. Si quieres cambiar el modelo de esta sesión: comando `/model`.

---

## 9. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El rediseño rompe la compuerta a11y de 003 | Alto | La suite verifica contraste sobre estilos computados; se corre en cada iteración, no al final |
| La suite visual no tiene baseline de imagen | Medio | Solo hay capturas, no diff. Se generan nuevas y se revisan a ojo por breakpoint |
| `tmp.md` contiene credenciales en claro | Alto | **Depurar/eliminar antes de entregar.** Pendiente de autorización |
| Dos bibliografías divergentes | Alto (APA) | Consolidación en Fase 1 antes de escribir un solo párrafo |
| Colisión de numeración `D-26…D-32` entre specs 002 y 003 | Medio | Se resuelve al promover las decisiones a ADR |
| No hay diagrama de despliegue y los `.drawio` no se exportan | Medio | Fase 1 + exportación manual |
| La validación con usuarios depende del calendario del autor | **Alto** | Es la única fase que no puedo comprimir |

---

## 10. Supuestos vigentes (veta cualquiera)

1. LaTeX vía **Docker texlive** (Docker funciona sin `sudo`), con Tectonic como alternativa rápida.
2. `tmp.md` se **depura o elimina** antes de la entrega.
3. Los artefactos del informe viven en `docs/informe/`; `docs/anteproyecto/` se conserva como material fuente y no se reescribe en sitio.
4. Los objetivos se consolidan de 10 a 5 — **confirmado por el autor**.
5. La numeración `D-26…D-32` se resuelve en la promoción a ADR.
6. Las compuertas de 003 (e2e, a11y, `design-debt.mjs`) **no se relajan** en la Fase 2. Si una prueba falla, el rediseño está mal.
7. `/simuladores` heredado y `calculators.config.ts` quedan fuera de alcance; las calculadoras nuevas aparecen solo en `/calculadoras`.

---

## 11. Plazo y ruta

**Plazo declarado por el autor: 1–2 semanas.** Eso fija la ruta rápida, con tres recortes:

1. **3 semillas nuevas** (fondo de emergencia, ahorro para meta, CDT a días), no 5.
2. **5 sesiones de usabilidad** como mínimo + encuesta ≥15 respuestas. Por debajo de eso el SUS no es interpretable.
3. **Un diagrama nuevo** (despliegue) + exportar los existentes. Sin redibujar C4-L3.

### Riesgo principal del plazo

El autor eligió **fuente en inglés y traducción posterior**. A ~90 páginas eso son 3–4 días de trabajo suyo al final del plazo. Mitigación: redactar en *inglés traducible* (frases cortas, cero modismos, sin metáforas) y fijar un **glosario bilingüe único** desde el día 1, para que la traducción sea consistente en terminología.

### Lo que falta del autor

1. **Reclutar 5–8 participantes** y aprobar el guion de sesión antes de la fase 5.
2. **Levantar el stack** (`dev/build`, `dev/up`, `dev/migrate`, `dev/seed`) el día 5: sin stack no hay e2e, ni capturas, ni Lighthouse, y todo lo demás se cae.
3. **Juicio sobre el diseño**: una sola pasada de revisión en `/interno/galeria` el día 4, con decisión final. "Institucional sin ser aburrido" lo cierran el autor y su directora; yo puedo exigir contraste, jerarquía y breakpoints, no gusto.
