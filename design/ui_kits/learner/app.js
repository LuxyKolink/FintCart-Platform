/* global React */
const { Button, Input, Tag, Badge, ProgressBar, ModuleBox, Card, Tabs, Avatar } = window.FintCartDesignSystem_cf1e0c;
const { useState, useEffect, useRef, useLayoutEffect } = React;
const D = window.LEARN;
const COP = (n) => '$ ' + n.toLocaleString('es-CO');

/* ---- Lucide icon helper ---- */
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
function useIcons(dep) {}

const catOf = (id) => D.categories.find((c) => c.id === id) || D.categories[0];

/* ================= Chrome ================= */
function TopBar({ go, view, onSearch }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--surface-card)', borderBottom: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xs)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 18 }}>
        <a onClick={() => go('home')} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textDecoration: 'none' }}>
          <img src="../../assets/logo/fintcart-mark.svg" width="34" height="34" alt="" />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, letterSpacing: '-0.5px', color: 'var(--warm-900)' }}>Fint<span style={{ color: 'var(--coral-400)' }}>Cart</span></span>
        </a>
        <div style={{ flex: 1, maxWidth: 460, position: 'relative', display: 'flex' }}>
          <input onChange={(e) => onSearch && onSearch(e.target.value)} placeholder="Buscar artículos, conceptos, simuladores…" style={{
            width: '100%', height: 38, padding: '0 14px 0 38px', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-sm)',
            border: '2px solid var(--purple-400)', borderRadius: 'var(--radius-md)', outline: 'none', color: 'var(--text-body)', background: 'var(--surface-card)',
          }} />
          <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-faint)' }}><Icon name="search" size={18} /></span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button title="Notificaciones" style={{ position: 'relative', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}>
            <Icon name="bell" size={20} />
            <span style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: 'var(--coral-400)', border: '1.5px solid var(--surface-card)' }} />
          </button>
          <div onClick={() => go('profile')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Avatar name={D.user.name} size={32} />
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{D.user.name.split(' ')[0]}</span>
          </div>
        </div>
      </div>
      <nav style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-page)' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 4 }}>
          {[['home', 'Inicio'], ['catalog', 'Catálogo'], ['sim', 'Simuladores'], ['profile', 'Mi progreso'], ['help', 'Ayuda']].map(([id, label]) => {
            const on = (view === id) || (view === 'home' && id === 'home') || (view === 'article' && id === 'catalog');
            return <a key={id} onClick={() => go(id === 'sim' ? 'sim' : id === 'catalog' ? 'home' : id === 'help' ? 'home' : id)} style={{
              padding: '9px 12px', fontSize: 'var(--fs-sm)', fontWeight: on ? 700 : 500, cursor: 'pointer',
              color: on ? 'var(--text-strong)' : 'var(--text-link)', borderBottom: `2px solid ${on ? 'var(--coral-400)' : 'transparent'}`,
            }}>{label}</a>;
          })}
        </div>
      </nav>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--border-default)', background: 'var(--surface-card)', marginTop: 32 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 16, fontSize: 'var(--fs-xs)' }}>
          <a href="#">Términos</a><a href="#">Política de datos (Ley 1581)</a><a href="#">Ayuda</a><a href="#">Contacto</a>
        </div>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>© 2026 FintCart · Educación financiera para Colombia</span>
      </div>
    </footer>
  );
}

/* ================= Sidebars ================= */
function ServicesRail({ activeCat, onCat }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ModuleBox title="Categorías" accent="var(--brand-primary)" padded={false}>
        <ul className="fc-linklist" style={{ padding: '4px 12px' }}>
          {D.categories.map((c) => (
            <li key={c.id}><a onClick={() => onCat(activeCat === c.id ? null : c.id)} style={{ cursor: 'pointer', color: activeCat === c.id ? 'var(--text-strong)' : 'var(--text-link)', fontWeight: activeCat === c.id ? 700 : 400 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flex: 'none' }} />{c.label}
            </a></li>
          ))}
        </ul>
      </ModuleBox>
      <ModuleBox title="Mi progreso" accent="var(--brand-accent)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
          <span className="fc-num" style={{ fontSize: 28, fontWeight: 600, color: 'var(--text-strong)' }}>{D.user.points}</span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>/ {D.user.nextLevel} pts</span>
        </div>
        <ProgressBar value={D.user.points} max={D.user.nextLevel} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          <span>Nivel: <strong style={{ color: 'var(--text-strong)' }}>{D.user.level}</strong></span>
          <span>🔥 {D.user.streak} días</span>
        </div>
      </ModuleBox>
    </aside>
  );
}

