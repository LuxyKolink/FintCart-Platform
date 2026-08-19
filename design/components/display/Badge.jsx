import React from 'react';

/** FintCart Badge — small status/label pill. */
export function Badge({ children, tone = 'neutral', variant = 'soft', style }) {
  const tones = {
    neutral: { soft: ['var(--warm-100)', 'var(--warm-700)'], solid: ['var(--warm-700)', '#fff'] },
    brand:   { soft: ['var(--coral-50)', 'var(--coral-600)'], solid: ['var(--brand-primary)', '#fff'] },
    accent:  { soft: ['var(--gold-50)', 'var(--gold-600)'], solid: ['var(--brand-accent)', 'var(--warm-900)'] },
    success: { soft: ['var(--success-soft)', 'var(--green-500)'], solid: ['var(--success)', '#fff'] },
    warning: { soft: ['var(--warning-soft)', 'var(--gold-600)'], solid: ['var(--warning)', '#fff'] },
    danger:  { soft: ['var(--danger-soft)', 'var(--red-500)'], solid: ['var(--danger)', '#fff'] },
    info:    { soft: ['var(--info-soft)', 'var(--purple-600)'], solid: ['var(--info)', '#fff'] },
  };
  const [bg, fg] = (tones[tone] || tones.neutral)[variant] || tones.neutral.soft;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-2xs)', fontWeight: 'var(--fw-bold)',
      letterSpacing: '0.04em', textTransform: 'uppercase',
      background: bg, color: fg, lineHeight: 1.4, whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  );
}
