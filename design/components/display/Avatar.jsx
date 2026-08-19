import React from 'react';

/** FintCart Avatar — user monogram or image, warm ring. */
export function Avatar({ name = '', src, size = 36, tone = 'var(--brand-interactive)', style }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]).join('').toUpperCase() || '·';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: size, height: size, borderRadius: '50%',
      background: src ? 'transparent' : tone, color: '#fff',
      fontFamily: 'var(--font-sans)', fontWeight: 'var(--fw-bold)',
      fontSize: Math.round(size * 0.4), overflow: 'hidden', flex: 'none',
      border: '2px solid var(--surface-card)', boxShadow: '0 0 0 1px var(--border-default)',
      ...style,
    }}>
      {src ? <img src={src} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
    </span>
  );
}
