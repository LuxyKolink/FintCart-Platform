import * as React from 'react';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Native select styled to match Input. Pass <option> children. */
export function Select(props: SelectProps): JSX.Element;
