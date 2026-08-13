/**
 * Prueba de CONTRATO gRPC de `LearningService` (T069).
 *
 * No comprueba el dominio —eso lo hace `repositories.spec.ts`— sino la FRONTERA: los
 * nombres de campo del `.proto`, los tipos con que salen y los códigos de estado de
 * cada fallo. Es lo único que detecta que un refactor cambió `attempt_no` por
 * `attemptNo` en la respuesta, o que una calificación salió como número JSON: dos
 * cosas que compilan, pasan las pruebas de dominio y rompen a todos los clientes.
 *
 * Corre a través del grafo completo —controlador → servicio → repositorio → SQL— con
 * `pg-mem` debajo. Un doble del servicio de aplicación haría que la prueba de contrato
 * verificara el doble.
 *
 * §Calidad: sin PostgreSQL ni servidor gRPC.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';

import { CONFIG, PG_POOL } from '../src/common/database.module';
import { LearningController } from '../src/grpc/learning.controller';
import { LearningModule } from '../src/grpc/learning.module';

import { IDS, newMemoryFixture } from './support/memdb';

const NOT_A_UUID = 'no-soy-un-uuid';
const MISSING_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Controlador cableado sobre una base en memoria. */
async function newController(): Promise<{ controller: LearningController; pool: Pool }> {
  const { pool } = newMemoryFixture();

  // Se sustituyen los DOS proveedores del módulo de base de datos. `PG_POOL` por la
  // base en memoria, y `CONFIG` porque Nest instancia los proveedores de los módulos
  // importados aunque nadie los pida: sin el reemplazo, `loadConfig()` correría y
  // fallaría por variables de entorno ausentes, con un error que no menciona la prueba.
  const moduleRef = await Test.createTestingModule({ imports: [LearningModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(CONFIG)
    .useValue({
      dbAddr: 'postgres://memoria',
      amqpAddr: 'amqp://memoria',
      grpcPort: '0',
      healthPort: 0,
      logLevel: 'silent',
      protoDir: '',
    })
    .compile();

  return { controller: moduleRef.get(LearningController), pool };
}

/** Extrae el código de estado de un `RpcException`. */
function codeOf(err: unknown): GrpcStatus | undefined {
  if (!(err instanceof RpcException)) {
    return undefined;
  }
  const error = err.getError();
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error.code as GrpcStatus)
    : undefined;
}

/**
 * Comprueba que la llamada falla con el código de estado esperado.
 *
 * El `fail` explícito importa: sin él, una llamada que devuelve en lugar de fallar
 * pasaría la prueba en silencio, y el caso de error dejaría de estar cubierto sin que
 * nadie lo notara.
 */
async function expectRpcCode(call: Promise<unknown>, expected: GrpcStatus): Promise<void> {
  try {
    await call;
  } catch (err) {
    expect(codeOf(err)).toBe(expected);
    return;
  }
  throw new Error(`se esperaba un fallo con código ${expected} y la llamada resolvió`);
}

// ── catálogo ───────────────────────────────────────────────────────────────

describe('LearningService.ListPublished', () => {
  it('responde con la forma del contrato', async () => {
    const { controller } = await newController();

    const response = await controller.listPublished({ category: '', page: undefined });

    expect(response.items[0]).toEqual({
      article_id: IDS.article,
      title: 'Ahorro para principiantes',
      category: 'ahorro',
      // El listado NO lleva cuerpo: devolverlo multiplicaría por cien el tamaño de una
      // página que solo muestra títulos.
      body: '',
      current_version_no: 3,
      quiz_ids: [],
    });
  });

  it('`total_size` sale como string porque es un int64', async () => {
    const { controller } = await newController();

    const response = await controller.listPublished({ category: '', page: undefined });

    // Un `int64` por encima de 2^53 no cabe en un `number` de JavaScript. Que salga
    // como número aquí funcionaría con un catálogo pequeño y perdería el total exacto
    // justo cuando importa.
    expect(typeof response.page?.total_size).toBe('string');
    expect(response.page?.total_size).toBe('1');
  });

  it('la última página no devuelve token de continuación', async () => {
    const { controller } = await newController();

    const response = await controller.listPublished({ category: '', page: undefined });

    // La cadena vacía es la señal de fin. Devolver siempre un token obligaría al
    // cliente a pedir una página más para descubrir que ya no hay nada.
    expect(response.page?.next_page_token).toBe('');
  });

  it('un page_token corrupto es INVALID_ARGUMENT, no la primera página', async () => {
    const { controller } = await newController();

    // Caer al principio en silencio haría que un cliente con el cursor roto recorriera
    // la primera página para siempre creyendo que avanza.
    await expectRpcCode(
      controller.listPublished({ category: '', page: { page_size: 10, page_token: 'xxx' } }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});

describe('LearningService.GetArticle', () => {
  it('devuelve cuerpo y cuestionarios', async () => {
    const { controller } = await newController();

    const article = await controller.getArticle({ article_id: IDS.article });

    expect(article.body).toBe('Cuerpo publicado');
    expect(article.quiz_ids).toEqual([IDS.quiz]);
  });

  it('un artículo en borrador responde NOT_FOUND', async () => {
    const { controller } = await newController();

    // NOT_FOUND y no PERMISSION_DENIED: distinguirlos delataría la existencia de
    // borradores a quien solo prueba identificadores.
    await expectRpcCode(
      controller.getArticle({ article_id: IDS.draftArticle }),
      GrpcStatus.NOT_FOUND,
    );
  });

  it('un id mal formado es INVALID_ARGUMENT y no un error interno', async () => {
    const { controller } = await newController();

    // Sin la validación previa, PostgreSQL respondería `invalid input syntax for type
    // uuid` y saldría como INTERNAL: un error del servidor por un dato del cliente.
    await expectRpcCode(
      controller.getArticle({ article_id: NOT_A_UUID }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});

// ── cuestionario ───────────────────────────────────────────────────────────

describe('LearningService.GetQuiz', () => {
  it('las opciones llevan clave y texto', async () => {
    const { controller } = await newController();

    const quiz = await controller.getQuiz({ quiz_id: IDS.quiz });

    // Sin la clave, `GradeRequest.answers` —que mapea `question_id -> option_key`— no
    // se podría construir: el cuestionario sería incontestable.
    expect(quiz.questions[0]?.options).toEqual([
      { key: 'a', text: 'Un ahorro para imprevistos' },
      { key: 'b', text: 'Una inversión de riesgo' },
    ]);
  });

  it('la respuesta correcta NO cruza la frontera', async () => {
    const { controller } = await newController();

    const quiz = await controller.getQuiz({ quiz_id: IDS.quiz });

    // Se comprueba sobre el JSON serializado: un campo añadido por descuido aparecería
    // aquí aunque el tipo del contrato no lo declare.
    //
    // Solo se busca `correct`, no el valor `"a"`: las CLAVES de las opciones sí tienen
    // que salir —son lo que el cliente devuelve en `answers`—, así que la letra correcta
    // aparece necesariamente entre ellas. Lo que no puede aparecer es CUÁL es.
    expect(JSON.stringify(quiz)).not.toContain('correct');
  });

  it('umbral y pesos salen como string decimal canónica', async () => {
    const { controller } = await newController();

    const quiz = await controller.getQuiz({ quiz_id: IDS.quiz });

    // Principio VIII: nunca un número JSON para un valor con escala.
    expect(quiz.pass_threshold).toBe('70');
    expect(typeof quiz.questions[1]?.weight).toBe('string');
    expect(quiz.questions[1]?.weight).toBe('3');
  });

  it('un cuestionario inexistente responde NOT_FOUND', async () => {
    const { controller } = await newController();

    await expectRpcCode(controller.getQuiz({ quiz_id: MISSING_UUID }), GrpcStatus.NOT_FOUND);
  });
});

// ── calificación ───────────────────────────────────────────────────────────

describe('LearningService.GradeAndStoreAttempt', () => {
  it('la calificación es ponderada y sale como string decimal', async () => {
    const { controller } = await newController();

    // Pesos 1 y 3: acertar solo la segunda son 3 de 4, exactamente 75,00. Con un
    // promedio simple saldría 50 — la diferencia es lo que distingue una ponderación
    // real de una que se perdió en un refactor.
    const response = await controller.gradeAndStoreAttempt({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      answers: { [IDS.questionB]: 'b' },
    });

    expect(response.score).toBe('75');
    expect(typeof response.score).toBe('string');
    expect(response.attempt_no).toBe(1);
    expect(response.passed).toBe(true);
  });

  it('una pregunta sin responder cuenta como incorrecta', async () => {
    const { controller } = await newController();

    const response = await controller.gradeAndStoreAttempt({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      answers: { [IDS.questionA]: 'a' },
    });

    // Excluir del denominador las preguntas en blanco convertiría dejarlas sin
    // responder en una estrategia: quien contestara solo la que sabe sacaría un 100.
    expect(response.score).toBe('25');
    expect(response.passed).toBe(false);
  });

  it('el intento se persiste aunque no apruebe', async () => {
    const { controller, pool } = await newController();

    await controller.gradeAndStoreAttempt({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      answers: {},
    });

    // FR-016: se guarda TODO intento. Filtrar los reprobados dejaría un historial que
    // no permite ver la propia progresión, que es para lo que existe.
    const stored = await pool.query('SELECT 1 FROM quiz_attempts WHERE user_id = $1', [IDS.user]);
    expect(stored.rowCount).toBe(1);
  });

  it('responder una pregunta de otro cuestionario es INVALID_ARGUMENT', async () => {
    const { controller } = await newController();

    // Ignorarla en silencio produciría una nota que el usuario no entiende y que nadie
    // puede explicar después.
    await expectRpcCode(
      controller.gradeAndStoreAttempt({
        user_id: IDS.user,
        quiz_id: IDS.quiz,
        answers: { [MISSING_UUID]: 'a' },
      }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});

describe('LearningService.ListAttempts', () => {
  it('devuelve el historial completo, del más reciente al más antiguo', async () => {
    const { controller } = await newController();
    const rounds: Record<string, string>[] = [
      {},
      { [IDS.questionB]: 'b' },
      { [IDS.questionA]: 'a' },
    ];
    for (const answers of rounds) {
      await controller.gradeAndStoreAttempt({
        user_id: IDS.user,
        quiz_id: IDS.quiz,
        answers,
      });
    }

    const response = await controller.listAttempts({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      page: undefined,
    });

    expect(response.items.map((a) => a.attempt_no)).toEqual([3, 2, 1]);
    expect(response.items.map((a) => a.score)).toEqual(['25', '75', '0']);
    expect(response.page?.total_size).toBe('3');
  });

  it('`created_at` sale en RFC-3339 UTC', async () => {
    const { controller } = await newController();
    await controller.gradeAndStoreAttempt({ user_id: IDS.user, quiz_id: IDS.quiz, answers: {} });

    const response = await controller.listAttempts({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      page: undefined,
    });

    // El contrato lo declara como RFC-3339 UTC. Una marca con desplazamiento local
    // haría que Auditoría y el frontend interpretaran la misma hora de forma distinta.
    expect(response.items[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it('el token de la página siguiente apunta al desplazamiento consumido', async () => {
    const { controller } = await newController();
    for (let i = 0; i < 3; i += 1) {
      await controller.gradeAndStoreAttempt({ user_id: IDS.user, quiz_id: IDS.quiz, answers: {} });
    }

    const first = await controller.listAttempts({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      page: { page_size: 2, page_token: '' },
    });

    expect(first.items).toHaveLength(2);
    expect(first.page?.next_page_token).toBe('2');
  });

  // `quiz_id` vacío lista TODOS los cuestionarios del usuario. Es lo que usa
  // `UsersService.GetActivityReport` (plan.md N-02) y `GET /me/data` del Gateway
  // (FR-029) para contar/leer sin conocer cada `quiz_id` de antemano.
  it('quiz_id vacío lista los intentos de todos los cuestionarios', async () => {
    const { controller } = await newController();
    await controller.gradeAndStoreAttempt({ user_id: IDS.user, quiz_id: IDS.quiz, answers: {} });

    const response = await controller.listAttempts({ user_id: IDS.user, quiz_id: '', page: undefined });

    expect(response.items).toHaveLength(1);
    expect(response.page?.total_size).toBe('1');
  });
});

// ── FR-030: paso de anonimización de Aprendizaje ────────────────────────────

describe('LearningService.AnonymizeAttempts', () => {
  it('acepta un user_id válido y no borra el historial', async () => {
    const { controller } = await newController();
    await controller.gradeAndStoreAttempt({ user_id: IDS.user, quiz_id: IDS.quiz, answers: {} });

    await expect(controller.anonymizeAttempts({ user_id: IDS.user })).resolves.toEqual({
      success: true,
      code: '',
      message: '',
    });

    // No-op deliberado (ver `GradingService.anonymizeAttempts`): el historial
    // sigue intacto, porque `quiz_attempts` no tiene PII que disociar.
    const response = await controller.listAttempts({
      user_id: IDS.user,
      quiz_id: IDS.quiz,
      page: undefined,
    });
    expect(response.items).toHaveLength(1);
  });

  it('rechaza un user_id que no es UUID', async () => {
    const { controller } = await newController();
    await expectRpcCode(controller.anonymizeAttempts({ user_id: NOT_A_UUID }), GrpcStatus.INVALID_ARGUMENT);
  });
});
