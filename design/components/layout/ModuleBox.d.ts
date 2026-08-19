import * as React from 'react';

export interface ModuleBoxProps {
  /** Header title. Omit for a plain bordered box. */
  title?: string;
  /** Optional leading icon (Lucide), tinted with the accent. */
  icon?: React.ReactNode;
  /** Left accent rule + icon color. @default coral */
  accent?: string;
  /** Right-aligned header actions (links, buttons). */
  actions?: React.ReactNode;
  /** Pad the body. @default true */
  padded?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * The signature portal container: bordered box + accented header bar.
 * @startingPoint section="Layout" subtitle="Portal module box" viewport="700x240"
 */
export function ModuleBox(props: ModuleBoxProps): JSX.Element;
