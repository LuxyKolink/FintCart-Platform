import * as React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  /** Leading affix, e.g. a "$" or "COP". */
  prefix?: React.ReactNode;
  /** Trailing affix, e.g. "%" or a unit. */
  suffix?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
}

/** Labeled text input with hint/error states and money affixes. */
export function Input(props: InputProps): JSX.Element;
