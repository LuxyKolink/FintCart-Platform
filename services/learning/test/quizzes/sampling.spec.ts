/**
 * Pruebas del muestreo y barajado de la sesión (T062, T064; FR-038, SC-013).
 *
 * Prueban las funciones PURAS `sampleServed` y `shuffle` de `session.service.ts`, no el
 * grafo completo: lo que puede romperse aquí es el algoritmo —cuántas preguntas se
 * sirven, si el barajado conserva los elementos y si el orden queda registrado en
 * `served`— y eso se comprueba de forma determinista inyectando una fuente de
 * aleatoriedad fija, sin depender de `Math.random`.
 */
import Decimal from 'decimal.js';

import type { Quiz, QuizQuestion } from '../../src/quizzes/quizzes.repository';
import { sampleServed, shuffle } from '../../src/quizzes/session.service';

function option(key: string): { key: string; text: string } {
  return { key, text: `Opción ${key}` };
}

/** Cuestionario sintético con `questionCount` preguntas de 4 opciones cada una. */
function makeQuiz(questionCount: number, questionsToServe: number): Quiz {
  const questions: QuizQuestion[] = Array.from({ length: questionCount }, (_, i) => ({
    questionId: `q${i + 1}`,
    prompt: `Pregunta ${i + 1}`,
    options: [option('a'), option('b'), option('c'), option('d')],
    weight: new Decimal('1'),
  }));
  return {
    quizId: 'quiz-1',
    articleId: 'article-1',
    title: 'Cuestionario de prueba',
    passThreshold: new Decimal('60'),
    questions,
    questionsToServe,
  };
}

describe('sampleServed', () => {
  it('un banco con MENOS preguntas que N sirve todas sin error (FR-038, T064)', () => {
    const { served, questions } = sampleServed(makeQuiz(2, 5));

    expect(served).toHaveLength(2);
    expect(questions).toHaveLength(2);
    expect(served.map((s) => s.questionId).sort()).toEqual(['q1', 'q2']);
  });

  it('un banco con MÁS preguntas que N sirve exactamente N, todas del banco y sin repetir (T062)', () => {
    const bank = makeQuiz(6, 3);
    const { served, questions } = sampleServed(bank);

    expect(served).toHaveLength(3);
    expect(questions).toHaveLength(3);

    const ids = served.map((s) => s.questionId);
    expect(new Set(ids).size).toBe(3); // sin repetidas
    expect(ids.every((id) => bank.questions.some((q) => q.questionId === id))).toBe(true);

    // Las opciones de cada servida son una permutación de las originales.
    for (const question of questions) {
      expect(question.options.map((o) => o.key).sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  it('el orden de opciones servido queda registrado en `served` (research D-17)', () => {
    const { served, questions } = sampleServed(makeQuiz(1, 1), () => 0.5);

    // La reconstrucción de lo que el usuario vio exige que `served.option_keys` lleve el
    // MISMO orden que las opciones devueltas al lector.
    expect(served[0]?.optionKeys).toEqual(questions[0]?.options.map((o) => o.key));
  });
});

describe('shuffle', () => {
  it('reordena de forma determinista con la misma fuente y conserva los elementos (SC-013)', () => {
    const input = ['a', 'b', 'c', 'd'];
    const first = shuffle(input, () => 0.5);
    const second = shuffle(input, () => 0.5);

    expect(first).toEqual(second);            // determinista
    expect(first).not.toEqual(input);         // no es la identidad: sí baraja
    expect([...first].sort()).toEqual(input); // y conserva exactamente los elementos
  });
});
