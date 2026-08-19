import React from 'react';

/**
 * FintCart Button — primary action control.
 * Warm, slightly boxy portal chrome: 1px borders, modest radius, snap press.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  type = 'button',
  onClick,
  children,
  style,
  ...rest
}) {
  const sizes = {
    sm: { padding: '0 10px', height: 30, fontSize: 'var(--fs-sm)', gap: 6 },
    md: { padding: '0 16px', height: 38, fontSize: 'var(--fs-base)', gap: 8 },
    lg: { padding: '0 22px', height: 46, fontSize: 'var(--fs-md)', gap: 8 },
  };

  const variants = {
    primary: {
      background: 'var(--brand-primary)',
      color: 'var(--text-on-brand)',
      border: '1px solid var(--brand-primary)',
    },
    accent: {
      background: 'var(--brand-accent)',
      color: 'var(--warm-900)',
      border: '1px solid var(--gold-500)',
    },
    secondary: {
      background: 'var(--surface-card)',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-strong)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-link)',
      border: '1px solid transparent',
    },
    danger: {
      background: 'var(--danger)',
      color: '#fff',
      border: '1px solid var(--red-500)',
    },
  };

  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: block ? 'flex' : 'inline-flex',
        width: block ? '100%' : undefined,
        alignItems: 'center',
        justifyContent: 'center',
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--fw-semibold)',
        fontSize: s.fontSize,
        lineHeight: 1,
        letterSpacing: '0.01em',
        borderRadius: 'var(--radius-md)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        boxShadow: variant === 'ghost' ? 'none' : 'var(--shadow-xs)',
        transition: 'transform var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
        whiteSpace: 'nowrap',
        ...v,
        ...style,
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'translateY(1px)'; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.filter = 'none'; }}
      onMouseEnter={(e) => { if (!disabled && variant !== 'ghost') e.currentTarget.style.filter = 'brightness(0.95)'; if (!disabled && variant === 'ghost') e.currentTarget.style.background = 'var(--purple-50)'; }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
