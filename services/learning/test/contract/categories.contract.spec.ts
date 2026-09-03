/**
 * Prueba de CONTRATO gRPC de las categorías (T049, FR-032…FR-035).
 *
 * Mismo motivo que `learning.contract.spec.ts`: comprueba la FRONTERA —nombres de
 * campo, tipos y código de estado por fallo— corriendo el grafo completo (controlador →
 * servicio → repositorio → SQL) contra `pg-mem`. Lo que rompería un refactor aquí es
 * que `categoryId` saliera como `category_id`, que un `conflict` de nombre se tradujera
 * como un código distinto de `FAILED_PRECONDITION`, o que el slug derivado llevara tilde.
 *
 * La única vía de administración es gRPC hacia Aprendizaje; el rol administrador lo
 * impone el Gateway ANTES de enrutar (FR-081, T030), así que este controlador no
 * conoce al actor: los métodos reciben `actor_id` en el mensaje y no lo usan.
 */
import { status as GrpcStatus } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';

import { CONFIG, PG_POOL } from '../../src/common/database.module';
import { CategoriesController } from '../../src/categories/categories.controller';
import { LearningModule } from '../../src/grpc/learning.module';

import { IDS, newMemoryFixture } from '../support/memdb';

const NOT_A_UUID = 'no-soy-un-uuid';
const MISSING_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Controlador de categorías cableado sobre una base en memoria. */
async function newController(): Promise<{ controller: CategoriesController; pool: Pool }> {
  const { pool } = newMemoryFixture();

  // Mismos reemplazos que `editorial.contract.spec.ts`: `PG_POOL` por la base en
  // memoria y `CONFIG` porque Nest instancia los proveedores de los módulos
  // importados. El `amqpAddr` inalcanzable es deliberado: `EventsPublisher.publish`
  // NUNCA lanza (ver su cabecera), así que publicar `category.deactivated` sin broker
  // no puede hacer fallar `DeactivateCategory` en esta prueba.
  const moduleRef = await Test.createTestingModule({ imports: [LearningModule] })
    .overrideProvider(PG_POOL)
    .useValue(pool)
    .overrideProvider(CONFIG)
    .useValue({
      dbAddr: 'postgres://memoria',
      amqpAddr: 'amqp://127.0.0.1:1',
      grpcPort: '0',
      healthPort: 0,
      logLevel: 'silent',
      protoDir: '',
    })
    .compile();

  return { controller: moduleRef.get(CategoriesController), pool };
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

/** Comprueba que la llamada falla con el código de estado esperado (ver `learning.contract.spec.ts`). */
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

describe('LearningService.ListCategories', () => {
  it('sin include_inactive responde solo las activas, con la forma exacta del contrato', async () => {
    const { controller } = await newController();

    const response = await controller.listCategories({ include_inactive: false });

    // toEqual y no toMatchObject: la forma EXACTA detecta un campo que se saliera con
    // nombre de dominio (`categoryId`) o un extra no declarado en el `.proto`.
    expect(response.items[0]).toEqual({
      category_id: IDS.categoryAhorro,
      name: 'ahorro',
      slug: 'ahorro',
      description: '',
      position: 1,
      active: true,
    });
    expect(response.items).toHaveLength(5);
  });

  it('con include_inactive incluye las desactivadas al final', async () => {
    const { controller } = await newController();

    const response = await controller.listCategories({ include_inactive: true });

    expect(response.items).toHaveLength(6);
    expect(response.items[response.items.length - 1]).toMatchObject({
      slug: 'ahorro-antiguo',
      active: false,
    });
  });
});

// ── alta ───────────────────────────────────────────────────────────────────

describe('LearningService.CreateCategory', () => {
  it('crea la categoría; slug vacío se deriva del nombre sin tildes', async () => {
    const { controller } = await newController();

    const created = await controller.createCategory({
      name: 'Jubilación',
      slug: '',
      description: 'A largo plazo',
      position: 0,
      actor_id: IDS.user,
    });

    // `category_id` es un UUID del servidor (gen_random_uuid): se comprueba la forma.
    expect(created.category_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created).toMatchObject({
      name: 'Jubilación',
      // El slug cruza la frontera SIN la tilde y en minúsculas.
      slug: 'jubilacion',
      description: 'A largo plazo',
      active: true,
    });
    // position 0 ⇒ anexada al final de las activas.
    expect(created.position).toBe(6);
  });

  it('rechaza un nombre en blanco (INVALID_ARGUMENT)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.createCategory({ name: '   ', slug: '', description: '', position: 0, actor_id: IDS.user }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });

  it('rechaza un slug fuera del formato (INVALID_ARGUMENT)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.createCategory({ name: 'x', slug: 'No-Válido', description: '', position: 0, actor_id: IDS.user }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });

  it('rechaza un nombre que ya está activo sin tildes ni mayúsculas (FAILED_PRECONDITION)', async () => {
    const { controller } = await newController();

    // La activa del fixture se llama «ahorro»: «Ahorro» colapsa a la misma clave.
    await expectRpcCode(
      controller.createCategory({ name: 'Ahorro', slug: '', description: '', position: 0, actor_id: IDS.user }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('rechaza un slug ya usado aunque la categoría esté INACTIVA (FAILED_PRECONDITION)', async () => {
    const { controller } = await newController();

    // «ahorro antiguo» está desactivada en el fixture, pero su slug sigue reservado:
    // reutilizarlo rompería cualquier ruta histórica (ver `category.types.ts`).
    await expectRpcCode(
      controller.createCategory({ name: 'ahorro antiguo', slug: '', description: '', position: 0, actor_id: IDS.user }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('rechaza una posición ya ocupada entre las activas (FAILED_PRECONDITION)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.createCategory({ name: 'Nueva', slug: 'nueva', description: '', position: 1, actor_id: IDS.user }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });
});

// ── edición ────────────────────────────────────────────────────────────────

describe('LearningService.UpdateCategory', () => {
  it('renombra y el cambio se refleja en el catálogo', async () => {
    const { controller } = await newController();

    const updated = await controller.updateCategory({
      category_id: IDS.categoryCredito,
      name: 'Tarjetas',
      description: 'Crédito y débito',
      position: 0,
      actor_id: IDS.user,
    });

    expect(updated).toMatchObject({ category_id: IDS.categoryCredito, name: 'Tarjetas' });

    const list = await controller.listCategories({ include_inactive: false });
    expect(list.items.find((category) => category.category_id === IDS.categoryCredito)).toMatchObject({
      name: 'Tarjetas',
    });
  });

  it('mover a la posición de otra activa INTERCAMBIA las dos posiciones', async () => {
    const { controller } = await newController();

    await controller.updateCategory({
      category_id: IDS.categoryCredito,
      name: 'credito',
      description: '',
      position: 1,
      actor_id: IDS.user,
    });

    const list = await controller.listCategories({ include_inactive: false });
    const positionOf = (id: string): number | undefined =>
      list.items.find((category) => category.category_id === id)?.position;
    expect(positionOf(IDS.categoryCredito)).toBe(1);
    expect(positionOf(IDS.categoryAhorro)).toBe(2);
  });

  it('rechaza editar una categoría inactiva (FAILED_PRECONDITION)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.updateCategory({
        category_id: IDS.categoryInactive,
        name: 'x',
        description: '',
        position: 0,
        actor_id: IDS.user,
      }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('rechaza una categoría inexistente (NOT_FOUND)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.updateCategory({
        category_id: MISSING_UUID,
        name: 'x',
        description: '',
        position: 0,
        actor_id: IDS.user,
      }),
      GrpcStatus.NOT_FOUND,
    );
  });
});

// ── desactivación ──────────────────────────────────────────────────────────

describe('LearningService.DeactivateCategory', () => {
  it('rechaza con FAILED_PRECONDITION si la categoría tiene artículos publicados (FR-035)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.deactivateCategory({ category_id: IDS.categoryAhorro, actor_id: IDS.user }),
      GrpcStatus.FAILED_PRECONDITION,
    );
  });

  it('desactiva una categoría sin artículos publicados y la saca de la vista pública', async () => {
    const { controller } = await newController();

    const result = await controller.deactivateCategory({ category_id: IDS.categoryCredito, actor_id: IDS.user });

    // `category.deactivated` se publicó (a un broker inalcanzable que no lanza) y la
    // operación responde éxito: el evento nunca debe hacer fallar la desactivación.
    expect(result).toEqual({ success: true, code: '', message: '' });

    const publicList = await controller.listCategories({ include_inactive: false });
    expect(publicList.items.find((category) => category.category_id === IDS.categoryCredito)).toBeUndefined();
    const fullList = await controller.listCategories({ include_inactive: true });
    expect(fullList.items.find((category) => category.category_id === IDS.categoryCredito)).toMatchObject({
      active: false,
    });
  });

  it('desactivar una categoría ya inactiva es un no-op que responde éxito', async () => {
    const { controller } = await newController();

    await expect(
      controller.deactivateCategory({ category_id: IDS.categoryInactive, actor_id: IDS.user }),
    ).resolves.toEqual({ success: true, code: '', message: '' });
  });

  it('rechaza un category_id que no es un UUID (INVALID_ARGUMENT)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.deactivateCategory({ category_id: NOT_A_UUID, actor_id: IDS.user }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });

  it('rechaza un actor_id que no es un UUID (INVALID_ARGUMENT)', async () => {
    const { controller } = await newController();

    await expectRpcCode(
      controller.deactivateCategory({ category_id: IDS.categoryCredito, actor_id: NOT_A_UUID }),
      GrpcStatus.INVALID_ARGUMENT,
    );
  });
});
