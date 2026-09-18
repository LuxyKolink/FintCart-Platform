# Hallazgos: datos que la API no expone

**Feature**: `003-design-system-frontend` · **Tarea**: T089 · **Requisito**: FR-122
· **Fecha**: 2026-09-16

Durante el rediseño se comparó cada pantalla con los cinco kits de `design/ui_kits/`. Estos
son los puntos donde el kit dibuja algo que **el contrato no puede alimentar**. No se
resuelven aquí: se registran para que un feature posterior los tome o los descarte
conscientemente.

La regla que los separa de un error de diseño: **el rediseño no inventa datos**. Cuando el
dato no existe, la pantalla se rediseña sin él y se anota. Rellenar un hueco con un valor
plausible produce una interfaz que se ve terminada y miente, que es peor que una interfaz
incompleta.

## Resumen

| # | Hallazgo | Bloquea | Destino propuesto |
|---|----------|---------|-------------------|
| 1 | No existe la transición de rechazo editorial | Mitad de FR-115 | 003 (bloqueada) → 002 |
| 2 | El autor de una versión es un UUID, no un nombre | FR-117 (parcial) | 002 |
| 3 | El progreso es un único entero | Portal de aprendizaje | 004 |
| 4 | El artículo no lleva autor, fecha, tiempo ni dificultad | Catálogo y lector | 002 (`body_doc`/metadatos) |
| 5 | No hay totales por estado | FR-114 (parcial) | 002 |
| 6 | No hay restablecimiento de contraseña | Pantalla de acceso | 002 |
| 7 | No hay proveedor de identidad externo | Pantalla de acceso | Fuera de alcance |
| 8 | La verificación es por enlace, no por código | Pantalla de verificación | No aplica (es diseño) |
| 9 | El borde colapsa conflictos en `400` sin causa | Mensajes de error | 002 |
| 10 | `/me/report` no declara esquema | Reporte de actividad | 002 |

---

## 1. No existe la transición de rechazo editorial — **bloquea la mitad de FR-115**

FR-115 pide que la bandeja de revisión presente «la decisión de aprobar **o rechazar**». La
mitad «rechazar» no se puede ofrecer porque el servicio no la tiene.

**Evidencia**

- Prototipo gRPC (`contracts/proto/fintcart/learning/v1/`): las RPC de editorial son
  `CreateDraft`, `UpdateDraft`, `SubmitForReview`, `ApproveAndPublish`, `Archive`,
  `ListVersions`. **No hay `RejectVersion`.**
- Transiciones reales en `services/learning/src/publishing/publishing.repository.ts`:
  `borrador → en_revision` (`SUBMIT_FOR_REVIEW_SQL`), `en_revision → publicado`
  (`PUBLISH_VERSION_SQL`), `publicado → archivado` (`ARCHIVE_VERSION_SQL`) y la edición del
  cuerpo de un borrador. **No hay ninguna salida de `en_revision` distinta de publicar.**
- Medido pulsando el botón contra el servicio real, no deducido:

  ```
  learning  ERROR  Archive falló: la versión 39347591-… no está publicada
                   (estado actual: en_revision)
  gateway   WARN   error de servicio interno  POST /editorial/versions/39347591-…/archive
                   grpc_code=FailedPrecondition → HTTP 400 {"code":"bad_request",
                   "message":"petición inválida"}
  ```

**Qué se hizo mientras tanto**: se **retiró** el botón «Archivar versión» que se había añadido
en T066. Una acción que siempre falla es peor que su ausencia, y añadir la transición sería
cambiar una regla de negocio, que 003 tiene prohibido (FR-121). La prueba unitaria que lo daba
por bueno se sustituyó por una que fija lo que la pantalla hace de verdad.

**Propuesta para 002**: `RejectVersion(VersionRef, reason) → OpResult` con
`en_revision → borrador` (devuelve el borrador a su autor, que es lo que permite corregir) o a
un estado propio `rechazado` si se quiere distinguir «nunca enviada» de «devuelta». El motivo
es obligatorio en el rechazo de calculadoras (FR-054) y aquí cumple la misma función: sin él,
el editor no sabe qué corregir.

## 2. El autor de una versión es un UUID, no un nombre — degrada FR-117

`ArticleVersion.created_by` es el identificador del editor. Lo único que la interfaz puede
afirmar es si la versión es tuya; para las demás no hay nombre que mostrar, y **no se inventa**
(la pantalla dice «Otro editor» y conserva el identificador para poder trazar, FR-122).

