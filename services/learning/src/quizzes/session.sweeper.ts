/**
 * Barrido periódico de sesiones de cuestionario vencidas (D-17, T071).
 *
 * La sesión caduca a los 60 minutos y el calificador YA rechaza una sesión vencida al
 * usarla; el barrido no añade corrección, añade higiene: sin él, `quiz_sessions`
 * crecería sin cota con filas que nadie volverá a leer. Es estado de Aprendizaje y lo
 * limpia Aprendizaje, en su propio proceso — no el Orquestador, que solo secuencia
 * sagas entre servicios (Principio VI).
 *
 * Corre en un `setInterval` y NO es crítico: si una pasada falla, la siguiente lo
 * reintenta. Por eso el error se registra y se deja pasar, en lugar de derribar el
 * proceso.
 */
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import type { Config } from '../common/config';
import { CONFIG } from '../common/database.module';
import { messageOf } from '../common/errors';
import { JsonLogger } from '../common/observability';
import { SessionsRepository } from './sessions.repository';

@Injectable()
export class SessionSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new JsonLogger();
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    @Inject(CONFIG) private readonly config: Config,
    private readonly sessions: SessionsRepository,
  ) {}

  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.config.sessionSweepIntervalMs);
  }

  public onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async sweep(): Promise<void> {
    try {
      const purged = await this.sessions.sweepExpired();
      if (purged > 0) {
        this.logger.log(`${purged} sesión(es) vencida(s) eliminadas`, 'SessionSweeper');
      }
    } catch (err) {
      this.logger.error(`barrido de sesiones falló: ${messageOf(err)}`, 'SessionSweeper');
    }
  }
}
