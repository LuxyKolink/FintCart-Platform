/* @ds-bundle: {"format":3,"namespace":"FintCartDesignSystem_cf1e0c","components":[{"name":"Avatar","sourcePath":"components/display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"ProgressBar","sourcePath":"components/display/ProgressBar.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Card","sourcePath":"components/layout/Card.jsx"},{"name":"ModuleBox","sourcePath":"components/layout/ModuleBox.jsx"},{"name":"Tabs","sourcePath":"components/layout/Tabs.jsx"}],"sourceHashes":{"components/display/Avatar.jsx":"09d52e6b47b1","components/display/Badge.jsx":"c4a54b9aeae5","components/display/ProgressBar.jsx":"7dfa5d692fa4","components/display/Tag.jsx":"f5c48c3319ca","components/forms/Button.jsx":"4e616615a6f7","components/forms/Checkbox.jsx":"0ec222edd186","components/forms/Input.jsx":"8b564e52af56","components/forms/Select.jsx":"62d08ed00299","components/layout/Card.jsx":"f54bbefcc4ea","components/layout/ModuleBox.jsx":"3eb023e7a644","components/layout/Tabs.jsx":"7cb0034afe5e","ui_kits/auth/app.js":"7142a24b0963","ui_kits/editorial/app.js":"aba3ef0cbbbd","ui_kits/learner/app.js":"f7ec0a2d984d","ui_kits/learner/data.js":"6b5f9d2c5eb3","ui_kits/learner/portal.js":"bb0fd20440cb","ui_kits/marketing/app.js":"50f1d35b293c","ui_kits/simulators/app.js":"b51572ae56f6"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.FintCartDesignSystem_cf1e0c = window.FintCartDesignSystem_cf1e0c || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/Avatar.jsx
try { (() => {
/** FintCart Avatar — user monogram or image, warm ring. */
function Avatar({
  name = '',
  src,
  size = 36,
  tone = 'var(--brand-interactive)',
  style
}) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase() || '·';
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      borderRadius: '50%',
      background: src ? 'transparent' : tone,
      color: '#fff',
      fontFamily: 'var(--font-sans)',
      fontWeight: 'var(--fw-bold)',
      fontSize: Math.round(size * 0.4),
      overflow: 'hidden',
      flex: 'none',
      border: '2px solid var(--surface-card)',
      boxShadow: '0 0 0 1px var(--border-default)',
      ...style
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/display/Badge.jsx
try { (() => {
/** FintCart Badge — small status/label pill. */
function Badge({
  children,
  tone = 'neutral',
  variant = 'soft',
  style
}) {
  const tones = {
    neutral: {
      soft: ['var(--warm-100)', 'var(--warm-700)'],
      solid: ['var(--warm-700)', '#fff']
    },
    brand: {
      soft: ['var(--coral-50)', 'var(--coral-600)'],
      solid: ['var(--brand-primary)', '#fff']
    },
    accent: {
      soft: ['var(--gold-50)', 'var(--gold-600)'],
      solid: ['var(--brand-accent)', 'var(--warm-900)']
    },
    success: {
      soft: ['var(--success-soft)', 'var(--green-500)'],
      solid: ['var(--success)', '#fff']
    },
    warning: {
      soft: ['var(--warning-soft)', 'var(--gold-600)'],
      solid: ['var(--warning)', '#fff']
    },
    danger: {
      soft: ['var(--danger-soft)', 'var(--red-500)'],
      solid: ['var(--danger)', '#fff']
    },
    info: {
      soft: ['var(--info-soft)', 'var(--purple-600)'],
      solid: ['var(--info)', '#fff']
    }
  };
  const [bg, fg] = (tones[tone] || tones.neutral)[variant] || tones.neutral.soft;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 8px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-2xs)',
      fontWeight: 'var(--fw-bold)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      background: bg,
      color: fg,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/ProgressBar.jsx
try { (() => {
/**
 * FintCart ProgressBar — the platform's core progress motif (puntos de progreso).
 * Marigold fill by default; supports a value label and segmented "stepped" mode.
 */
function ProgressBar({
  value = 0,
  max = 100,
  label,
  showValue = false,
  tone = 'var(--brand-accent)',
  size = 'md',
  style
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const heights = {
    sm: 6,
    md: 10,
    lg: 14
  };
  const h = heights[size] || 10;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      ...style
    }
  }, (label || showValue) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)'
    }
  }, label), showValue && /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, Math.round(value), "/", max)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: h,
      background: 'var(--surface-inset)',
      borderRadius: 'var(--radius-pill)',
      overflow: 'hidden',
      border: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      background: tone,
      borderRadius: 'var(--radius-pill)',
      transition: 'width var(--dur-slow) var(--ease-out)',
      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.12)'
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
/** FintCart Tag — category chip with a colored dot, used across the catalog. */
function Tag({
  children,
  color = 'var(--cat-inversion)',
  href,
  active = false,
  onClick,
  style
}) {
  const Comp = href ? 'a' : 'button';
  return /*#__PURE__*/React.createElement(Comp, {
    href: href,
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px 3px 8px',
      border: `1px solid ${active ? color : 'var(--border-default)'}`,
      background: active ? 'var(--surface-card)' : 'var(--surface-card)',
      borderRadius: 'var(--radius-sm)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 'var(--fw-semibold)',
      color: active ? 'var(--text-strong)' : 'var(--text-muted)',
      cursor: 'pointer',
      textDecoration: 'none',
      lineHeight: 1.6,
      boxShadow: active ? `inset 0 -2px 0 ${color}` : 'none',
      transition: 'all var(--dur-fast)',
      ...style
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = color;
    },
    onMouseLeave: e => {
      if (!active) e.currentTarget.style.borderColor = 'var(--border-default)';
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: color,
      flex: 'none'
    }
  }), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FintCart Button — primary action control.
 * Warm, slightly boxy portal chrome: 1px borders, modest radius, snap press.
 */
function Button({
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
    sm: {
      padding: '0 10px',
      height: 30,
      fontSize: 'var(--fs-sm)',
      gap: 6
    },
    md: {
      padding: '0 16px',
      height: 38,
      fontSize: 'var(--fs-base)',
      gap: 8
    },
    lg: {
      padding: '0 22px',
      height: 46,
      fontSize: 'var(--fs-md)',
      gap: 8
    }
  };
  const variants = {
    primary: {
      background: 'var(--brand-primary)',
      color: 'var(--text-on-brand)',
      border: '1px solid var(--brand-primary)'
    },
    accent: {
      background: 'var(--brand-accent)',
      color: 'var(--warm-900)',
      border: '1px solid var(--gold-500)'
    },
    secondary: {
      background: 'var(--surface-card)',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-strong)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-link)',
      border: '1px solid transparent'
    },
    danger: {
      background: 'var(--danger)',
      color: '#fff',
      border: '1px solid var(--red-500)'
    }
  };
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: {
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
      ...style
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'translateY(1px)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'translateY(0)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.filter = 'none';
    },
    onMouseEnter: e => {
      if (!disabled && variant !== 'ghost') e.currentTarget.style.filter = 'brightness(0.95)';
      if (!disabled && variant === 'ghost') e.currentTarget.style.background = 'var(--purple-50)';
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
/** FintCart Checkbox — square, warm, with optional label. */
function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  disabled = false,
  id,
  style
}) {
  const cbId = id || (label ? 'cb-' + String(label).replace(/\s+/g, '-').toLowerCase() : undefined);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: cbId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-base)',
      color: 'var(--text-body)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    id: cbId,
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled,
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: 18,
      height: 18,
      margin: 0,
      border: '1.5px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-card)',
      display: 'grid',
      placeItems: 'center',
      cursor: 'inherit',
      transition: 'all var(--dur-fast)',
      accentColor: 'var(--brand-primary)'
    },
    onChange: onChange
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * FintCart Input — text field with optional label, hint, error and affixes.
 */
function Input({
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
  const heights = {
    sm: 30,
    md: 38,
    lg: 46
  };
  const h = heights[size] || 38;
  const inputId = id || (label ? 'in-' + label.replace(/\s+/g, '-').toLowerCase() : undefined);
  const invalid = !!error;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      background: 'var(--surface-card)',
      border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      height: h,
      paddingLeft: prefix ? 10 : 0,
      paddingRight: suffix ? 10 : 0,
      boxShadow: 'var(--shadow-inset)',
      transition: 'border-color var(--dur-fast), box-shadow var(--dur-fast)'
    },
    onFocusCapture: e => {
      e.currentTarget.style.borderColor = 'var(--border-focus)';
      e.currentTarget.style.boxShadow = 'var(--focus-ring)';
    },
    onBlurCapture: e => {
      e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--border-strong)';
      e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
    }
  }, prefix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)',
      fontSize: 'var(--fs-sm)',
      marginRight: 6,
      fontFamily: 'var(--font-mono)'
    }
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    "aria-invalid": invalid,
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-base)',
      color: 'var(--text-body)',
      height: '100%',
      padding: '0 12px',
      minWidth: 0
    }
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)',
      fontSize: 'var(--fs-sm)',
      marginLeft: 6
    }
  }, suffix)), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: invalid ? 'var(--danger)' : 'var(--text-faint)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** FintCart Select — native dropdown styled to match Input. */
