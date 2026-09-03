/**
 * Capa de TRANSPORTE del catálogo de categorías (Principio IX, FR-032…FR-035).
 *
 * Espejo de `grpc/learning.controller.ts`: recibe el mensaje, extrae campos, llama al
 * servicio, convierte con `mapping.ts` y traduce el error con `codeOf`/`clientMessage`
 * (compartidos desde `common/rpc-errors.ts`). No decide políticas y no conoce el rol
 * del llamador: el Gateway lo verifica antes de enrutar (FR-081).
 */
import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { JsonLogger } from '../common/observability';
import { codeOf, clientMessage } from '../common/rpc-errors';
import { messageOf } from '../common/errors';
import type { OpResult as OpResultPb } from '../pb/fintcart/common/v1/common';
import type {
  Category as CategoryPb,
  CategoryRef,
  CreateCategoryRequest,
  ListCategoriesRequest,
  ListCategoriesResponse as ListCategoriesResponsePb,
  UpdateCategoryRequest,
} from '../pb/fintcart/learning/v1/learning';

import { categoryToPb, okResult } from '../grpc/mapping';
import { CategoriesService } from './categories.service';

/** Nombre del servicio en el contrato; debe coincidir con el `.proto`. */
const SERVICE = 'LearningService';

@Controller()
export class CategoriesController {
  private readonly logger = new JsonLogger();

  public constructor(private readonly categories: CategoriesService) {}

  @GrpcMethod(SERVICE, 'ListCategories')
  public async listCategories(request: ListCategoriesRequest): Promise<ListCategoriesResponsePb> {
    return this.guard('ListCategories', async () => {
      const items = await this.categories.list(request.include_inactive ?? false);
      return { items: items.map(categoryToPb) };
    });
  }

  @GrpcMethod(SERVICE, 'CreateCategory')
  public async createCategory(request: CreateCategoryRequest): Promise<CategoryPb> {
    return this.guard('CreateCategory', async () =>
      categoryToPb(
        await this.categories.create({
          name: request.name ?? '',
          slug: request.slug ?? '',
          description: request.description ?? '',
          position: request.position ?? 0,
        }),
      ),
    );
  }

  @GrpcMethod(SERVICE, 'UpdateCategory')
  public async updateCategory(request: UpdateCategoryRequest): Promise<CategoryPb> {
    return this.guard('UpdateCategory', async () =>
      categoryToPb(
        await this.categories.update(request.category_id ?? '', {
          name: request.name ?? '',
          description: request.description ?? '',
          position: request.position ?? 0,
        }),
      ),
    );
  }

  @GrpcMethod(SERVICE, 'DeactivateCategory')
  public async deactivateCategory(request: CategoryRef): Promise<OpResultPb> {
    return this.guard('DeactivateCategory', async () => {
      await this.categories.deactivate(request.category_id ?? '', request.actor_id ?? '');
      return okResult();
    });
  }

  /** Traduce cualquier error de dominio a un estado gRPC (ver `learning.controller.ts`). */
  private async guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      this.logger.error(`${operation} falló: ${messageOf(err)}`, operation);
      throw new RpcException({ code: codeOf(err), message: clientMessage(err) });
    }
  }
}
