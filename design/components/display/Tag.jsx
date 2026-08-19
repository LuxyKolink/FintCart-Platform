import React from 'react';

/** FintCart Tag — category chip with a colored dot, used across the catalog. */
export function Tag({ children, color = 'var(--cat-inversion)', href, active = false, onClick, style }) {
  const Comp = href ? 'a' : 'button';
  return (
    <Comp
      href={href}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px 3px 8px',
        border: `1px solid ${active ? color : 'var(--border-default)'}`,
        background: active ? 'var(--surface-card)' : 'var(--surface-card)',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-semibold)',
        color: active ? 'var(--text-strong)' : 'var(--text-muted)',
        cursor: 'pointer', textDecoration: 'none', lineHeight: 1.6,
        boxShadow: active ? `inset 0 -2px 0 ${color}` : 'none',
        transition: 'all var(--dur-fast)',
        ...style,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = 'var(--border-default)'; }}
    >
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' }} />
      {children}
    </Comp>
  );
}