function Select({
  label,
  hint,
  error,
  size = 'md',
  id,
  children,
  style,
  ...rest
}) {
  const heights = {
    sm: 30,
    md: 38,
    lg: 46
  };
  const h = heights[size] || 38;
  const selId = id || (label ? 'sel-' + label.replace(/\s+/g, '-').toLowerCase() : undefined);
  const invalid = !!error;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: selId,
    style: {
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 'var(--fw-semibold)',
      color: 'var(--text-strong)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: selId,
    style: {
      appearance: 'none',
      WebkitAppearance: 'none',
      width: '100%',
      height: h,
      padding: '0 34px 0 12px',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-base)',
      color: 'var(--text-body)',
      background: 'var(--surface-card)',
      border: `1px solid ${invalid ? 'var(--danger)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-inset)',
      cursor: 'pointer',
      outline: 'none'
    },
    onFocus: e => {
      e.currentTarget.style.borderColor = 'var(--border-focus)';
      e.currentTarget.style.boxShadow = 'var(--focus-ring)';
    },
    onBlur: e => {
      e.currentTarget.style.borderColor = invalid ? 'var(--danger)' : 'var(--border-strong)';
      e.currentTarget.style.boxShadow = 'var(--shadow-inset)';
    }
  }, rest), children), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: 12,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--text-muted)',
      fontSize: 12
    }
  }, "\u25BE")), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: invalid ? 'var(--danger)' : 'var(--text-faint)'
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/layout/Card.jsx
try { (() => {
/** FintCart Card — content card for catalog articles & results. */
function Card({
  children,
  interactive = false,
  padded = true,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
      padding: padded ? 'var(--space-4)' : 0,
      transition: 'box-shadow var(--dur-base), transform var(--dur-base), border-color var(--dur-base)',
      cursor: interactive ? 'pointer' : 'default',
      overflow: 'hidden',
      ...style
    },
    onMouseEnter: e => {
      if (interactive) {
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
      }
    },
    onMouseLeave: e => {
      if (interactive) {
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'var(--border-default)';
      }
    }
  }, children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Card.jsx", error: String((e && e.message) || e) }); }

// components/layout/ModuleBox.jsx
try { (() => {
/**
 * FintCart ModuleBox — THE signature portal container.
 * A bordered box with a header bar carrying a left accent rule, a title,
 * and optional actions. Composes the dense, link-heavy portal layout.
 */
function ModuleBox({
  title,
  icon = null,
  accent = 'var(--brand-primary)',
  actions = null,
  padded = true,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-xs)',
      overflow: 'hidden',
      ...style
    }
  }, title && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: 'var(--surface-module-header)',
      borderBottom: '1px solid var(--border-default)',
      borderLeft: `3px solid ${accent}`
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: accent
    }
  }, icon), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      fontWeight: 'var(--fw-bold)',
      color: 'var(--text-strong)',
      letterSpacing: '0.01em'
    }
  }, title), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: padded ? 'var(--space-3)' : 0
    }
  }, children));
}
Object.assign(__ds_scope, { ModuleBox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/ModuleBox.jsx", error: String((e && e.message) || e) }); }

// components/layout/Tabs.jsx
try { (() => {
/**
 * FintCart Tabs — underlined portal tabs (Topics / Economic / Sports…).
 * Controlled or uncontrolled. Tabs are passed as [{ id, label }].
 */
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  style
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? (tabs[0] && tabs[0].id));
  const active = value !== undefined ? value : internal;
  const select = id => {
    if (value === undefined) setInternal(id);
    onChange && onChange(id);
  };
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: 'flex',
      gap: 2,
      alignItems: 'flex-end',
      borderBottom: '1px solid var(--border-default)',
      ...style
    }
  }, tabs.map(t => {
    const on = t.id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      role: "tab",
      "aria-selected": on,
      onClick: () => select(t.id),
      style: {
        appearance: 'none',
        border: 'none',
        background: 'transparent',
        padding: '9px 14px',
        marginBottom: -1,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-sm)',
        fontWeight: on ? 'var(--fw-bold)' : 'var(--fw-medium)',
        color: on ? 'var(--text-strong)' : 'var(--text-muted)',
        borderBottom: `2px solid ${on ? 'var(--brand-interactive)' : 'transparent'}`,
        transition: 'color var(--dur-fast), border-color var(--dur-fast)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        whiteSpace: 'nowrap'
      },
      onMouseEnter: e => {
        if (!on) e.currentTarget.style.color = 'var(--text-body)';
      },
      onMouseLeave: e => {
        if (!on) e.currentTarget.style.color = 'var(--text-muted)';
      }
    }, t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
      className: "fc-num",
      style: {
        fontSize: 'var(--fs-2xs)',
        color: 'var(--text-faint)'
      }
    }, t.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/layout/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/auth/app.js
try { (() => {
/* global React */
const {
  Button,
  Input,
  Checkbox,
  Badge
} = window.FintCartDesignSystem_cf1e0c;
const {
  useState,
  useLayoutEffect
} = React;
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}
function BrandPanel() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'linear-gradient(160deg, var(--coral-400) 0%, var(--coral-600) 70%, var(--purple-600) 140%)',
      color: '#fff',
      padding: '40px 38px',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 11
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "40",
    height: "40",
    alt: "",
    style: {
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 26,
      color: '#fff'
    }
  }, "FintCart")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto'
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      color: '#fff',
      fontSize: 34,
      lineHeight: 1.12,
      margin: '0 0 12px'
    }
  }, "Aprende a manejar tu plata, paso a paso."), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'rgba(255,255,255,0.9)',
      fontSize: 'var(--fs-md)',
      margin: 0,
      maxWidth: 320
    }
  }, "Art\xEDculos, cuestionarios y simuladores financieros pensados para el contexto colombiano. Gratis."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 22,
      marginTop: 26
    }
  }, [['book-open', '+120 artículos'], ['calculator', '5 simuladores'], ['award', 'Mide tu progreso']].map(f => /*#__PURE__*/React.createElement("div", {
    key: f[0],
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 'var(--fs-sm)',
      color: '#fff'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: f[0],
    size: 18
  }), f[1])))));
}
function Login({
  go
}) {
  return /*#__PURE__*/React.createElement(Form, {
    title: "Inicia sesi\xF3n",
    sub: "Bienvenido de nuevo a FintCart."
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Correo electr\xF3nico",
    type: "email",
    placeholder: "tu@correo.com",
    defaultValue: "mariana@correo.com"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Contrase\xF1a",
    type: "password",
    defaultValue: "123456"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    label: "Recordarme",
    defaultChecked: true
  }), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 'var(--fs-sm)'
    }
  }, "\xBFOlvidaste tu contrase\xF1a?")), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    size: "lg"
  }, "Entrar"), /*#__PURE__*/React.createElement(Divider, null, "o contin\xFAa con"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "shield",
      size: 16
    })
  }, "OAuth2 \xB7 PKCE"), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      margin: '4px 0 0'
    }
  }, "\xBFNo tienes cuenta? ", /*#__PURE__*/React.createElement("a", {
    onClick: () => go('register'),
    style: {
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Reg\xEDstrate")));
}
function Register({
  go
}) {
  return /*#__PURE__*/React.createElement(Form, {
    title: "Crea tu cuenta",
    sub: "Gratis, en menos de un minuto."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Input, {
    label: "Nombre",
    placeholder: "Mariana"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Apellido",
    placeholder: "L\xF3pez"
  })), /*#__PURE__*/React.createElement(Input, {
    label: "Correo electr\xF3nico",
    type: "email",
    placeholder: "tu@correo.com"
  }), /*#__PURE__*/React.createElement(Input, {
    label: "Contrase\xF1a",
    type: "password",
    hint: "M\xEDnimo 8 caracteres, una may\xFAscula y un n\xFAmero."
  }), /*#__PURE__*/React.createElement(Checkbox, {
    label: "Acepto la Pol\xEDtica de Tratamiento de Datos (Ley 1581 de 2012)."
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    size: "lg",
    onClick: () => go('verify')
  }, "Crear cuenta"), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      margin: '4px 0 0'
    }
  }, "\xBFYa tienes cuenta? ", /*#__PURE__*/React.createElement("a", {
    onClick: () => go('login'),
    style: {
      cursor: 'pointer',
      fontWeight: 600
    }
  }, "Inicia sesi\xF3n")));
}
function Verify({
  go
}) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const set = (i, v) => {
    const c = [...code];
    c[i] = v.slice(-1);
    setCode(c);
  };
  return /*#__PURE__*/React.createElement(Form, {
    title: "Verifica tu correo",
    sub: /*#__PURE__*/React.createElement(React.Fragment, null, "Enviamos un c\xF3digo de 6 d\xEDgitos a ", /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--text-strong)'
      }
    }, "tu@correo.com"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 56,
      height: 56,
      borderRadius: '50%',
      background: 'var(--coral-50)',
      color: 'var(--coral-500)',
      display: 'grid',
      placeItems: 'center',
      margin: '0 auto 4px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "mail-check",
    size: 26
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      justifyContent: 'center'
    }
  }, code.map((d, i) => /*#__PURE__*/React.createElement("input", {
    key: i,
    value: d,
    onChange: e => set(i, e.target.value),
    maxLength: 1,
    inputMode: "numeric",
    style: {
      width: 44,
      height: 52,
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 22,
      fontWeight: 600,
      border: `2px solid ${d ? 'var(--purple-400)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      color: 'var(--text-strong)'
    }
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    size: "lg",
    onClick: () => go('done')
  }, "Verificar"), /*#__PURE__*/React.createElement("p", {
    style: {
      textAlign: 'center',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      margin: 0
    }
  }, "\xBFNo te lleg\xF3? ", /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontWeight: 600
    }
  }, "Reenviar c\xF3digo")));
}
function Done() {
  return /*#__PURE__*/React.createElement(Form, {
    title: "\xA1Cuenta verificada!",
    sub: "Ya puedes empezar a aprender."
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 64,
      height: 64,
      borderRadius: '50%',
      background: 'var(--success-soft)',
      color: 'var(--success)',
      display: 'grid',
      placeItems: 'center',
      margin: '0 auto 6px'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 32
  })), /*#__PURE__*/React.createElement("a", {
    href: "../learner/index.html",
    style: {
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    size: "lg",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "Ir al cat\xE1logo")));
}
function Divider({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      color: 'var(--text-faint)',
      fontSize: 'var(--fs-xs)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border-default)'
    }
  }), children, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: 'var(--border-default)'
    }
  }));
}
function Form({
  title,
  sub,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 372,
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 4px',
      fontSize: 'var(--fs-3xl)'
    }
  }, title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-sm)'
    }
  }, sub)), children);
}
function App() {
  const [view, setView] = useState('login');
  useLayoutEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  });
  const Screen = {
    login: Login,
    register: Register,
    verify: Verify,
    done: Done
  }[view];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'var(--surface-page)',
      padding: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      maxWidth: 880,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-xl)',
      overflow: 'hidden',
      boxShadow: 'var(--shadow-lg)',
      minHeight: 540
    }
  }, /*#__PURE__*/React.createElement(BrandPanel, null), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '40px 38px',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Screen, {
    go: setView
  }))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/auth/app.js", error: String((e && e.message) || e) }); }

