/**
 * Lint del Servicio de Notificación (consumidor puro, canal email).
 *
 * Notificación no calcula valores financieros, pero sí transporta payloads que
 * pueden contenerlos (p. ej. hitos de progreso o resultados en una plantilla de
 * email). Por eso los payloads se tratan como `string` y nunca se re-parsean a
 * `number` (Constitución Principio VIII).
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
    // La cola con estado depende de que ninguna promesa quede suelta: un
    // dispatch no esperado desincronizaría el contador de intentos.
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    'no-restricted-globals': [
      'error',
      {
        name: 'parseFloat',
        message:
          'Principio VIII: los valores decimales de un payload se transportan como string; no re-parsear a number.',
      },
    ],
  },
  overrides: [
    {
      files: ['test/**/*.ts', '**/*.spec.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
