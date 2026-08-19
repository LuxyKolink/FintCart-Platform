import React from 'react';

/**
 * FintCart Tabs — underlined portal tabs (Topics / Economic / Sports…).
 * Controlled or uncontrolled. Tabs are passed as [{ id, label }].
 */
export function Tabs({ tabs = [], value, defaultValue, onChange, style }) {
  const [internal, setInternal] = React.useState(defaultValue ?? (tabs[0] && tabs[0].id));
  const active = value !== undefined ? value : internal;
  const select = (id) => { if (value === undefined) setInternal(id); onChange && onChange(id); };

  return (
    <div role="tablist" style={{
      display: 'flex', gap: 2, alignItems: 'flex-end',
      borderBottom: '1px solid var(--border-default)',
      ...style,
    }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} role="tab" aria-selected={on} onClick={() => select(t.id)}
            style={{
              appearance: 'none', border: 'none', background: 'transparent',
              padding: '9px 14px', marginBottom: -1, cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)',
              fontWeight: on ? 'var(--fw-bold)' : 'var(--fw-medium)',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              borderBottom: `2px solid ${on ? 'var(--brand-interactive)' : 'transparent'}`,
              transition: 'color var(--dur-fast), border-color var(--dur-fast)',
              display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = 'var(--text-body)'; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {t.label}
            {t.count != null && (
              <span className="fc-num" style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