// ui_kits/editorial/app.js
try { (() => {
/* global React */
const {
  Button,
  Input,
  Select,
  Badge,
  Tag,
  ModuleBox,
  Card,
  Avatar
} = window.FintCartDesignSystem_cf1e0c;
const {
  useState,
  useLayoutEffect
} = React;
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}
const STATUS = {
  borrador: {
    label: 'Borrador',
    tone: 'neutral'
  },
  revision: {
    label: 'En revisión',
    tone: 'warning'
  },
  publicado: {
    label: 'Publicado',
    tone: 'success'
  }
};
const SEED = [{
  id: 1,
  title: 'Cómo armar un fondo de emergencia',
  cat: 'Ahorro',
  status: 'publicado',
  v: 3,
  author: 'Valentina Ríos',
  updated: '12 jun',
  chars: 1248
}, {
  id: 2,
  title: 'Entender la tasa E.A. de tu crédito',
  cat: 'Crédito',
  status: 'revision',
  v: 1,
  author: 'Carlos Mejía',
  updated: '11 jun',
  chars: 2110
}, {
  id: 3,
  title: 'La regla 50/30/20 para tu presupuesto',
  cat: 'Presupuesto',
  status: 'revision',
  v: 2,
  author: 'Daniela Ospina',
  updated: '11 jun',
  chars: 980
}, {
  id: 4,
  title: 'Diversificar: primeros pasos en inversión',
  cat: 'Inversión',
  status: 'borrador',
  v: 1,
  author: 'Tú',
  updated: 'hace 5 min',
  chars: 1640
}, {
  id: 5,
  title: '¿Debo declarar renta este año?',
  cat: 'Colombia',
  status: 'borrador',
  v: 1,
  author: 'Tú',
  updated: 'ayer',
  chars: 320
}];
function TopBar({
  role,
  setRole,
  go
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--warm-900)',
      color: 'var(--warm-50)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1240,
      margin: '0 auto',
      padding: '0 18px',
      height: 52,
      display: 'flex',
      alignItems: 'center',
      gap: 22
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => go('dash'),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      cursor: 'pointer',
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "28",
    height: "28",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 18,
      color: '#fff'
    }
  }, "FintCart ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gold-400)',
      fontWeight: 600
    }
  }, "Editor"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 2,
      marginLeft: 8
    }
  }, ['Inicio', 'Borradores', 'Plantillas', 'Analítica'].map((n, i) => /*#__PURE__*/React.createElement("a", {
    key: n,
    onClick: () => go('dash'),
    style: {
      padding: '6px 11px',
      fontSize: 'var(--fs-sm)',
      color: i === 0 ? '#fff' : 'var(--warm-300)',
      fontWeight: i === 0 ? 600 : 400,
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)'
    }
  }, n))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      background: 'var(--warm-800)',
      borderRadius: 'var(--radius-pill)',
      padding: 3
    }
  }, ['editor', 'coordinador'].map(r => /*#__PURE__*/React.createElement("button", {
    key: r,
    onClick: () => setRole(r),
    style: {
      border: 'none',
      cursor: 'pointer',
      padding: '4px 12px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 600,
      textTransform: 'capitalize',
      background: role === r ? 'var(--gold-400)' : 'transparent',
      color: role === r ? 'var(--warm-900)' : 'var(--warm-300)'
    }
  }, r))), /*#__PURE__*/React.createElement(Avatar, {
    name: role === 'editor' ? 'Tú Editor' : 'Coord Editorial',
    size: 30,
    tone: "var(--purple-500)"
  }))));
}
function SideMenu({
  go
}) {
  const items = [['file-plus', 'Nuevo artículo', true], ['list', 'Lista de artículos'], ['folder', 'Categorías'], ['tag', 'Etiquetas']];
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Men\xFA del editor",
    accent: "var(--brand-interactive)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 6
    }
  }, items.map(([icon, label, primary], i) => /*#__PURE__*/React.createElement("li", {
    key: i
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => primary && go('edit', SEED[3]),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 10px',
      fontSize: 'var(--fs-sm)',
      cursor: 'pointer',
      borderRadius: 'var(--radius-sm)',
      color: primary ? 'var(--purple-600)' : 'var(--text-link)',
      fontWeight: primary ? 700 : 400,
      background: primary ? 'var(--purple-50)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16
  }), label))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Categor\xEDas",
    accent: "var(--brand-primary)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    className: "fc-linklist",
    style: {
      padding: '4px 12px'
    }
  }, ['Ahorro', 'Crédito', 'Presupuesto', 'Inversión', 'Contexto Colombia'].map(c => /*#__PURE__*/React.createElement("li", {
    key: c
  }, /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, c))))));
}
function Dashboard({
  role,
  items,
  go
}) {
  const counts = {
    borrador: 0,
    revision: 0,
    publicado: 0
  };
  items.forEach(a => counts[a.status]++);
  const visible = role === 'coordinador' ? items : items;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      flexWrap: 'wrap',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 2px',
      fontSize: 'var(--fs-2xl)'
    }
  }, role === 'coordinador' ? 'Cola de revisión' : 'Mis artículos'), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-sm)'
    }
  }, role === 'coordinador' ? 'Revisa, aprueba y publica el contenido enviado por editores.' : 'Crea borradores y envíalos a revisión.')), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 16
    }),
    onClick: () => go('edit', SEED[3])
  }, "Nuevo art\xEDculo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12
    }
  }, [['Borradores', counts.borrador, 'var(--warm-500)'], ['En revisión', counts.revision, 'var(--gold-500)'], ['Publicados', counts.publicado, 'var(--success)']].map(s => /*#__PURE__*/React.createElement(Card, {
    key: s[0],
    style: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-page)',
      display: 'grid',
      placeItems: 'center',
      color: s[2]
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 20
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "fc-num",
    style: {
      fontSize: 24,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, s[1]), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, s[0]))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Art\xEDculos",
    accent: "var(--brand-interactive)",
    padded: false
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 14px',
      fontWeight: 700
    }
  }, "T\xEDtulo"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 8px',
      fontWeight: 700
    }
  }, "Categor\xEDa"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 8px',
      fontWeight: 700
    }
  }, "Estado"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 8px',
      fontWeight: 700
    }
  }, "Autor"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 8px',
      fontWeight: 700,
      textAlign: 'right'
    }
  }, "Actualizado"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, visible.map(a => /*#__PURE__*/React.createElement("tr", {
    key: a.id,
    onClick: () => go('edit', a),
    style: {
      borderTop: '1px solid var(--border-subtle)',
      cursor: 'pointer'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--surface-page)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 14px',
      color: 'var(--text-strong)',
      fontWeight: 600
    }
  }, a.title, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)',
      fontWeight: 400,
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)'
    }
  }, "v", a.v)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 8px',
      color: 'var(--text-muted)'
    }
  }, a.cat), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 8px'
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: STATUS[a.status].tone
  }, STATUS[a.status].label)), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 8px',
      color: 'var(--text-muted)'
    }
  }, a.author), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 8px',
      textAlign: 'right',
      color: 'var(--text-faint)',
      fontSize: 'var(--fs-xs)'
    }
  }, a.updated), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '11px 14px',
      textAlign: 'right',
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-right",
    size: 16
  }))))))));
}
function Editor({
  article,
  role,
  go,
  onStatus
}) {
  const canPublish = role === 'coordinador' && article.author !== 'Tú';
  const toolbar = ['bold', 'italic', 'underline', '|', 'align-left', 'align-center', '|', 'link', 'image', 'list'];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 290px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => go('dash'),
    style: {
      cursor: 'pointer'
    }
  }, "Dashboard"), /*#__PURE__*/React.createElement("span", null, "\u203A"), /*#__PURE__*/React.createElement("span", null, article.cat), /*#__PURE__*/React.createElement("span", null, "\u203A"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "Editar")), /*#__PURE__*/React.createElement(Card, {
    padded: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '8px 12px',
      borderBottom: '1px solid var(--border-default)',
      background: 'var(--surface-page)'
    }
  }, toolbar.map((t, i) => t === '|' ? /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 1,
      height: 18,
      background: 'var(--border-default)',
      margin: '0 4px'
    }
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      padding: 6,
      borderRadius: 'var(--radius-sm)',
      color: 'var(--text-muted)',
      display: 'inline-flex'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'var(--surface-inset)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement(Icon, {
    name: t,
    size: 16
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)',
      fontFamily: 'var(--font-mono)'
    }
  }, article.chars, " caracteres")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 22
    }
  }, /*#__PURE__*/React.createElement("input", {
    defaultValue: article.title,
    style: {
      width: '100%',
      border: 'none',
      outline: 'none',
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 30,
      color: 'var(--text-strong)',
      marginBottom: 10,
      background: 'transparent'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    color: "var(--cat-ahorro)"
  }, article.cat), /*#__PURE__*/React.createElement(Badge, {
    tone: STATUS[article.status].tone
  }, STATUS[article.status].label)), /*#__PURE__*/React.createElement("div", {
    contentEditable: true,
    suppressContentEditableWarning: true,
    style: {
      outline: 'none',
      fontSize: 'var(--fs-md)',
      lineHeight: 1.7,
      color: 'var(--text-body)',
      minHeight: 220
    }
  }, /*#__PURE__*/React.createElement("p", null, "Un fondo de emergencia es dinero que apartas para imprevistos: una reparaci\xF3n, una urgencia m\xE9dica o quedarte sin ingresos por un tiempo."), /*#__PURE__*/React.createElement("p", null, "\xBFCu\xE1nto guardar? Una buena meta inicial es un mes de tus gastos esenciales. Luego apunta a tres meses y, si tu ingreso es variable, a seis."), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "[ Escribe aqu\xED el cuerpo del art\xEDculo\u2026 ]"))))), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Publicaci\xF3n",
    accent: "var(--brand-primary)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "Estado"), /*#__PURE__*/React.createElement(Badge, {
    tone: STATUS[article.status].tone
  }, STATUS[article.status].label)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "Versi\xF3n"), /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      color: 'var(--text-strong)'
    }
  }, "v", article.v)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "Autor"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-strong)'
    }
  }, article.author)), /*#__PURE__*/React.createElement("hr", {
    style: {
      border: 'none',
      borderTop: '1px dotted var(--border-default)',
      margin: '2px 0'
    }
  }), role === 'editor' && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "save",
      size: 15
    })
  }, "Guardar borrador"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "send",
      size: 15
    }),
    onClick: () => onStatus(article, 'revision')
  }, "Enviar a revisi\xF3n")), role === 'coordinador' && /*#__PURE__*/React.createElement(React.Fragment, null, canPublish ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "check",
      size: 15
    }),
    onClick: () => onStatus(article, 'publicado')
  }, "Aprobar y publicar"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    block: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "corner-up-left",
      size: 15
    })
  }, "Devolver al editor")) : /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)',
      lineHeight: 1.5,
      display: 'flex',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "info",
    size: 15,
    style: {
      marginTop: 1
    }
  }), "Un coordinador no puede publicar su propio contenido. Solo puede aprobar art\xEDculos de otros editores.")))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Referencias",
    accent: "var(--brand-accent)",
    actions: /*#__PURE__*/React.createElement("a", {
      href: "#",
      style: {
        fontSize: 'var(--fs-xs)'
      }
    }, "+ A\xF1adir")
  }, [['Superintendencia Financiera', 'superfinanciera.gov.co'], ['Banca de las Oportunidades', 'bancadelasoportunidades.gov.co']].map(r => /*#__PURE__*/React.createElement("div", {
    key: r[0],
    style: {
      padding: '8px 0',
      borderBottom: '1px dotted var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, r[0]), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-link)'
    }
  }, r[1])))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Cuestionario",
    accent: "var(--cat-inversion)"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 10px',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "3 preguntas asociadas a este art\xEDculo."), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "clipboard-check",
      size: 15
    })
  }, "Editar cuestionario"))));
}
function App() {
  const [role, setRole] = useState('editor');
  const [view, setView] = useState('dash');
  const [current, setCurrent] = useState(null);
  const [items, setItems] = useState(SEED);
  const [toast, setToast] = useState(null);
  useLayoutEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  });
  const go = (v, payload) => {
    if (payload) setCurrent(payload);
    setView(v);
  };
  const onStatus = (article, status) => {
    setItems(items.map(a => a.id === article.id ? {
      ...a,
      status
    } : a));
    setCurrent({
      ...article,
      status
    });
    setToast(status === 'revision' ? 'Artículo enviado a revisión.' : 'Artículo publicado en el catálogo.');
    setTimeout(() => setToast(null), 2600);
    setView('dash');
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      overflow: 'auto',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    role: role,
    setRole: r => {
      setRole(r);
      setView('dash');
    },
    go: go
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1240,
      margin: '0 auto',
      padding: '18px',
      display: 'grid',
      gridTemplateColumns: '220px 1fr',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(SideMenu, {
    go: go
  }), /*#__PURE__*/React.createElement("main", null, view === 'dash' && /*#__PURE__*/React.createElement(Dashboard, {
    role: role,
    items: items,
    go: go
  }), view === 'edit' && current && /*#__PURE__*/React.createElement(Editor, {
    article: current,
    role: role,
    go: go,
    onStatus: onStatus
  }))), toast && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'fixed',
      bottom: 22,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--warm-900)',
      color: '#fff',
      padding: '11px 18px',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-pop)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 'var(--fs-sm)',
      zIndex: 50
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-circle",
    size: 17,
    color: "var(--gold-400)"
  }), toast));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/editorial/app.js", error: String((e && e.message) || e) }); }

// ui_kits/learner/app.js
try { (() => {
/* global React */
const {
  Button,
  Input,
  Tag,
  Badge,
  ProgressBar,
  ModuleBox,
  Card,
  Tabs,
  Avatar
} = window.FintCartDesignSystem_cf1e0c;
const {
  useState,
  useEffect,
  useRef,
  useLayoutEffect
} = React;
const D = window.LEARN;
const COP = n => '$ ' + n.toLocaleString('es-CO');

/* ---- Lucide icon helper ---- */
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}
function useIcons(dep) {}
const catOf = id => D.categories.find(c => c.id === id) || D.categories[0];

/* ================= Chrome ================= */
function TopBar({
  go,
  view,
  onSearch
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 20,
      background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-default)',
      boxShadow: 'var(--shadow-xs)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1180,
      margin: '0 auto',
      padding: '10px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => go('home'),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      cursor: 'pointer',
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "34",
    height: "34",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 23,
      letterSpacing: '-0.5px',
      color: 'var(--warm-900)'
    }
  }, "Fint", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-400)'
    }
  }, "Cart"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 460,
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("input", {
    onChange: e => onSearch && onSearch(e.target.value),
    placeholder: "Buscar art\xEDculos, conceptos, simuladores\u2026",
    style: {
      width: '100%',
      height: 38,
      padding: '0 14px 0 38px',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      border: '2px solid var(--purple-400)',
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      color: 'var(--text-body)',
      background: 'var(--surface-card)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 12,
      top: 10,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("button", {
    title: "Notificaciones",
    style: {
      position: 'relative',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-muted)',
      padding: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 20
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: 'var(--coral-400)',
      border: '1.5px solid var(--surface-card)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    onClick: () => go('profile'),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: D.user.name,
    size: 32
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, D.user.name.split(' ')[0])))), /*#__PURE__*/React.createElement("nav", {
    style: {
      borderTop: '1px solid var(--border-subtle)',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1180,
      margin: '0 auto',
      padding: '0 20px',
      display: 'flex',
      gap: 4
    }
  }, [['home', 'Inicio'], ['catalog', 'Catálogo'], ['sim', 'Simuladores'], ['profile', 'Mi progreso'], ['help', 'Ayuda']].map(([id, label]) => {
    const on = view === id || view === 'home' && id === 'home' || view === 'article' && id === 'catalog';
    return /*#__PURE__*/React.createElement("a", {
      key: id,
      onClick: () => go(id === 'sim' ? 'sim' : id === 'catalog' ? 'home' : id === 'help' ? 'home' : id),
      style: {
        padding: '9px 12px',
        fontSize: 'var(--fs-sm)',
        fontWeight: on ? 700 : 500,
        cursor: 'pointer',
        color: on ? 'var(--text-strong)' : 'var(--text-link)',
        borderBottom: `2px solid ${on ? 'var(--coral-400)' : 'transparent'}`
      }
    }, label);
  }))));
}
function Footer() {
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--border-default)',
      background: 'var(--surface-card)',
      marginTop: 32
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1180,
      margin: '0 auto',
      padding: '20px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: 16,
      alignItems: 'center',
      justifyContent: 'space-between'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 16,
      fontSize: 'var(--fs-xs)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "T\xE9rminos"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Pol\xEDtica de datos (Ley 1581)"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Ayuda"), /*#__PURE__*/React.createElement("a", {
    href: "#"
  }, "Contacto")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-2xs)',
      color: 'var(--text-faint)'
    }
  }, "\xA9 2026 FintCart \xB7 Educaci\xF3n financiera para Colombia")));
}

/* ================= Sidebars ================= */
function ServicesRail({
  activeCat,
  onCat
}) {
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Categor\xEDas",
    accent: "var(--brand-primary)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    className: "fc-linklist",
    style: {
      padding: '4px 12px'
    }
  }, D.categories.map(c => /*#__PURE__*/React.createElement("li", {
    key: c.id
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => onCat(activeCat === c.id ? null : c.id),
    style: {
      cursor: 'pointer',
      color: activeCat === c.id ? 'var(--text-strong)' : 'var(--text-link)',
      fontWeight: activeCat === c.id ? 700 : 400
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: c.color,
      flex: 'none'
    }
  }), c.label))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Mi progreso",
    accent: "var(--brand-accent)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 28,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, D.user.points), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "/ ", D.user.nextLevel, " pts")), /*#__PURE__*/React.createElement(ProgressBar, {
    value: D.user.points,
    max: D.user.nextLevel
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 10,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "Nivel: ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-strong)'
    }
  }, D.user.level)), /*#__PURE__*/React.createElement("span", null, "\uD83D\uDD25 ", D.user.streak, " d\xEDas"))));
}
function RightRail({
  go
}) {
  const ranking = [['Andrés G.', 1840], ['Laura C.', 1620], ['Mariana L.', 680], ['Carlos M.', 540]];
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Continuar aprendiendo",
    accent: "var(--cat-inversion)"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 4px',
      fontWeight: 700,
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-strong)'
    }
  }, "Diversificar: primeros pasos"), /*#__PURE__*/React.createElement(ProgressBar, {
    value: 2,
    max: 3,
    size: "sm",
    tone: "var(--cat-inversion)"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '8px 0 0',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "2 de 3 secciones \xB7 Quiz pendiente"), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm",
    style: {
      marginTop: 10,
      width: '100%'
    },
    onClick: () => go('article', D.articles[3])
  }, "Retomar")), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Ranking de la semana",
    accent: "var(--gold-500)",
    padded: false
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("tbody", null, ranking.map((r, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      background: r[0] === 'Mariana L.' ? 'var(--gold-50)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '7px 12px',
      width: 22,
      color: 'var(--text-faint)',
      fontWeight: 700
    }
  }, i + 1), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '7px 4px',
      fontWeight: r[0] === 'Mariana L.' ? 700 : 400,
      color: 'var(--text-body)'
    }
  }, r[0]), /*#__PURE__*/React.createElement("td", {
    className: "fc-num",
    style: {
      padding: '7px 12px',
      textAlign: 'right',
      color: 'var(--text-muted)'
    }
  }, r[1])))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Notificaciones",
    accent: "var(--brand-primary)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0
    }
  }, D.notifications.map((n, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      display: 'flex',
      gap: 9,
      padding: '10px 12px',
      borderBottom: i < D.notifications.length - 1 ? '1px dotted var(--border-default)' : 'none',
      background: n.unread ? 'var(--coral-50)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-500)',
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n.icon,
    size: 16
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-body)',
      lineHeight: 1.4
    }
  }, n.text), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, n.time)))))));
}

