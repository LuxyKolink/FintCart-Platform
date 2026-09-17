/**
 * Prueba de CONTRATO gRPC de `LearningService.StartQuizSession` (T061, FR-038).
 *
 * Comprueba la FRONTERA del RPC nuevo de US2: que la sesión devuelve exactamente
 * `questions_to_serve` preguntas, SIN la clave correcta, y con `session_id` y
 * `expires_at`. Corre por el grafo completo (controlador → servicio → repositorio →
 * SQL) con `pg-mem` debajo, igual que `learning.contract.spec.ts`.
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

const NOT_A_UUID = 'no-soy-un-uuid';
const MISSING_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Controlador cableado sobre una base en memoria. */
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

describe('LearningService.StartQuizSession', () => {
  it('devuelve exactamente questions_to_serve preguntas y sin la clave correcta (T061)', async () => {
    const { controller } = await newController();

    const quiz = await controller.upsertQuiz({
      quiz_id: '',
      article_id: IDS.article,
      title: 'Banco grande',
      pass_threshold: '60',
      questions_to_serve: 2,
      questions: [
        { prompt: 'P1', options: { a: 'A', b: 'B' }, correct_key: 'a', weight: '1' },
        { prompt: 'P2', options: { a: 'A', b: 'B' }, correct_key: 'a', weight: '1' },
        { prompt: 'P3', options: { a: 'A', b: 'B' }, correct_key: 'a', weight: '1' },
        { prompt: 'P4', options: { a: 'A', b: 'B' }, correct_key: 'a', weight: '1' },
      ],
    });

    const session = await controller.startQuizSession({ user_id: IDS.user, quiz_id: quiz.quiz_id });

    expect(session.questions).toHaveLength(2);
    expect(session.session_id).toBeTruthy();
    expect(session.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    expect(session.title).toBe('Banco grande');
    expect(session.pass_threshold).toBe('60');
    // Sin clave correcta: comprobado sobre el JSON serializado, no sobre un tipo que ya
    // la habría excluido en tiempo de compilación.
    expect(JSON.stringify(session)).not.toContain('correct_key');
    expect(JSON.stringify(session)).not.toContain('correct');
  });

  it('un cuestionario inexistente responde NOT_FOUND', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.startQuizSession({ user_id: IDS.user, quiz_id: MISSING_UUID }),
      GrpcStatus.NOT_FOUND,
    );
  });

  it('un id mal formado responde INVALID_ARGUMENT', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.startQuizSession({ user_id: IDS.user, quiz_id: NOT_A_UUID }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});
