/* global React */
const { Button, Input, Select, Tag, Badge, ModuleBox, Card, ProgressBar, Avatar } = window.FintCartDesignSystem_cf1e0c;
const { useState, useLayoutEffect, useMemo } = React;
const COP = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');
const PCT = (n) => n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';

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

const SIMS = [
  { id: 'ahorro', label: 'Ahorro', icon: 'piggy-bank', color: 'var(--cat-ahorro)', desc: 'Proyecta tu ahorro con aportes periódicos.' },
  { id: 'credito', label: 'Crédito', icon: 'credit-card', color: 'var(--cat-credito)', desc: 'Calcula la cuota mensual de un crédito.' },
  { id: 'presupuesto', label: 'Presupuesto', icon: 'wallet', color: 'var(--cat-presupuesto)', desc: 'Reparte tu ingreso con la regla 50/30/20.' },
  { id: 'inversion', label: 'Inversión', icon: 'trending-up', color: 'var(--cat-inversion)', desc: 'Estima el valor futuro de una inversión.' },
  { id: 'colombia', label: 'Cesantías (Colombia)', icon: 'landmark', color: 'var(--cat-colombia)', desc: 'Calcula cesantías e intereses de ley.' },
];

/* ---------- shared layout pieces ---------- */
function Field({ label, value, onChange, prefix, suffix, type = 'number' }) {
  return <Input label={label} value={value} onChange={(e) => onChange(e.target.value)} prefix={prefix} suffix={suffix} type={type} inputMode="numeric" />;
}
function ResultStat({ label, value, big, color }) {
  return (
    <div style={{ flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div className="fc-num" style={{ fontSize: big ? 30 : 20, fontWeight: 600, color: color || 'var(--text-strong)' }}>{value}</div>
    </div>
  );
}
function MiniBars({ data, color }) {
  const max = Math.max(...data.map((d) => d.v), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, padding: '8px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
          <div title={COP(d.v)} style={{ width: '100%', maxWidth: 34, height: `${(d.v / max) * 86}px`, background: color, borderRadius: 'var(--radius-xs) var(--radius-xs) 0 0', minHeight: 3, transition: 'height var(--dur-slow) var(--ease-out)' }} />
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{d.l}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- calculators ---------- */
function Ahorro({ save }) {
  const [inicial, setInicial] = useState('500000');
  const [aporte, setAporte] = useState('200000');
  const [meses, setMeses] = useState('24');
  const [tasa, setTasa] = useState('9');
  const r = useMemo(() => {
    const P = +inicial || 0, D = +aporte || 0, n = +meses || 0, ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const fv = P * Math.pow(1 + i, n) + (i ? D * (Math.pow(1 + i, n) - 1) / i : D * n);
    const aportado = P + D * n;
    const bars = [];
    for (let m = 0; m <= n; m += Math.max(1, Math.round(n / 6))) {
      const v = P * Math.pow(1 + i, m) + (i ? D * (Math.pow(1 + i, m) - 1) / i : D * m);
      bars.push({ l: 'M' + m, v });
    }
    return { fv, aportado, interes: fv - aportado, bars };
  }, [inicial, aporte, meses, tasa]);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Ahorro inicial" value={inicial} onChange={setInicial} prefix="$" suffix="COP" />
        <Field label="Aporte mensual" value={aporte} onChange={setAporte} prefix="$" suffix="COP" />
        <Field label="Plazo (meses)" value={meses} onChange={setMeses} />
        <Field label="Rentabilidad E.A." value={tasa} onChange={setTasa} suffix="%" />
      </div>
      <ResultPanel color="var(--cat-ahorro)" onSave={() => save('Ahorro', COP(r.fv))}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 8 }}>
          <ResultStat label="Saldo proyectado" value={COP(r.fv)} big color="var(--cat-ahorro)" />
          <ResultStat label="Total aportado" value={COP(r.aportado)} />
          <ResultStat label="Rendimientos" value={COP(r.interes)} color="var(--success)" />
        </div>
        <MiniBars data={r.bars} color="var(--cat-ahorro)" />
      </ResultPanel>
    </div>
  );
}

function Credito({ save }) {
  const [monto, setMonto] = useState('15000000');
  const [tasa, setTasa] = useState('22');
  const [meses, setMeses] = useState('36');
  const r = useMemo(() => {
    const P = +monto || 0, n = +meses || 1, ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const cuota = i ? P * i / (1 - Math.pow(1 + i, -n)) : P / n;
    const total = cuota * n;
    return { cuota, total, interes: total - P, i: i * 100 };
  }, [monto, tasa, meses]);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Monto del crédito" value={monto} onChange={setMonto} prefix="$" suffix="COP" />
        <Field label="Tasa E.A." value={tasa} onChange={setTasa} suffix="%" />
        <Field label="Plazo (meses)" value={meses} onChange={setMeses} />
        <div style={{ display: 'flex', alignItems: 'flex-end' }}><span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Tasa mensual equivalente: <strong className="fc-num">{PCT(r.i)}</strong></span></div>
      </div>
      <ResultPanel color="var(--cat-credito)" onSave={() => save('Crédito', COP(r.cuota) + '/mes')}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <ResultStat label="Cuota mensual" value={COP(r.cuota)} big color="var(--cat-credito)" />
          <ResultStat label="Total a pagar" value={COP(r.total)} />
          <ResultStat label="Intereses" value={COP(r.interes)} color="var(--danger)" />
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 5 }}><span>Capital</span><span>Intereses</span></div>
          <div style={{ display: 'flex', height: 14, borderRadius: 'var(--radius-pill)', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
            <div style={{ width: `${(+monto / r.total) * 100}%`, background: 'var(--warm-400)' }} />
            <div style={{ flex: 1, background: 'var(--coral-300)' }} />
          </div>
        </div>
      </ResultPanel>
    </div>
  );
}

