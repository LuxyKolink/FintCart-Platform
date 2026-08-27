# Quickstart — Feature 003

**Feature**: `003-design-system-frontend` | **Date**: 2026-08-26

Guía para verificar el rediseño. Presupone el sistema levantado según
[`../001-fintcart-platform/quickstart.md`](../001-fintcart-platform/quickstart.md) y la
biblioteca de componentes del feature 002 disponible.

> **Principio XII**: los comandos de esta guía coinciden con los scripts de `dev/`. Este
> feature **no añade ningún requisito nuevo de entorno**: no hay variables, ni servicios, ni
> migraciones. Si algún paso pidiera una acción manual, es un defecto de `dev/`.

## 0. Prerrequisito de la biblioteca compartida

```bash
# La galería de componentes del feature 002 debe existir y renderizar
ls frontend/src/app/shared/ui/
```

Si esa carpeta no está, **este feature no arranca**. Improvisar componentes locales sería
reconstruir exactamente la capa artesanal que venimos a retirar (research D-26).

## 1. Levantar el frontend

```bash
dev/up
# http://localhost:4200
```

## 2. La verificación que gobierna todo: qué desaparece

El avance de este feature se mide por lo que se retira, no por lo que se escribe
(research D-26, nota N-12).

```bash
# Estilos en línea restantes — al empezar son 94, al terminar DEBE ser 0
grep -rc 'style="' frontend/src/app/features --include=*.html | grep -v ':0' | \
  awk -F: '{s+=$2} END {print "estilos en línea: " s}'

# Capa de primitivas artesanal — al empezar 116 líneas, al terminar el archivo NO EXISTE
wc -l frontend/src/styles.scss 2>/dev/null || echo "styles.scss eliminado ✅"

# Ninguna plantilla referencia ya las clases artesanales
grep -rho 'fc-btn\|fc-input\|fc-field\|fc-label\|fc-banner\|fc-help\|fc-select\|fc-error-text' \
  frontend/src/app --include=*.html | sort -u
# Esperado al terminar: sin resultados
# `fc-module`, `fc-num`, `fc-eyebrow` y `fc-linklist` SÍ sobreviven: son primitivas de
# portal de tokens/base.css, no de la capa artesanal.
```

Y que no vuelva a entrar:

```bash
# Introducir un estilo en línea deliberadamente y comprobar que la barrera lo rechaza
cd frontend && npm run lint
```

## 3. Regresión funcional — las pruebas NO se modifican

Es la garantía dura de SC-036. Se ejecutan **tras cada grupo migrado**, no al final: así un
fallo apunta a un grupo concreto.

```bash
cd frontend && npx playwright test
```

**Regla innegociable** (nota N-13): si una suite falla, **el fallo es del rediseño, no de la
prueba**. Seleccionan por rol y etiqueta accesible en 100 de 109 casos, así que un fallo
significa que se rompió un rol, una etiqueta o un texto visible — es decir, que se rompió la
accesibilidad. Ajustar la aserción "para que pase" destruye la única garantía del feature.

## 4. Verificar por grupo de pantallas

El orden es el de research D-28. Cada grupo se despliega completo, nunca pantalla suelta.

### Grupo 1 — Acceso (US1, 3 pantallas)

`/iniciar-sesion`, `/crear-cuenta`, `/auth/verify-email`. Contrastar contra
`design/ui_kits/auth/`.

- El panel de marca muestra logotipo, titular y los tres indicadores de contenido.
- Están presentes: mantener sesión, recuperar contraseña, acceso federado y enlace a registro.
- El registro muestra el consentimiento de datos personales antes de enviar.
- **A 375 px de ancho**: el panel de marca se convierte en banda superior compacta con
  logotipo y titular. **No desaparece** (nota N-14) — si desapareció, se revirtió el feature
  justo en el dispositivo donde más gente entra.

### Grupo 2 — Aprendizaje (US2, 5 pantallas + armazón)

`/catalogo`, `/articulos/:articleId`, `/cuestionarios/:quizId`, `/progreso`,
`/notificaciones`. Contrastar contra `design/ui_kits/learner/` y su variante `portal.html`.

