import * as React from 'react';

export interface CardProps {
  children?: React.ReactNode;
  /** Adds hover lift + pointer; use for clickable catalog cards. */
  interactive?: boolean;
  /** Pad the card. @default true */
  padded?: boolean;
  style?: React.CSSProperties;
}

/** General content card with a soft shadow; `interactive` adds a hover lift. */
export function Card(props: CardProps): JSX.Element;
