# Quickstart — Feature 002

**Feature**: `002-calculator-builder-content-admin` | **Date**: 2026-08-26

Guía para verificar los cambios de este feature sobre un entorno ya funcionando. Presupone
haber seguido [`../001-fintcart-platform/quickstart.md`](../001-fintcart-platform/quickstart.md)
para el arranque general.

> **Principio XII**: los comandos de esta guía DEBEN coincidir con los scripts de `dev/`. Si
> algún paso exige una acción manual que los scripts no cubren, es un **defecto de los
> scripts** y se corrige en `dev/`, no documentándolo aquí.

## 0. Requisito nuevo de entorno

| Variable | Servicio | Para qué |
|----------|----------|----------|
| `BOOTSTRAP_ADMIN_EMAIL` | Usuarios | Promueve a `administrador`, de forma idempotente al arrancar, la cuenta con ese correo (research D-21). Sin ella no hay ningún administrador y las pantallas de `/admin/**` son inalcanzables. |
| `PURGE_SWEEP_INTERVAL` | Orquestador | Cada cuánto se buscan cuentas cuyo período de gracia venció (research D-20). En local conviene un valor corto para no esperar; en producción, del orden de horas. |
| `INDICATOR_SWEEP_INTERVAL` | Orquestador | Cada cuánto se revisa el calendario de indicadores y se emite el aviso de vencimiento (research D-23). |

Se declara en `dev/docker-compose.yaml` y en `deploy/vps/compose.app.yaml`. **No se siembra
en una migración** a propósito: un usuario privilegiado escrito en una migración versionada
queda en el repositorio para siempre.

## 1. Aplicar los cambios

```bash
dev/build      # reconstruye: Simulador (motor de fórmulas), Aprendizaje, Usuarios, Gateway, frontend
dev/up
dev/migrate    # aplica las migraciones de 002 en learning_db, simulator_db y users_db
dev/seed       # siembra las 7 definiciones de calculadora por defecto y los indicadores del año
```

`dev/migrate` es donde ocurren las tres migraciones con conversión de datos. Revisa su
salida: emite el recuento de cuestionarios cuyo banco de preguntas cambió después de su
primer intento, para los que la reescala de calificaciones es **aproximada** y no exacta
(research D-18).

## 2. Verificar el catálogo de categorías (US1)

```bash
# El catálogo público ya no devuelve texto libre
curl -s localhost:8080/catalog/categories | jq '.[] | {slug, name, position}'

# Desactivar una categoría con artículos publicados DEBE fallar con 409 y decir cuántos
curl -si -X DELETE localhost:8080/admin/categories/$CAT_ID -H "Authorization: Bearer $ADMIN_TOKEN" \
  | grep -E 'HTTP/|published_count'
```

**Criterio**: ningún artículo conserva categoría en texto libre (SC-025).

```bash
docker compose -f dev/docker-compose.yaml exec learning-db \
  psql -U fintcart -d learning_db -c \
  "SELECT count(*) FROM articles WHERE category_id IS NULL;"   # DEBE ser 0
```

## 3. Verificar la randomización de cuestionarios (US2)

```bash
# Dos sesiones seguidas del MISMO cuestionario deben servir conjuntos distintos
for i in 1 2; do
  curl -s -X POST localhost:8080/quizzes/$QUIZ_ID/session -H "Authorization: Bearer $TOKEN" \
    | jq -c '[.questions[].question_id] | sort'
done
```

**Criterio SC-013**: las dos líneas difieren cuando el banco tiene al menos el triple de
preguntas que `questions_to_serve`.

```bash
# Responder a una pregunta NO servida debe rechazarse, no calificarse (FR-040)
curl -si -X POST localhost:8080/quizzes/$QUIZ_ID/attempts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"session_id":"'$SESSION'","answers":{"'$PREGUNTA_NO_SERVIDA'":"a"}}' | head -1
# Esperado: HTTP/1.1 409
```

## 4. Verificar el constructor de calculadoras (US3)

**El criterio que más importa es SC-015**: las siete definiciones semilla deben producir
resultados **idénticos** a los del código nativo anterior.

```bash
cargo test -p fintcart-simulator --test seed_regression
```

Esa suite compara, para cada calculadora por defecto y sobre su rango de uso, el resultado
del motor de fórmulas contra los valores esperados registrados antes de la enmienda,
incluidos los casos de borde numérico. **Si falla, no se sigue adelante**: es la prueba de
la que depende que FR-049 no haya que renegociar (research D-16).

Comprobación manual de la distinción exacto/aproximado, que es donde vive el riesgo:

```bash
# ea_a_mv usa potd (exponente decimal, aproximada); credito usa pot (entero, exacta)
curl -s -X POST localhost:8080/calculators/$EA_A_MV/run -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"inputs":{"tasa_ea":"0.24"}}' | jq .result
```

Definición inválida:

```bash
curl -s -X POST localhost:8080/calculators/validate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"definition":{"inputs":[{"key":"a","type":"INPUT_TYPE_MONTO"}],
       "outputs":[{"key":"r","expression":"a + noexiste","scale":2}]}}' | jq .errors
# Esperado: [{ location: "outputs[0].expression", code: "campo_inexistente", ... }]
```

## 5. Verificar indicadores y procedimiento anual (US4)