**Impacto de negocio**: un coordinador **no puede saber quién escribió lo que revisa**. En un
flujo donde la decisión de publicar depende de la confianza en el editor, eso es información
faltante de verdad, no un detalle estético.

**Propuesta**: que `ListVersions` devuelva el nombre para mostrar del autor (o que Usuarios
exponga `GetDisplayNames` y Aprendizaje lo componga). Nótese que la resolución no puede ser una
lectura cruzada de base de datos (Principio III): tiene que ser gRPC.

## 3. El progreso es un único entero

`Progress` en el contrato del borde son **dos campos**: `user_id` y `points`.

El kit del portal dibuja, además: progreso por categoría, racha de días, artículos leídos
sobre el total y «continuar donde lo dejaste». Nada de eso tiene origen. La pantalla de
progreso se rediseñó con lo que sí existe —los puntos, en **una sola** cifra, y los hitos que
se derivan de ellos— y el resto se omitió en lugar de calcularse en el navegador a partir del
catálogo (que daría una cifra plausible y falsa).

**Propuesta**: nueva RPC `GetLearningProgress(user_id)` con desglose por categoría e historial
de actividad. Es material de un feature de aprendizaje, no del rediseño.

## 4. El artículo no lleva autor, fecha, tiempo de lectura ni dificultad

`Article` son cinco campos: `article_id`, `title`, `category`, `body`, `current_version_no`.

El kit del catálogo y del lector muestra, por tarjeta: autor, fecha de publicación, minutos de
lectura y nivel. La portada del artículo tampoco está: no hay resumen ni imagen de cabecera
(002 introduce `article_images`, pero para el cuerpo). El lector y el catálogo se rediseñaron
sin esos datos.

**Propuesta**: que `body_doc` (002, T016) traiga asociados los metadatos del artículo
(`published_at`, `reading_minutes` calculable en el servidor, `difficulty`), y que `ListPublished`
los devuelva.

## 5. No hay totales por estado — degrada FR-114

FR-114 pide presentar los artículos agrupados por estado. `ListVersions` devuelve `items` y
`total_size` **de la consulta filtrada**, no un desglose. Mostrar «3 en revisión · 1 publicado»
exigiría cuatro llamadas, y cada una con su filtro; mostrar un contador sobre el total sería un
número equivocado, que es exactamente lo que N-15 prohíbe. La pantalla muestra los distintivos
de estado por versión y **ningún contador**.

**Propuesta**: un `counts_by_state` en la respuesta de `ListVersions`, o un
`ListVersionsSummary`. Es barato en el servidor (un `GROUP BY state`) y hoy obliga a la interfaz
a no mostrar nada.

## 6. No hay restablecimiento de contraseña

Las rutas de autenticación del borde son `/oauth/authorize`, `/oauth/token`, `/auth/register`,
`/auth/verify-email` y `/auth/logout`. No hay solicitud de restablecimiento ni consumo de
token, y no hay plantilla de correo para ello.

La pantalla de acceso se rediseñó sin el enlace «olvidé mi contraseña» que el kit dibuja: un
enlace que lleva a ninguna parte es peor que su ausencia. El usuario que la olvide queda sin
salida y el flujo de alta exige verificar el correo, así que tampoco puede crear otra cuenta
con la misma dirección.

**Propuesta**: `POST /auth/password-reset` (solicitud, siempre 202 para no filtrar qué correos
existen) y `POST /auth/password-reset/{token}` (consumo). Con el token de un solo uso y
caducidad corta. Es el hueco funcional más grande que quedó a la vista.

## 7. No hay proveedor de identidad externo

El único flujo es Authorization Code + PKCE contra el propio servidor de autorización. No hay
federación. Se registra solo para que la ausencia sea una decisión y no un olvido: si el
alcance no la incluye, el kit debería dejar de dibujar los botones de proveedor.

## 8. La verificación es por enlace, no por código de seis dígitos

El correo de verificación lleva a `/verificar-correo?token=…` y no un código de seis dígitos. No
es un hallazgo de datos, sino una decisión funcional que el rediseño respetó: la pantalla no
tiene casillas de seis dígitos aunque el kit las dibuje.

## 9. El borde colapsa conflictos en `400` sin causa — afecta a los mensajes de error

