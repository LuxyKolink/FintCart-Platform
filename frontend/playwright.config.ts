import { defineConfig, devices } from '@playwright/test';

/**
 * No gestiona `webServer`: cada spec ejercita la SPA contra la pila completa
 * (Gateway, servicios, MailHog) levantada por `dev/up` — no solo `ng serve`.
 * Arrancar aquí únicamente el frontend dejaría cada endpoint real devolviendo
 * "conexión rechazada" y el fallo parecería un bug de la SPA.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
