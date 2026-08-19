# UI Kit — Simuladores

Los **cinco simuladores** financieros de FintCart en una sola vista con riel de calculadoras,
formulario de parámetros, resultados con cifras monetarias y mini-gráficos, e historial.

**Calculadoras:** Ahorro (valor futuro con aportes), Crédito (cuota mensual y amortización),
Presupuesto (regla 50/30/20), Inversión (valor futuro a N años), Cesantías (contexto Colombia).

**Archivos:** `index.html`, `App.jsx`. Compone `ModuleBox`, `Card`, `Input`, `Button`, `Badge`.

> Los cálculos se hacen en el cliente solo para la demo. En producción la **precisión decimal**
> de dinero/tasas es responsabilidad del backend (regla NON-NEGOTIABLE del proyecto).