El Gateway mapea `FailedPrecondition` a `400 {"code":"bad_request","message":"petición
inválida"}`. El servicio **sí** dice qué pasó («la versión … no está publicada (estado actual:
en_revision)»); el borde lo tira. `Forbidden` sí llega como `403`, y por eso el aviso de
FR-116 funciona: la interfaz pudo explicar la regla.

**Impacto**: cualquier conflicto de estado —archivar algo que no está publicado, editar algo
que ya no es borrador— llega a la interfaz como «petición inválida», sin nada que decirle al
usuario. Las pantallas de 003 evitan el caso no ofreciendo acciones inválidas, pero un desfase
de estado entre dos pestañas lo producirá igual.

**Propuesta**: mapear `FailedPrecondition` a `409` conservando el mensaje del dominio (o un
campo `reason` aparte), que es lo que ya hace con `NotFound → 404` y `PermissionDenied → 403`.

## 10. `/me/report` no declara esquema

En el contrato, `GET /me/report` responde `200` con descripción y **sin esquema**. Lo leen
cuatro cifras (`quizzes_attempted`, `simulations_run`, y los dos que las acompañan) y la
pantalla las pinta desde el payload real, con estado vacío cuando están en cero. Como no hay
contrato, un cambio de nombre en el productor rompería la pantalla sin que ninguna prueba de
contrato lo detecte.

**Propuesta**: declarar el esquema del reporte, como se hizo con `Progress` y `Article`.

---

## Lo que sí se pudo construir

Para contraste, y porque acota lo anterior: el rediseño es **completo** en todo lo que no está
en esta lista. De las 19 pantallas, 18 están migradas al sistema visual; la que falta es el
editor de artículos, y no falta por descuido: la superficie de redacción la reescribe 002
(FR-123). Las cuatro suites funcionales pasan sin haber cambiado **ninguna aserción de
comportamiento** —los ajustes que se hicieron en `us1`/`us2`/`us4` fueron sobre aserciones que
ya no describían el sistema de 002, no sobre el rediseño—. Y ninguno de los diez puntos de
arriba dejó una pantalla en blanco: cada uno tiene su estado vacío o su explicación (SC-034).

---

## Hallazgo 38 — La barrera de accesibilidad perdió una pantalla sin decirlo

**Qué pasaba**: la comprobación de la pantalla del cuestionario busca un artículo que traiga
cuestionario recorriendo el catálogo, y miraba **solo los cinco primeros**. El catálogo se sirve
`ORDER BY a.created_at DESC` (`articles.repository.ts`), así que cada artículo publicado después
—el que crea `us4` en cada pasada de la suite, o cualquiera de demostración— se coloca delante y
empuja hacia abajo el artículo sembrado que sí tiene cuestionario. Cuando pasa del quinto puesto,
la prueba se salta la pantalla con `test.skip`, la suite termina **en verde** y la barrera cubre
18 pantallas en vez de 19.

Se vio al ejecutar la suite completa después de publicar un artículo de demostración: `58 passed
· 1 skipped`. Nadie había tocado nada de accesibilidad; lo que cambió fue el contenido.

**Por qué importa más de lo que parece**: un `test.skip` condicionado por el orden de los datos
es una pérdida de cobertura que se disfraza de resultado normal. El límite fijo sobre una lista
que crece hacia arriba garantiza que algún día se pierda —y no avisa el día que ocurre, sino
semanas antes, en silencio—.

**Arreglo**: se recorre el catálogo **entero** hasta encontrar el artículo con cuestionario. El
`test.skip` se queda, pero ahora significa lo que dice —que ningún artículo de la fixture tiene
cuestionario— y no «que el artículo cayó fuera de la ventana». Verificado: la barrera pasa 5/5
sin ningún salto.

**Lo que NO se toca, y por qué**: el mismo patrón existe en `e2e/us1-aprendizaje.spec.ts` (mira
**solo el primer artículo**), pero esa spec está protegida por N-13 —sus aserciones son la
garantía dura del feature y ajustarlas destruye justo lo que protegen—. Ahí el arreglo no es de
la prueba sino del procedimiento: **la ejecución que demuestra cobertura completa es la que se
hace sobre una pila recién sembrada** (`dev/down --volumes && dev/up && dev/migrate && dev/seed`),
que es además la que ya está documentada como paso previo a cualquier demostración. En una pila
limpia el primer artículo del catálogo es el que trae cuestionario y el paso se ejecuta.