function RightRail({ go }) {
  const ranking = [['Andrés G.', 1840], ['Laura C.', 1620], ['Mariana L.', 680], ['Carlos M.', 540]];
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ModuleBox title="Continuar aprendiendo" accent="var(--cat-inversion)">
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>Diversificar: primeros pasos</p>
        <ProgressBar value={2} max={3} size="sm" tone="var(--cat-inversion)" />
        <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>2 de 3 secciones · Quiz pendiente</p>
        <Button variant="secondary" size="sm" style={{ marginTop: 10, width: '100%' }} onClick={() => go('article', D.articles[3])}>Retomar</Button>
      </ModuleBox>
      <ModuleBox title="Ranking de la semana" accent="var(--gold-500)" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <tbody>
            {ranking.map((r, i) => (
              <tr key={i} style={{ background: r[0] === 'Mariana L.' ? 'var(--gold-50)' : 'transparent' }}>
                <td style={{ padding: '7px 12px', width: 22, color: 'var(--text-faint)', fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: '7px 4px', fontWeight: r[0] === 'Mariana L.' ? 700 : 400, color: 'var(--text-body)' }}>{r[0]}</td>
                <td className="fc-num" style={{ padding: '7px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>{r[1]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleBox>
      <ModuleBox title="Notificaciones" accent="var(--brand-primary)" padded={false}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {D.notifications.map((n, i) => (
            <li key={i} style={{ display: 'flex', gap: 9, padding: '10px 12px', borderBottom: i < D.notifications.length - 1 ? '1px dotted var(--border-default)' : 'none', background: n.unread ? 'var(--coral-50)' : 'transparent' }}>
              <span style={{ color: 'var(--coral-500)', marginTop: 1 }}><Icon name={n.icon} size={16} /></span>
              <div><p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 1.4 }}>{n.text}</p><span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{n.time}</span></div>
            </li>
          ))}
        </ul>
      </ModuleBox>
    </aside>
  );
}

/* ================= Catalog ================= */
function ArticleRow({ a, go }) {
  const c = catOf(a.cat);
  return (
    <div onClick={() => go('article', a)} style={{ display: 'flex', gap: 14, padding: '12px 0', borderBottom: '1px dotted var(--border-default)', cursor: 'pointer' }}>
      <div style={{ width: 96, height: 72, flex: 'none', borderRadius: 'var(--radius-sm)', background: `linear-gradient(135deg, ${c.color}22, ${c.color}11)`, border: `1px solid var(--border-subtle)`, display: 'grid', placeItems: 'center', color: c.color }}>
        <Icon name={a.cat === 'ahorro' ? 'piggy-bank' : a.cat === 'credito' ? 'credit-card' : a.cat === 'presupuesto' ? 'wallet' : a.cat === 'inversion' ? 'trending-up' : 'landmark'} size={26} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <Tag color={c.color}>{c.label}</Tag>
          {a.new && <Badge tone="brand">Nuevo</Badge>}
        </div>
        <h4 style={{ margin: '0 0 3px', fontSize: 'var(--fs-md)', fontFamily: 'var(--font-display)', color: 'var(--text-strong)' }}>{a.title}</h4>
        <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.4 }}>{a.dek}</p>
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-faint)' }}>{a.minutes} min · +{a.points} pts · {a.author}</div>
      </div>
    </div>
  );
}

