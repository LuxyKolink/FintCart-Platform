/**
 * Capa de aplicación del catálogo de categorías (Principio IX, FR-032…FR-035).
 *
 * Decide la política que PostgreSQL no alcanza a imponer solo. La unicidad de nombre
 * insensible a mayúsculas/tildes (FR-032) no cabe en un índice —el parcial de la
 * migración usa `lower(name)`, que no quita tildes—, de modo que el ALTA la comprueba
 * aquí contra el catálogo, igual que hizo la migración FR-036 al poblar. El
 * `categories.service` es además quien orquesta la desactivación con su evento
 * `category.deactivated` (T056): el repositorio ya rechazó si hay artículos publicados
 * (FR-035) y devolvió si hubo transición; este servicio publica el evento solo cuando
 * la hubo.
 *
 * Lo que NO hace: no conoce protobuf (`grpc/mapping.ts`) ni decide autorización — el
 * rol administrador lo impone el Gateway (FR-081, tasks T030/T057).
 */
import { Injectable } from '@nestjs/common';

import { conflict, invalidArgument, notFound } from '../common/errors';
import { EventsPublisher } from '../events/publisher';

import { CategoriesRepository } from './categories.repository';
import {
  normalizeNameKey,
  SLUG_FORMAT,
  slugFromName,
  type Category,
  type CategoryCreateInput,
  type CategoryUpdateInput,
} from './category.types';

/** Un UUID canónico en cualquiera de sus versiones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CategoriesService {
  public constructor(
    private readonly repository: CategoriesRepository,
    private readonly events: EventsPublisher,
  ) {}

  /** Catálogo; `includeInactive` solo lo usa la pantalla de administración. */
  public async list(includeInactive: boolean): Promise<Category[]> {
    return this.repository.list(includeInactive);
  }

  /**
   * Alta de una categoría (FR-033).
   *
   * `slug` vacío se deriva del nombre y queda fijo para siempre: no hay RPC de edición
   * de slug, porque reutilizar el de una categoría desactivada rompería cualquier ruta
   * histórica (ver `category.types.ts`).
   */
  public async create(input: CategoryCreateInput): Promise<Category> {
    const name = input.name.trim();
    const nameKey = normalizeNameKey(name);
    if (nameKey === '') {
      throw invalidArgument('name no puede estar vacío');
    }

    const slug = input.slug.trim() === '' ? slugFromName(name) : input.slug.trim();
    if (slug === '') {
      throw invalidArgument(`no se pudo derivar un identificador (slug) de «${name}»`);
    }
    if (!SLUG_FORMAT.test(slug)) {
      throw invalidArgument(
        `slug solo admite minúsculas y dígitos separados por guion: ${JSON.stringify(slug)}`,
      );
    }

    const catalog = await this.repository.list(true);
    const active = catalog.filter((category) => category.active);
    const occupiedName = active.find((category) => normalizeNameKey(category.name) === nameKey);
    if (occupiedName !== undefined) {
      throw conflict(`ya existe una categoría activa con el nombre «${occupiedName.name}»`);
    }
    if (catalog.some((category) => category.slug === slug)) {
      throw conflict(`ya existe una categoría con el identificador (slug) «${slug}»`);
    }

    // `position ≤ 0` ⇒ anexar al final de las activas: el administrador no cuenta
    // posiciones, y el campo `int32` de proto3 no distingue ausente de 0.
    const position = input.position > 0 ? input.position : nextPosition(active);
    if (active.some((category) => category.position === position)) {
      throw conflict(`la posición ${position} ya está en uso entre las categorías activas`);
    }

    return this.repository.create({ name, slug, description: input.description, position });
  }

  /**
   * Edición (FR-033). `position ≤ 0` deja el orden intacto (ver `categories.repository.ts`).
   */
  public async update(categoryId: string, input: CategoryUpdateInput): Promise<Category> {
    requireUuid('category_id', categoryId);
    const name = input.name.trim();
    if (normalizeNameKey(name) === '') {
      throw invalidArgument('name no puede estar vacío');
    }
    if (!Number.isInteger(input.position) || input.position < 0) {
      throw invalidArgument('position debe ser un entero no negativo');
    }
    return this.repository.update(categoryId, {
      name,
      description: input.description,
      position: input.position,
    });
  }

  /**
   * Desactivación LÓGICA (FR-035) + `category.deactivated` (T056).
   *
   * El evento se publica DESPUÉS de que la transacción del repositorio confirmó y solo
   * si hubo transición real — un `DELETE` repetido sobre una categoría ya inactiva es
   * un no-op y no debe auditarse dos veces. Sigue la regla de `approveAndPublish`:
   * publicar el evento solo tras confirmar la escritura que lo justifica.
   */
  public async deactivate(categoryId: string, actorId: string): Promise<void> {
    requireUuid('category_id', categoryId);
    requireUuid('actor_id', actorId);

    const result = await this.repository.deactivate(categoryId);
    if (result.changed) {
      await this.events.publishCategoryDeactivated(actorId, {
        category_ref: result.category.categoryId,
        slug: result.category.slug,
        actor_ref: actorId,
      });
    }
  }

  /**
   * Exige que la categoría exista y esté ACTIVA. Es la barrera de FR-034 que usa el
   * flujo editorial (`PublishingService.createDraft`) antes de crear un artículo nuevo.
   *
   * Una categoría desactivada deja de ofrecerse al editor (escenario 4 de US1); si un
   * cliente con una lista desactualizada la envía igualmente, la referencia se rechaza
   * aquí y no llega a escribirse.
   */
  public async assertActiveCategory(categoryId: string): Promise<void> {
    requireUuid('category_id', categoryId);
    const category = await this.repository.findById(categoryId);
    if (category === null) {
      throw notFound(`no existe la categoría ${categoryId}`);
    }
    if (!category.active) {
      throw invalidArgument(`la categoría «${category.name}» no está activa`);
    }
  }
}

function requireUuid(field: string, value: string): void {
  if (!UUID.test(value)) {
    throw invalidArgument(`${field} no es un UUID: ${JSON.stringify(value)}`);
  }
}

/** Siguiente posición libre: una más que la mayor de las activas, o 1 si no hay. */
function nextPosition(active: readonly Category[]): number {
  const max = active.reduce((highest, category) => Math.max(highest, category.position), 0);
  return max + 1;
}
