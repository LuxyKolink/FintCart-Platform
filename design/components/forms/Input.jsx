import React from 'react';

/**
 * FintCart Input — text field with optional label, hint, error and affixes.
 */
export function Input({
  label,
  hint,
  error,
  prefix = null,
  suffix = null,
  size = 'md',
  id,
  style,
  ...rest
}) {
  const heights = { sm: 30, md: 38, lg: 46 };
  const h = heights[size] || 38;
  const inputId = id || (label ? 'in-' + label.replace(/\s+/g, '-').toLowerCase() : undefined);
  const invalid = !!error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {label && (
        <label htmlFor={inputId} style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)',
          fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)',
        }}>{label}</label>
      )}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'var(--surface-card)',
        border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--radius-md)',
        height: h, paddingLeft: prefix ? 10 : 0, paddingRight: suffix ? 10 : 0,
        boxShadow: 'var(--shadow-inset)',
        transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)',
      }}
        onFocusCapture={(e) => { e.currentTarget.style.borderColor = 'var(--border-focus)'; e.currentTarget.style.boxShadow = 'var(--focus-ring)'; }}
        onBlurCapture={(e) => { e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--border-strong)'; e.currentTarget.style.boxShadow = 'var(--shadow-inset)'; }}
      >
        {prefix && <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', marginRight: 6, fontFamily: 'var(--font-mono)' }}>{prefix}</span>}
        <input id={inputId} aria-invalid={invalid} style={{
          flex: 1, border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-base)', color: 'var(--text-body)',
          height: '100%', padding: '0 12px', minWidth: 0,
        }} {...rest} />
        {suffix && <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', marginLeft: 6 }}>{suffix}</span>}
      </div>
      {(hint || error) && (
        <span style={{ fontSize: 'var(--fs-xs)', color: invalid ? 'var(--danger)' : 'var(--text-faint)' }}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