function Presupuesto({ save }) {
  const [ingreso, setIngreso] = useState('3500000');
  const v = +ingreso || 0;
  const rows = [['Necesidades', 0.5, 'var(--cat-credito)'], ['Gustos', 0.3, 'var(--cat-presupuesto)'], ['Ahorro / deudas', 0.2, 'var(--cat-ahorro)']];
  return (
    <div>
      <Field label="Ingreso mensual neto" value={ingreso} onChange={setIngreso} prefix="$" suffix="COP" />
      <ResultPanel color="var(--cat-presupuesto)" onSave={() => save('Presupuesto', COP(v))}>
        <div style={{ display: 'flex', height: 16, borderRadius: 'var(--radius-pill)', overflow: 'hidden', border: '1px solid var(--border-subtle)', marginBottom: 14 }}>
          {rows.map((row, i) => <div key={i} style={{ width: `${row[1] * 100}%`, background: row[2] }} />)}
        </div>
        {rows.map((row, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 2 ? '1px dotted var(--border-default)' : 'none' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: row[2], flex: 'none' }} />
            <span style={{ flex: 1, fontWeight: 600, color: 'var(--text-strong)' }}>{row[0]}</span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{row[1] * 100}%</span>
            <span className="fc-num" style={{ width: 130, textAlign: 'right', fontWeight: 600, color: 'var(--text-strong)' }}>{COP(v * row[1])}</span>
          </div>
        ))}
      </ResultPanel>
    </div>
  );
}

function Inversion({ save }) {
  const [inicial, setInicial] = useState('2000000');
  const [aporte, setAporte] = useState('300000');
  const [anios, setAnios] = useState('5');
  const [tasa, setTasa] = useState('12');
  const r = useMemo(() => {
    const P = +inicial || 0, D = +aporte || 0, n = (+anios || 0) * 12, ea = (+tasa || 0) / 100;
    const i = Math.pow(1 + ea, 1 / 12) - 1;
    const fv = P * Math.pow(1 + i, n) + (i ? D * (Math.pow(1 + i, n) - 1) / i : D * n);
    const aportado = P + D * n;
    const bars = [];
    for (let y = 0; y <= +anios; y++) {
      const m = y * 12; const v = P * Math.pow(1 + i, m) + (i ? D * (Math.pow(1 + i, m) - 1) / i : D * m);
      bars.push({ l: y + 'a', v });
    }
    return { fv, aportado, ganancia: fv - aportado, bars };
  }, [inicial, aporte, anios, tasa]);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Capital inicial" value={inicial} onChange={setInicial} prefix="$" suffix="COP" />
        <Field label="Aporte mensual" value={aporte} onChange={setAporte} prefix="$" suffix="COP" />
        <Field label="Horizonte (años)" value={anios} onChange={setAnios} />
        <Field label="Rentabilidad E.A." value={tasa} onChange={setTasa} suffix="%" />
      </div>
      <ResultPanel color="var(--cat-inversion)" onSave={() => save('Inversión', COP(r.fv))}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 8 }}>
          <ResultStat label="Valor futuro" value={COP(r.fv)} big color="var(--cat-inversion)" />
          <ResultStat label="Aportado" value={COP(r.aportado)} />
          <ResultStat label="Ganancia" value={COP(r.ganancia)} color="var(--success)" />
        </div>
        <MiniBars data={r.bars} color="var(--cat-inversion)" />
      </ResultPanel>
    </div>
  );
}