/* ================= Catalog ================= */
function ArticleRow({
  a,
  go
}) {
  const c = catOf(a.cat);
  return /*#__PURE__*/React.createElement("div", {
    onClick: () => go('article', a),
    style: {
      display: 'flex',
      gap: 14,
      padding: '12px 0',
      borderBottom: '1px dotted var(--border-default)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 96,
      height: 72,
      flex: 'none',
      borderRadius: 'var(--radius-sm)',
      background: `linear-gradient(135deg, ${c.color}22, ${c.color}11)`,
      border: `1px solid var(--border-subtle)`,
      display: 'grid',
      placeItems: 'center',
      color: c.color
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.cat === 'ahorro' ? 'piggy-bank' : a.cat === 'credito' ? 'credit-card' : a.cat === 'presupuesto' ? 'wallet' : a.cat === 'inversion' ? 'trending-up' : 'landmark',
    size: 26
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    color: c.color
  }, c.label), a.new && /*#__PURE__*/React.createElement(Badge, {
    tone: "brand"
  }, "Nuevo")), /*#__PURE__*/React.createElement("h4", {
    style: {
      margin: '0 0 3px',
      fontSize: 'var(--fs-md)',
      fontFamily: 'var(--font-display)',
      color: 'var(--text-strong)'
    }
  }, a.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      lineHeight: 1.4
    }
  }, a.dek), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 5,
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, a.minutes, " min \xB7 +", a.points, " pts \xB7 ", a.author)));
}
function Catalog({
  go,
  activeCat,
  setActiveCat,
  query
}) {
  const tabs = [{
    id: 'todos',
    label: 'Todos'
  }, ...D.categories.map(c => ({
    id: c.id,
    label: c.label
  }))];
  const [tab, setTab] = useState('todos');
  let list = D.articles;
  if (activeCat) list = list.filter(a => a.cat === activeCat);else if (tab !== 'todos') list = list.filter(a => a.cat === tab);
  if (query) list = list.filter(a => (a.title + a.dek).toLowerCase().includes(query.toLowerCase()));
  const hero = D.articles[0];
  const c = catOf(hero.cat);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padded: false,
    interactive: true,
    style: {
      display: 'flex',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: () => go('article', hero),
    style: {
      display: 'flex',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 280,
      flex: 'none',
      background: `linear-gradient(140deg, ${c.color}, var(--coral-400))`,
      color: '#fff',
      padding: 20,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "piggy-bank",
    size: 40,
    style: {
      opacity: 0.9,
      marginBottom: 'auto'
    }
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: "accent",
    variant: "solid",
    style: {
      alignSelf: 'flex-start'
    }
  }, "Destacado")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 20,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    color: c.color
  }, c.label), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: '10px 0 6px',
      fontSize: 'var(--fs-3xl)'
    }
  }, hero.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: 'var(--fs-md)',
      color: 'var(--text-muted)',
      maxWidth: 520
    }
  }, hero.dek), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 16
    })
  }, "Leer y resolver"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)'
    }
  }, hero.minutes, " min \xB7 +", hero.points, " pts"))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: activeCat ? catOf(activeCat).label : 'Catálogo de contenido',
    accent: "var(--brand-interactive)",
    actions: activeCat ? /*#__PURE__*/React.createElement("a", {
      onClick: () => setActiveCat(null),
      style: {
        cursor: 'pointer',
        fontSize: 'var(--fs-xs)'
      }
    }, "Quitar filtro") : null,
    padded: false
  }, !activeCat && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 12px'
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    tabs: tabs,
    value: tab,
    onChange: setTab
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '4px 14px 10px'
    }
  }, list.length ? list.map(a => /*#__PURE__*/React.createElement(ArticleRow, {
    key: a.id,
    a: a,
    go: go
  })) : /*#__PURE__*/React.createElement("p", {
    style: {
      padding: 20,
      color: 'var(--text-muted)',
      textAlign: 'center'
    }
  }, "Sin resultados."))));
}

