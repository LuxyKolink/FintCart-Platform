/* global React */
const { Button, Input, Checkbox, Badge } = window.FintCartDesignSystem_cf1e0c;
const { useState, useLayoutEffect } = React;

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

function BrandPanel() {
  return (
    <div style={{ background: 'linear-gradient(160deg, var(--coral-400) 0%, var(--coral-600) 70%, var(--purple-600) 140%)', color: '#fff', padding: '40px 38px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <img src="../../assets/logo/fintcart-mark.svg" width="40" height="40" alt="" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))' }} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, color: '#fff' }}>FintCart</span>
      </div>
      <div style={{ marginTop: 'auto' }}>
        <h2 style={{ color: '#fff', fontSize: 34, lineHeight: 1.12, margin: '0 0 12px' }}>Aprende a manejar tu plata, paso a paso.</h2>
        <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: 'var(--fs-md)', margin: 0, maxWidth: 320 }}>Artículos, cuestionarios y simuladores financieros pensados para el contexto colombiano. Gratis.</p>
        <div style={{ display: 'flex', gap: 22, marginTop: 26 }}>
          {[['book-open', '+120 artículos'], ['calculator', '5 simuladores'], ['award', 'Mide tu progreso']].map((f) => (
            <div key={f[0]} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', color: '#fff' }}>
              <Icon name={f[0]} size={18} />{f[1]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Login({ go }) {
  return (
    <Form title="Inicia sesión" sub="Bienvenido de nuevo a FintCart.">
      <Input label="Correo electrónico" type="email" placeholder="tu@correo.com" defaultValue="mariana@correo.com" />
      <Input label="Contraseña" type="password" defaultValue="123456" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Checkbox label="Recordarme" defaultChecked />
        <a href="#" style={{ fontSize: 'var(--fs-sm)' }}>¿Olvidaste tu contraseña?</a>
      </div>
      <Button variant="primary" block size="lg">Entrar</Button>
      <Divider>o continúa con</Divider>
      <Button variant="secondary" block iconLeft={<Icon name="shield" size={16} />}>OAuth2 · PKCE</Button>
      <p style={{ textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>¿No tienes cuenta? <a onClick={() => go('register')} style={{ cursor: 'pointer', fontWeight: 600 }}>Regístrate</a></p>
    </Form>
  );
}

function Register({ go }) {
  return (
    <Form title="Crea tu cuenta" sub="Gratis, en menos de un minuto.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input label="Nombre" placeholder="Mariana" />
        <Input label="Apellido" placeholder="López" />
      </div>
      <Input label="Correo electrónico" type="email" placeholder="tu@correo.com" />
      <Input label="Contraseña" type="password" hint="Mínimo 8 caracteres, una mayúscula y un número." />
      <Checkbox label="Acepto la Política de Tratamiento de Datos (Ley 1581 de 2012)." />
      <Button variant="primary" block size="lg" onClick={() => go('verify')}>Crear cuenta</Button>
      <p style={{ textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>¿Ya tienes cuenta? <a onClick={() => go('login')} style={{ cursor: 'pointer', fontWeight: 600 }}>Inicia sesión</a></p>
    </Form>
  );
}

function Verify({ go }) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const set = (i, v) => { const c = [...code]; c[i] = v.slice(-1); setCode(c); };
  return (
    <Form title="Verifica tu correo" sub={<>Enviamos un código de 6 dígitos a <strong style={{ color: 'var(--text-strong)' }}>tu@correo.com</strong></>}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--coral-50)', color: 'var(--coral-500)', display: 'grid', placeItems: 'center', margin: '0 auto 4px' }}><Icon name="mail-check" size={26} /></div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {code.map((d, i) => (
          <input key={i} value={d} onChange={(e) => set(i, e.target.value)} maxLength={1} inputMode="numeric" style={{
            width: 44, height: 52, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600,
            border: `2px solid ${d ? 'var(--purple-400)' : 'var(--border-strong)'}`, borderRadius: 'var(--radius-md)', outline: 'none', color: 'var(--text-strong)',
          }} />
        ))}
      </div>
      <Button variant="primary" block size="lg" onClick={() => go('done')}>Verificar</Button>
      <p style={{ textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>¿No te llegó? <a href="#" style={{ fontWeight: 600 }}>Reenviar código</a></p>
    </Form>
  );
}

function Done() {
  return (
    <Form title="¡Cuenta verificada!" sub="Ya puedes empezar a aprender.">
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', margin: '0 auto 6px' }}><Icon name="check" size={32} /></div>
      <a href="../learner/index.html" style={{ textDecoration: 'none' }}><Button variant="primary" block size="lg" iconRight={<Icon name="arrow-right" size={16} />}>Ir al catálogo</Button></a>
    </Form>
  );
}

function Divider({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>
    <span style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />{children}<span style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
  </div>;
}
function Form({ title, sub, children }) {
  return (
    <div style={{ width: '100%', maxWidth: 372, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div><h1 style={{ margin: '0 0 4px', fontSize: 'var(--fs-3xl)' }}>{title}</h1><p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{sub}</p></div>
      {children}
    </div>
  );
}

function App() {
  const [view, setView] = useState('login');
  useLayoutEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  const Screen = { login: Login, register: Register, verify: Verify, done: Done }[view];
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--surface-page)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 880, display: 'grid', gridTemplateColumns: '1fr 1fr', background: 'var(--surface-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', minHeight: 540 }}>
        <BrandPanel />
        <div style={{ padding: '40px 38px', display: 'grid', placeItems: 'center' }}><Screen go={setView} /></div>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