function Catalog({ go, activeCat, setActiveCat, query }) {
  const tabs = [{ id: 'todos', label: 'Todos' }, ...D.categories.map((c) => ({ id: c.id, label: c.label }))];
  const [tab, setTab] = useState('todos');
  let list = D.articles;
  if (activeCat) list = list.filter((a) => a.cat === activeCat);
  else if (tab !== 'todos') list = list.filter((a) => a.cat === tab);
  if (query) list = list.filter((a) => (a.title + a.dek).toLowerCase().includes(query.toLowerCase()));
  const hero = D.articles[0];
  const c = catOf(hero.cat);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Hero */}
      <Card padded={false} interactive style={{ display: 'flex', overflow: 'hidden' }}>
        <div onClick={() => go('article', hero)} style={{ display: 'flex', width: '100%' }}>
          <div style={{ width: 280, flex: 'none', background: `linear-gradient(140deg, ${c.color}, var(--coral-400))`, color: '#fff', padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <Icon name="piggy-bank" size={40} style={{ opacity: 0.9, marginBottom: 'auto' }} />
            <Badge tone="accent" variant="solid" style={{ alignSelf: 'flex-start' }}>Destacado</Badge>
          </div>
          <div style={{ padding: 20, flex: 1 }}>
            <Tag color={c.color}>{c.label}</Tag>
            <h2 style={{ margin: '10px 0 6px', fontSize: 'var(--fs-3xl)' }}>{hero.title}</h2>
            <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-md)', color: 'var(--text-muted)', maxWidth: 520 }}>{hero.dek}</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Button variant="primary" iconRight={<Icon name="arrow-right" size={16} />}>Leer y resolver</Button>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{hero.minutes} min · +{hero.points} pts</span>
            </div>
          </div>
        </div>
      </Card>

      <ModuleBox title={activeCat ? catOf(activeCat).label : 'Catálogo de contenido'} accent="var(--brand-interactive)"
        actions={activeCat ? <a onClick={() => setActiveCat(null)} style={{ cursor: 'pointer', fontSize: 'var(--fs-xs)' }}>Quitar filtro</a> : null} padded={false}>
        {!activeCat && <div style={{ padding: '0 12px' }}><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>}
        <div style={{ padding: '4px 14px 10px' }}>
          {list.length ? list.map((a) => <ArticleRow key={a.id} a={a} go={go} />) : <p style={{ padding: 20, color: 'var(--text-muted)', textAlign: 'center' }}>Sin resultados.</p>}
        </div>
      </ModuleBox>
    </div>
  );
}

