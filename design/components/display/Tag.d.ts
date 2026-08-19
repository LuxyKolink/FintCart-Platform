import * as React from 'react';

export interface TagProps {
  children?: React.ReactNode;
  /** Dot + accent color; defaults to inversión purple. Use the --cat-* tokens. */
  color?: string;
  href?: string;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/** Category chip with colored dot — the catalog's topic filter vocabulary. */
export function Tag(props: TagProps): JSX.Element;
