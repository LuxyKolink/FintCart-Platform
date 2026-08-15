/**
 * Prueba de CONTRATO gRPC del flujo editorial (T154, US4).
 *
 * Mismo motivo que `learning.contract.spec.ts`: comprueba la FRONTERA —nombres de
 * campo, tipos y código de estado por fallo— corriendo el grafo completo (controlador →
 * servicio → repositorio → SQL) contra `pg-mem`. La invariante de dominio
 * `approved_by ≠ created_by` tiene su propia prueba dedicada en `publishing.spec.ts`
 * (T155); aquí solo se comprueba que, cuando SÍ se cumple, la respuesta tiene la forma
 * que promete `learning.proto`.
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
const COORDINATOR = IDS.user;

async function newController(): Promise<{ controller: LearningController; pool: Pool }> {
  const { pool } = newMemoryFixture();

  const moduleRef = await Test.createTestingModule({ imports: [LearningModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(CONFIG)
    .useValue({
      dbAddr: 'postgres://memoria',
      // Puerto/host inexistentes a propósito: `EventsPublisher.publish` NUNCA debe
      // lanzar (ver la cabecera de `events/publisher.ts`), así que un broker
      // inalcanzable no puede hacer fallar `ApproveAndPublish` en esta prueba.
      amqpAddr: 'amqp://127.0.0.1:1',
      grpcPort: '0',
      healthPort: 0,
      logLevel: 'silent',
      protoDir: '',
    })
    .compile();

  return { controller: moduleRef.get(LearningController), pool };
}

function codeOf(err: unknown): GrpcStatus | undefined {
  if (!(err instanceof RpcException)) {
    return undefined;
  }
  const error = err.getError();
  return typeof error === 'object' && error !== null && 'code' in error ? (error.code as GrpcStatus) : undefined;
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

describe('LearningService.CreateDraft', () => {
  it('crea un artículo nuevo con su versión 1 en borrador (FR-007)', async () => {
    const { controller } = await newController();

    const version = await controller.createDraft({
      title: 'Presupuesto familiar',
      category: 'presupuesto',
      body: 'Cuerpo del borrador',
      editor_id: IDS.editor,
      article_id: '',
    });

    expect(version.version_no).toBe(1);
    expect(version.state).toBe('borrador');
    expect(version.created_by).toBe(IDS.editor);
    expect(version.approved_by).toBe('');
  });

  it('article_id relleno crea una nueva versión del artículo existente (FR-013)', async () => {
    const { controller } = await newController();

    const version = await controller.createDraft({
      title: '',
      category: '',
      body: 'Cuerpo revisado',
      editor_id: IDS.editor,
      article_id: IDS.article,
    });

    expect(version.article_id).toBe(IDS.article);
    // El fixture ya tiene la versión 3 publicada para IDS.article.
    expect(version.version_no).toBe(4);
  });

  it('rechaza un editor_id que no es un UUID', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.createDraft({ title: 't', category: 'c', body: 'b', editor_id: NOT_A_UUID, article_id: '' }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});

describe('LearningService.SubmitForReview → ApproveAndPublish', () => {
  it('publica y lo refleja en el catálogo', async () => {
    const { controller } = await newController();

    await controller.submitForReview({ version_id: IDS.draftVersion, actor_id: IDS.editor });
    const ack = await controller.approveAndPublish({
      version_id: IDS.draftVersion,
      coordinator_id: COORDINATOR,
    });

    expect(ack.success).toBe(true);

    const catalog = await controller.listPublished({ category: '', page: undefined });
    expect(catalog.items.some((a) => a.article_id === IDS.draftArticle)).toBe(true);
  });

  it('SubmitForReview de un id ajeno responde NOT_FOUND (FR-008: borrador visible solo a su editor)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.submitForReview({ version_id: IDS.draftVersion, actor_id: COORDINATOR }),
      GrpcStatus.NOT_FOUND,
    );
  });
});

describe('LearningService.ListVersions', () => {
  it('responde con la forma del contrato, incluidas las marcas temporales', async () => {
    const { controller } = await newController();

    const response = await controller.listVersions({
      article_id: IDS.article,
      state: '',
      editor_id: '',
      page: undefined,
    });

    expect(response.items).toHaveLength(1);
    const version = response.items[0];
    expect(version?.version_id).toBe(IDS.publishedVersion);
    expect(version?.state).toBe('publicado');
    expect(typeof version?.created_at).toBe('string');
    expect(version?.created_at).not.toBe('');
    expect(version?.published_at).not.toBe('');
  });
});

describe('LearningService.UpsertQuiz', () => {
  it('crea un cuestionario con sus preguntas, sin devolver la clave correcta (FR-009)', async () => {
    const { controller } = await newController();

    const quiz = await controller.upsertQuiz({
      quiz_id: '',
      article_id: IDS.article,
      title: 'Cuestionario nuevo',
      pass_threshold: '60.00',
      questions: [
        { prompt: '¿2+2?', options: { a: '3', b: '4' }, correct_key: 'b', weight: '1.00' },
      ],
    });

    expect(quiz.title).toBe('Cuestionario nuevo');
    // `format()` no conserva ceros finales (mismo comportamiento que el resto del
    // servicio — ver `learning.contract.spec.ts::GetQuiz`, que fija "70.00" → "70").
    expect(quiz.pass_threshold).toBe('60');
    expect(quiz.questions).toHaveLength(1);
    // Ninguna clave del contrato `Option`/`Question` puede llevar la respuesta
    // correcta — comprobado sobre el objeto serializado, no sobre un tipo que ya la
    // habría excluido en tiempo de compilación.
    expect(JSON.stringify(quiz)).not.toContain('correct_key');
  });

  it('rechaza una correct_key que no está entre las opciones', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.upsertQuiz({
        quiz_id: '',
        article_id: IDS.article,
        title: 't',
        pass_threshold: '60.00',
        questions: [{ prompt: 'p', options: { a: 'x', b: 'y' }, correct_key: 'z', weight: '1.00' }],
      }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});