```bash
# Vigencia solapada debe rechazarse en la BASE, no solo en la aplicación (FR-059)
curl -si -X POST localhost:8080/admin/indicators -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"UVT","value":"49799","valid_from":"2027-01-01","valid_to":"2028-01-01"}' | head -1
# Repetir la misma llamada → HTTP/1.1 409

curl -s localhost:8080/admin/indicators/status -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Criterio SC-019**: una simulación guardada conserva los indicadores con que se calculó.

```bash
curl -s localhost:8080/simulators/history -H "Authorization: Bearer $TOKEN" \
  | jq '.items[0] | {calculator_id, calculator_version, indicators_used}'
```

## 6. Verificar el editor enriquecido (US6)

En `http://localhost:4200/editorial/editor`: aplicar formato, insertar una imagen (exige
texto alternativo) y guardar.

**Criterio SC-022** — la comprobación que de verdad importa:

```bash
# Un documento con un nodo no admitido debe rechazarse al GUARDAR
curl -si -X PATCH localhost:8080/editorial/versions/$VERSION_ID -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body_doc":{"tipo":"doc","contenido":[{"tipo":"script","contenido":[]}]}}' | head -1
# Esperado: HTTP/1.1 422

# Y un enlace con esquema javascript: también
curl -si -X PATCH localhost:8080/editorial/versions/$VERSION_ID -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body_doc":{"tipo":"doc","contenido":[{"tipo":"parrafo","contenido":[
       {"tipo":"texto","texto":"x","marcas":[{"tipo":"enlace","href":"javascript:alert(1)"}]}]}]}}' | head -1
# Esperado: HTTP/1.1 422
```

Además, verificar por inspección que **ningún componente Angular usa `[innerHTML]` ni
`bypassSecurityTrust*`** para renderizar el cuerpo:

```bash
grep -rn "innerHTML\|bypassSecurityTrust" frontend/src/app/features/learning/ | grep -v node_modules
# Esperado: sin resultados
```

Con el modelo de bloques de research D-14 no hay ninguna razón legítima para que aparezca
uno; si aparece, es la reintroducción exacta de la superficie que este diseño elimina.

## 7. Verificar la depuración de cuentas (US7)

```bash
# Marcar → la cuenta queda suspendida y con vencimiento a 30 días
curl -s -X POST localhost:8080/admin/accounts/$USER_ID/purge -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"reason":"solicitud del titular"}' | jq .purge_due_at

# El correo sigue RESERVADO durante la gracia (FR-076)
curl -si -X POST localhost:8080/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"'$EMAIL_MARCADO'","password":"Xx1!xxxxxxxx"}' | head -1
# Esperado: HTTP/1.1 409

# El titular reactiva dentro del plazo y recupera todo intacto
curl -s -X POST localhost:8080/me/account/reactivate -H "Authorization: Bearer $TOKEN" | jq
curl -s localhost:8080/me/progress -H "Authorization: Bearer $TOKEN" | jq .points
```

Para verificar el vencimiento sin esperar 30 días, adelantar la fecha en la base y dejar que
corra el barrido del Orquestador:

```bash
docker compose -f dev/docker-compose.yaml exec users-db \
  psql -U fintcart -d users_db -c \
  "UPDATE profiles SET purge_due_at = now() - interval '1 day' WHERE id = '$USER_ID';"
```

**Criterio SC-024**: tras la anonimización, la auditoría conserva el 100 % de las
operaciones del titular bajo identificador opaco y los agregados no varían.

```bash
docker compose -f dev/docker-compose.yaml exec audit-db \
  psql -U fintcart -d audit_db -c \
  "SELECT count(*) FROM audit_log WHERE actor_ref = '$USER_ID';"   # sin variación

docker compose -f dev/docker-compose.yaml exec learning-db \
  psql -U fintcart -d learning_db -c \
  "SELECT article_id, view_count, attempt_count FROM article_stats ORDER BY article_id LIMIT 5;"
```

Y comprobar que **no quedó ningún rastro del correo** (FR-077):

```bash
docker compose -f dev/docker-compose.yaml exec users-db \
  psql -U fintcart -d users_db -c \
  "SELECT email FROM profiles WHERE id = '$USER_ID';"
# Esperado: <uuid>@anonimizado.fintcart.invalid — y ninguna otra columna con el original
```

## 8. Verificar la calculadora incrustada (US8)

Insertar un bloque de calculadora en un artículo, publicarlo, ejecutarlo como lector y
confirmar que **la ejecución aparece en el historial** (FR-071) — es la diferencia entre una
integración real y un iframe decorativo:

```bash
curl -s localhost:8080/simulators/history -H "Authorization: Bearer $TOKEN" | jq '.items[0]'
```

Después, despublicar la calculadora y recargar el artículo: debe seguir siendo legible con
un aviso en lugar del bloque (FR-072), no romperse.

## Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| `/admin/**` devuelve 403 con un usuario que debería ser admin | `BOOTSTRAP_ADMIN_EMAIL` no coincide con el correo de la cuenta, o el token se emitió antes de la promoción: volver a iniciar sesión para que el JWT lleve el rol nuevo |
| `dev/migrate` falla en `financial_indicators` | Falta `CREATE EXTENSION btree_gist`, necesaria para la restricción de exclusión de vigencias (research D-22) |
| Las calculadoras semilla dan resultados distintos a los históricos | Una definición usa `potd` donde el código nativo usaba `pot`. Es exactamente el fallo que research D-16 anticipa: exponente entero exige la función exacta |
| Un artículo migrado aparece vacío en el editor | La migración de `body` → `body_doc` no cubrió un separador de párrafo; revisar el aviso de `dev/migrate` |
