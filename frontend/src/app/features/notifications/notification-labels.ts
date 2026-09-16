/**
 * Etiquetas legibles de los tipos de notificación in-app (FR-023).
 *
 * Vive aparte del componente porque la **bandeja** y el **riel de notificaciones del
 * catálogo** muestran las mismas entradas: dos tablas de traducción distintas
 * acabarían llamando «Hito» a lo mismo que la otra llama «Hito de progreso».
 *
 * Los cuatro tipos son los que aceptan el `CHECK` de `inapp_notifications` y la
 * validación de `services/users/internal/server/inapp.go` (FR-081).
 */
const TYPE_LABELS: Record<string, string> = {
  nuevo_articulo: 'Nuevo artículo',
  recordatorio: 'Recordatorio',
  hito_progreso: 'Hito de progreso',
  resultado_cuestionario: 'Resultado de cuestionario',
};

export function notificationTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}
