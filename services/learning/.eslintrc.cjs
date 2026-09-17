/**
 * Lint del Servicio de Aprendizaje.
 *
 * Regla central: prohibición de `number` para montos, tasas y calificaciones
 * (Constitución Principio VIII, NON-NEGOTIABLE). Todo valor decimal se maneja
 * con `decimal.js` y viaja como `string` decimal canónica.
 */
/**
 * Vocabulario de nombres que el Principio VIII prohíbe declarar como `number`.
 *
 * Va aquí, en una constante, porque lo usan CUATRO selectores y una lista repetida
 * cuatro veces es una lista que se corrige en tres sitios. Y lleva fronteras de palabra
 * por un motivo concreto, que costó un falso positivo: la primera versión buscaba
 * `tasa` con la bandera `i` y encontraba «preGUN-TASA-Servir» dentro de
 * `preguntasAServir`. Una regla que señala código correcto se termina desactivando, así
 * que la coincidencia exige empezar en frontera de palabra (`montoTotal` sí) y NO seguir
 * en minúsculas (`preguntasAServir` no, porque tras «tasa» sigue una `s`).
 */
const VOCABULARIO_FINANCIERO = [
  '[Ss]core',
  '[Ww]eight',
  'pass[_-]?[Tt]hreshold',
  '[Tt]hreshold',
  'umbral',
  '[Mm]onto',
  'amount',
  '[Tt]asa',
  'rate',
  '[Pp]rice',
  '[Pp]recio',
  '[Cc]uota',
  '[Ss]aldo',
  '[Bb]alance',
  '[Vv]alor',
  '[Ii]nteres',
  '[Ii]nterest',
  'igsf',
  'gmf',
  'uvt',
  'smmlv',
].join('|');

/** Un nombre financiero, en frontera de palabra y sin seguir en minúsculas. */
const NOMBRE_FINANCIERO = `(^|[^A-Za-z])(${VOCABULARIO_FINANCIERO})(?![a-z])`;

/** Los selectores que lo aplican a las tres formas de declarar un valor. */
const SELECTORES_VIII = [
  `Identifier[name=/${NOMBRE_FINANCIERO}/] > TSTypeAnnotation > TSNumberKeyword`,
  `PropertyDefinition[key.name=/${NOMBRE_FINANCIERO}/] > TSTypeAnnotation > TSNumberKeyword`,
  `TSPropertySignature[key.name=/${NOMBRE_FINANCIERO}/] > TSTypeAnnotation > TSNumberKeyword`,
].map((selector) => ({
  selector,
  message:
    'Principio VIII (NON-NEGOTIABLE): un valor financiero no se declara `number`. Usar Decimal (decimal.js) en el dominio y `string` decimal canónica en la frontera.',
}));

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'prettier',
  ],
  env: { node: true, jest: true },
  ignorePatterns: ['.eslintrc.cjs', 'dist/', 'node_modules/', 'src/pb/'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/require-await': 'error',
  },
  overrides: [
    {
      // ── Principio VIII (NON-NEGOTIABLE) ────────────────────────────────
      // Módulos donde TODOS los números son dinero o calificación: aquí la
      // prohibición de `number` es literal, sin excepciones.
      files: ['src/grading/**/*.ts', 'src/common/decimal-str.ts'],
      rules: {
        '@typescript-eslint/no-restricted-types': [
          'error',
          {
            types: {
              number: {
                message:
                  'Principio VIII (NON-NEGOTIABLE): prohibido `number` para calificaciones, montos o tasas. Usar Decimal (decimal.js) en el dominio y `string` decimal canónica en la frontera.',
                fixWith: 'Decimal',
              },
            },
          },
        ],
        'no-restricted-globals': [
          'error',
          {
            name: 'parseFloat',
            message: 'Principio VIII: usar new Decimal(str), no parseFloat.',
          },
          {
            name: 'Number',
            message: 'Principio VIII: usar new Decimal(str), no Number().',
          },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'round',
            message:
              'Principio VIII: el redondeo de valores financieros usa Decimal.toDecimalPlaces con modo half-even, no Math.round.',
          },
        ],
      },
    },
    {
      // ── Principio VIII, versión PRECISA (src/quizzes/**) ───────────────
      //
      // En `src/quizzes/**` conviven las calificaciones (`score`, `weight`,
      // `pass_threshold`) con valores que NO son dinero: el número de preguntas que se
      // sirven y la fuente de aleatoriedad del barajado. Prohibir ahí el tipo `number`
      // a secas hacía fallar el lint sobre código CORRECTO, y una regla que señala
      // código correcto termina desactivada por quien la sufre —con lo que deja de
      // proteger lo que protegía—.
      //
      // Así que en vez de silenciarla se la hace precisar el NOMBRE: se prohíbe
      // `number` en todo lo que se llame como un valor financiero, en parámetros,
      // propiedades de clase y miembros de tipo. El vocabulario es el de todo el
      // proyecto (los mismos nombres que usan el Simulador, el borde y la SPA), así
      // que un `score: number` nuevo sigue fallando aunque nadie toque esta lista.
      //
      // La prueba de que sigue fallando está en `scripts/lint-viii-selftest.mjs`: sin
      // ella, esto sería un cambio de configuración que nadie vuelve a mirar.
      files: ['src/quizzes/**/*.ts'],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'parseFloat', message: 'Principio VIII: usar new Decimal(str), no parseFloat.' },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'round',
            message:
              'Principio VIII: el redondeo de valores financieros usa Decimal.toDecimalPlaces con modo half-even, no Math.round.',
          },
        ],
        'no-restricted-syntax': [
          'error',
          {
            // `Number(x)` para convertir dinero: es la puerta por la que entra un `double`.
            // `Number.isInteger(y)` sobre un conteo es correcto y no se toca.
            selector: 'CallExpression[callee.name="Number"]',
            message: 'Principio VIII: usar new Decimal(str), no Number().',
          },
          ...SELECTORES_VIII,
        ],
      },
    },
    {
      files: ['test/**/*.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ],
};
