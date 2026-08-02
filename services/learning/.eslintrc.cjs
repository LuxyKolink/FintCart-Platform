/**
 * Lint del Servicio de Aprendizaje.
 *
 * Regla central: prohibición de `number` para montos, tasas y calificaciones
 * (Constitución Principio VIII, NON-NEGOTIABLE). Todo valor decimal se maneja
 * con `decimal.js` y viaja como `string` decimal canónica.
 */
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
      // Módulos financieros: calificación (`score`, `weight`, `pass_threshold`)
      // y todo lo que cruce la frontera decimal.
      files: ['src/grading/**/*.ts', 'src/quizzes/**/*.ts', 'src/common/decimal-str.ts'],
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
      files: ['test/**/*.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
  ],
};