function Colombia({ save }) {
  const [salario, setSalario] = useState('1800000');
  const [dias, setDias] = useState('360');
  const r = useMemo(() => {
    const s = +salario || 0, d = +dias || 0;
    const cesantias = s * d / 360;
    const intereses = cesantias * 0.12 * d / 360;
    return { cesantias, intereses, prima: s * d / 360 };
  }, [salario, dias]);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Salario mensual" value={salario} onChange={setSalario} prefix="$" suffix="COP" />
        <Field label="Días trabajados (año)" value={dias} onChange={setDias} />
      </div>
      <ResultPanel color="var(--cat-colombia)" onSave={() => save('Cesantías', COP(r.cesantias))}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <ResultStat label="Cesantías" value={COP(r.cesantias)} big color="var(--cat-colombia)" />
          <ResultStat label="Intereses (12%)" value={COP(r.intereses)} color="var(--success)" />
          <ResultStat label="Prima estimada" value={COP(r.prima)} />
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 1.5 }}>Cálculo educativo de prestaciones sociales según la fórmula de ley (salario × días ÷ 360). Los valores son referenciales.</p>
      </ResultPanel>
    </div>
  );
}

function ResultPanel({ children, color, onSave }) {
  return (
    <div style={{ marginTop: 18, padding: 16, borderRadius: 'var(--radius-md)', background: 'var(--surface-page)', border: `1px solid var(--border-default)`, borderTop: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Resultado</span>
        <Button variant="ghost" size="sm" style={{ marginLeft: 'auto' }} onClick={onSave} iconLeft={<Icon name="save" size={15} />}>Guardar en historial</Button>
      </div>
      {children}
    </div>
  );
}

/* ---------- root ---------- */
function App() {
  const [active, setActive] = useState('ahorro');
  const [history, setHistory] = useState([
    { type: 'Crédito', result: '$ 568.900/mes', time: 'hace 1 h' },
    { type: 'Ahorro', result: '$ 6.240.500', time: 'ayer' },
  ]);
  useLayoutEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  const save = (type, result) => setHistory([{ type, result, time: 'ahora' }, ...history].slice(0, 8));
  const sim = SIMS.find((s) => s.id === active);
  const Calc = { ahorro: Ahorro, credito: Credito, presupuesto: Presupuesto, inversion: Inversion, colombia: Colombia }[active];

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--surface-page)' }}>
      <div style={{ background: 'var(--surface-card)', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="../learner/index.html" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
            <img src="../../assets/logo/fintcart-mark.svg" width="30" height="30" alt="" />
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--warm-900)' }}>Fint<span style={{ color: 'var(--coral-400)' }}>Cart</span></span>
          </a>
          <span style={{ color: 'var(--border-strong)' }}>/</span>
          <strong style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>Simuladores</strong>
        </div>
      </div>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px', display: 'grid', gridTemplateColumns: '230px 1fr 240px', gap: 16, alignItems: 'start' }}>
        <ModuleBox title="Calculadoras" accent="var(--brand-primary)" padded={false}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 6 }}>
            {SIMS.map((s) => {
              const on = s.id === active;
              return (
                <li key={s.id}><a onClick={() => setActive(s.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  background: on ? 'var(--surface-page)' : 'transparent', color: on ? 'var(--text-strong)' : 'var(--text-link)',
                  fontWeight: on ? 700 : 500, fontSize: 'var(--fs-sm)', boxShadow: on ? `inset 3px 0 0 ${s.color}` : 'none', textDecoration: 'none',
                }}>
                  <span style={{ color: s.color }}><Icon name={s.icon} size={18} /></span>{s.label}
                </a></li>
              );
            })}
          </ul>
        </ModuleBox>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
              <span style={{ color: sim.color }}><Icon name={sim.icon} size={22} /></span>
              <h1 style={{ margin: 0, fontSize: 'var(--fs-2xl)' }}>{sim.label}</h1>
            </div>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{sim.desc}</p>
          </div>
          <Card><Calc save={save} /></Card>
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Icon name="shield-check" size={14} /> Cálculos con precisión decimal en el backend. FintCart no almacena datos bancarios reales.
          </p>
        </div>

        <ModuleBox title="Historial" accent="var(--brand-accent)" padded={false}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {history.map((h, i) => (
              <li key={i} style={{ padding: '10px 12px', borderBottom: i < history.length - 1 ? '1px dotted var(--border-default)' : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>{h.type}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>{h.time}</span>
                </div>
                <span className="fc-num" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{h.result}</span>
              </li>
            ))}
          </ul>
        </ModuleBox>
      </div>
    </div>
  );
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
