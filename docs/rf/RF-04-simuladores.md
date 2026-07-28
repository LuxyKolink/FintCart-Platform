# RF-04 — Simuladores

## Nombre del requerimiento

Simuladores Financieros.

## Descripción del requerimiento

Los simuladores financieros son un conjunto de cinco calculadoras especializadas —ahorro, crédito, presupuesto, inversión y calculadoras específicas del contexto colombiano— que permiten al usuario experimentar con escenarios financieros realistas en pesos colombianos y aplicar a su situación personal los conceptos aprendidos. Cada ejecución produce resultados con precisión decimal arbitraria y queda registrada en el historial del usuario. Materializa los requerimientos FR-019 (cinco simuladores), FR-020 (parámetros en COP con interacción con otras monedas), FR-021 (precisión decimal sin redondeo binario) y FR-022 (historial de operaciones), y se implementa en el servicio Simulador (Rust, `rust_decimal`).

## Precondiciones

El usuario debe estar autenticado con un token JWT válido y con el scope de simulador. Para ejecutar una calculadora debe proporcionar parámetros financieros válidos —montos, tasas y plazos— expresados como decimales canónicos; la moneda principal de cálculo es el peso colombiano (COP).

## Postcondiciones

Tras una ejecución exitosa, el sistema devuelve el resultado con la precisión decimal adecuada al dominio y persiste la operación —con sus parámetros, resultado y marca temporal— en el historial personal de simulaciones (FR-022); además, la ejecución se emite, a través del Orquestador, hacia el servicio de Auditoría. La simulación no afecta el indicador de progreso del usuario.

## Casos de uso con los que se relaciona

Corresponde a la Historia de Usuario 2 (Simuladores financieros para análisis personal, prioridad P2) y sus escenarios de selección de calculadora, ingreso de parámetros, obtención de resultado y consulta del historial; se relaciona con RF-03 (autenticación previa) y con el servicio de Auditoría (registro de las ejecuciones), y es independiente del consumo previo de contenido educativo.

## Flujo Básico

El usuario accede al módulo de simuladores y elige una de las cinco calculadoras; ingresa los parámetros financieros válidos en COP y ejecuta la simulación (`POST /simulators/{calcType}/run`), que el Gateway enruta vía gRPC al servicio Simulador; este valida las entradas, calcula con `rust_decimal` y devuelve el resultado, que se persiste en el historial y queda disponible para consulta posterior (`GET /simulators/history`).

## Flujo Alternativo

Si los parámetros son inválidos o exceden rangos razonables, el simulador rechaza la ejecución con un error de validación sin registrar la operación; cuando el escenario lo requiere, la calculadora contempla la interacción con otros tipos de moneda además del COP; ante una pérdida de conexión durante la ejecución, la operación no se registra y puede reintentarse; y el usuario puede revisar sus simulaciones previas con sus parámetros, resultados y marca temporal.

## Restricciones y/o Excepciones

Toda magnitud monetaria, tasa o porcentaje se representa, calcula, persiste y transmite con precisión decimal arbitraria (`rust_decimal` en cómputo y string decimal canónica en JSON y persistencia), quedando PROHIBIDO el punto flotante binario (FR-028, NON-NEGOTIABLE). El Simulador no es productor de RabbitMQ —su auditoría se emite a través del Orquestador (decisión D-03)—; los datos ingresados son referenciales y educativos, sin vínculo con cuentas o productos financieros reales; y el historial es anonimizable por `user_id` ante una supresión de cuenta.
