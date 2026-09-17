#!/usr/bin/env bash
# deploy/loadtest/calculadora.sh — prepara, corre y limpia la prueba de carga de T162.
#
# La prueba en sí es `k6-calculadora.js` (leer su cabecera primero: ahí está lo que mide y lo que
# no). Este guion es la preparación que el guion de k6 necesita y que no le corresponde hacer:
#
#   preparar   crea las dos calculadoras —el peor caso admisible y un caso trivial, para poder
#              comparar—, las publica por el camino REAL (proponer + aprobar por otro usuario) y
#              crea el fondo de cuentas. Deja un archivo de entorno con lo que hace falta.
#   correr     lanza k6 en un contenedor contra el borde.
#   limpiar    borra las calculadoras, sus simulaciones y las sagas que dejó la prueba.
#
# ## Por qué publicar y no quedarse en privada
#
# `POST /calculators/{id}/run` solo deja ejecutar una calculadora publicada o propia, y la prueba
# usa varias cuentas (una por VU): una calculadora privada solo la podría ejecutar su autor y las
# demás recibirían 404, midiendo un camino que no existe. Publicarla obliga además a pasar por la
# curaduría —proponer con el autor, aprobar con otro—, que es lo que hace una calculadora en la
# vida real.
#
# ## Por qué las cuentas se crean aquí y no dentro de k6
#
# `dev/token` recorre el flujo de OAuth2 completo (registro, verificación por correo, rol y PKCE).
# Dentro de k6 eso obligaría a hablar con MailHog en `setup()`, y lo que se mide es el evaluador:
# la preparación no debe aportar dependencias a la medición. Tampoco hay atajo: el token es real.
#
# Una cuenta por VU es un requisito, no una comodidad: el borde limita por usuario (600 rpm) además
# de por IP, así que un fondo compartido entre VUs se agota y la corrida mide el limitador. Se
# comprueba aquí para que la prueba no arranque con una configuración que no puede dar un número
# válido.
#
# ## Qué NO limpia
#
# Las cuentas del fondo (`loadtest-…@fintcart.test`) quedan dadas de alta, con el mismo criterio que
# las de `k6-scenarios.js`: volver a correr la prueba las reutiliza, y borrarlas exigiría pasar por
# la anonimización, que es una operación de producto y no de una prueba.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../../dev/common.sh"

GATEWAY="${FINTCART_GATEWAY_URL:-http://localhost:8080}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUENTAS="${LOADTEST_ACCOUNTS:-${LOADTEST_VUS:-30}}"
ENTORNO="${LOADTEST_ENV_FILE:-/tmp/fintcart-loadtest.env}"
RED="fintcart_fintcart"

