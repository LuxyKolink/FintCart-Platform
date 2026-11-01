/**
 * Punto de entrada histórico del formato de resultados del simulador.
 *
 * Los ayudantes se mudaron a `shared/format-money.ts` —ver allí el porqué: los usa
 * también la administración— y este módulo queda como reexportación para no tocar a
 * quien ya importaba de aquí (`result.component.ts`, `history-rows.ts`) ni su prueba.
 * Código nuevo: importar directamente de `shared/format-money`.
 */
export { formatMoney, formatRate } from '../../shared/format-money';
