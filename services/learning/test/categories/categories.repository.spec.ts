/**
 * Pruebas de persistencia del catálogo de categorías (T050, FR-032…FR-035).
 *
 * Corren contra `pg-mem`, igual que `publishing.repository.spec.ts`: lo que puede
 * romperse aquí es el SQL emitido —el recuento de FR-035, el `FOR UPDATE` que blinda la
 * transacción, el intercambio de posición— y `pg-mem` lo EJECUTA en vez de devolver
 * filas preparadas. El «driver simulado» de la tarea es la base en memoria de
 * `support/memdb.ts`, que además aporta el mapeo real fila → dominio (`rowToCategory`).
 *
 * Lo que se fija:
 *
 * - `list` tiene dos ramas SQL (vista pública vs. administración) y el orden correcto.
 * - `create`/`update` devuelven la categoría mapeada, no la fila cruda.
 * - El intercambio de posición al reordenar escribe las DOS posiciones en la MISMA
 *   transacción (ver la cabecera de `categories.repository.ts`).
 * - FR-035: desactivar con artículos publicados rechaza con el recuento en el mensaje
 *   (singular/plural), y el rechazo REVIERTE la transacción — la categoría sigue activa.
 */
import type { Pool } from 'pg';
import type { IMemoryDb } from 'pg-mem';

import { CategoriesRepository } from '../../src/categories/categories.repository';

import { IDS, newMemoryFixture } from '../support/memdb';

function newFixture(): { db: IMemoryDb; pool: Pool; repo: CategoriesRepository } {
  const { db, pool } = newMemoryFixture();
  return { db, pool, repo: new CategoriesRepository(pool) };
}

describe('CategoriesRepository.list', () => {
  it('vista pública: solo activas, ordenadas por posición', async () => {
    const { repo } = newFixture();

    const items = await repo.list(false);

    // El fixture de `memdb.ts` tiene 5 activas (la inactiva «ahorro antiguo» NO sale).
    expect(items).toHaveLength(5);
    expect(items.map((category) => category.position)).toEqual([1, 2, 3, 4, 5]);
    expect(items.map((category) => category.slug)).toEqual([
      'ahorro',
      'credito',
      'presupuesto',
      'inversion',
      'seguridad-financiera',
    ]);
  });

  it('administración: activas primero y las inactivas después, cada grupo por posición', async () => {
    const { repo } = newFixture();

    const items = await repo.list(true);

    expect(items).toHaveLength(6);
    // La inactiva (position 1) NO se intercala con las activas: va al final del grupo.
    const last = items[items.length - 1];
    expect(last?.active).toBe(false);
    expect(last?.name).toBe('ahorro antiguo');
    // Las primeras 5 siguen el orden de la vista pública.
    expect(items.slice(0, 5).map((category) => category.active)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});

describe('CategoriesRepository.findById', () => {
  it('devuelve la categoría mapeada (id → categoryId) o null si no existe', async () => {
    const { repo } = newFixture();

    const found = await repo.findById(IDS.categoryAhorro);
    expect(found).toMatchObject({
      categoryId: IDS.categoryAhorro,
      name: 'ahorro',
      slug: 'ahorro',
      position: 1,
      active: true,
    });
    expect(found?.description).toBeDefined();

    expect(await repo.findById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBeNull();
  });
});

describe('CategoriesRepository.create', () => {
  it('inserta y devuelve la categoría mapeada', async () => {
    const { repo } = newFixture();

    const created = await repo.create({ name: 'Jubilación', slug: 'jubilacion', description: 'A largo plazo', position: 6 });

    expect(created.categoryId).toBeTruthy();
    expect(created).toMatchObject({
      name: 'Jubilación',
      slug: 'jubilacion',
      description: 'A largo plazo',
      position: 6,
      active: true,
    });
  });
});

describe('CategoriesRepository.update', () => {
  it('renombra y devuelve la categoría mapeada', async () => {
    const { repo } = newFixture();

    const updated = await repo.update(IDS.categoryCredito, {
      name: 'Tarjetas',
      description: 'Crédito y débito',
      position: 0, // ≤ 0 ⇒ «no toques la posición».
    });

    expect(updated).toMatchObject({ categoryId: IDS.categoryCredito, name: 'Tarjetas', position: 2 });
    // La posición NO cambió al pasar 0.
    expect(updated.position).toBe(2);
  });

  it('rechaza un nombre que choca con otra activa sin tildes ni mayúsculas (FR-032)', async () => {
    const { repo } = newFixture();

    // «Ahorro» colapsa con la activa existente «ahorro» (memdb) aunque el nombre cambie
    // de caja. La comprobación vive en la transacción (repo.update), no en el servicio.
    const call = repo.update(IDS.categoryCredito, { name: 'Ahorro', description: '', position: 0 });

    await expect(call).rejects.toMatchObject({ code: 'conflict' });
    // El mensaje cita la categoría ACTIVA que ya ocupa el nombre («ahorro», minúscula).
    await expect(call).rejects.toThrow('«ahorro»');
  });

  it('mover a la posición ocupada por otra activa INTERCAMBIA las dos (una sola transacción)', async () => {
    const { repo } = newFixture();

    // «credito» está en 2; pedirle la posición 1 intercambia con «ahorro».
    await repo.update(IDS.categoryCredito, { name: 'credito', description: '', position: 1 });

    expect(await repo.findById(IDS.categoryCredito)).toMatchObject({ position: 1 });
    expect(await repo.findById(IDS.categoryAhorro)).toMatchObject({ position: 2 });
  });

  it('rechaza editar una categoría inactiva', async () => {
    const { repo } = newFixture();

    await expect(
      repo.update(IDS.categoryInactive, { name: 'x', description: '', position: 0 }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rechaza un identificador inexistente', async () => {
    const { repo } = newFixture();

    await expect(
      repo.update('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { name: 'x', description: '', position: 0 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('CategoriesRepository.deactivate (FR-035)', () => {
  it('desactiva una categoría sin artículos publicados y devuelve la transición', async () => {
    const { repo } = newFixture();

    const result = await repo.deactivate(IDS.categoryCredito);

    expect(result.changed).toBe(true);
    expect(result.category).toMatchObject({ categoryId: IDS.categoryCredito, active: false });
  });

  it('desactivar una categoría YA inactiva es un no-op sin transición', async () => {
    const { repo } = newFixture();

    const result = await repo.deactivate(IDS.categoryInactive);

    expect(result.changed).toBe(false);
    expect(result.category.active).toBe(false);
  });

  it('rechaza con el recuento si hay artículos publicados (el borrador NO cuenta) y revierte', async () => {
    const { repo } = newFixture();

    // `IDS.categoryAhorro` tiene dos artículos (publicado y borrador), pero solo el
    // publicado tiene `current_version_id` en estado 'publicado': el recuento es 1.
    const call = repo.deactivate(IDS.categoryAhorro);

    await expect(call).rejects.toMatchObject({ code: 'conflict' });
    // Singular, no «1 artículos publicados».
    await expect(call).rejects.toThrow('tiene 1 artículo publicado');

    // El rechazo REVIERTE la transacción: la categoría sigue activa.
    expect(await repo.findById(IDS.categoryAhorro)).toMatchObject({ active: true });
  });
});
