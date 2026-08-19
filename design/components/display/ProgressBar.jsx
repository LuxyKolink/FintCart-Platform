import React from 'react';

/**
 * FintCart ProgressBar — the platform's core progress motif (puntos de progreso).
 * Marigold fill by default; supports a value label and segmented "stepped" mode.
 */
export function ProgressBar({ value = 0, max = 100, label, showValue = false, tone = 'var(--brand-accent)', size = 'md', style }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const heights = { sm: 6, md: 10, lg: 14 };
  const h = heights[size] || 10;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...style }}>
      {(label || showValue) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          {label && <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{label}</span>}
          {showValue && <span className="fc-num" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{Math.round(value)}/{max}</span>}
        </div>
      )}
      <div style={{
        height: h, background: 'var(--surface-inset)', borderRadius: 'var(--radius-pill)',
        overflow: 'hidden', border: '1px solid var(--border-subtle)',
      }}>
        <div style={{
          width: pct + '%', height: '100%', background: tone, borderRadius: 'var(--radius-pill)',
          transition: 'width var(--dur-slow) var(--ease-out)',
          boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)',
        }} />
      </div>
    </div>
  );
}
