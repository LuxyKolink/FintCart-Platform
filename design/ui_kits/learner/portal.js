/* global React */
const { Badge, Tag, ProgressBar, Avatar, Button } = window.FintCartDesignSystem_cf1e0c;
const { useState } = React;

function Icon({ name, size = 18, color, strokeWidth = 2, style }) {
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
  return <span ref={ref} aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size, color, flex: 'none', ...style }} />;
}

/* ---------- Frutiger Aero glass primitives (palette unchanged) ---------- */
const glass = {
  background: 'linear-gradient(157deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.50) 100%)',
  backdropFilter: 'blur(16px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.25)',
  border: '1px solid rgba(255,255,255,0.75)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: '0 6px 20px rgba(28,24,21,0.10), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -10px 22px rgba(255,255,255,0.30)',
};
function GlassModule({ title, icon, accent = 'var(--brand-primary)', actions, children, style, bodyStyle }) {
  return (
    <section style={{ ...glass, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
      {title && (
        <header style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '7px 11px', flex: 'none',
          background: `linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.35))`,
          borderBottom: '1px solid rgba(255,255,255,0.6)', boxShadow: `inset 3px 0 0 ${accent}`,
        }}>
          {icon && <span style={{ color: accent, display: 'inline-flex' }}><Icon name={icon} size={15} /></span>}
          <h3 style={{ margin: 0, fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-strong)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h3>
          {actions && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{actions}</div>}
        </header>
      )}
      <div style={{ padding: 11, flex: 1, minHeight: 0, ...bodyStyle }}>{children}</div>
    </section>
  );
}

/* ---------- data ---------- */
const CATS = [
  { id: 'ahorros', label: 'Ahorros', icon: 'piggy-bank', color: 'var(--cat-ahorro)', pct: 75 },
  { id: 'creditos', label: 'Créditos', icon: 'credit-card', color: 'var(--cat-credito)', pct: 40 },
  { id: 'inversion', label: 'Inversión', icon: 'trending-up', color: 'var(--cat-inversion)', pct: 20 },
  { id: 'presupuesto', label: 'Presupuesto', icon: 'wallet', color: 'var(--cat-presupuesto)', pct: 60 },
  { id: 'colombia', label: 'Colombia', icon: 'landmark', color: 'var(--cat-colombia)', pct: 30 },
];
const DIFF = {
  principiante: { label: 'Principiante', tone: 'success' },
  intermedio: { label: 'Intermedio', tone: 'accent' },
  avanzado: { label: 'Avanzado', tone: 'info' },
};
const ARTICLES = [
  { id: 1, title: 'Cómo armar un fondo de emergencia', cat: 'ahorros', min: 6, diff: 'principiante', status: 'done' },
  { id: 2, title: 'Entender la tasa E.A. de tu crédito', cat: 'creditos', min: 8, diff: 'intermedio', status: 'progress', prog: 60 },
  { id: 3, title: 'La regla 50/30/20 del presupuesto', cat: 'presupuesto', min: 5, diff: 'principiante', status: 'new' },
  { id: 4, title: 'Diversificar: primeros pasos', cat: 'inversion', min: 7, diff: 'avanzado', status: 'todo' },
  { id: 5, title: '¿Debo declarar renta este año?', cat: 'colombia', min: 9, diff: 'intermedio', status: 'new' },
  { id: 6, title: 'CDT vs. cuenta de ahorros', cat: 'ahorros', min: 6, diff: 'principiante', status: 'done' },
];
const catOf = (id) => CATS.find((c) => c.id === id);
const ACTIVITY = [
  { icon: 'badge-check', color: 'var(--success)', text: 'Aprobaste el quiz “Fondo de emergencia” · 100/100', time: 'hace 2 h' },
  { icon: 'book-open', color: 'var(--cat-inversion)', text: 'Leíste “Diversificar: primeros pasos”', time: 'hace 4 h' },
  { icon: 'calculator', color: 'var(--cat-credito)', text: 'Simulaste una cuota de crédito', time: 'ayer' },
  { icon: 'flame', color: 'var(--gold-500)', text: 'Mantuviste tu racha de 4 días', time: 'ayer' },
];

/* ---------- status chip ---------- */
function StatusChip({ status, prog }) {
  if (status === 'done') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--success)' }}><Icon name="check-circle" size={13} /> Completado</span>;
  if (status === 'progress') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--gold-600)' }}><Icon name="loader" size={13} /> {prog}%</span>;
  if (status === 'new') return <Badge tone="brand">Nuevo</Badge>;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: 'var(--text-faint)' }}><Icon name="circle" size={12} /> Sin empezar</span>;
}

