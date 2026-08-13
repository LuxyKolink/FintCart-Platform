/** DTOs de perfil, preferencias y derechos Ley 1581 — espejo de
 * `services/api-gateway/internal/handler/types.go`. */
import type { Page, SimulationHistoryEntry } from '../simulators/simulators.types';

/**
 * Claves reservadas del mapa de preferencias (ver
 * `services/users/internal/server/mapping.go::preferencesFromRow`). Cualquier
 * otra clave es libre y se guarda igual, pero estas tres tienen columna propia
 * en `preferences` y por eso siempre están presentes en la respuesta.
 */
export const PREF_LOCALE = 'locale';
export const PREF_NOTIF_INAPP = 'notif_inapp';
export const PREF_NOTIF_EMAIL = 'notif_email';

export interface Profile {
  user_id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  account_status: string;
  preferences: Record<string, string>;
  roles: string[];
}

export interface UpdateProfileRequest {
  display_name?: string;
  preferences?: Record<string, string>;
}

/**
 * Los cuatro campos son conteos enteros (FR-014/FR-018), no dinero. Este
 * directorio no cae bajo la regla `no-restricted-types` de `.eslintrc.json`
 * (a diferencia de `features/simulators/` o `features/learning/progress/`),
 * así que `number` aquí no necesita el alias documentado que usan aquellos.
 */
export interface ActivityReport {
  user_id: string;
  points: number;
  articles_viewed: number;
  quizzes_attempted: number;
  simulations_run: number;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface QuizAttempt {
  attempt_id: string;
  attempt_no: number;
  score: string;
  created_at: string;
}

export interface PersonalData {
  profile: Profile;
  progress: { user_id: string; points: number };
  quiz_attempts: Page<QuizAttempt>;
  simulations: Page<SimulationHistoryEntry>;
}

export interface InAppNotification {
  id: string;
  type: string;
  read_state: 'unread' | 'read';
  created_at: string;
  payload?: Record<string, unknown>;
}