/* ================= Article + Quiz ================= */
function Quiz({ article, onComplete }) {
  const qs = D.quiz[article.id];
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const correct = qs.filter((q, i) => answers[i] === q.answer).length;
  const score = Math.round((correct / qs.length) * 100);

  if (submitted) {
    const pass = score >= 67;
    return (
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px', display: 'grid', placeItems: 'center', background: pass ? 'var(--success-soft)' : 'var(--warning-soft)', color: pass ? 'var(--success)' : 'var(--warning)' }}>
          <Icon name={pass ? 'badge-check' : 'rotate-ccw'} size={32} />
        </div>
        <h3 style={{ margin: '0 0 4px' }}>{pass ? '¡Bien hecho!' : 'Casi lo logras'}</h3>
        <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Obtuviste <strong className="fc-num" style={{ color: 'var(--text-strong)' }}>{score}/100</strong> · {correct} de {qs.length} correctas</p>
        {pass && <Badge tone="success" variant="solid" style={{ marginBottom: 14 }}>+{Math.round(article.points * score / 100)} puntos de progreso</Badge>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => { setSubmitted(false); setAnswers({}); }}>Reintentar</Button>
          <Button variant="primary" size="sm" onClick={onComplete}>Continuar</Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {qs.map((q, i) => (
        <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < qs.length - 1 ? '1px dotted var(--border-default)' : 'none' }}>
          <p style={{ margin: '0 0 9px', fontWeight: 600, color: 'var(--text-strong)' }}><span className="fc-num" style={{ color: 'var(--brand-interactive)', marginRight: 6 }}>{i + 1}.</span>{q.q}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {q.options.map((opt, oi) => {
              const sel = answers[i] === oi;
              return (
                <label key={oi} onClick={() => setAnswers({ ...answers, [i]: oi })} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer',
                  border: `1.5px solid ${sel ? 'var(--purple-400)' : 'var(--border-default)'}`, borderRadius: 'var(--radius-md)',
                  background: sel ? 'var(--purple-50)' : 'var(--surface-card)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
                }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${sel ? 'var(--purple-500)' : 'var(--border-strong)'}`, background: sel ? 'var(--purple-500)' : 'transparent', flex: 'none' }} />
                  {opt}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <Button variant="primary" block disabled={Object.keys(answers).length < qs.length} onClick={() => setSubmitted(true)}>Enviar respuestas</Button>
    </div>
  );
}

function ArticleView({ article, go }) {
  const c = catOf(article.cat);
  const related = D.articles.filter((a) => a.cat === article.cat && a.id !== article.id).slice(0, 3);
  const moreRelated = related.length ? related : D.articles.filter((a) => a.id !== article.id).slice(0, 3);
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 12 }}>
        <a onClick={() => go('home')} style={{ cursor: 'pointer' }}>Inicio</a><span>›</span>
        <a onClick={() => go('home')} style={{ cursor: 'pointer' }}>{c.label}</a><span>›</span>
        <span style={{ color: 'var(--text-faint)' }}>Artículo</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <Tag color={c.color}>{c.label}</Tag>
            <h1 style={{ margin: '10px 0 8px', fontSize: 'var(--fs-4xl)', lineHeight: 1.1 }}>{article.title}</h1>
            <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-lg)', fontFamily: 'var(--font-display)', fontStyle: 'italic', color: 'var(--text-muted)' }}>{article.dek}</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--border-default)' }}>
              <Avatar name={article.author} size={30} />
              <div style={{ fontSize: 'var(--fs-xs)' }}><strong style={{ color: 'var(--text-strong)' }}>{article.author}</strong><div style={{ color: 'var(--text-faint)' }}>{article.date} · {article.minutes} min de lectura</div></div>
            </div>
            {article.body.map((p, i) => (
              <React.Fragment key={i}>
                <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.65, color: 'var(--text-body)', margin: '0 0 14px' }}>{p}</p>
                {i === 1 && (
                  <blockquote style={{ margin: '4px 0 18px', padding: '14px 18px', borderLeft: '3px solid var(--brand-accent)', background: 'var(--gold-50)', borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}>
                    <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', color: 'var(--warm-900)', lineHeight: 1.35 }}>{article.key}</p>
                  </blockquote>
                )}
              </React.Fragment>
            ))}
          </Card>
          <ModuleBox title="Cuestionario" icon={<Icon name="clipboard-check" size={16} />} accent="var(--brand-primary)">
            <p style={{ margin: '0 0 14px', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Responde para sumar puntos. Puedes reintentar las veces que quieras; cuenta tu mejor resultado.</p>
            <Quiz article={article} onComplete={() => go('profile')} />
          </ModuleBox>
        </div>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 110 }}>
          <ModuleBox title="Tu progreso" accent="var(--brand-accent)">
            <ProgressBar value={D.user.points} max={D.user.nextLevel} showValue label="Puntos" />
            <p style={{ margin: '10px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>Completa este cuestionario para sumar hasta <strong style={{ color: 'var(--text-strong)' }}>+{article.points}</strong>.</p>
          </ModuleBox>
          <ModuleBox title="Relacionados" accent="var(--cat-inversion)" padded={false}>
            <ul className="fc-linklist" style={{ padding: '4px 12px' }}>
              {moreRelated.map((a) => <li key={a.id}><a onClick={() => go('article', a)} style={{ cursor: 'pointer' }}>{a.title}</a></li>)}
            </ul>
          </ModuleBox>
        </aside>
      </div>
    </div>
  );
}

/* ================= Profile ================= */
function Profile({ go }) {
  const history = [
    ['Cómo armar un fondo de emergencia', 'Ahorro', 100, '12 jun'],
    ['La regla 50/30/20', 'Presupuesto', 80, '10 jun'],
    ['Entender la tasa E.A.', 'Crédito', 67, '8 jun'],
    ['Diversificar: primeros pasos', 'Inversión', 90, '5 jun'],
  ];
  const stat = (label, value, icon, color) => (
    <Card style={{ flex: 1, minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color, marginBottom: 6 }}><Icon name={icon} size={18} /><span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{label}</span></div>
      <div className="fc-num" style={{ fontSize: 30, fontWeight: 600, color: 'var(--text-strong)' }}>{value}</div>
    </Card>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
        <Avatar name={D.user.name} size={64} />
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: '0 0 2px', fontSize: 'var(--fs-2xl)' }}>{D.user.name}</h1>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{D.user.email} · Nivel {D.user.level}</p>
        </div>
        <Button variant="secondary" iconLeft={<Icon name="settings" size={16} />}>Editar perfil</Button>
      </Card>
      <ModuleBox title="Progreso general" accent="var(--brand-accent)">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
          <span className="fc-num" style={{ fontSize: 38, fontWeight: 600, color: 'var(--text-strong)' }}>{D.user.points}</span>
          <span style={{ color: 'var(--text-muted)' }}>de {D.user.nextLevel} pts para nivel Avanzado</span>
        </div>
        <ProgressBar value={D.user.points} max={D.user.nextLevel} size="lg" />
      </ModuleBox>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {stat('Artículos leídos', D.user.articlesRead, 'book-open', 'var(--cat-inversion)')}
        {stat('Cuestionarios', D.user.quizzesDone, 'clipboard-check', 'var(--coral-400)')}
        {stat('Racha', D.user.streak + ' días', 'flame', 'var(--gold-500)')}
        {stat('Simulaciones', 7, 'calculator', 'var(--success)')}
      </div>
      <ModuleBox title="Historial de cuestionarios" accent="var(--brand-interactive)" padded={false}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ padding: '9px 14px', fontWeight: 700 }}>Artículo</th><th style={{ padding: '9px 14px', fontWeight: 700 }}>Categoría</th><th style={{ padding: '9px 14px', fontWeight: 700, textAlign: 'right' }}>Mejor puntaje</th><th style={{ padding: '9px 14px', fontWeight: 700, textAlign: 'right' }}>Fecha</th>
          </tr></thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 14px', color: 'var(--text-strong)', fontWeight: 500 }}>{h[0]}</td>
                <td style={{ padding: '10px 14px' }}><span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{h[1]}</span></td>
                <td className="fc-num" style={{ padding: '10px 14px', textAlign: 'right', color: h[2] >= 80 ? 'var(--success)' : 'var(--text-body)', fontWeight: 600 }}>{h[2]}/100</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>{h[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleBox>
    </div>
  );
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
    if (v === 'sim') { window.location.href = '../simulators/index.html'; return; }
    setView(v);
    if (scroller.current) scroller.current.scrollTop = 0;
  };

  return (
    <div ref={scroller} style={{ height: '100%', overflow: 'auto', background: 'var(--surface-page)' }}>
      <TopBar go={go} view={view} onSearch={setQuery} />
      <main style={{ maxWidth: 1180, margin: '0 auto', padding: '18px 20px' }}>
        {view === 'home' && (
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 256px', gap: 16, alignItems: 'start' }}>
            <ServicesRail activeCat={activeCat} onCat={(c) => { setActiveCat(c); setQuery(''); }} />
            <Catalog go={go} activeCat={activeCat} setActiveCat={setActiveCat} query={query} />
            <RightRail go={go} />
          </div>
        )}
        {view === 'article' && article && <ArticleView article={article} go={go} />}
        {view === 'profile' && <Profile go={go} />}
      </main>
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