/* ================= Article + Quiz ================= */
function Quiz({
  article,
  onComplete
}) {
  const qs = D.quiz[article.id];
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const correct = qs.filter((q, i) => answers[i] === q.answer).length;
  const score = Math.round(correct / qs.length * 100);
  if (submitted) {
    const pass = score >= 67;
    return /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        padding: '8px 0'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 64,
        height: 64,
        borderRadius: '50%',
        margin: '0 auto 12px',
        display: 'grid',
        placeItems: 'center',
        background: pass ? 'var(--success-soft)' : 'var(--warning-soft)',
        color: pass ? 'var(--success)' : 'var(--warning)'
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: pass ? 'badge-check' : 'rotate-ccw',
      size: 32
    })), /*#__PURE__*/React.createElement("h3", {
      style: {
        margin: '0 0 4px'
      }
    }, pass ? '¡Bien hecho!' : 'Casi lo logras'), /*#__PURE__*/React.createElement("p", {
      style: {
        margin: '0 0 12px',
        color: 'var(--text-muted)',
        fontSize: 'var(--fs-sm)'
      }
    }, "Obtuviste ", /*#__PURE__*/React.createElement("strong", {
      className: "fc-num",
      style: {
        color: 'var(--text-strong)'
      }
    }, score, "/100"), " \xB7 ", correct, " de ", qs.length, " correctas"), pass && /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      variant: "solid",
      style: {
        marginBottom: 14
      }
    }, "+", Math.round(article.points * score / 100), " puntos de progreso"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'center',
        marginTop: 8
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "secondary",
      size: "sm",
      onClick: () => {
        setSubmitted(false);
        setAnswers({});
      }
    }, "Reintentar"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm",
      onClick: onComplete
    }, "Continuar")));
  }
  return /*#__PURE__*/React.createElement("div", null, qs.map((q, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      marginBottom: 16,
      paddingBottom: 16,
      borderBottom: i < qs.length - 1 ? '1px dotted var(--border-default)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 9px',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      color: 'var(--brand-interactive)',
      marginRight: 6
    }
  }, i + 1, "."), q.q), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, q.options.map((opt, oi) => {
    const sel = answers[i] === oi;
    return /*#__PURE__*/React.createElement("label", {
      key: oi,
      onClick: () => setAnswers({
        ...answers,
        [i]: oi
      }),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        cursor: 'pointer',
        border: `1.5px solid ${sel ? 'var(--purple-400)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-md)',
        background: sel ? 'var(--purple-50)' : 'var(--surface-card)',
        fontSize: 'var(--fs-sm)',
        color: 'var(--text-body)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: `1.5px solid ${sel ? 'var(--purple-500)' : 'var(--border-strong)'}`,
        background: sel ? 'var(--purple-500)' : 'transparent',
        flex: 'none'
      }
    }), opt);
  })))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    block: true,
    disabled: Object.keys(answers).length < qs.length,
    onClick: () => setSubmitted(true)
  }, "Enviar respuestas"));
}
function ArticleView({
  article,
  go
}) {
  const c = catOf(article.cat);
  const related = D.articles.filter(a => a.cat === article.cat && a.id !== article.id).slice(0, 3);
  const moreRelated = related.length ? related : D.articles.filter(a => a.id !== article.id).slice(0, 3);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => go('home'),
    style: {
      cursor: 'pointer'
    }
  }, "Inicio"), /*#__PURE__*/React.createElement("span", null, "\u203A"), /*#__PURE__*/React.createElement("a", {
    onClick: () => go('home'),
    style: {
      cursor: 'pointer'
    }
  }, c.label), /*#__PURE__*/React.createElement("span", null, "\u203A"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "Art\xEDculo")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 280px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Tag, {
    color: c.color
  }, c.label), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '10px 0 8px',
      fontSize: 'var(--fs-4xl)',
      lineHeight: 1.1
    }
  }, article.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 12px',
      fontSize: 'var(--fs-lg)',
      fontFamily: 'var(--font-display)',
      fontStyle: 'italic',
      color: 'var(--text-muted)'
    }
  }, article.dek), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center',
      paddingBottom: 14,
      marginBottom: 14,
      borderBottom: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: article.author,
    size: 30
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-xs)'
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-strong)'
    }
  }, article.author), /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--text-faint)'
    }
  }, article.date, " \xB7 ", article.minutes, " min de lectura"))), article.body.map((p, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--fs-md)',
      lineHeight: 1.65,
      color: 'var(--text-body)',
      margin: '0 0 14px'
    }
  }, p), i === 1 && /*#__PURE__*/React.createElement("blockquote", {
    style: {
      margin: '4px 0 18px',
      padding: '14px 18px',
      borderLeft: '3px solid var(--brand-accent)',
      background: 'var(--gold-50)',
      borderRadius: '0 var(--radius-md) var(--radius-md) 0'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-display)',
      fontSize: 'var(--fs-xl)',
      color: 'var(--warm-900)',
      lineHeight: 1.35
    }
  }, article.key))))), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Cuestionario",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "clipboard-check",
      size: 16
    }),
    accent: "var(--brand-primary)"
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '0 0 14px',
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)'
    }
  }, "Responde para sumar puntos. Puedes reintentar las veces que quieras; cuenta tu mejor resultado."), /*#__PURE__*/React.createElement(Quiz, {
    article: article,
    onComplete: () => go('profile')
  }))), /*#__PURE__*/React.createElement("aside", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      position: 'sticky',
      top: 110
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Tu progreso",
    accent: "var(--brand-accent)"
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    value: D.user.points,
    max: D.user.nextLevel,
    showValue: true,
    label: "Puntos"
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '10px 0 0',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "Completa este cuestionario para sumar hasta ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-strong)'
    }
  }, "+", article.points), ".")), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Relacionados",
    accent: "var(--cat-inversion)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    className: "fc-linklist",
    style: {
      padding: '4px 12px'
    }
  }, moreRelated.map(a => /*#__PURE__*/React.createElement("li", {
    key: a.id
  }, /*#__PURE__*/React.createElement("a", {
    onClick: () => go('article', a),
    style: {
      cursor: 'pointer'
    }
  }, a.title))))))));
}

/* ================= Profile ================= */
function Profile({
  go
}) {
  const history = [['Cómo armar un fondo de emergencia', 'Ahorro', 100, '12 jun'], ['La regla 50/30/20', 'Presupuesto', 80, '10 jun'], ['Entender la tasa E.A.', 'Crédito', 67, '8 jun'], ['Diversificar: primeros pasos', 'Inversión', 90, '5 jun']];
  const stat = (label, value, icon, color) => /*#__PURE__*/React.createElement(Card, {
    style: {
      flex: 1,
      minWidth: 150
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      color,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 18
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-2xs)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)'
    }
  }, label)), /*#__PURE__*/React.createElement("div", {
    className: "fc-num",
    style: {
      fontSize: 30,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, value));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    style: {
      display: 'flex',
      gap: 18,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: D.user.name,
    size: 64
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: '0 0 2px',
      fontSize: 'var(--fs-2xl)'
    }
  }, D.user.name), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)'
    }
  }, D.user.email, " \xB7 Nivel ", D.user.level)), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 16
    })
  }, "Editar perfil")), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Progreso general",
    accent: "var(--brand-accent)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 38,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, D.user.points), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, "de ", D.user.nextLevel, " pts para nivel Avanzado")), /*#__PURE__*/React.createElement(ProgressBar, {
    value: D.user.points,
    max: D.user.nextLevel,
    size: "lg"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 14,
      flexWrap: 'wrap'
    }
  }, stat('Artículos leídos', D.user.articlesRead, 'book-open', 'var(--cat-inversion)'), stat('Cuestionarios', D.user.quizzesDone, 'clipboard-check', 'var(--coral-400)'), stat('Racha', D.user.streak + ' días', 'flame', 'var(--gold-500)'), stat('Simulaciones', 7, 'calculator', 'var(--success)')), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Historial de cuestionarios",
    accent: "var(--brand-interactive)",
    padded: false
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
    style: {
      textAlign: 'left',
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-xs)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 14px',
      fontWeight: 700
    }
  }, "Art\xEDculo"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 14px',
      fontWeight: 700
    }
  }, "Categor\xEDa"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 14px',
      fontWeight: 700,
      textAlign: 'right'
    }
  }, "Mejor puntaje"), /*#__PURE__*/React.createElement("th", {
    style: {
      padding: '9px 14px',
      fontWeight: 700,
      textAlign: 'right'
    }
  }, "Fecha"))), /*#__PURE__*/React.createElement("tbody", null, history.map((h, i) => /*#__PURE__*/React.createElement("tr", {
    key: i,
    style: {
      borderTop: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 14px',
      color: 'var(--text-strong)',
      fontWeight: 500
    }
  }, h[0]), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 14px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, h[1])), /*#__PURE__*/React.createElement("td", {
    className: "fc-num",
    style: {
      padding: '10px 14px',
      textAlign: 'right',
      color: h[2] >= 80 ? 'var(--success)' : 'var(--text-body)',
      fontWeight: 600
    }
  }, h[2], "/100"), /*#__PURE__*/React.createElement("td", {
    style: {
      padding: '10px 14px',
      textAlign: 'right',
      color: 'var(--text-faint)',
      fontSize: 'var(--fs-xs)'
    }
  }, h[3])))))));
}

/* ================= Root ================= */
function App() {
  const [view, setView] = useState('home');
  const [article, setArticle] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const [query, setQuery] = useState('');
  const scroller = useRef(null);
  useIcons([view, article, activeCat, query]);
  const go = (v, payload) => {
    if (v === 'article') setArticle(payload);
    if (v === 'sim') {
      window.location.href = '../simulators/index.html';
      return;
    }
    setView(v);
    if (scroller.current) scroller.current.scrollTop = 0;
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: scroller,
    style: {
      height: '100%',
      overflow: 'auto',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(TopBar, {
    go: go,
    view: view,
    onSearch: setQuery
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      maxWidth: 1180,
      margin: '0 auto',
      padding: '18px 20px'
    }
  }, view === 'home' && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '200px 1fr 256px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(ServicesRail, {
    activeCat: activeCat,
    onCat: c => {
      setActiveCat(c);
      setQuery('');
    }
  }), /*#__PURE__*/React.createElement(Catalog, {
    go: go,
    activeCat: activeCat,
    setActiveCat: setActiveCat,
    query: query
  }), /*#__PURE__*/React.createElement(RightRail, {
    go: go
  })), view === 'article' && article && /*#__PURE__*/React.createElement(ArticleView, {
    article: article,
    go: go
  }), view === 'profile' && /*#__PURE__*/React.createElement(Profile, {
    go: go
  })), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/learner/app.js", error: String((e && e.message) || e) }); }

// ui_kits/learner/data.js
try { (() => {
/* FintCart — Learner app demo data (Spanish / Colombia). Plain global, no bundler. */
window.LEARN = function () {
  const categories = [{
    id: 'ahorro',
    label: 'Ahorro',
    color: 'var(--cat-ahorro)'
  }, {
    id: 'credito',
    label: 'Crédito',
    color: 'var(--cat-credito)'
  }, {
    id: 'presupuesto',
    label: 'Presupuesto',
    color: 'var(--cat-presupuesto)'
  }, {
    id: 'inversion',
    label: 'Inversión',
    color: 'var(--cat-inversion)'
  }, {
    id: 'colombia',
    label: 'Contexto Colombia',
    color: 'var(--cat-colombia)'
  }];
  const articles = [{
    id: 'fondo-emergencia',
    cat: 'ahorro',
    minutes: 6,
    points: 100,
    new: true,
    title: 'Cómo armar un fondo de emergencia',
    dek: 'Tres a seis meses de gastos, guardados en pesos y disponibles cuando los necesites.',
    author: 'Valentina Ríos',
    date: '12 jun 2026',
    body: ['Un fondo de emergencia es dinero que apartas para imprevistos: una reparación, una urgencia médica o quedarte sin ingresos por un tiempo. No es para inversión ni para gastos planeados.', '¿Cuánto guardar? Una buena meta inicial es un mes de tus gastos esenciales. Luego apunta a tres meses y, si tu ingreso es variable, a seis.', 'Dónde guardarlo: en una cuenta de fácil acceso y bajo riesgo. La liquidez importa más que la rentabilidad: este dinero debe estar disponible el mismo día.', 'Empieza pequeño. Aparta un monto fijo cada quincena —aunque sean $50.000— y automatiza la transferencia el día de pago. La constancia pesa más que el monto.'],
    key: 'La liquidez importa más que la rentabilidad en tu fondo de emergencia.'
  }, {
    id: 'tasa-ea',
    cat: 'credito',
    minutes: 8,
    points: 120,
    title: 'Entender la tasa E.A. de tu crédito',
    dek: 'Qué significa “Efectivo Anual”, por qué difiere de la tasa mensual y cómo compararla.',
    author: 'Carlos Mejía',
    date: '9 jun 2026',
    body: ['En Colombia las tasas de crédito suelen expresarse como Efectivo Anual (E.A.). Es el costo real del dinero en un año, incluyendo el efecto del interés compuesto.', 'Una tasa de 1,8% mensual no es 21,6% anual: por el interés compuesto equivale aproximadamente a 23,9% E.A. Siempre compara créditos usando la misma base.', 'La tasa de usura, fijada por la Superintendencia Financiera, es el tope legal que ninguna entidad puede superar. Conocerla te protege.'],
    key: 'Compara siempre créditos usando la misma base: la tasa Efectivo Anual.'
  }, {
    id: 'regla-50-30-20',
    cat: 'presupuesto',
    minutes: 5,
    points: 80,
    new: true,
    title: 'La regla 50/30/20 para tu presupuesto',
    dek: 'Una forma simple de repartir tu ingreso entre necesidades, gustos y ahorro.',
    author: 'Daniela Ospina',
    date: '7 jun 2026',
    body: ['La regla 50/30/20 reparte tu ingreso mensual en tres bloques: 50% para necesidades, 30% para gustos y 20% para ahorro o pago de deudas.', 'Necesidades son gastos que no puedes evitar: arriendo, servicios, transporte, mercado. Gustos son opcionales: salidas, suscripciones, antojos.', 'No es una ley rígida. Si tu arriendo se lleva el 55%, ajusta los otros bloques. Lo importante es que el ahorro tenga un lugar fijo, no lo que sobre.'],
    key: 'El ahorro merece un lugar fijo en tu presupuesto, no solo lo que sobra.'
  }, {
    id: 'diversificar',
    cat: 'inversion',
    minutes: 7,
    points: 110,
    title: 'Diversificar: primeros pasos en inversión',
    dek: 'No pongas todos los huevos en la misma canasta. Qué significa en la práctica.',
    author: 'Andrés Gómez',
    date: '4 jun 2026',
    body: ['Diversificar es repartir tu dinero entre distintos tipos de activos para que el mal desempeño de uno no arrastre todo tu patrimonio.', 'Para empezar no necesitas grandes sumas. Los fondos de inversión colectiva permiten participar con montos bajos y dejan la diversificación en manos de un gestor.', 'El riesgo y el rendimiento van de la mano: a mayor rentabilidad esperada, mayor riesgo. Define tu horizonte antes de elegir.'],
    key: 'A mayor rentabilidad esperada, mayor riesgo: define tu horizonte primero.'
  }, {
    id: 'declaracion-renta',
    cat: 'colombia',
    minutes: 9,
    points: 130,
    title: '¿Debo declarar renta este año?',
    dek: 'Topes de ingresos, patrimonio y consumos que te obligan a declarar en Colombia.',
    author: 'Laura Castaño',
    date: '1 jun 2026',
    body: ['No todas las personas deben declarar renta. La obligación depende de topes anuales de ingresos, patrimonio, consumos con tarjeta y movimientos bancarios.', 'Declarar no siempre significa pagar. Muchas personas declaran y obtienen saldo a favor por retenciones que les practicaron durante el año.', 'Guarda tus certificados de ingresos y retenciones: son la base para diligenciar la declaración correctamente.'],
    key: 'Declarar no siempre significa pagar: puedes tener saldo a favor.'
  }, {
    id: 'cdt-vs-cuenta',
    cat: 'ahorro',
    minutes: 6,
    points: 90,
    title: 'CDT vs. cuenta de ahorros: ¿cuál elegir?',
    dek: 'Rentabilidad, liquidez y plazo: las tres variables que definen tu decisión.',
    author: 'Valentina Ríos',
    date: '28 may 2026',
    body: ['Un CDT (Certificado de Depósito a Término) ofrece una tasa fija a cambio de inmovilizar tu dinero por un plazo. La cuenta de ahorros da liquidez total con menor rentabilidad.', 'Si sabes que no tocarás ese dinero por seis meses o más, un CDT suele rendir más. Si puedes necesitarlo en cualquier momento, prioriza la cuenta.', 'Ambos están cubiertos por el seguro de depósitos de Fogafín hasta el tope vigente, lo que aporta seguridad a tu capital.'],
    key: 'Plazo conocido y sin necesidad de liquidez: el CDT suele rendir más.'
  }];
  const quiz = {
    'fondo-emergencia': [{
      q: '¿Cuál es la prioridad principal de un fondo de emergencia?',
      options: ['Máxima rentabilidad', 'Liquidez y disponibilidad', 'Beneficios tributarios'],
      answer: 1
    }, {
      q: 'Una meta inicial razonable es guardar…',
      options: ['Un mes de gastos esenciales', 'Diez años de ingresos', 'El valor de un carro'],
      answer: 0
    }, {
      q: '¿Qué ayuda más a construir el fondo?',
      options: ['Esperar a que sobre dinero', 'Apartar un monto fijo automatizado', 'Invertir en acciones'],
      answer: 1
    }]
  };
  // reuse a generic quiz for articles without one
  articles.forEach(a => {
    if (!quiz[a.id]) quiz[a.id] = quiz['fondo-emergencia'];
  });
  const user = {
    name: 'Mariana López',
    email: 'mariana@correo.com',
    points: 680,
    level: 'Intermedio',
    nextLevel: 1000,
    streak: 4,
    articlesRead: 11,
    quizzesDone: 9
  };
  const notifications = [{
    icon: 'badge-check',
    text: 'Aprobaste el cuestionario “Fondo de emergencia” con 100/100.',
    time: 'hace 2 h',
    unread: true
  }, {
    icon: 'file-text',
    text: 'Nuevo artículo publicado en Inversión.',
    time: 'hace 5 h',
    unread: true
  }, {
    icon: 'trending-up',
    text: 'Alcanzaste 680 puntos de progreso.',
    time: 'ayer',
    unread: false
  }];
  return {
    categories,
    articles,
    quiz,
    user,
    notifications
  };
}();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/learner/data.js", error: String((e && e.message) || e) }); }

// ui_kits/learner/portal.js
try { (() => {
/* global React */
const {
  Badge,
  Tag,
  ProgressBar,
  Avatar,
  Button
} = window.FintCartDesignSystem_cf1e0c;
const {
  useState
} = React;
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}

/* ---------- Frutiger Aero glass primitives (palette unchanged) ---------- */
const glass = {
  background: 'linear-gradient(157deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.50) 100%)',
  backdropFilter: 'blur(16px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.25)',
  border: '1px solid rgba(255,255,255,0.75)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 6px 20px rgba(28,24,21,0.10), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -10px 22px rgba(255,255,255,0.30)'
};
function GlassModule({
  title,
  icon,
  accent = 'var(--brand-primary)',
  actions,
  children,
  style,
  bodyStyle
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      ...glass,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style
    }
  }, title && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      padding: '7px 11px',
      flex: 'none',
      background: `linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.35))`,
      borderBottom: '1px solid rgba(255,255,255,0.6)',
      boxShadow: `inset 3px 0 0 ${accent}`
    }
  }, icon && /*#__PURE__*/React.createElement("span", {
    style: {
      color: accent,
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 15
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      color: 'var(--text-strong)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, title), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center'
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 11,
      flex: 1,
      minHeight: 0,
      ...bodyStyle
    }
  }, children));
}

/* ---------- data ---------- */
const CATS = [{
  id: 'ahorros',
  label: 'Ahorros',
  icon: 'piggy-bank',
  color: 'var(--cat-ahorro)',
  pct: 75
}, {
  id: 'creditos',
  label: 'Créditos',
  icon: 'credit-card',
  color: 'var(--cat-credito)',
  pct: 40
}, {
  id: 'inversion',
  label: 'Inversión',
  icon: 'trending-up',
  color: 'var(--cat-inversion)',
  pct: 20
}, {
  id: 'presupuesto',
  label: 'Presupuesto',
  icon: 'wallet',
  color: 'var(--cat-presupuesto)',
  pct: 60
}, {
  id: 'colombia',
  label: 'Colombia',
  icon: 'landmark',
  color: 'var(--cat-colombia)',
  pct: 30
}];
const DIFF = {
  principiante: {
    label: 'Principiante',
    tone: 'success'
  },
  intermedio: {
    label: 'Intermedio',
    tone: 'accent'
  },
  avanzado: {
    label: 'Avanzado',
    tone: 'info'
  }
};
const ARTICLES = [{
  id: 1,
  title: 'Cómo armar un fondo de emergencia',
  cat: 'ahorros',
  min: 6,
  diff: 'principiante',
  status: 'done'
}, {
  id: 2,
  title: 'Entender la tasa E.A. de tu crédito',
  cat: 'creditos',
  min: 8,
  diff: 'intermedio',
  status: 'progress',
  prog: 60
}, {
  id: 3,
  title: 'La regla 50/30/20 del presupuesto',
  cat: 'presupuesto',
  min: 5,
  diff: 'principiante',
  status: 'new'
}, {
  id: 4,
  title: 'Diversificar: primeros pasos',
  cat: 'inversion',
  min: 7,
  diff: 'avanzado',
  status: 'todo'
}, {
  id: 5,
  title: '¿Debo declarar renta este año?',
  cat: 'colombia',
  min: 9,
  diff: 'intermedio',
  status: 'new'
}, {
  id: 6,
  title: 'CDT vs. cuenta de ahorros',
  cat: 'ahorros',
  min: 6,
  diff: 'principiante',
  status: 'done'
}];
const catOf = id => CATS.find(c => c.id === id);
const ACTIVITY = [{
  icon: 'badge-check',
  color: 'var(--success)',
  text: 'Aprobaste el quiz “Fondo de emergencia” · 100/100',
  time: 'hace 2 h'
}, {
  icon: 'book-open',
  color: 'var(--cat-inversion)',
  text: 'Leíste “Diversificar: primeros pasos”',
  time: 'hace 4 h'
}, {
  icon: 'calculator',
  color: 'var(--cat-credito)',
  text: 'Simulaste una cuota de crédito',
  time: 'ayer'
}, {
  icon: 'flame',
  color: 'var(--gold-500)',
  text: 'Mantuviste tu racha de 4 días',
  time: 'ayer'
}];

/* ---------- status chip ---------- */
function StatusChip({
  status,
  prog
}) {
  if (status === 'done') return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 10,
      fontWeight: 700,
      color: 'var(--success)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check-circle",
    size: 13
  }), " Completado");
  if (status === 'progress') return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 10,
      fontWeight: 700,
      color: 'var(--gold-600)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "loader",
    size: 13
  }), " ", prog, "%");
  if (status === 'new') return /*#__PURE__*/React.createElement(Badge, {
    tone: "brand"
  }, "Nuevo");
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "circle",
    size: 12
  }), " Sin empezar");
}

/* ---------- article card ---------- */
function ArticleCard({
  a
}) {
  const c = catOf(a.cat);
  const d = DIFF[a.diff];
  return /*#__PURE__*/React.createElement("article", {
    style: {
      ...glass,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      cursor: 'pointer',
      transition: 'transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast)'
    },
    onMouseEnter: e => {
      e.currentTarget.style.transform = 'translateY(-3px)';
      e.currentTarget.style.boxShadow = '0 12px 26px rgba(28,24,21,0.16), inset 0 1px 0 rgba(255,255,255,0.95)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = glass.boxShadow;
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 46,
      flex: 'none',
      borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
      background: `linear-gradient(120deg, ${c.color}, color-mix(in srgb, ${c.color} 55%, var(--coral-400)))`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 11px',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 60%)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      color: '#fff',
      display: 'inline-flex',
      zIndex: 1,
      filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.18))'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: c.icon,
    size: 20
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      zIndex: 1
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    color: "#fff",
    style: {
      background: 'rgba(255,255,255,0.22)',
      borderColor: 'rgba(255,255,255,0.5)',
      color: '#fff'
    }
  }, c.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '9px 11px 10px',
      display: 'flex',
      flexDirection: 'column',
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h4", {
    style: {
      margin: '0 0 8px',
      fontSize: 'var(--fs-sm)',
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      color: 'var(--text-strong)',
      lineHeight: 1.18
    }
  }, a.title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: d.tone
  }, d.label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 10,
      color: 'var(--text-muted)',
      fontFamily: 'var(--font-mono)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clock",
    size: 12
  }), " ", a.min, " min")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      paddingTop: 7,
      borderTop: '1px dotted var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement(StatusChip, {
    status: a.status,
    prog: a.prog
  }))));
}

/* ---------- columns ---------- */
function LeftColumn() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 200,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(GlassModule, {
    title: "Categor\xEDas",
    icon: "layout-grid",
    accent: "var(--brand-primary)",
    style: {
      flex: 1
    },
    bodyStyle: {
      display: 'flex',
      flexDirection: 'column',
      gap: 9,
      padding: 10
    }
  }, CATS.map(c => /*#__PURE__*/React.createElement("a", {
    key: c.id,
    style: {
      textDecoration: 'none',
      display: 'block',
      padding: '6px 7px',
      borderRadius: 'var(--radius-sm)',
      transition: 'background var(--dur-fast)'
    },
    onMouseEnter: e => e.currentTarget.style.background = 'rgba(255,255,255,0.55)',
    onMouseLeave: e => e.currentTarget.style.background = 'transparent'
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: c.color,
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: c.icon,
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, c.label), /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      marginLeft: 'auto',
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, c.pct, "%")), /*#__PURE__*/React.createElement(ProgressBar, {
    value: c.pct,
    size: "sm",
    tone: c.color
  })))), /*#__PURE__*/React.createElement("a", {
    href: "../simulators/index.html",
    style: {
      textDecoration: 'none',
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '11px 12px',
      cursor: 'pointer',
      border: '1px solid var(--coral-500)',
      borderRadius: 'var(--radius-md)',
      color: '#fff',
      fontFamily: 'var(--font-sans)',
      fontWeight: 700,
      fontSize: 'var(--fs-sm)',
      background: 'linear-gradient(180deg, var(--coral-300), var(--coral-500))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 3px 10px rgba(222,77,43,0.35)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calculator",
    size: 17
  }), " Ir a simuladores")));
}
function CenterColumn() {
  const [diff, setDiff] = useState('todos');
  const list = diff === 'todos' ? ARTICLES : ARTICLES.filter(a => a.diff === diff);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xl)',
      lineHeight: 1
    }
  }, "Cat\xE1logo de aprendizaje"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '3px 0 0',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, list.length, " art\xEDculos \xB7 organizados por categor\xEDa y dificultad")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 4,
      ...glass,
      padding: 3,
      borderRadius: 'var(--radius-pill)'
    }
  }, [['todos', 'Todos'], ['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzado', 'Avanzado']].map(([id, label]) => /*#__PURE__*/React.createElement("button", {
    key: id,
    onClick: () => setDiff(id),
    style: {
      border: 'none',
      cursor: 'pointer',
      padding: '5px 12px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 600,
      background: diff === id ? 'var(--brand-interactive)' : 'transparent',
      color: diff === id ? '#fff' : 'var(--text-muted)',
      boxShadow: diff === id ? 'inset 0 1px 0 rgba(255,255,255,0.3)' : 'none'
    }
  }, label)))), /*#__PURE__*/React.createElement("a", {
    style: {
      ...glass,
      padding: 0,
      display: 'flex',
      overflow: 'hidden',
      flex: 'none',
      cursor: 'pointer',
      height: 132
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 188,
      flex: 'none',
      position: 'relative',
      background: 'linear-gradient(135deg, var(--cat-ahorro), var(--coral-400))',
      display: 'flex',
      alignItems: 'flex-end',
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 55%)'
    }
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "piggy-bank",
    size: 40,
    color: "#fff",
    style: {
      position: 'absolute',
      top: 14,
      left: 14,
      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))'
    }
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: "accent",
    variant: "solid",
    style: {
      position: 'relative'
    }
  }, "Destacado de hoy")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 7,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement(Tag, {
    color: "var(--cat-ahorro)"
  }, "Ahorros"), /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, "Principiante")), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: '0 0 5px',
      fontSize: 'var(--fs-2xl)',
      lineHeight: 1.05
    }
  }, "C\xF3mo armar un fondo de emergencia"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "Tres a seis meses de gastos, en pesos \xB7 6 min \xB7 Quiz +100 pts"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 12,
      flex: 1,
      minHeight: 0
    }
  }, list.map(a => /*#__PURE__*/React.createElement(ArticleCard, {
    key: a.id,
    a: a
  }))));
}
function RingProgress({
  value,
  max,
  size = 72
}) {
  const pct = value / max;
  const r = (size - 8) / 2,
    C = 2 * Math.PI * r;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--surface-inset)",
    strokeWidth: "7"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--brand-accent)",
    strokeWidth: "7",
    strokeLinecap: "round",
    strokeDasharray: C,
    strokeDashoffset: C * (1 - pct)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 16,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, Math.round(pct * 100), "%")));
}
function RightColumn() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 280,
      flex: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(GlassModule, {
    title: "Mi progreso",
    icon: "award",
    accent: "var(--brand-accent)",
    style: {
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(RingProgress, {
    value: 680,
    max: 1000
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "fc-num",
    style: {
      fontSize: 24,
      fontWeight: 600,
      color: 'var(--text-strong)',
      lineHeight: 1
    }
  }, "680 ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-faint)'
    }
  }, "/ 1000 pts")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "Nivel ", /*#__PURE__*/React.createElement("strong", {
    style: {
      color: 'var(--text-strong)'
    }
  }, "Intermedio")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      display: 'flex',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "11 le\xEDdos"), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "9 quizzes"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      ...glass,
      padding: '11px 13px',
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'linear-gradient(157deg, rgba(254,246,224,0.85), rgba(255,255,255,0.55))'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: '50%',
      flex: 'none',
      display: 'grid',
      placeItems: 'center',
      background: 'linear-gradient(180deg, var(--gold-300), var(--gold-500))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 3px 8px rgba(238,155,0,0.35)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "flame",
    size: 24,
    color: "#fff"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 700,
      color: 'var(--text-strong)'
    }
  }, "Racha de 4 d\xEDas"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      marginTop: 5
    }
  }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      width: 20,
      height: 20,
      borderRadius: 5,
      display: 'grid',
      placeItems: 'center',
      fontSize: 9,
      fontWeight: 700,
      fontFamily: 'var(--font-mono)',
      color: i < 4 ? '#fff' : 'var(--text-faint)',
      background: i < 4 ? 'var(--gold-400)' : 'var(--surface-inset)',
      boxShadow: i < 4 ? 'inset 0 1px 0 rgba(255,255,255,0.4)' : 'none'
    }
  }, d))))), /*#__PURE__*/React.createElement(GlassModule, {
    title: "Actividad reciente",
    icon: "activity",
    accent: "var(--cat-inversion)",
    style: {
      flex: 1
    },
    bodyStyle: {
      padding: '6px 11px'
    }
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0
    }
  }, ACTIVITY.map((a, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      display: 'flex',
      gap: 9,
      padding: '8px 0',
      borderBottom: i < ACTIVITY.length - 1 ? '1px dotted var(--border-default)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: a.color,
      marginTop: 1,
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: a.icon,
    size: 15
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-body)',
      lineHeight: 1.35
    }
  }, a.text), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: 'var(--text-faint)'
    }
  }, a.time)))))), /*#__PURE__*/React.createElement(GlassModule, {
    title: "Tu siguiente art\xEDculo",
    icon: "sparkles",
    accent: "var(--brand-primary)",
    style: {
      flex: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 40,
      height: 40,
      flex: 'none',
      borderRadius: 'var(--radius-md)',
      display: 'grid',
      placeItems: 'center',
      color: '#fff',
      background: 'linear-gradient(135deg, var(--cat-credito), var(--coral-500))',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "credit-card",
    size: 20
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 700,
      color: 'var(--text-strong)',
      lineHeight: 1.15
    }
  }, "Entender la tasa E.A."), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, "Cr\xE9ditos \xB7 Intermedio \xB7 8 min"))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm",
    block: true,
    style: {
      marginTop: 9
    },
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 14
    })
  }, "Continuar")));
}

/* ---------- navbar ---------- */
function Navbar() {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      flex: 'none',
      height: 58,
      display: 'flex',
      alignItems: 'center',
      gap: 18,
      padding: '0 18px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55))',
      backdropFilter: 'blur(18px) saturate(1.3)',
      WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
      borderBottom: '1px solid rgba(255,255,255,0.7)',
      boxShadow: '0 2px 10px rgba(28,24,21,0.06), inset 0 1px 0 rgba(255,255,255,0.9)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 38,
      height: 38,
      borderRadius: 'var(--radius-md)',
      display: 'grid',
      placeItems: 'center',
      background: 'linear-gradient(160deg, rgba(255,255,255,0.9), rgba(255,255,255,0.4))',
      border: '1px solid rgba(255,255,255,0.8)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(28,24,21,0.1)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-eye.svg",
    width: "30",
    height: "22",
    alt: ""
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 24,
      letterSpacing: '-0.5px',
      color: 'var(--warm-900)'
    }
  }, "Fint", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-400)'
    }
  }, "cart"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 2
    }
  }, [['Inicio', true], ['Catálogo'], ['Simuladores'], ['Mi progreso'], ['Ayuda']].map(([label, on]) => /*#__PURE__*/React.createElement("a", {
    key: label,
    style: {
      padding: '7px 11px',
      fontSize: 'var(--fs-sm)',
      fontWeight: on ? 700 : 500,
      color: on ? 'var(--text-strong)' : 'var(--text-link)',
      borderBottom: `2px solid ${on ? 'var(--coral-400)' : 'transparent'}`,
      cursor: 'pointer',
      whiteSpace: 'nowrap'
    }
  }, label))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 360,
      marginLeft: 'auto',
      position: 'relative',
      display: 'flex'
    }
  }, /*#__PURE__*/React.createElement("input", {
    placeholder: "Buscar art\xEDculos, conceptos\u2026",
    style: {
      width: '100%',
      height: 34,
      padding: '0 12px 0 34px',
      fontFamily: 'var(--font-sans)',
      fontSize: 'var(--fs-sm)',
      borderRadius: 'var(--radius-pill)',
      border: '1px solid rgba(255,255,255,0.9)',
      outline: 'none',
      color: 'var(--text-body)',
      background: 'rgba(255,255,255,0.6)',
      boxShadow: 'inset 0 1px 3px rgba(28,24,21,0.08)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 11,
      top: 8,
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 17
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      color: 'var(--text-muted)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "bell",
    size: 19
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: -2,
      right: -2,
      width: 7,
      height: 7,
      borderRadius: '50%',
      background: 'var(--coral-400)',
      border: '1.5px solid #fff'
    }
  })), /*#__PURE__*/React.createElement(Avatar, {
    name: "Mariana L\xF3pez",
    size: 30
  })));
}
function Portal() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(Navbar, null), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minHeight: 0,
      display: 'flex',
      gap: 14,
      padding: 16
    }
  }, /*#__PURE__*/React.createElement(LeftColumn, null), /*#__PURE__*/React.createElement(CenterColumn, null), /*#__PURE__*/React.createElement(RightColumn, null)));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(Portal, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/learner/portal.js", error: String((e && e.message) || e) }); }

// ui_kits/marketing/app.js
try { (() => {
/* global React */
const {
  Button,
  Tag,
  Badge,
  ModuleBox,
  Card,
  ProgressBar,
  Avatar
} = window.FintCartDesignSystem_cf1e0c;
const {
  useLayoutEffect
} = React;
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}
function Nav() {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 20,
      background: 'rgba(251,248,242,0.9)',
      backdropFilter: 'blur(8px)',
      borderBottom: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '12px 22px',
      display: 'flex',
      alignItems: 'center',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "32",
    height: "32",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 22,
      color: 'var(--warm-900)'
    }
  }, "Fint", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-400)'
    }
  }, "Cart"))), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: 'flex',
      gap: 18,
      marginLeft: 14
    }
  }, ['Cómo funciona', 'Temas', 'Simuladores', 'Para editores'].map(n => /*#__PURE__*/React.createElement("a", {
    key: n,
    href: "#",
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-body)',
      fontWeight: 500
    }
  }, n))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "../auth/index.html"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm"
  }, "Iniciar sesi\xF3n")), /*#__PURE__*/React.createElement("a", {
    href: "../auth/index.html"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "sm"
  }, "Crear cuenta gratis")))));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '46px 22px 30px',
      display: 'grid',
      gridTemplateColumns: '1.1fr 0.9fr',
      gap: 36,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Badge, {
    tone: "accent",
    style: {
      marginBottom: 14
    }
  }, "Educaci\xF3n financiera \xB7 Colombia"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 52,
      lineHeight: 1.06,
      margin: '0 0 16px',
      letterSpacing: '-0.02em'
    }
  }, "Entiende tu plata. ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-400)'
    }
  }, "Sin enredos.")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--fs-lg)',
      color: 'var(--text-muted)',
      margin: '0 0 24px',
      maxWidth: 460
    }
  }, "Aprende con art\xEDculos cortos, pon a prueba lo que sabes con cuestionarios y simula tus decisiones con calculadoras pensadas para Colombia."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "../auth/index.html"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 18
    })
  }, "Empieza gratis")), /*#__PURE__*/React.createElement("a", {
    href: "../learner/index.html"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "lg",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "book-open",
      size: 17
    })
  }, "Ver el cat\xE1logo"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 22,
      marginTop: 28,
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-sm)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16,
    color: "var(--success)"
  }), " 100% gratis"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16,
    color: "var(--success)"
  }), " En espa\xF1ol"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16,
    color: "var(--success)"
  }), " Sin datos bancarios"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Mi progreso",
    accent: "var(--brand-accent)"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 6,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 30,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, "680"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "/ 1000 pts")), /*#__PURE__*/React.createElement(ProgressBar, {
    value: 680,
    max: 1000
  })), /*#__PURE__*/React.createElement(Card, {
    interactive: true,
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 42,
      height: 42,
      borderRadius: 'var(--radius-md)',
      background: 'var(--green-50)',
      color: 'var(--cat-ahorro)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "piggy-bank",
    size: 22
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--text-strong)',
      fontSize: 'var(--fs-sm)'
    }
  }, "Fondo de emergencia"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "6 min \xB7 Quiz +100 pts")), /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 16,
    color: "var(--text-faint)"
  })), /*#__PURE__*/React.createElement(Card, {
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 42,
      height: 42,
      borderRadius: 'var(--radius-md)',
      background: 'var(--coral-50)',
      color: 'var(--cat-credito)',
      display: 'grid',
      placeItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "calculator",
    size: 22
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 700,
      color: 'var(--text-strong)',
      fontSize: 'var(--fs-sm)'
    }
  }, "Cuota de cr\xE9dito"), /*#__PURE__*/React.createElement("div", {
    className: "fc-num",
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)'
    }
  }, "$ 568.900 / mes")), /*#__PURE__*/React.createElement(Badge, {
    tone: "success"
  }, "Simulado"))));
}
function Steps() {
  const steps = [['user-plus', 'Regístrate', 'Crea tu cuenta gratis y verifica tu correo en un minuto.'], ['book-open', 'Aprende', 'Lee artículos cortos por categoría: ahorro, crédito, inversión y más.'], ['clipboard-check', 'Responde', 'Resuelve el cuestionario de cada artículo y suma puntos de progreso.'], ['calculator', 'Simula', 'Pon a prueba tus decisiones con las cinco calculadoras.']];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: 'var(--surface-card)',
      borderTop: '1px solid var(--border-default)',
      borderBottom: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '44px 22px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "fc-eyebrow",
    style: {
      marginBottom: 6
    }
  }, "C\xF3mo funciona"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 'var(--fs-3xl)',
      margin: '0 0 28px'
    }
  }, "Cuatro pasos para tomar mejores decisiones"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 16
    }
  }, steps.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--coral-300)',
      position: 'absolute',
      top: 0,
      right: 0
    }
  }, "0", i + 1), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 46,
      height: 46,
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-page)',
      border: '1px solid var(--border-default)',
      display: 'grid',
      placeItems: 'center',
      color: 'var(--coral-400)',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s[0],
    size: 22
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 'var(--fs-lg)',
      margin: '0 0 5px'
    }
  }, s[1]), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      margin: 0,
      lineHeight: 1.5
    }
  }, s[2]))))));
}
function Topics() {
  const cats = [['Ahorro', 'piggy-bank', 'var(--cat-ahorro)', 24], ['Crédito', 'credit-card', 'var(--cat-credito)', 18], ['Presupuesto', 'wallet', 'var(--cat-presupuesto)', 15], ['Inversión', 'trending-up', 'var(--cat-inversion)', 21], ['Contexto Colombia', 'landmark', 'var(--cat-colombia)', 12]];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '46px 22px'
    }
  }, /*#__PURE__*/React.createElement("p", {
    className: "fc-eyebrow",
    style: {
      marginBottom: 6
    }
  }, "Temas"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 'var(--fs-3xl)',
      margin: '0 0 24px'
    }
  }, "Aprende sobre lo que te importa"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: 14
    }
  }, cats.map(c => /*#__PURE__*/React.createElement(Card, {
    key: c[0],
    interactive: true,
    style: {
      textAlign: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 48,
      height: 48,
      borderRadius: '50%',
      display: 'inline-grid',
      placeItems: 'center',
      background: `${c[2]}18`,
      color: c[2],
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: c[1],
    size: 24
  })), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 'var(--fs-md)',
      margin: '0 0 3px'
    }
  }, c[0]), /*#__PURE__*/React.createElement("p", {
    className: "fc-num",
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)',
      margin: 0
    }
  }, c[3], " art\xEDculos")))));
}
function CTA() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: 1100,
      margin: '0 auto 50px',
      padding: '0 22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'linear-gradient(135deg, var(--warm-900), var(--purple-700))',
      borderRadius: 'var(--radius-xl)',
      padding: '44px 40px',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 24,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h2", {
    style: {
      color: '#fff',
      fontSize: 'var(--fs-4xl)',
      margin: '0 0 8px'
    }
  }, "Tu educaci\xF3n financiera empieza hoy"), /*#__PURE__*/React.createElement("p", {
    style: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 'var(--fs-md)',
      margin: 0
    }
  }, "Gratis, en espa\xF1ol, sin necesidad de datos bancarios.")), /*#__PURE__*/React.createElement("a", {
    href: "../auth/index.html"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "accent",
    size: "lg",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrow-right",
      size: 18
    })
  }, "Crear cuenta gratis"))));
}
function Footer() {
  const cols = [['Producto', ['Catálogo', 'Simuladores', 'Mi progreso', 'Para editores']], ['Temas', ['Ahorro', 'Crédito', 'Inversión', 'Contexto Colombia']], ['Legal', ['Términos', 'Política de datos (Ley 1581)', 'Privacidad']]];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: 'var(--surface-card)',
      borderTop: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '36px 22px',
      display: 'grid',
      gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
      gap: 24
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "30",
    height: "30",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 20,
      color: 'var(--warm-900)'
    }
  }, "FintCart")), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)',
      maxWidth: 240,
      margin: 0
    }
  }, "Educaci\xF3n financiera interactiva para el mercado colombiano.")), cols.map(col => /*#__PURE__*/React.createElement("div", {
    key: col[0]
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 'var(--fs-xs)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-strong)',
      margin: '0 0 10px'
    }
  }, col[0]), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 7
    }
  }, col[1].map(l => /*#__PURE__*/React.createElement("li", {
    key: l
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)'
    }
  }, l))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: '1px solid var(--border-subtle)',
      padding: '14px 22px',
      textAlign: 'center',
      fontSize: 'var(--fs-2xs)',
      color: 'var(--text-faint)'
    }
  }, "\xA9 2026 FintCart \xB7 Educaci\xF3n financiera para Colombia"));
}
function App() {
  useLayoutEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  });
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement(Nav, null), /*#__PURE__*/React.createElement(Hero, null), /*#__PURE__*/React.createElement(Steps, null), /*#__PURE__*/React.createElement(Topics, null), /*#__PURE__*/React.createElement(CTA, null), /*#__PURE__*/React.createElement(Footer, null));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/app.js", error: String((e && e.message) || e) }); }

// ui_kits/simulators/app.js
try { (() => {
/* global React */
const {
  Button,
  Input,
  Select,
  Tag,
  Badge,
  ModuleBox,
  Card,
  ProgressBar,
  Avatar
} = window.FintCartDesignSystem_cf1e0c;
const {
  useState,
  useLayoutEffect,
  useMemo
} = React;
const COP = n => '$ ' + Math.round(n).toLocaleString('es-CO');
const PCT = n => n.toLocaleString('es-CO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}) + ' %';
function Icon({
  name,
  size = 18,
  color,
  strokeWidth = 2,
  style
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !window.lucide) return;
    el.innerHTML = '';
    const i = document.createElement('i');
    i.setAttribute('data-lucide', name);
    i.setAttribute('width', size);
    i.setAttribute('height', size);
    i.setAttribute('stroke-width', strokeWidth);
    el.appendChild(i);
    window.lucide.createIcons();
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", {
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: size,
      height: size,
      color,
      flex: 'none',
      ...style
    }
  });
}
const SIMS = [{
  id: 'ahorro',
  label: 'Ahorro',
  icon: 'piggy-bank',
  color: 'var(--cat-ahorro)',
  desc: 'Proyecta tu ahorro con aportes periódicos.'
}, {
  id: 'credito',
  label: 'Crédito',
  icon: 'credit-card',
  color: 'var(--cat-credito)',
  desc: 'Calcula la cuota mensual de un crédito.'
}, {
  id: 'presupuesto',
  label: 'Presupuesto',
  icon: 'wallet',
  color: 'var(--cat-presupuesto)',
  desc: 'Reparte tu ingreso con la regla 50/30/20.'
}, {
  id: 'inversion',
  label: 'Inversión',
  icon: 'trending-up',
  color: 'var(--cat-inversion)',
  desc: 'Estima el valor futuro de una inversión.'
}, {
  id: 'colombia',
  label: 'Cesantías (Colombia)',
  icon: 'landmark',
  color: 'var(--cat-colombia)',
  desc: 'Calcula cesantías e intereses de ley.'
}];

/* ---------- shared layout pieces ---------- */
function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
  type = 'number'
}) {
  return /*#__PURE__*/React.createElement(Input, {
    label: label,
    value: value,
    onChange: e => onChange(e.target.value),
    prefix: prefix,
    suffix: suffix,
    type: type,
    inputMode: "numeric"
  });
}
function ResultStat({
  label,
  value,
  big,
  color
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 130
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--fs-2xs)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)',
      marginBottom: 4
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    className: "fc-num",
    style: {
      fontSize: big ? 30 : 20,
      fontWeight: 600,
      color: color || 'var(--text-strong)'
    }
  }, value));
}
function MiniBars({
  data,
  color
}) {
  const max = Math.max(...data.map(d => d.v), 1);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      gap: 6,
      height: 110,
      padding: '8px 0'
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    title: COP(d.v),
    style: {
      width: '100%',
      maxWidth: 34,
      height: `${d.v / max * 86}px`,
      background: color,
      borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0',
      minHeight: 3,
      transition: 'height var(--dur-slow) var(--ease-out)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--text-faint)',
      fontFamily: 'var(--font-mono)'
    }
  }, d.l))));
}

/* ---------- calculators ---------- */
function Ahorro({
  save
}) {
  const [inicial, setInicial] = useState('500000');
  const [aporte, setAporte] = useState('200000');
  const [meses, setMeses] = useState('24');
  const [tasa, setTasa] = useState('9');
  const r = useMemo(() => {
    const P = +inicial || 0,
      D = +aporte || 0,
      n = +meses || 0,
      ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const fv = P * Math.pow(1 + i, n) + (i ? D * (Math.pow(1 + i, n) - 1) / i : D * n);
    const aportado = P + D * n;
    const bars = [];
    for (let m = 0; m <= n; m += Math.max(1, Math.round(n / 6))) {
      const v = P * Math.pow(1 + i, m) + (i ? D * (Math.pow(1 + i, m) - 1) / i : D * m);
      bars.push({
        l: 'M' + m,
        v
      });
    }
    return {
      fv,
      aportado,
      interes: fv - aportado,
      bars
    };
  }, [inicial, aporte, meses, tasa]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Ahorro inicial",
    value: inicial,
    onChange: setInicial,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Aporte mensual",
    value: aporte,
    onChange: setAporte,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Plazo (meses)",
    value: meses,
    onChange: setMeses
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Rentabilidad E.A.",
    value: tasa,
    onChange: setTasa,
    suffix: "%"
  })), /*#__PURE__*/React.createElement(ResultPanel, {
    color: "var(--cat-ahorro)",
    onSave: () => save('Ahorro', COP(r.fv))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      flexWrap: 'wrap',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(ResultStat, {
    label: "Saldo proyectado",
    value: COP(r.fv),
    big: true,
    color: "var(--cat-ahorro)"
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Total aportado",
    value: COP(r.aportado)
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Rendimientos",
    value: COP(r.interes),
    color: "var(--success)"
  })), /*#__PURE__*/React.createElement(MiniBars, {
    data: r.bars,
    color: "var(--cat-ahorro)"
  })));
}
function Credito({
  save
}) {
  const [monto, setMonto] = useState('15000000');
  const [tasa, setTasa] = useState('22');
  const [meses, setMeses] = useState('36');
  const r = useMemo(() => {
    const P = +monto || 0,
      n = +meses || 1,
      ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const cuota = i ? P * i / (1 - Math.pow(1 + i, -n)) : P / n;
    const total = cuota * n;
    return {
      cuota,
      total,
      interes: total - P,
      i: i * 100
    };
  }, [monto, tasa, meses]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Monto del cr\xE9dito",
    value: monto,
    onChange: setMonto,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Tasa E.A.",
    value: tasa,
    onChange: setTasa,
    suffix: "%"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Plazo (meses)",
    value: meses,
    onChange: setMeses
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)'
    }
  }, "Tasa mensual equivalente: ", /*#__PURE__*/React.createElement("strong", {
    className: "fc-num"
  }, PCT(r.i))))), /*#__PURE__*/React.createElement(ResultPanel, {
    color: "var(--cat-credito)",
    onSave: () => save('Crédito', COP(r.cuota) + '/mes')
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(ResultStat, {
    label: "Cuota mensual",
    value: COP(r.cuota),
    big: true,
    color: "var(--cat-credito)"
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Total a pagar",
    value: COP(r.total)
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Intereses",
    value: COP(r.interes),
    color: "var(--danger)"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-muted)',
      marginBottom: 5
    }
  }, /*#__PURE__*/React.createElement("span", null, "Capital"), /*#__PURE__*/React.createElement("span", null, "Intereses")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: 14,
      borderRadius: 'var(--radius-pill)',
      overflow: 'hidden',
      border: '1px solid var(--border-subtle)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: `${+monto / r.total * 100}%`,
      background: 'var(--warm-400)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      background: 'var(--coral-300)'
    }
  })))));
}
function Presupuesto({
  save
}) {
  const [ingreso, setIngreso] = useState('3500000');
  const v = +ingreso || 0;
  const rows = [['Necesidades', 0.5, 'var(--cat-credito)'], ['Gustos', 0.3, 'var(--cat-presupuesto)'], ['Ahorro / deudas', 0.2, 'var(--cat-ahorro)']];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Field, {
    label: "Ingreso mensual neto",
    value: ingreso,
    onChange: setIngreso,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(ResultPanel, {
    color: "var(--cat-presupuesto)",
    onSave: () => save('Presupuesto', COP(v))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      height: 16,
      borderRadius: 'var(--radius-pill)',
      overflow: 'hidden',
      border: '1px solid var(--border-subtle)',
      marginBottom: 14
    }
  }, rows.map((row, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: `${row[1] * 100}%`,
      background: row[2]
    }
  }))), rows.map((row, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 0',
      borderBottom: i < 2 ? '1px dotted var(--border-default)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: 3,
      background: row[2],
      flex: 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, row[0]), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)'
    }
  }, row[1] * 100, "%"), /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      width: 130,
      textAlign: 'right',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, COP(v * row[1]))))));
}
function Inversion({
  save
}) {
  const [inicial, setInicial] = useState('2000000');
  const [aporte, setAporte] = useState('300000');
  const [anios, setAnios] = useState('5');
  const [tasa, setTasa] = useState('12');
  const r = useMemo(() => {
    const P = +inicial || 0,
      D = +aporte || 0,
      n = (+anios || 0) * 12,
      ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const fv = P * Math.pow(1 + i, n) + (i ? D * (Math.pow(1 + i, n) - 1) / i : D * n);
    const aportado = P + D * n;
    const bars = [];
    for (let y = 0; y <= +anios; y++) {
      const m = y * 12;
      const v = P * Math.pow(1 + i, m) + (i ? D * (Math.pow(1 + i, m) - 1) / i : D * m);
      bars.push({
        l: y + 'a',
        v
      });
    }
    return {
      fv,
      aportado,
      ganancia: fv - aportado,
      bars
    };
  }, [inicial, aporte, anios, tasa]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Capital inicial",
    value: inicial,
    onChange: setInicial,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Aporte mensual",
    value: aporte,
    onChange: setAporte,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Horizonte (a\xF1os)",
    value: anios,
    onChange: setAnios
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Rentabilidad E.A.",
    value: tasa,
    onChange: setTasa,
    suffix: "%"
  })), /*#__PURE__*/React.createElement(ResultPanel, {
    color: "var(--cat-inversion)",
    onSave: () => save('Inversión', COP(r.fv))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      flexWrap: 'wrap',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(ResultStat, {
    label: "Valor futuro",
    value: COP(r.fv),
    big: true,
    color: "var(--cat-inversion)"
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Aportado",
    value: COP(r.aportado)
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Ganancia",
    value: COP(r.ganancia),
    color: "var(--success)"
  })), /*#__PURE__*/React.createElement(MiniBars, {
    data: r.bars,
    color: "var(--cat-inversion)"
  })));
}
function Colombia({
  save
}) {
  const [salario, setSalario] = useState('1800000');
  const [dias, setDias] = useState('360');
  const r = useMemo(() => {
    const s = +salario || 0,
      d = +dias || 0;
    const cesantias = s * d / 360;
    const intereses = cesantias * 0.12 * d / 360;
    return {
      cesantias,
      intereses,
      prima: s * d / 360
    };
  }, [salario, dias]);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Salario mensual",
    value: salario,
    onChange: setSalario,
    prefix: "$",
    suffix: "COP"
  }), /*#__PURE__*/React.createElement(Field, {
    label: "D\xEDas trabajados (a\xF1o)",
    value: dias,
    onChange: setDias
  })), /*#__PURE__*/React.createElement(ResultPanel, {
    color: "var(--cat-colombia)",
    onSave: () => save('Cesantías', COP(r.cesantias))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement(ResultStat, {
    label: "Cesant\xEDas",
    value: COP(r.cesantias),
    big: true,
    color: "var(--cat-colombia)"
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Intereses (12%)",
    value: COP(r.intereses),
    color: "var(--success)"
  }), /*#__PURE__*/React.createElement(ResultStat, {
    label: "Prima estimada",
    value: COP(r.prima)
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: '14px 0 0',
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)',
      lineHeight: 1.5
    }
  }, "C\xE1lculo educativo de prestaciones sociales seg\xFAn la f\xF3rmula de ley (salario \xD7 d\xEDas \xF7 360). Los valores son referenciales.")));
}
function ResultPanel({
  children,
  color,
  onSave
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      padding: 16,
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-page)',
      border: `1px solid var(--border-default)`,
      borderTop: `3px solid ${color}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-2xs)',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--text-muted)'
    }
  }, "Resultado"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    style: {
      marginLeft: 'auto'
    },
    onClick: onSave,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "save",
      size: 15
    })
  }, "Guardar en historial")), children);
}

