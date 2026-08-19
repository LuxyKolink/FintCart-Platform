import React from 'react';

/** FintCart Checkbox — square, warm, with optional label. */
export function Checkbox({ checked, defaultChecked, onChange, label, disabled = false, id, style }) {
  const cbId = id || (label ? 'cb-' + String(label).replace(/\s+/g, '-').toLowerCase() : undefined);
  return (
    <label htmlFor={cbId} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-base)', color: 'var(--text-body)',
      ...style,
    }}>
      <input id={cbId} type="checkbox" checked={checked} defaultChecked={defaultChecked} onChange={onChange} disabled={disabled}
        style={{
          appearance: 'none', WebkitAppearance: 'none', width: 18, height: 18, margin: 0,
          border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-card)', display: 'grid', placeItems: 'center',
          cursor: 'inherit', transition: 'all var(--dur-fast)',
          accentColor: 'var(--brand-primary)',
        }}
        onChange={onChange}
      />
      {label && <span>{label}</span>}
    </label>
  );
}
