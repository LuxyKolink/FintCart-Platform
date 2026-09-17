/**
 * Pruebas del rechazo de calificación fuera de la sesión (T063, FR-040/FR-042).
 *
 * La calificación dejó de aceptar respuestas sueltas: solo califica contra una sesión
 * emitida, vigente y sin consumir. Estos casos —pregunta no servida, sesión vencida,
 * sesión ya consumida y sesión ajena— deben fallar con `FAILED_PRECONDITION` (que el
 * borde presenta como 409) en vez de calificar.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { resolve } from 'node:path';

import type { Pool } from 'pg';

import { CONFIG, PG_POOL } from '../../src/common/database.module';
import { LearningController } from '../../src/grpc/learning.controller';
import { LearningModule } from '../../src/grpc/learning.module';

// Los `.proto` los carga el cliente gRPC del Simulador al construir el módulo (T151): la ruta se
// resuelve desde la raíz del servicio, que es donde el contenedor los copia (`PROTO_DIR`).
const SIMULADOR_PROTO_DIR = resolve(__dirname, '../../contracts', 'proto');

import { IDS, newMemoryFixture } from '../support/memdb';

const MISSING_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function newController(): Promise<{ controller: LearningController; pool: Pool }> {
  const { pool } = newMemoryFixture();
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
      // La dirección y los `.proto` del Simulador son reales porque `SimulatorModule` construye
      // su cliente gRPC al arrancar el módulo, y ese cliente CARGA el `.proto` al construirse: un
      // `protoDir` vacío hacía fallar estas pruebas con «file at fintcart/simulator/v1/… not found».
      // El puerto es el del propio `ClientGrpc` y no una carpeta de pruebas, y el servicio no está
      // levantado: `PublishedCalculators` solo se consulta cuando el documento incrusta una
      // calculadora, y ningún caso de estas suites lo hace.
      simulatorSvcAddr: '127.0.0.1:1',
      protoDir: SIMULADOR_PROTO_DIR,
    })
    .compile();
  return { controller: moduleRef.get(LearningController), pool };
}

function codeOf(err: unknown): GrpcStatus | undefined {
  if (!(err instanceof RpcException)) {
    return undefined;
  }
  const error = err.getError();
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error.code as GrpcStatus)
    : undefined;
}

async function expectRpcCode(call: Promise<unknown>, expected: GrpcStatus): Promise<void> {
  try {
    await call;
  } catch (err) {
    expect(codeOf(err)).toBe(expected);
    return;
  }
  throw new Error(`se esperaba un fallo con código ${expected} y la llamada resolvió`);
}

/** Inicia una sesión sobre el cuestionario del fixture (que sirve sus dos preguntas). */
async function startSession(controller: LearningController): Promise<string> {
  const session = await controller.startQuizSession({ user_id: IDS.user, quiz_id: IDS.quiz });
  return session.session_id;
}

function gradeReq(sessionId: string, userID: string, answers: Record<string, string>) {
  return {
    user_id: userID,
    quiz_id: IDS.quiz,
    session_id: sessionId,
    answers,
    idempotency_key: '',
  };
}

describe('GradingService: rechazo fuera de la sesión (FR-040/FR-042)', () => {
  it('una pregunta no servida es FAILED_PRECONDITION', async () => {
    const { controller } = await newController();
    const sessionId = await startSession(controller);

    await expectRpcCode(
      controller.gradeAndStoreAttempt(gradeReq(sessionId, IDS.user, { [MISSING_UUID]: 'a' })),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('una sesión vencida es FAILED_PRECONDITION', async () => {
    const { controller, pool } = await newController();
    const sessionId = await startSession(controller);

    await pool.query(`UPDATE quiz_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE id = $1`, [
      sessionId,
    ]);

    await expectRpcCode(
      controller.gradeAndStoreAttempt(gradeReq(sessionId, IDS.user, { [IDS.questionA]: 'a' })),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('una sesión ya consumida es FAILED_PRECONDITION (FR-042)', async () => {
    const { controller } = await newController();
    const sessionId = await startSession(controller);

    // La primera calificación consume la sesión.
    await controller.gradeAndStoreAttempt(gradeReq(sessionId, IDS.user, { [IDS.questionA]: 'a' }));
    // La segunda, con la misma sesión, ya no puede calificar.
    await expectRpcCode(
      controller.gradeAndStoreAttempt(gradeReq(sessionId, IDS.user, { [IDS.questionA]: 'a' })),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('una sesión ajena al usuario es FAILED_PRECONDITION', async () => {
    const { controller } = await newController();
    const sessionId = await startSession(controller);

    await expectRpcCode(
      controller.gradeAndStoreAttempt(gradeReq(sessionId, MISSING_UUID, { [IDS.questionA]: 'a' })),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });
});
