import * as React from 'react';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  /** Optional count shown after the label. */
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active id. */
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  style?: React.CSSProperties;
}

/** Underlined portal tabs (purple active rule). Controlled or uncontrolled. */
export function Tabs(props: TabsProps): JSX.Element;
