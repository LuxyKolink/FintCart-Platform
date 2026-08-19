import React from 'react';

/**
 * FintCart ModuleBox — THE signature portal container.
 * A bordered box with a header bar carrying a left accent rule, a title,
 * and optional actions. Composes the dense, link-heavy portal layout.
 */
export function ModuleBox({ title, icon = null, accent = 'var(--brand-primary)', actions = null, padded = true, children, style }) {
  return (
    <section style={{
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-xs)',
      overflow: 'hidden',
      ...style,
    }}>
      {title && (
        <header style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: 'var(--surface-module-header)',
          borderBottom: '1px solid var(--border-default)',
          borderLeft: `3px solid ${accent}`,
        }}>
          {icon && <span style={{ display: 'inline-flex', color: accent }}>{icon}</span>}
          <h3 style={{
            margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)',
            fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)', letterSpacing: '0.01em',
          }}>{title}</h3>
          {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: padded ? 'var(--space-3)' : 0 }}>{children}</div>
    </section>
  );
}
