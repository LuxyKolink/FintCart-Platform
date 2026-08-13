import { Injectable } from '@angular/core';

interface Draft {
  answers: Record<string, string>;
  savedAt: string;
}

const KEY_PREFIX = 'fc_quiz_draft_';

/**
 * Persistencia local de un intento en curso (Edge Case, `spec.md` línea 127):
 * si el usuario cierra la pestaña o pierde la conexión antes de enviar, el
 * resultado NUNCA se registra en el servidor — solo lo hace `submitQuizAttempt`
 * al completar. Este servicio guarda el borrador en `localStorage` (sobrevive
 * al cierre de pestaña, a diferencia de `sessionStorage`) para poder
 * reanudarlo o descartarlo en una sesión posterior.
 */
@Injectable({ providedIn: 'root' })
export class QuizStateService {
  public saveDraft(quizId: string, answers: Record<string, string>): void {
    const draft: Draft = { answers, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY_PREFIX + quizId, JSON.stringify(draft));
  }

  public loadDraft(quizId: string): Record<string, string> | null {
    const raw = localStorage.getItem(KEY_PREFIX + quizId);
    if (raw === null) {
      return null;
    }
    try {
      return (JSON.parse(raw) as Draft).answers;
    } catch {
      return null;
    }
  }

  /** Se llama solo tras un envío exitoso: un intento calificado no deja borrador. */
  public clearDraft(quizId: string): void {
    localStorage.removeItem(KEY_PREFIX + quizId);
  }
}
