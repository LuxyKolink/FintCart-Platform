import * as React from 'react';

export interface BadgeProps {
  children?: React.ReactNode;
  /** Color tone. @default "neutral" */
  tone?: 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  /** Fill style. @default "soft" */
  variant?: 'soft' | 'solid';
  style?: React.CSSProperties;
}

/** Uppercase status/label pill for states like Borrador / Publicado / Aprobado. */
export function Badge(props: BadgeProps): JSX.Element;
