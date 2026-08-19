/* global React */
const { Button, Tag, Badge, ModuleBox, Card, ProgressBar, Avatar } = window.FintCartDesignSystem_cf1e0c;
const { useLayoutEffect } = React;
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

function Nav() {
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 20, background: 'rgba(251,248,242,0.9)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border-default)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="../../assets/logo/fintcart-mark.svg" width="32" height="32" alt="" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--warm-900)' }}>Fint<span style={{ color: 'var(--coral-400)' }}>Cart</span></span>
        </div>
        <nav style={{ display: 'flex', gap: 18, marginLeft: 14 }}>
          {['Cómo funciona', 'Temas', 'Simuladores', 'Para editores'].map((n) => <a key={n} href="#" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontWeight: 500 }}>{n}</a>)}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href="../auth/index.html"><Button variant="ghost" size="sm">Iniciar sesión</Button></a>
          <a href="../auth/index.html"><Button variant="primary" size="sm">Crear cuenta gratis</Button></a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '46px 22px 30px', display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 36, alignItems: 'center' }}>
      <div>
        <Badge tone="accent" style={{ marginBottom: 14 }}>Educación financiera · Colombia</Badge>
        <h1 style={{ fontSize: 52, lineHeight: 1.06, margin: '0 0 16px', letterSpacing: '-0.02em' }}>Entiende tu plata. <span style={{ color: 'var(--coral-400)' }}>Sin enredos.</span></h1>
        <p style={{ fontSize: 'var(--fs-lg)', color: 'var(--text-muted)', margin: '0 0 24px', maxWidth: 460 }}>Aprende con artículos cortos, pon a prueba lo que sabes con cuestionarios y simula tus decisiones con calculadoras pensadas para Colombia.</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="../auth/index.html"><Button variant="primary" size="lg" iconRight={<Icon name="arrow-right" size={18} />}>Empieza gratis</Button></a>
          <a href="../learner/index.html"><Button variant="secondary" size="lg" iconLeft={<Icon name="book-open" size={17} />}>Ver el catálogo</Button></a>
        </div>
        <div style={{ display: 'flex', gap: 22, marginTop: 28, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="check" size={16} color="var(--success)" /> 100% gratis</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="check" size={16} color="var(--success)" /> En español</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><Icon name="check" size={16} color="var(--success)" /> Sin datos bancarios</span>
        </div>
      </div>
      {/* portal preview card */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ModuleBox title="Mi progreso" accent="var(--brand-accent)">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            <span className="fc-num" style={{ fontSize: 30, fontWeight: 600, color: 'var(--text-strong)' }}>680</span><span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>/ 1000 pts</span>
          </div>
          <ProgressBar value={680} max={1000} />
        </ModuleBox>
        <Card interactive style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'var(--green-50)', color: 'var(--cat-ahorro)', display: 'grid', placeItems: 'center' }}><Icon name="piggy-bank" size={22} /></span>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>Fondo de emergencia</div><div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>6 min · Quiz +100 pts</div></div>
          <Icon name="arrow-right" size={16} color="var(--text-faint)" />
        </Card>
        <Card style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ width: 42, height: 42, borderRadius: 'var(--radius-md)', background: 'var(--coral-50)', color: 'var(--cat-credito)', display: 'grid', placeItems: 'center' }}><Icon name="calculator" size={22} /></span>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: 'var(--text-strong)', fontSize: 'var(--fs-sm)' }}>Cuota de crédito</div><div className="fc-num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>$ 568.900 / mes</div></div>
          <Badge tone="success">Simulado</Badge>
        </Card>
      </div>
    </section>
  );
}

