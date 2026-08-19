import React from 'react';

/** FintCart Card — content card for catalog articles & results. */
export function Card({ children, interactive = false, padded = true, style }) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        padding: padded ? 'var(--space-4)' : 0,
        transition: 'box-shadow var(--dur-base), transform var(--dur-base), border-color var(--dur-base)',
        cursor: interactive ? 'pointer' : 'default',
        overflow: 'hidden',
        ...style,
      }}
      onMouseEnter={(e) => { if (interactive) { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; } }}
      onMouseLeave={(e) => { if (interactive) { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border-default)'; } }}
    >
      {children}
    </div>
  );
}
