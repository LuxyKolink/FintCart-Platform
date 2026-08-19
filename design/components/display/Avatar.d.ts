import * as React from 'react';

export interface AvatarProps {
  /** Full name — initials are derived from it. */
  name?: string;
  /** Image URL; falls back to initials monogram. */
  src?: string;
  /** Pixel diameter. @default 36 */
  size?: number;
  /** Monogram background color. */
  tone?: string;
  style?: React.CSSProperties;
}

/** User monogram or photo with a warm ring. */
export function Avatar(props: AvatarProps): JSX.Element;