function Steps() {
  const steps = [['user-plus', 'Regístrate', 'Crea tu cuenta gratis y verifica tu correo en un minuto.'], ['book-open', 'Aprende', 'Lee artículos cortos por categoría: ahorro, crédito, inversión y más.'], ['clipboard-check', 'Responde', 'Resuelve el cuestionario de cada artículo y suma puntos de progreso.'], ['calculator', 'Simula', 'Pon a prueba tus decisiones con las cinco calculadoras.']];
  return (
    <section style={{ background: 'var(--surface-card)', borderTop: '1px solid var(--border-default)', borderBottom: '1px solid var(--border-default)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '44px 22px' }}>
        <p className="fc-eyebrow" style={{ marginBottom: 6 }}>Cómo funciona</p>
        <h2 style={{ fontSize: 'var(--fs-3xl)', margin: '0 0 28px' }}>Cuatro pasos para tomar mejores decisiones</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <span className="fc-num" style={{ fontSize: 13, fontWeight: 700, color: 'var(--coral-300)', position: 'absolute', top: 0, right: 0 }}>0{i + 1}</span>
              <span style={{ width: 46, height: 46, borderRadius: 'var(--radius-md)', background: 'var(--surface-page)', border: '1px solid var(--border-default)', display: 'grid', placeItems: 'center', color: 'var(--coral-400)', marginBottom: 12 }}><Icon name={s[0]} size={22} /></span>
              <h3 style={{ fontSize: 'var(--fs-lg)', margin: '0 0 5px' }}>{s[1]}</h3>
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{s[2]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Topics() {
  const cats = [['Ahorro', 'piggy-bank', 'var(--cat-ahorro)', 24], ['Crédito', 'credit-card', 'var(--cat-credito)', 18], ['Presupuesto', 'wallet', 'var(--cat-presupuesto)', 15], ['Inversión', 'trending-up', 'var(--cat-inversion)', 21], ['Contexto Colombia', 'landmark', 'var(--cat-colombia)', 12]];
  return (
    <section style={{ maxWidth: 1100, margin: '0 auto', padding: '46px 22px' }}>
      <p className="fc-eyebrow" style={{ marginBottom: 6 }}>Temas</p>
      <h2 style={{ fontSize: 'var(--fs-3xl)', margin: '0 0 24px' }}>Aprende sobre lo que te importa</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        {cats.map((c) => (
          <Card key={c[0]} interactive style={{ textAlign: 'center' }}>
            <span style={{ width: 48, height: 48, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', background: `${c[2]}18`, color: c[2], marginBottom: 10 }}><Icon name={c[1]} size={24} /></span>
            <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 3px' }}>{c[0]}</h3>
            <p className="fc-num" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: 0 }}>{c[3]} artículos</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section style={{ maxWidth: 1100, margin: '0 auto 50px', padding: '0 22px' }}>
      <div style={{ background: 'linear-gradient(135deg, var(--warm-900), var(--purple-700))', borderRadius: 'var(--radius-xl)', padding: '44px 40px', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ color: '#fff', fontSize: 'var(--fs-4xl)', margin: '0 0 8px' }}>Tu educación financiera empieza hoy</h2>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 'var(--fs-md)', margin: 0 }}>Gratis, en español, sin necesidad de datos bancarios.</p>
        </div>
        <a href="../auth/index.html"><Button variant="accent" size="lg" iconRight={<Icon name="arrow-right" size={18} />}>Crear cuenta gratis</Button></a>
      </div>
    </section>
  );
}

function Footer() {
  const cols = [['Producto', ['Catálogo', 'Simuladores', 'Mi progreso', 'Para editores']], ['Temas', ['Ahorro', 'Crédito', 'Inversión', 'Contexto Colombia']], ['Legal', ['Términos', 'Política de datos (Ley 1581)', 'Privacidad']]];
  return (
    <footer style={{ background: 'var(--surface-card)', borderTop: '1px solid var(--border-default)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 22px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr', gap: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <img src="../../assets/logo/fintcart-mark.svg" width="30" height="30" alt="" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--warm-900)' }}>FintCart</span>
          </div>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', maxWidth: 240, margin: 0 }}>Educación financiera interactiva para el mercado colombiano.</p>
        </div>
        {cols.map((col) => (
          <div key={col[0]}>
            <p style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-strong)', margin: '0 0 10px' }}>{col[0]}</p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {col[1].map((l) => <li key={l}><a href="#" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{l}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '14px 22px', textAlign: 'center', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>© 2026 FintCart · Educación financiera para Colombia</div>
    </footer>
  );
}

function App() {
  useLayoutEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return (
    <div style={{ background: 'var(--surface-page)' }}>
      <Nav /><Hero /><Steps /><Topics /><CTA /><Footer />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
