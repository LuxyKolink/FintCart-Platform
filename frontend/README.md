# Frontend — FintCart

SPA Angular con el sistema visual de FintCart. Habla **solo** con el API Gateway (`/v1`); no
conoce ningún servicio interno ni base de datos.

```bash
npm install
npm start          # ng serve — requiere la pila de `dev/up` para tener datos
npm test           # unitarias (Karma + ChromeHeadless)
npm run e2e        # Playwright contra http://localhost:4200
npm run lint       # ESLint + oxlint, con la barrera de estilos en línea
node scripts/design-debt.mjs   # mide la deuda de estilo (estilos en línea, styles.scss)
```

## Estructura

```
src/app/
  core/            auth (token, interceptor, guardas), sesión, layout interno
  features/        una carpeta por pantalla: auth, learning, simulators, profile,
                   notifications, editorial, admin
  shared/          ui/ (biblioteca de componentes), ayudantes de formato decimal
  styles/          tokens/ (color, tipografía, espaciado, puntos de corte) + base.css
e2e/               suites de extremo a extremo y ayudantes compartidos
```

## Sistema visual

- **`shared/ui/`** es la fuente única de los componentes. Las pantallas importan del barril
  `shared/ui`; los imports profundos están prohibidos por el lint.
- **`styles.scss`** es una capa artesanal en retirada: la usa **solo** el editor de artículos,
  que reescribe el feature 002. Su eliminación es el criterio de terminación del rediseño.
- **Puntos de corte**: cuatro tokens en `styles/tokens/breakpoints.css` (480/768/1024/1280;
  mínimo soportado 360). Una variable de CSS no se puede usar dentro de una `@media`, así que
  cada consulta escribe el literal y **cita el token** en un comentario.
- **Cifras**: dinero, calificaciones y conteos salen de `shared/format-number.ts` y
  `shared/format-decimal.ts`, que agrupan la **cadena decimal canónica** (nunca pasan por
  `number`) con la convención local: `$1.250.000,00`. Una cifra no se trunca jamás — está
  prohibido truncar dinero o puntajes por diseño (N-15).

## Pruebas

| Suite | Qué garantiza |
|---|---|
| `us1`…`us4` | Los cuatro recorridos funcionales completos, contra la pila real |
| `a11y.spec.ts` | Las 19 pantallas: etiqueta asociada, contraste AA y recorrido por teclado |
| `zoom-200.spec.ts` | La interfaz con la fuente del navegador al 200 %, sin pérdida de cifras |
| `offline-assets.spec.ts` | Tipografía e iconos sin conectividad hacia servicios externos |
| `visual/*.spec.ts` | Capturas a 480/768/1024/1280/360 + etiquetas y contraste en cada anchura |

Las cuatro suites heredadas **no se modifican**: seleccionan por rol y etiqueta accesible, así
que si una falla tras un cambio de presentación, el fallo es de la presentación.