aviso() { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
error() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

# Pide algo al borde y aborta con el cuerpo de la respuesta si no es lo esperado. Sin esto, un 403
# por un rol mal puesto se leería como «la prueba no midió nada» en vez de «faltaba un rol».
pedir() {
  local esperado="$1"; shift
  local salida
  salida="$(curl -sS -w '\n%{http_code}' "$@")" || error "curl falló: $*"
  local codigo="${salida##*$'\n'}"
  local cuerpo="${salida%$'\n'*}"
  if [[ "$codigo" != "$esperado" ]]; then
    error "esperaba HTTP $esperado y llegó $codigo de $* — cuerpo: $cuerpo"
  fi
  printf '%s' "$cuerpo"
}

# El JSON de la definición del peor caso admisible.
#
# Diez salidas —el máximo de FR-046—, cada una con `pot` al exponente máximo (1200), que son las dos
# palancas que tiene un autor. La base es ligeramente mayor que uno para que el resultado siga siendo
# representable: `pot(2, 1200)` desborda los 28 decimales de `Decimal` y el motor responde con un
# error de dominio sin haber hecho el trabajo, así que mediría el camino del error.
#
# Cada salida usa una base DISTINTA a propósito: con la misma expresión, un futuro plegado de
# constantes la evaluaría una sola vez y la medición mentiría por abajo.
peor_caso() {
  python3 - <<'PY'
import json
salidas = [
    {"key": f"r{i}", "label": f"R{i}", "expression": f"pot(1.00000{i}, 1200)", "scale": 2}
    for i in range(1, 10)
]
salidas.append({"key": "r10", "label": "R10", "expression": "pot(1.000001, 1199)", "scale": 2})
print(json.dumps({
    "name": "ZZLOAD Peor caso admisible",
    "description": "Definición en el tope declarado de FR-046 (10 salidas × pot(·, 1200)). T162.",
    "definition": {
        "inputs": [{"key": "base", "label": "Base", "type": "tasa", "required": True}],
        "validations": [],
        "outputs": salidas,
    },
}))
PY
}

# El CONTROL: el mismo número de salidas —diez, como el peor caso— y la misma ruta, con una sola
# operación por salida.
#
# Las diez salidas no son un adorno: si el control tuviera UNA, la comparación mezclaría dos cosas
# —el coste del AST y el de devolver y guardar diez resultados en vez de uno— y la diferencia se
# atribuiría al evaluador. Medido: con una sola salida el p95 del control era 55 ms frente a los
# 100 ms del peor caso; con diez, la diferencia desaparece, que es lo que demuestra que lo que
# costaba eran los diez resultados y no la fórmula.
caso_trivial() {
  python3 - <<'PY'
import json
print(json.dumps({
    "name": "ZZLOAD Control trivial",
    "description": "Diez salidas de una operación, como control del coste del AST. T162.",
    "definition": {
        "inputs": [{"key": "base", "label": "Base", "type": "tasa", "required": True}],
        "validations": [],
        "outputs": [
            {"key": f"r{i}", "label": f"R{i}", "expression": f"base * {i}", "scale": 2}
            for i in range(1, 11)
        ],
    },
}))
PY
}

# Devuelve el id de la calculadora publicada con ese nombre, o vacío. Reutiliza la que ya exista
# para que repetir la prueba no acumule calculadoras `ZZLOAD` en el catálogo.
buscarla() {
  local token="$1" nombre="$2"
  curl -sS "$GATEWAY/me/calculators" -H "Authorization: Bearer $token" \
    | python3 -c "
import json, sys
nombre = sys.argv[1]
for c in json.load(sys.stdin).get('items', []):
    if c.get('name') == nombre and c.get('state') == 'publicada':
        print(c['calculator_id']); break
" "$nombre"
}

# Crea, propone y aprueba una calculadora. Imprime su id.
publicar() {
  local autor="$1" coordinador="$2" cuerpo="$3" nombre id
  nombre="$(printf '%s' "$cuerpo" | python3 -c 'import json,sys;print(json.load(sys.stdin)["name"])')"

  id="$(buscarla "$autor" "$nombre")"
  if [[ -n "$id" ]]; then
    aviso "«$nombre» ya estaba publicada ($id): se reutiliza" >&2
    printf '%s' "$id"
    return
  fi

  id="$(pedir 201 -X POST "$GATEWAY/calculators" -H "Authorization: Bearer $autor" \
    -H 'Content-Type: application/json' -d "$cuerpo" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["calculator_id"])')"
  aviso "«$nombre» creada ($id): se propone para el catálogo" >&2

  pedir 200 -X POST "$GATEWAY/calculators/$id/submit" -H "Authorization: Bearer $autor" >/dev/null
  # La aprobación va por el Orquestador (emite `calculator.published`, T115) y es de OTRO usuario:
  # FR-053 lo exige, y el Simulador responde 403 si el autor intenta aprobarse a sí mismo.
  pedir 200 -X POST "$GATEWAY/editorial/calculators/$id/approve" -H "Authorization: Bearer $coordinador" >/dev/null
  aviso "«$nombre» aprobada por el coordinador" >&2
  printf '%s' "$id"
}

preparar() {
  require_docker
  local autor coordinador
  aviso "obteniendo tokens reales con dev/token (registro + correo + PKCE)…" >&2
  autor="$(dev/token loadtest.autor@fintcart.test editor 2>/dev/null)"
  coordinador="$(dev/token loadtest.curador@fintcart.test coordinador_editorial 2>/dev/null)"

  local objetivo="${LOADTEST_VUS:-30}"
  if (( CUENTAS < objetivo )); then
    error "hacen falta al menos tantas cuentas como VUs ($objetivo) y hay $CUENTAS: el límite de \
tasa es por usuario (600 rpm) y un fondo compartido devolvería 429 en masa — la corrida mediría el \
limitador. Sube LOADTEST_ACCOUNTS o baja LOADTEST_VUS."
  fi

  local tokens=() i
  for ((i = 1; i <= CUENTAS; i++)); do
    tokens+=("$(dev/token "loadtest.vu${i}@fintcart.test" usuario_final 2>/dev/null)")
  done
  aviso "fondo de cuentas listo: $CUENTAS (una por VU)" >&2

  local peor barato
  peor="$(publicar "$autor" "$coordinador" "$(peor_caso)")"
  barato="$(publicar "$autor" "$coordinador" "$(caso_trivial)")"

  # La dirección del borde NO va en el archivo: la prueba corre dentro de la red del compose, donde
  # `localhost` es el propio contenedor de k6. La fija `correr` (o el entorno, si se apunta a otro
  # despliegue).
  #
  # Sin comillas y sin espacios en ningún valor: así el archivo sirve para `source` (bash) y para
  # `docker run --env-file` (que NO quita comillas: `K='v'` le llegaría como `'v'`). Los valores
  # están elegidos para que eso sea posible; las entradas de la definición no van aquí porque
  # llevan comillas dobles —el guion de k6 trae su valor por defecto— y quien las quiera cambiar
  # pasa `LOADTEST_INPUTS` por entorno.
  {
    echo "# Generado por deploy/loadtest/calculadora.sh — contiene tokens reales de DESARROLLO."
    echo "LOADTEST_CALCULATOR_ID=$peor"
    echo "LOADTEST_CHEAP_CALCULATOR_ID=$barato"
    echo "LOADTEST_TOKENS=$(IFS=,; echo "${tokens[*]}")"
    echo "LOADTEST_VUS=${LOADTEST_VUS:-30}"
    echo "LOADTEST_RAMP_UP=${LOADTEST_RAMP_UP:-15s}"
    echo "LOADTEST_HOLD=${LOADTEST_HOLD:-1m}"
    echo "LOADTEST_RAMP_DOWN=${LOADTEST_RAMP_DOWN:-15s}"
  } >"$ENTORNO"
  chmod 600 "$ENTORNO"

  aviso "entorno escrito en $ENTORNO" >&2
  cat <<FIN

Siguiente paso:

  deploy/loadtest/calculadora.sh correr

  (o a mano, para controlar cada parámetro:)

  docker run --rm --network $RED --env-file $ENTORNO \\
    -e LOADTEST_BASE_URL=http://api-gateway:8080 \\
    -v "$AQUI:/scripts:ro" grafana/k6 run /scripts/k6-calculadora.js

Al terminar, \`deploy/loadtest/calculadora.sh limpiar\` borra las calculadoras, sus
simulaciones y las sagas de la prueba.
FIN
}

# Corre k6 en un contenedor, dentro de la red del compose para llegar al borde por su nombre.
correr() {
  [[ -f "$ENTORNO" ]] || error "no hay entorno preparado: corre antes «calculadora.sh preparar»"
  require_docker
  # shellcheck disable=SC1090
  set -a; source "$ENTORNO"; set +a

  docker run --rm --network "$RED" \
    -v "$AQUI:/scripts:ro" \
    -e LOADTEST_BASE_URL="${LOADTEST_BASE_URL:-http://api-gateway:8080}" \
    ${LOADTEST_CALCULATOR_ID:+-e LOADTEST_CALCULATOR_ID="$LOADTEST_CALCULATOR_ID"} \
    ${LOADTEST_CHEAP_CALCULATOR_ID:+-e LOADTEST_CHEAP_CALCULATOR_ID="$LOADTEST_CHEAP_CALCULATOR_ID"} \
    ${LOADTEST_TOKENS:+-e LOADTEST_TOKENS="$LOADTEST_TOKENS"} \
    ${LOADTEST_INPUTS:+-e LOADTEST_INPUTS="$LOADTEST_INPUTS"} \
    -e LOADTEST_VUS="$LOADTEST_VUS" \
    -e LOADTEST_RAMP_UP="$LOADTEST_RAMP_UP" \
    -e LOADTEST_HOLD="$LOADTEST_HOLD" \
    -e LOADTEST_RAMP_DOWN="$LOADTEST_RAMP_DOWN" \
    grafana/k6 run /scripts/k6-calculadora.js
}

# Borra lo que la prueba escribió.
#
# Va por SQL y no por la API por la misma razón que la limpieza de las pruebas de extremo a extremo:
# `DELETE /calculators/{id}` se niega —con razón— a borrar una calculadora citada por simulaciones, y
# aquí lo que se quiere borrar son precisamente las simulaciones de la prueba. El nombre `ZZLOAD` es
# la salvaguarda: nadie más lo usa.
limpiar() {
  local simulador="fintcart-postgres-simulator-1" orquestador="fintcart-postgres-orchestrator-1"
  local ids
  ids="$(docker exec "$simulador" psql -U fintcart -d simulator_db -t -A -c \
    "SELECT string_agg(quote_literal(id::text), ',') FROM calculators WHERE name LIKE 'ZZLOAD %'")"
  if [[ -z "$ids" ]]; then
    aviso "no hay calculadoras ZZLOAD: nada que limpiar" >&2
    return
  fi

  docker exec "$simulador" psql -U fintcart -d simulator_db -q -c \
    "DELETE FROM simulations WHERE calculator_id IN ($ids);" \
    -c "DELETE FROM calculators WHERE id IN ($ids);"

  # Las sagas de las simulaciones de prueba (el Orquestador guarda una por ejecución). Se borran
  # las de tipo `simulacion` COMPLETADAS, que son las que acumula una prueba de carga; una saga a
  # medias dice que algo falló y se deja estar para poder mirarla.
  docker exec "$orquestador" psql -U fintcart -d orchestrator_db -q -c \
    "DELETE FROM saga_state WHERE saga_type = 'simulacion' AND status = 'completed';"

  aviso "limpieza hecha: calculadoras ZZLOAD, sus simulaciones y sus sagas" >&2
}

case "${1:-}" in
  preparar) preparar ;;
  correr) correr ;;
  limpiar) limpiar ;;
  *) error "uso: calculadora.sh {preparar|correr|limpiar}" ;;
esac
