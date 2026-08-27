# Contratos — Feature 002 (deltas)

Estos archivos son **deltas** contra los contratos vigentes en `contracts/` de la raíz del
repositorio, que son la única superficie compartida del monorepo (Constitución §Definición
de Contratos, Principio I).

**No compilan por sí solos.** Describen exactamente qué se añade o cambia en cada contrato.
Durante la implementación se aplican sobre los archivos reales y se regeneran los stubs en
un commit separado del cambio de lógica, como exige §Definición de Contratos.

| Archivo | Contrato real que modifica |
|---------|----------------------------|
| `proto/learning-delta.proto` | `contracts/proto/fintcart/learning/v1/learning.proto` |
| `proto/simulator-delta.proto` | `contracts/proto/fintcart/simulator/v1/simulator.proto` |
| `proto/users-delta.proto` | `contracts/proto/fintcart/users/v1/users.proto` |
| `openapi/gateway-delta.yaml` | `contracts/openapi/gateway.yaml` |
| `events/events-catalog-delta.md` | `contracts/events/events-catalog.md` |

## Reglas transversales que aplican a todo delta

1. **Principio VIII**: todo importe, tasa, peso, umbral y valor de indicador viaja como
   `string` decimal canónica en proto y en JSON. `float`/`double` y número JSON están
   PROHIBIDOS. Los campos afectados van marcados `// [decimal]`, igual que en 001.
2. **Compatibilidad**: solo se añaden campos y RPC nuevos, con números de campo nuevos.
   Ningún número de campo existente se reutiliza ni se renumera.
3. **Cambios semánticos incompatibles**: `Quiz`/`GetQuiz` y `GradeAndStoreAttempt` cambian
   de significado (subconjunto servido, escala de 100). No cambia la forma del mensaje,
   pero sí el contrato de comportamiento — está señalado en el delta y exige migración
   coordinada del frontend.
4. **REST solo en el Gateway** (Principio II): todos los endpoints nuevos son del Gateway.
   Ningún servicio interno gana superficie HTTP.
