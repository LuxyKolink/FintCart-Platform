/**
 * Concede un rol editorial a una cuenta ya registrada (T156, US4).
 *
 * Los roles editoriales NO se pueden pedir por la API —con razón: un endpoint que
 * permitiera auto-concederse `coordinador_editorial` anularía la separación de
 * responsabilidades de FR-008— así que la única forma de tener un editor y un
 * coordinador de prueba es `dev/seed role <correo> <rol>`, el mismo script que usaría
 * un operador real. Se invoca por `bash` y no por un cliente Postgres directo desde
 * Node porque el script YA sabe contra qué contenedor y qué base ejecutar el SQL — un
 * segundo camino para lo mismo divergiría de él con el tiempo.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

export function grantRole(email: string, role: 'editor' | 'coordinador_editorial'): void {
  execFileSync('bash', ['dev/seed', 'role', email, role], { cwd: REPO_ROOT, stdio: 'pipe' });
}
