/* global React */
const { Button, Input, Select, Badge, Tag, ModuleBox, Card, Avatar } = window.FintCartDesignSystem_cf1e0c;
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

const STATUS = {
  borrador: { label: 'Borrador', tone: 'neutral' },
  revision: { label: 'En revisión', tone: 'warning' },
  publicado: { label: 'Publicado', tone: 'success' },
};

const SEED = [
  { id: 1, title: 'Cómo armar un fondo de emergencia', cat: 'Ahorro', status: 'publicado', v: 3, author: 'Valentina Ríos', updated: '12 jun', chars: 1248 },
  { id: 2, title: 'Entender la tasa E.A. de tu crédito', cat: 'Crédito', status: 'revision', v: 1, author: 'Carlos Mejía', updated: '11 jun', chars: 2110 },
  { id: 3, title: 'La regla 50/30/20 para tu presupuesto', cat: 'Presupuesto', status: 'revision', v: 2, author: 'Daniela Ospina', updated: '11 jun', chars: 980 },
  { id: 4, title: 'Diversificar: primeros pasos en inversión', cat: 'Inversión', status: 'borrador', v: 1, author: 'Tú', updated: 'hace 5 min', chars: 1640 },
  { id: 5, title: '¿Debo declarar renta este año?', cat: 'Colombia', status: 'borrador', v: 1, author: 'Tú', updated: 'ayer', chars: 320 },
];