- El catálogo presenta las tres zonas del portal.
- **A 1024 px**: colapsa primero el riel derecho. **A 768 px**: el izquierdo pasa a
  desplegable. La columna central **nunca** se sacrifica.
- El armazón (barra superior) ya está migrado: si sigue con la estética anterior, se ve en el
  100 % de las vistas (research D-30).

### Grupo 3 — Simuladores (US3, 4 pantallas)

`/simuladores`. Contrastar contra `design/ui_kits/simulators/`.

**La verificación que más importa aquí es la de precisión** (FR-109, Principio VIII):

```bash
# Ejecutar una simulación y comparar el valor mostrado con el que devuelve la API
curl -s localhost:8080/simulators/ahorro/run -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{"aporte_mensual":"350000","tasa_anual":"0.12","meses":"60"}}' | jq .result
```

La cifra en pantalla debe coincidir **hasta el último decimal**. Y comprobar que una cifra
larga no se recorta (nota N-15): un importe truncado no es un texto incompleto, es un dato
falso.

### Grupo 4 — Perfil y datos personales (US4, 4 pantallas)

`/perfil`, cambio de contraseña, reporte, eliminación de cuenta.

- La consecuencia de eliminar la cuenta y su período de reversión se comunican de forma
  destacada, no en un párrafo corrido.
- Las cifras del reporte conservan su precisión.

### Grupo 5 — Editorial (US5, 3 pantallas) — **el último**

`/editorial`, `/editorial/revision`, historial de versiones. Contrastar contra
`design/ui_kits/editorial/`.

Se migra al final a propósito: es la única zona que colisiona con el feature 002, que reescribe
la superficie de redacción del editor.

```bash
# Verificar que este feature NO tocó la superficie de redacción (FR-123)
git diff main --stat -- frontend/src/app/features/editorial/editor/
```

Los cambios deben limitarse al marco —cabecera, paneles laterales, estados de publicación—.

## 5. Accesibilidad (US6)

```bash
cd frontend && npx playwright test --grep @a11y
```

Y la comprobación manual que ninguna herramienta sustituye:

- Recorrer cada pantalla **solo con Tab**: se alcanzan todos los controles y el foco es siempre
  visible.
- Poner el tamaño de fuente del navegador al 200 %: no se pierde contenido ni funcionalidad.

## 6. Sin dependencias externas en tiempo de ejecución

```bash
# Bloquear dominios externos en el navegador y recargar
# Esperado: tipografía e iconos presentes, interfaz completa y legible (FR-092)
```

Si la tipografía cae al sustituto del sistema o los iconos desaparecen, es que algo volvió a
apoyarse en un servicio externo — regresión de lo que resolvió el feature 002.

## 7. Criterio de terminación

| | Al empezar | Al terminar |
|---|---|---|
| Estilos en línea en plantillas | 94 | **0** |
| `frontend/src/styles.scss` | 116 líneas | **no existe** |
| Rutas con logotipos | 2 | **1** |
| `@media` / puntos de corte | 0 | 4 tokens |
| Suites de extremo a extremo modificadas | — | **0** |
| Pantallas migradas | 0 | **19 + armazón** |

## Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| Una pantalla pierde su estilo a mitad de migración | Se eliminó una clase de `styles.scss` que otra plantilla aún referencia. Retirar clases solo cuando **ninguna** las use (research D-26) |
| Una suite de extremo a extremo falla tras migrar un grupo | Se rompió un rol, una etiqueta o un texto visible. Corregir la pantalla, **nunca** la aserción (nota N-13) |
| La página desplaza en horizontal en móvil | Una tabla desborda su contenedor. Las tablas desplazan **dentro** de su propio contenedor; la página nunca (research D-27) |
| Conflictos repetidos en el editor de artículos | Se está tocando la superficie de redacción, que pertenece al feature 002 (FR-123) |
| El presupuesto de tamaño de `angular.json` se excede | La biblioteca compartida se está importando entera en lugar de por componente |
