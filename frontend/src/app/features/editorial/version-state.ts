import { BadgeTone } from '../../shared/ui';
import { VersionState } from './editorial.types';

/**
 * Presentación de los estados de una versión (FR-114).
 *
 * Vive aparte de las pantallas porque el listado de versiones, el historial por artículo y la
 * bandeja de revisión muestran los mismos cuatro estados: dos tablas de traducción acabarían
 * llamando «Pendiente» a lo que la otra llama «En revisión», y esa divergencia es información
 * falsa para quien revisa.
 *
 * Los tonos siguen el kit editorial: un borrador es neutro, lo que espera revisión avisa, lo
 * publicado está resuelto y lo archivado queda fuera de circulación.
 */
const STATE_PRESENTATION: Record<VersionState, { label: string; tone: BadgeTone }> = {
  borrador: { label: 'Borrador', tone: 'neutral' },
  en_revision: { label: 'En revisión', tone: 'warning' },
  publicado: { label: 'Publicado', tone: 'success' },
  archivado: { label: 'Archivado', tone: 'danger' },
};

/** Etiqueta visible del estado. Un estado desconocido se muestra tal cual, no se inventa. */
export function versionStateLabel(state: VersionState | string): string {
  return STATE_PRESENTATION[state as VersionState]?.label ?? state;
}

export function versionStateTone(state: VersionState | string): BadgeTone {
  return STATE_PRESENTATION[state as VersionState]?.tone ?? 'neutral';
}

/**
 * Cómo se nombra al autor de una versión a partir de su `created_by`.
 *
 * El contrato solo lleva el IDENTIFICADOR del editor, no su nombre (ver el hallazgo de T068):
 * lo único que se puede afirmar sin inventar nada es si la versión es tuya o no. El
 * identificador se conserva —un coordinador puede necesitarlo para trazar— pero el texto
 * principal es el que dice algo.
 */
export function authorLabel(createdBy: string, viewerId: string | null): string {
  if (viewerId !== null && createdBy === viewerId) {
    return 'Tú';
  }
  return 'Otro editor';
}
