/* FintCart — Learner app demo data (Spanish / Colombia). Plain global, no bundler. */
window.LEARN = (function () {
  const categories = [
    { id: 'ahorro', label: 'Ahorro', color: 'var(--cat-ahorro)' },
    { id: 'credito', label: 'Crédito', color: 'var(--cat-credito)' },
    { id: 'presupuesto', label: 'Presupuesto', color: 'var(--cat-presupuesto)' },
    { id: 'inversion', label: 'Inversión', color: 'var(--cat-inversion)' },
    { id: 'colombia', label: 'Contexto Colombia', color: 'var(--cat-colombia)' },
  ];

  const articles = [
    {
      id: 'fondo-emergencia', cat: 'ahorro', minutes: 6, points: 100, new: true,
      title: 'Cómo armar un fondo de emergencia',
      dek: 'Tres a seis meses de gastos, guardados en pesos y disponibles cuando los necesites.',
      author: 'Valentina Ríos', date: '12 jun 2026',
      body: [
        'Un fondo de emergencia es dinero que apartas para imprevistos: una reparación, una urgencia médica o quedarte sin ingresos por un tiempo. No es para inversión ni para gastos planeados.',
        '¿Cuánto guardar? Una buena meta inicial es un mes de tus gastos esenciales. Luego apunta a tres meses y, si tu ingreso es variable, a seis.',
        'Dónde guardarlo: en una cuenta de fácil acceso y bajo riesgo. La liquidez importa más que la rentabilidad: este dinero debe estar disponible el mismo día.',
        'Empieza pequeño. Aparta un monto fijo cada quincena —aunque sean $50.000— y automatiza la transferencia el día de pago. La constancia pesa más que el monto.',
      ],
      key: 'La liquidez importa más que la rentabilidad en tu fondo de emergencia.',
    },
    {
      id: 'tasa-ea', cat: 'credito', minutes: 8, points: 120,
      title: 'Entender la tasa E.A. de tu crédito',
      dek: 'Qué significa “Efectivo Anual”, por qué difiere de la tasa mensual y cómo compararla.',
      author: 'Carlos Mejía', date: '9 jun 2026',
      body: [
        'En Colombia las tasas de crédito suelen expresarse como Efectivo Anual (E.A.). Es el costo real del dinero en un año, incluyendo el efecto del interés compuesto.',
        'Una tasa de 1,8% mensual no es 21,6% anual: por el interés compuesto equivale aproximadamente a 23,9% E.A. Siempre compara créditos usando la misma base.',
        'La tasa de usura, fijada por la Superintendencia Financiera, es el tope legal que ninguna entidad puede superar. Conocerla te protege.',
      ],
      key: 'Compara siempre créditos usando la misma base: la tasa Efectivo Anual.',
    },
    {
      id: 'regla-50-30-20', cat: 'presupuesto', minutes: 5, points: 80, new: true,
      title: 'La regla 50/30/20 para tu presupuesto',
      dek: 'Una forma simple de repartir tu ingreso entre necesidades, gustos y ahorro.',
      author: 'Daniela Ospina', date: '7 jun 2026',
      body: [
        'La regla 50/30/20 reparte tu ingreso mensual en tres bloques: 50% para necesidades, 30% para gustos y 20% para ahorro o pago de deudas.',
        'Necesidades son gastos que no puedes evitar: arriendo, servicios, transporte, mercado. Gustos son opcionales: salidas, suscripciones, antojos.',
        'No es una ley rígida. Si tu arriendo se lleva el 55%, ajusta los otros bloques. Lo importante es que el ahorro tenga un lugar fijo, no lo que sobre.',
      ],
      key: 'El ahorro merece un lugar fijo en tu presupuesto, no solo lo que sobra.',
    },
    {
      id: 'diversificar', cat: 'inversion', minutes: 7, points: 110,
      title: 'Diversificar: primeros pasos en inversión',
      dek: 'No pongas todos los huevos en la misma canasta. Qué significa en la práctica.',
      author: 'Andrés Gómez', date: '4 jun 2026',
      body: [
        'Diversificar es repartir tu dinero entre distintos tipos de activos para que el mal desempeño de uno no arrastre todo tu patrimonio.',
        'Para empezar no necesitas grandes sumas. Los fondos de inversión colectiva permiten participar con montos bajos y dejan la diversificación en manos de un gestor.',
        'El riesgo y el rendimiento van de la mano: a mayor rentabilidad esperada, mayor riesgo. Define tu horizonte antes de elegir.',
      ],
      key: 'A mayor rentabilidad esperada, mayor riesgo: define tu horizonte primero.',
    },
    {
      id: 'declaracion-renta', cat: 'colombia', minutes: 9, points: 130,
      title: '¿Debo declarar renta este año?',
      dek: 'Topes de ingresos, patrimonio y consumos que te obligan a declarar en Colombia.',
      author: 'Laura Castaño', date: '1 jun 2026',
      body: [
        'No todas las personas deben declarar renta. La obligación depende de topes anuales de ingresos, patrimonio, consumos con tarjeta y movimientos bancarios.',
        'Declarar no siempre significa pagar. Muchas personas declaran y obtienen saldo a favor por retenciones que les practicaron durante el año.',
        'Guarda tus certificados de ingresos y retenciones: son la base para diligenciar la declaración correctamente.',
      ],
      key: 'Declarar no siempre significa pagar: puedes tener saldo a favor.',
    },
    {
      id: 'cdt-vs-cuenta', cat: 'ahorro', minutes: 6, points: 90,
      title: 'CDT vs. cuenta de ahorros: ¿cuál elegir?',
      dek: 'Rentabilidad, liquidez y plazo: las tres variables que definen tu decisión.',
      author: 'Valentina Ríos', date: '28 may 2026',
      body: [
        'Un CDT (Certificado de Depósito a Término) ofrece una tasa fija a cambio de inmovilizar tu dinero por un plazo. La cuenta de ahorros da liquidez total con menor rentabilidad.',
        'Si sabes que no tocarás ese dinero por seis meses o más, un CDT suele rendir más. Si puedes necesitarlo en cualquier momento, prioriza la cuenta.',
        'Ambos están cubiertos por el seguro de depósitos de Fogafín hasta el tope vigente, lo que aporta seguridad a tu capital.',
      ],
      key: 'Plazo conocido y sin necesidad de liquidez: el CDT suele rendir más.',
    },
  ];

  const quiz = {
    'fondo-emergencia': [
      { q: '¿Cuál es la prioridad principal de un fondo de emergencia?', options: ['Máxima rentabilidad', 'Liquidez y disponibilidad', 'Beneficios tributarios'], answer: 1 },
      { q: 'Una meta inicial razonable es guardar…', options: ['Un mes de gastos esenciales', 'Diez años de ingresos', 'El valor de un carro'], answer: 0 },
      { q: '¿Qué ayuda más a construir el fondo?', options: ['Esperar a que sobre dinero', 'Apartar un monto fijo automatizado', 'Invertir en acciones'], answer: 1 },
    ],
  };
  // reuse a generic quiz for articles without one
  articles.forEach((a) => { if (!quiz[a.id]) quiz[a.id] = quiz['fondo-emergencia']; });

  const user = {
    name: 'Mariana López', email: 'mariana@correo.com',
    points: 680, level: 'Intermedio', nextLevel: 1000,
    streak: 4, articlesRead: 11, quizzesDone: 9,
  };

  const notifications = [
    { icon: 'badge-check', text: 'Aprobaste el cuestionario “Fondo de emergencia” con 100/100.', time: 'hace 2 h', unread: true },
    { icon: 'file-text', text: 'Nuevo artículo publicado en Inversión.', time: 'hace 5 h', unread: true },
    { icon: 'trending-up', text: 'Alcanzaste 680 puntos de progreso.', time: 'ayer', unread: false },
  ];

  return { categories, articles, quiz, user, notifications };
})();