function TopBar({ role, setRole, go }) {
  return (
    <div style={{ background: 'var(--warm-900)', color: 'var(--warm-50)' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 18px', height: 52, display: 'flex', alignItems: 'center', gap: 22 }}>
        <a onClick={() => go('dash')} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', textDecoration: 'none' }}>
          <img src="../../assets/logo/fintcart-mark.svg" width="28" height="28" alt="" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#fff' }}>FintCart <span style={{ color: 'var(--gold-400)', fontWeight: 600 }}>Editor</span></span>
        </a>
        <nav style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
          {['Inicio', 'Borradores', 'Plantillas', 'Analítica'].map((n, i) => (
            <a key={n} onClick={() => go('dash')} style={{ padding: '6px 11px', fontSize: 'var(--fs-sm)', color: i === 0 ? '#fff' : 'var(--warm-300)', fontWeight: i === 0 ? 600 : 400, cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>{n}</a>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', background: 'var(--warm-800)', borderRadius: 'var(--radius-pill)', padding: 3 }}>
            {['editor', 'coordinador'].map((r) => (
              <button key={r} onClick={() => setRole(r)} style={{
                border: 'none', cursor: 'pointer', padding: '4px 12px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'capitalize',
                background: role === r ? 'var(--gold-400)' : 'transparent', color: role === r ? 'var(--warm-900)' : 'var(--warm-300)',
              }}>{r}</button>
            ))}
          </div>
          <Avatar name={role === 'editor' ? 'Tú Editor' : 'Coord Editorial'} size={30} tone="var(--purple-500)" />
        </div>
      </div>
    </div>
  );
}

function SideMenu({ go }) {
  const items = [['file-plus', 'Nuevo artículo', true], ['list', 'Lista de artículos'], ['folder', 'Categorías'], ['tag', 'Etiquetas']];
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ModuleBox title="Menú del editor" accent="var(--brand-interactive)" padded={false}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 6 }}>
          {items.map(([icon, label, primary], i) => (
            <li key={i}><a onClick={() => primary && go('edit', SEED[3])} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', fontSize: 'var(--fs-sm)', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
              color: primary ? 'var(--purple-600)' : 'var(--text-link)', fontWeight: primary ? 700 : 400, background: primary ? 'var(--purple-50)' : 'transparent',
            }}><Icon name={icon} size={16} />{label}</a></li>
          ))}
        </ul>
      </ModuleBox>
      <ModuleBox title="Categorías" accent="var(--brand-primary)" padded={false}>
        <ul className="fc-linklist" style={{ padding: '4px 12px' }}>
          {['Ahorro', 'Crédito', 'Presupuesto', 'Inversión', 'Contexto Colombia'].map((c) => <li key={c}><a href="#">{c}</a></li>)}
        </ul>
      </ModuleBox>
    </aside>
  );
}

function Dashboard({ role, items, go }) {
  const counts = { borrador: 0, revision: 0, publicado: 0 };
  items.forEach((a) => counts[a.status]++);
  const visible = role === 'coordinador' ? items : items;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: '0 0 2px', fontSize: 'var(--fs-2xl)' }}>{role === 'coordinador' ? 'Cola de revisión' : 'Mis artículos'}</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{role === 'coordinador' ? 'Revisa, aprueba y publica el contenido enviado por editores.' : 'Crea borradores y envíalos a revisión.'}</p>
        </div>
        <Button variant="primary" iconLeft={<Icon name="plus" size={16} />} onClick={() => go('edit', SEED[3])}>Nuevo artículo</Button>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        {[['Borradores', counts.borrador, 'var(--warm-500)'], ['En revisión', counts.revision, 'var(--gold-500)'], ['Publicados', counts.publicado, 'var(--success)']].map((s) => (
          <Card key={s[0]} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', background: 'var(--surface-page)', display: 'grid', placeItems: 'center', color: s[2] }}><Icon name="file-text" size={20} /></span>
            <div><div className="fc-num" style={{ fontSize: 24, fontWeight: 600, color: 'var(--text-strong)' }}>{s[1]}</div><div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{s[0]}</div></div>
          </Card>
        ))}
      </div>
      <ModuleBox title="Artículos" accent="var(--brand-interactive)" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em', background: 'var(--surface-page)' }}>
            <th style={{ padding: '9px 14px', fontWeight: 700 }}>Título</th><th style={{ padding: '9px 8px', fontWeight: 700 }}>Categoría</th><th style={{ padding: '9px 8px', fontWeight: 700 }}>Estado</th><th style={{ padding: '9px 8px', fontWeight: 700 }}>Autor</th><th style={{ padding: '9px 8px', fontWeight: 700, textAlign: 'right' }}>Actualizado</th><th></th>
          </tr></thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id} onClick={() => go('edit', a)} style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-page)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '11px 14px', color: 'var(--text-strong)', fontWeight: 600 }}>{a.title} <span style={{ color: 'var(--text-faint)', fontWeight: 400, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)' }}>v{a.v}</span></td>
                <td style={{ padding: '11px 8px', color: 'var(--text-muted)' }}>{a.cat}</td>
                <td style={{ padding: '11px 8px' }}><Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge></td>
                <td style={{ padding: '11px 8px', color: 'var(--text-muted)' }}>{a.author}</td>
                <td style={{ padding: '11px 8px', textAlign: 'right', color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>{a.updated}</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', color: 'var(--text-faint)' }}><Icon name="chevron-right" size={16} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleBox>
    </div>
  );
}

function Editor({ article, role, go, onStatus }) {
  const canPublish = role === 'coordinador' && article.author !== 'Tú';
  const toolbar = ['bold', 'italic', 'underline', '|', 'align-left', 'align-center', '|', 'link', 'image', 'list'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 16, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <a onClick={() => go('dash')} style={{ cursor: 'pointer' }}>Dashboard</a><span>›</span><span>{article.cat}</span><span>›</span><span style={{ color: 'var(--text-faint)' }}>Editar</span>
        </div>
        <Card padded={false}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', background: 'var(--surface-page)' }}>
            {toolbar.map((t, i) => t === '|'
              ? <span key={i} style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 4px' }} />
              : <button key={i} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 6, borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', display: 'inline-flex' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-inset)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}><Icon name={t} size={16} /></button>)}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{article.chars} caracteres</span>
          </div>
          <div style={{ padding: 22 }}>
            <input defaultValue={article.title} style={{ width: '100%', border: 'none', outline: 'none', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: 'var(--text-strong)', marginBottom: 10, background: 'transparent' }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}><Tag color="var(--cat-ahorro)">{article.cat}</Tag><Badge tone={STATUS[article.status].tone}>{STATUS[article.status].label}</Badge></div>
            <div contentEditable suppressContentEditableWarning style={{ outline: 'none', fontSize: 'var(--fs-md)', lineHeight: 1.7, color: 'var(--text-body)', minHeight: 220 }}>
              <p>Un fondo de emergencia es dinero que apartas para imprevistos: una reparación, una urgencia médica o quedarte sin ingresos por un tiempo.</p>
              <p>¿Cuánto guardar? Una buena meta inicial es un mes de tus gastos esenciales. Luego apunta a tres meses y, si tu ingreso es variable, a seis.</p>
              <p style={{ color: 'var(--text-faint)' }}>[ Escribe aquí el cuerpo del artículo… ]</p>
            </div>
          </div>
        </Card>
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <ModuleBox title="Publicación" accent="var(--brand-primary)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-muted)' }}>Estado</span><Badge tone={STATUS[article.status].tone}>{STATUS[article.status].label}</Badge></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-muted)' }}>Versión</span><span className="fc-num" style={{ color: 'var(--text-strong)' }}>v{article.v}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}><span style={{ color: 'var(--text-muted)' }}>Autor</span><span style={{ color: 'var(--text-strong)' }}>{article.author}</span></div>
            <hr style={{ border: 'none', borderTop: '1px dotted var(--border-default)', margin: '2px 0' }} />
            {role === 'editor' && <>
              <Button variant="secondary" block iconLeft={<Icon name="save" size={15} />}>Guardar borrador</Button>
              <Button variant="primary" block iconLeft={<Icon name="send" size={15} />} onClick={() => onStatus(article, 'revision')}>Enviar a revisión</Button>
            </>}
            {role === 'coordinador' && <>
              {canPublish ? <>
                <Button variant="primary" block iconLeft={<Icon name="check" size={15} />} onClick={() => onStatus(article, 'publicado')}>Aprobar y publicar</Button>
                <Button variant="secondary" block iconLeft={<Icon name="corner-up-left" size={15} />}>Devolver al editor</Button>
              </> : <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 1.5, display: 'flex', gap: 7 }}><Icon name="info" size={15} style={{ marginTop: 1 }} />Un coordinador no puede publicar su propio contenido. Solo puede aprobar artículos de otros editores.</p>}
            </>}
          </div>
        </ModuleBox>
        <ModuleBox title="Referencias" accent="var(--brand-accent)" actions={<a href="#" style={{ fontSize: 'var(--fs-xs)' }}>+ Añadir</a>}>
          {[['Superintendencia Financiera', 'superfinanciera.gov.co'], ['Banca de las Oportunidades', 'bancadelasoportunidades.gov.co']].map((r) => (
            <div key={r[0]} style={{ padding: '8px 0', borderBottom: '1px dotted var(--border-default)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{r[0]}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-link)' }}>{r[1]}</div>
            </div>
          ))}
        </ModuleBox>
        <ModuleBox title="Cuestionario" accent="var(--cat-inversion)">
          <p style={{ margin: '0 0 10px', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>3 preguntas asociadas a este artículo.</p>
          <Button variant="ghost" size="sm" iconLeft={<Icon name="clipboard-check" size={15} />}>Editar cuestionario</Button>
        </ModuleBox>
      </aside>
    </div>
  );
}

function App() {
  const [role, setRole] = useState('editor');
  const [view, setView] = useState('dash');
  const [current, setCurrent] = useState(null);
  const [items, setItems] = useState(SEED);
  const [toast, setToast] = useState(null);
  useLayoutEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  const go = (v, payload) => { if (payload) setCurrent(payload); setView(v); };
  const onStatus = (article, status) => {
    setItems(items.map((a) => a.id === article.id ? { ...a, status } : a));
    setCurrent({ ...article, status });
    setToast(status === 'revision' ? 'Artículo enviado a revisión.' : 'Artículo publicado en el catálogo.');
    setTimeout(() => setToast(null), 2600);
    setView('dash');
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--surface-page)' }}>
      <TopBar role={role} setRole={(r) => { setRole(r); setView('dash'); }} go={go} />
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '18px', display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
        <SideMenu go={go} />
        <main>
          {view === 'dash' && <Dashboard role={role} items={items} go={go} />}
          {view === 'edit' && current && <Editor article={current} role={role} go={go} onStatus={onStatus} />}
        </main>
      </div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 22, left: '50%', transform: 'translateX(-50%)', background: 'var(--warm-900)', color: '#fff', padding: '11px 18px', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-pop)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)', zIndex: 50 }}>
          <Icon name="check-circle" size={17} color="var(--gold-400)" />{toast}
        </div>
      )}
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
