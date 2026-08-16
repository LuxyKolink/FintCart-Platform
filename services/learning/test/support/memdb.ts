/**
 * PostgreSQL en memoria para las pruebas del Servicio de Aprendizaje.
 *
 * `pg-mem` EJECUTA el SQL de verdad. La alternativa —un doble del driver que devuelve
 * filas preparadas— comprobaría que se llamó a `query` con cierta cadena, que es justo
 * lo que no importa: lo que puede romperse es el propio SQL, y un doble lo daría
 * siempre por bueno.
 *
 * Vive en `support/` y no en un `.spec.ts` porque lo comparten la prueba de
 * persistencia y la de contrato: dos copias del esquema divergirían, y la que se
 * quedara atrás dejaría de comprobar lo que cree comprobar.
 */
import { randomUUID } from 'node:crypto';

import Decimal from 'decimal.js';
import type { Pool } from 'pg';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

/**
 * Esquema equivalente al de `migrations/`.
 *
 * Se declara aquí en lugar de cargar el fichero de migración porque `pg-mem` no
 * implementa índices parciales ni algunas constraints del original. Lo que sí se
 * conserva es todo lo que las pruebas ejercitan: las columnas, sus tipos `NUMERIC`,
 * las claves ajenas y el `UNIQUE (user_id, quiz_id, attempt_no)` del que depende el
 * cálculo de `attempt_no`.
 */
const SCHEMA = `
CREATE TABLE articles (
    id UUID PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    current_version_id UUID,
    author_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE article_versions (
    id UUID PRIMARY KEY,
    article_id UUID NOT NULL REFERENCES articles (id),
    version_no INTEGER NOT NULL,
    body TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'borrador',
    created_by UUID NOT NULL,
    approved_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ
);
CREATE TABLE quizzes (
    id UUID PRIMARY KEY,
    article_id UUID NOT NULL REFERENCES articles (id),
    title TEXT NOT NULL,
    pass_threshold NUMERIC(6,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE questions (
    id UUID PRIMARY KEY,
    quiz_id UUID NOT NULL REFERENCES quizzes (id),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_key TEXT NOT NULL,
    weight NUMERIC(6,2) NOT NULL,
    position INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    quiz_id UUID NOT NULL REFERENCES quizzes (id),
    attempt_no INTEGER NOT NULL,
    score NUMERIC(6,2) NOT NULL,
    answers JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key TEXT,
    UNIQUE (user_id, quiz_id, attempt_no),
    -- Igual que en la migración real (T176): un UNIQUE estándar no trata dos NULL
    -- como iguales, así que las llamadas sin clave (la mayoría de las pruebas)
    -- conviven sin conflicto sin necesitar un índice parcial.
    UNIQUE (idempotency_key)
);
CREATE TABLE article_stats (
    article_id UUID PRIMARY KEY REFERENCES articles (id),
    view_count BIGINT NOT NULL DEFAULT 0,
    attempt_count BIGINT NOT NULL DEFAULT 0,
    avg_score NUMERIC(6,2) NOT NULL DEFAULT 0
);
`;

/** Identificadores fijos del juego de datos. */
export const IDS = {
  article: '11111111-1111-4111-8111-111111111111',
  draftArticle: '22222222-2222-4222-8222-222222222222',
  quiz: '33333333-3333-4333-8333-333333333333',
  questionA: '44444444-4444-4444-8444-444444444444',
  questionB: '55555555-5555-4555-8555-555555555555',
  user: '66666666-6666-4666-8666-666666666666',
  editor: '77777777-7777-4777-8777-777777777777',
  publishedVersion: '88888888-8888-4888-8888-888888888888',
  draftVersion: '99999999-9999-4999-8999-999999999999',
} as const;

/** Base en memoria con el esquema y el juego de datos. */
export interface MemoryFixture {
  readonly db: IMemoryDb;
  readonly pool: Pool;
}

/**
 * Crea una base nueva por prueba.
 *
 * Una base por prueba y no una compartida: las pruebas corren en paralelo dentro del
 * fichero y un intento insertado por una haría fallar el conteo de otra, con un error
 * que depende del orden de ejecución y no se reproduce dos veces igual.
 */
export function newMemoryFixture(): MemoryFixture {
  const db = newDb();

  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    // `impure` es obligatorio: sin él, `pg-mem` da la función por determinista y
    // reutiliza el mismo UUID en cada INSERT, que falla por clave primaria duplicada.
    // El error apunta a la tabla y no a su causa.
    impure: true,
  });

  // `pg-mem` no implementa `round(numeric, int)`. Se registra con redondeo half-even,
  // el mismo que aplica PostgreSQL a `NUMERIC` y el único permitido para valores
  // financieros (research D-14): un `Math.round` haría que la prueba del promedio
  // pasara con un redondeo distinto del de producción.
  db.public.registerFunction({
    name: 'round',
    args: [DataType.float, DataType.integer],
    returns: DataType.float,
    implementation: (value: number, scale: number) =>
      new Decimal(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_EVEN).toNumber(),
  });

  db.public.none(SCHEMA);
  seed(db);

  const { Pool: MemPool } = db.adapters.createPg() as { Pool: new () => Pool };
  return { db, pool: new MemPool() };
}

/**
 * Un artículo publicado con cuestionario, y otro que sigue en borrador.
 *
 * El borrador está para que TODA prueba de lectura pueda comprobar que no se filtra:
 * un catálogo que expone contenido sin revisar es un fallo de FR-008, no un detalle.
 *
 * Los pesos son 1 y 3 a propósito: suman 4, así que acertar solo la segunda da
 * exactamente 75,00 y acertar solo la primera 25,00 — dos valores que distinguen un
 * promedio ponderado de uno simple.
 */
function seed(db: IMemoryDb): void {
  db.public.none(`
    INSERT INTO articles (id, title, category, author_id)
    VALUES ('${IDS.article}', 'Ahorro para principiantes', 'ahorro', '${IDS.editor}'),
           ('${IDS.draftArticle}', 'Borrador sin revisar', 'ahorro', '${IDS.editor}');

    INSERT INTO article_versions (id, article_id, version_no, body, state, created_by, approved_by, published_at)
    VALUES ('${IDS.publishedVersion}', '${IDS.article}', 3, 'Cuerpo publicado', 'publicado', '${IDS.editor}', '${IDS.user}', now()),
           ('${IDS.draftVersion}', '${IDS.draftArticle}', 1, 'Cuerpo en borrador', 'borrador', '${IDS.editor}', NULL, NULL);

    UPDATE articles SET current_version_id = '${IDS.publishedVersion}' WHERE id = '${IDS.article}';
    UPDATE articles SET current_version_id = '${IDS.draftVersion}' WHERE id = '${IDS.draftArticle}';

    INSERT INTO quizzes (id, article_id, title, pass_threshold)
    VALUES ('${IDS.quiz}', '${IDS.article}', 'Cuestionario de ahorro', 70.00);

    INSERT INTO questions (id, quiz_id, prompt, options, correct_key, weight, position)
    VALUES ('${IDS.questionA}', '${IDS.quiz}', '¿Qué es un fondo de emergencia?',
            '{"b": "Una inversión de riesgo", "a": "Un ahorro para imprevistos"}'::jsonb, 'a', 1.00, 1),
           ('${IDS.questionB}', '${IDS.quiz}', '¿Cada cuánto conviene revisarlo?',
            '{"a": "Nunca", "b": "Periódicamente"}'::jsonb, 'b', 3.00, 2);
  `);
}
