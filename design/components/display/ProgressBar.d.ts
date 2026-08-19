import * as React from 'react';

export interface ProgressBarProps {
  /** Current value. */
  value?: number;
  /** Maximum value. @default 100 */
  max?: number;
  label?: string;
  /** Show "value/max" readout. */
  showValue?: boolean;
  /** Fill color; defaults to marigold accent. */
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

/**
 * Core progress motif — "puntos de progreso" earned through quizzes.
 * @startingPoint section="Display" subtitle="Progress bar with label" viewport="700x120"
 */
export function ProgressBar(props: ProgressBarProps): JSX.Element;
