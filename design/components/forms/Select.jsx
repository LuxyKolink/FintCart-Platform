import React from 'react';

/** FintCart Select — native dropdown styled to match Input. */
export function Select({ label, hint, error, size = 'md', id, children, style, ...rest }) {
  const heights = { sm: 30, md: 38, lg: 46 };
  const h = heights[size] || 38;
  const selId = id || (label ? 'sel-' + label.replace(/\s+/g, '-').toLowerCase() : undefined);
  const invalid = !!error;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {label && <label htmlFor={selId} style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{label}</label>}
      <div style={{ position: 'relative', display: 'flex' }}>
        <select id={selId} style={{
          appearance: 'none', WebkitAppearance: 'none',
          width: '100%', height: h, padding: '0 34px 0 12px',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-base)', color: 'var(--text-body)',
          background: 'var(--surface-card)',
          border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-inset)',
          cursor: 'pointer', outline: 'none',
        }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.boxShadow = 'var(--focus-ring)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'var(--shadow-inset)'; }}
          {...rest}
        >{children}</select>
        <span aria-hidden="true" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)', fontSize: 12 }}>▾</span>
      </div>
      {(hint || error) && <span style={{ fontSize: 'var(--fs-xs)', color: invalid ? 'var(--danger)' : 'var(--text-faint)' }}>{error || hint}</span>}
    </div>
  );
}
