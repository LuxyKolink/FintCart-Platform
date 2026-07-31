/**
 * Módulo que ensambla la superficie gRPC del servicio.
 *
 * Declara el grafo `repositorio → servicio → controlador` en un solo sitio, que es lo
 * que permite que ninguna de las tres capas construya a la de abajo: todas reciben sus
 * dependencias por constructor y `main.ts` no nombra a ninguna.
 */
import { Module } from '@nestjs/common';

import { DatabaseModule } from '../common/database.module';
import { ArticlesRepository } from '../articles/articles.repository';
import { ArticlesService } from '../articles/articles.service';
import { GradingService } from '../grading/grading.service';
import { QuizzesRepository } from '../quizzes/quizzes.repository';
import { QuizzesService } from '../quizzes/quizzes.service';

import { LearningController } from './learning.controller';

@Module({
  // `DatabaseModule` se importa AQUÍ y no solo en el módulo raíz. Nest resuelve por
  // módulo, no globalmente: sin esta línea, `PG_POOL` no es visible para los
  // repositorios aunque el raíz lo importe, y el proceso falla al construir el
  // contenedor con un mensaje que señala al repositorio y no a la importación que
  // falta.
  imports: [DatabaseModule],
  controllers: [LearningController],
  providers: [
    ArticlesRepository,
    ArticlesService,
    QuizzesRepository,
    QuizzesService,
    GradingService,
  ],
})
export class LearningModule {}