/* ---------- article card ---------- */
function ArticleCard({ a }) {
  const c = catOf(a.cat);
  const d = DIFF[a.diff];
  return (
    <article style={{ ...glass, padding: 0, display: 'flex', flexDirection: 'column', cursor: 'pointer', transition: 'transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast)' }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 26px rgba(28,24,21,0.16), inset 0 1px 0 rgba(255,255,255,0.95)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = glass.boxShadow; }}>
      <div style={{ height: 46, flex: 'none', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', background: `linear-gradient(120deg, ${c.color}, color-mix(in srgb, ${c.color} 55%, var(--coral-400)))`, display: 'flex', alignItems: 'center', padding: '0 11px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 60%)' }} />
        <span style={{ color: '#fff', display: 'inline-flex', zIndex: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.18))' }}><Icon name={c.icon} size={20} /></span>
        <span style={{ marginLeft: 'auto', zIndex: 1 }}><Tag color="#fff" style={{ background: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.5)', color: '#fff' }}>{c.label}</Tag></span>
      </div>
      <div style={{ padding: '9px 11px 10px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.18 }}>{a.title}</h4>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Badge tone={d.tone}>{d.label}</Badge>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}><Icon name="clock" size={12} /> {a.min} min</span>
        </div>
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px dotted var(--border-default)' }}><StatusChip status={a.status} prog={a.prog} /></div>
      </div>
    </article>
  );
}

/* ---------- columns ---------- */
function LeftColumn() {
  return (
    <div style={{ width: 200, flex: 'none', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <GlassModule title="Categorías" icon="layout-grid" accent="var(--brand-primary)" style={{ flex: 1 }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 9, padding: 10 }}>
        {CATS.map((c) => (
          <a key={c.id} style={{ textDecoration: 'none', display: 'block', padding: '6px 7px', borderRadius: 'var(--radius-sm)', transition: 'background var(--dur-fast)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.55)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
              <span style={{ color: c.color, display: 'inline-flex' }}><Icon name={c.icon} size={15} /></span>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{c.label}</span>
              <span className="fc-num" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>{c.pct}%</span>
            </div>
            <ProgressBar value={c.pct} size="sm" tone={c.color} />
          </a>
        ))}
      </GlassModule>
      <a href="../simulators/index.html" style={{ textDecoration: 'none', flex: 'none' }}>
        <button style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 12px', cursor: 'pointer',
          border: '1px solid var(--coral-500)', borderRadius: 'var(--radius-md)', color: '#fff', fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 'var(--fs-sm)',
          background: 'linear-gradient(180deg, var(--coral-300), var(--coral-500))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), 0 3px 10px rgba(222,77,43,0.35)',
        }}>
          <Icon name="calculator" size={17} /> Ir a simuladores
        </button>
      </a>
    </div>
  );
}

function CenterColumn() {
  const [diff, setDiff] = useState('todos');
  const list = diff === 'todos' ? ARTICLES : ARTICLES.filter((a) => a.diff === diff);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-xl)', lineHeight: 1 }}>Catálogo de aprendizaje</h2>
          <p style={{ margin: '3px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{list.length} artículos · organizados por categoría y dificultad</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, ...glass, padding: 3, borderRadius: 'var(--radius-pill)' }}>
          {[['todos', 'Todos'], ['principiante', 'Principiante'], ['intermedio', 'Intermedio'], ['avanzado', 'Avanzado']].map(([id, label]) => (
            <button key={id} onClick={() => setDiff(id)} style={{
              border: 'none', cursor: 'pointer', padding: '5px 12px', borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-xs)', fontWeight: 600,
              background: diff === id ? 'var(--brand-interactive)' : 'transparent', color: diff === id ? '#fff' : 'var(--text-muted)',
              boxShadow: diff === id ? 'inset 0 1px 0 rgba(255,255,255,0.3)' : 'none',
            }}>{label}</button>
          ))}
        </div>
      </div>
      {/* featured banner */}
      <a style={{ ...glass, padding: 0, display: 'flex', overflow: 'hidden', flex: 'none', cursor: 'pointer', height: 132 }}>
        <div style={{ width: 188, flex: 'none', position: 'relative', background: 'linear-gradient(135deg, var(--cat-ahorro), var(--coral-400))', display: 'flex', alignItems: 'flex-end', padding: 14 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0) 55%)' }} />
          <Icon name="piggy-bank" size={40} color="#fff" style={{ position: 'absolute', top: 14, left: 14, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))' }} />
          <Badge tone="accent" variant="solid" style={{ position: 'relative' }}>Destacado de hoy</Badge>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', gap: 7, marginBottom: 6 }}><Tag color="var(--cat-ahorro)">Ahorros</Tag><Badge tone="success">Principiante</Badge></div>
          <h3 style={{ margin: '0 0 5px', fontSize: 'var(--fs-2xl)', lineHeight: 1.05 }}>Cómo armar un fondo de emergencia</h3>
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Tres a seis meses de gastos, en pesos · 6 min · Quiz +100 pts</p>
        </div>
      </a>
      {/* grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, flex: 1, minHeight: 0 }}>
        {list.map((a) => <ArticleCard key={a.id} a={a} />)}
      </div>
    </div>
  );
}

function RingProgress({ value, max, size = 72 }) {
  const pct = value / max;
  const r = (size - 8) / 2, C = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-inset)" strokeWidth="7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand-accent)" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span className="fc-num" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-strong)' }}>{Math.round(pct * 100)}%</span>
      </div>
    </div>
  );
}

function RightColumn() {
  return (
    <div style={{ width: 280, flex: 'none', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <GlassModule title="Mi progreso" icon="award" accent="var(--brand-accent)" style={{ flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <RingProgress value={680} max={1000} />
          <div style={{ flex: 1 }}>
            <div className="fc-num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1 }}>680 <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>/ 1000 pts</span></div>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Nivel <strong style={{ color: 'var(--text-strong)' }}>Intermedio</strong></div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <Badge tone="neutral">11 leídos</Badge><Badge tone="neutral">9 quizzes</Badge>
            </div>
          </div>
        </div>
      </GlassModule>

      <div style={{ ...glass, padding: '11px 13px', flex: 'none', display: 'flex', alignItems: 'center', gap: 12, background: 'linear-gradient(157deg, rgba(254,246,224,0.85), rgba(255,255,255,0.55))' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', flex: 'none', display: 'grid', placeItems: 'center', background: 'linear-gradient(180deg, var(--gold-300), var(--gold-500))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 3px 8px rgba(238,155,0,0.35)' }}>
          <Icon name="flame" size={24} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-strong)' }}>Racha de 4 días</div>
          <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
              <span key={i} style={{ width: 20, height: 20, borderRadius: 5, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: i < 4 ? '#fff' : 'var(--text-faint)', background: i < 4 ? 'var(--gold-400)' : 'var(--surface-inset)', boxShadow: i < 4 ? 'inset 0 1px 0 rgba(255,255,255,0.4)' : 'none' }}>{d}</span>
            ))}
          </div>
        </div>
      </div>

      <GlassModule title="Actividad reciente" icon="activity" accent="var(--cat-inversion)" style={{ flex: 1 }} bodyStyle={{ padding: '6px 11px' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {ACTIVITY.map((a, i) => (
            <li key={i} style={{ display: 'flex', gap: 9, padding: '8px 0', borderBottom: i < ACTIVITY.length - 1 ? '1px dotted var(--border-default)' : 'none' }}>
              <span style={{ color: a.color, marginTop: 1, display: 'inline-flex' }}><Icon name={a.icon} size={15} /></span>
              <div><p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 1.35 }}>{a.text}</p><span style={{ fontSize: 9, color: 'var(--text-faint)' }}>{a.time}</span></div>
            </li>
          ))}
        </ul>
      </GlassModule>

      <GlassModule title="Tu siguiente artículo" icon="sparkles" accent="var(--brand-primary)" style={{ flex: 'none' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg, var(--cat-credito), var(--coral-500))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)' }}><Icon name="credit-card" size={20} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-strong)', lineHeight: 1.15 }}>Entender la tasa E.A.</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Créditos · Intermedio · 8 min</div>
          </div>
        </div>
        <Button variant="primary" size="sm" block style={{ marginTop: 9 }} iconRight={<Icon name="arrow-right" size={14} />}>Continuar</Button>
      </GlassModule>
    </div>
  );
}

/* ---------- navbar ---------- */
function Navbar() {
  return (
    <header style={{
      flex: 'none', height: 58, display: 'flex', alignItems: 'center', gap: 18, padding: '0 18px',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.55))',
      backdropFilter: 'blur(18px) saturate(1.3)', WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
      borderBottom: '1px solid rgba(255,255,255,0.7)', boxShadow: '0 2px 10px rgba(28,24,21,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
    }}>
      {/* logo: eye + wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg, rgba(255,255,255,0.9), rgba(255,255,255,0.4))', border: '1px solid rgba(255,255,255,0.8)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 6px rgba(28,24,21,0.1)' }}>
          <img src="../../assets/logo/fintcart-eye.svg" width="30" height="22" alt="" />
        </span>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.5px', color: 'var(--warm-900)' }}>Fint<span style={{ color: 'var(--coral-400)' }}>cart</span></span>
      </div>
      <nav style={{ display: 'flex', gap: 2 }}>
        {[['Inicio', true], ['Catálogo'], ['Simuladores'], ['Mi progreso'], ['Ayuda']].map(([label, on]) => (
          <a key={label} style={{ padding: '7px 11px', fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 500, color: on ? 'var(--text-strong)' : 'var(--text-link)', borderBottom: `2px solid ${on ? 'var(--coral-400)' : 'transparent'}`, cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</a>
        ))}
      </nav>
      <div style={{ flex: 1, maxWidth: 360, marginLeft: 'auto', position: 'relative', display: 'flex' }}>
        <input placeholder="Buscar artículos, conceptos…" style={{ width: '100%', height: 34, padding: '0 12px 0 34px', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)', borderRadius: 'var(--radius-pill)', border: '1px solid rgba(255,255,255,0.9)', outline: 'none', color: 'var(--text-body)', background: 'rgba(255,255,255,0.6)', boxShadow: 'inset 0 1px 3px rgba(28,24,21,0.08)' }} />
        <span style={{ position: 'absolute', left: 11, top: 8, color: 'var(--text-faint)' }}><Icon name="search" size={17} /></span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ position: 'relative', color: 'var(--text-muted)', display: 'inline-flex' }}>
          <Icon name="bell" size={19} />
          <span style={{ position: 'absolute', top: -2, right: -2, width: 7, height: 7, borderRadius: '50%', background: 'var(--coral-400)', border: '1.5px solid #fff' }} />
        </span>
        <Avatar name="Mariana López" size={30} />
      </div>
    </header>
  );
}

function Portal() {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Navbar />
      <main style={{ flex: 1, minHeight: 0, display: 'flex', gap: 14, padding: 16 }}>
        <LeftColumn />
        <CenterColumn />
        <RightColumn />
      </main>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<Portal />);