/* ---------- root ---------- */
function App() {
  const [active, setActive] = useState('ahorro');
  const [history, setHistory] = useState([{
    type: 'Crédito',
    result: '$ 568.900/mes',
    time: 'hace 1 h'
  }, {
    type: 'Ahorro',
    result: '$ 6.240.500',
    time: 'ayer'
  }]);
  useLayoutEffect(() => {
    if (window.lucide) window.lucide.createIcons();
  });
  const save = (type, result) => setHistory([{
    type,
    result,
    time: 'ahora'
  }, ...history].slice(0, 8));
  const sim = SIMS.find(s => s.id === active);
  const Calc = {
    ahorro: Ahorro,
    credito: Credito,
    presupuesto: Presupuesto,
    inversion: Inversion,
    colombia: Colombia
  }[active];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      overflow: 'auto',
      background: 'var(--surface-page)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      borderBottom: '1px solid var(--border-default)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "../learner/index.html",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      textDecoration: 'none'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/fintcart-mark.svg",
    width: "30",
    height: "30",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 700,
      fontSize: 20,
      color: 'var(--warm-900)'
    }
  }, "Fint", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--coral-400)'
    }
  }, "Cart"))), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--border-strong)'
    }
  }, "/"), /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-strong)'
    }
  }, "Simuladores"))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1100,
      margin: '0 auto',
      padding: '20px',
      display: 'grid',
      gridTemplateColumns: '230px 1fr 240px',
      gap: 16,
      alignItems: 'start'
    }
  }, /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Calculadoras",
    accent: "var(--brand-primary)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 6
    }
  }, SIMS.map(s => {
    const on = s.id === active;
    return /*#__PURE__*/React.createElement("li", {
      key: s.id
    }, /*#__PURE__*/React.createElement("a", {
      onClick: () => setActive(s.id),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 10px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        background: on ? 'var(--surface-page)' : 'transparent',
        color: on ? 'var(--text-strong)' : 'var(--text-link)',
        fontWeight: on ? 700 : 500,
        fontSize: 'var(--fs-sm)',
        boxShadow: on ? `inset 3px 0 0 ${s.color}` : 'none',
        textDecoration: 'none'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: s.color
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: s.icon,
      size: 18
    })), s.label));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: sim.color
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: sim.icon,
    size: 22
  })), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-2xl)'
    }
  }, sim.label)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      color: 'var(--text-muted)',
      fontSize: 'var(--fs-sm)'
    }
  }, sim.desc)), /*#__PURE__*/React.createElement(Card, null, /*#__PURE__*/React.createElement(Calc, {
    save: save
  })), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 'var(--fs-xs)',
      color: 'var(--text-faint)',
      display: 'flex',
      gap: 6,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "shield-check",
    size: 14
  }), " C\xE1lculos con precisi\xF3n decimal en el backend. FintCart no almacena datos bancarios reales.")), /*#__PURE__*/React.createElement(ModuleBox, {
    title: "Historial",
    accent: "var(--brand-accent)",
    padded: false
  }, /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      margin: 0,
      padding: 0
    }
  }, history.map((h, i) => /*#__PURE__*/React.createElement("li", {
    key: i,
    style: {
      padding: '10px 12px',
      borderBottom: i < history.length - 1 ? '1px dotted var(--border-default)' : 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--fs-sm)',
      fontWeight: 600,
      color: 'var(--text-strong)'
    }
  }, h.type), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: 'var(--text-faint)'
    }
  }, h.time)), /*#__PURE__*/React.createElement("span", {
    className: "fc-num",
    style: {
      fontSize: 'var(--fs-sm)',
      color: 'var(--text-muted)'
    }
  }, h.result)))))));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/simulators/app.js", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.ModuleBox = __ds_scope.ModuleBox;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
