const TOKEN_STORAGE_KEY = "rocky.bodega.token";

// Esta pagina puede servirse detras de un prefijo de proxy (ej.
// "/bodega-api/") que varia segun el nginx del VPS -- un fetch a una ruta
// que empiece con "/" ignora ese prefijo y siempre apunta a la raiz del
// dominio. document.currentScript.src ya trae la URL absoluta REAL con la
// que este mismo archivo se cargo (resuelta por el navegador, sin
// ambiguedad de barra final), asi que la base de la API se deriva de ahi.
const API_BASE = document.currentScript ? document.currentScript.src.replace(/app\.js(?:\?.*)?$/, "") : "";

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

const app = document.getElementById("app");

const state = {
  view: "login",
  loading: false,
  flash: null,
  rango: null, // { desde, hasta } en yyyy-MM-dd -- se inicializa a "hoy" en loadPanel()
  rangoPickerOpen: false,
  rangoPickerModo: "dia", // "dia" | "rango"
  rangoPickerMes: null, // { year, month } (month 0-indexado) del mes que muestra el calendario
  rangoPickerInicio: null, // primer dia clicado en modo "rango", antes del segundo click
  moneda: "BS",
  tiendaFiltro: "",
  sortDir: "desc",
  balanceVisible: false,
  balanceMovimientos: [],
  balanceFormAbierto: null, // "ingreso" | "egreso" | null
  balanceFormSaving: false,
  balanceFormError: null,
  ventas: [],
  ventasAnterior: [],
  inventario: [],
  serieDiaria: [],
  tasaCambio: null,
  lastUpdated: null,
};

// ---- Fechas (todo en yyyy-MM-dd) -------------------------------------------
// "Hoy" se calcula con la fecha LOCAL del navegador (getFullYear/getMonth/
// getDate), no con toISOString() -- toISOString() siempre da la fecha en
// UTC, y Venezuela esta 4 horas detras: entre las 8pm y medianoche hora
// local ya es el dia siguiente en UTC, asi que "Hoy" se adelantaba un dia.
// El resto de la aritmetica de fechas (sumar dias, etc.) SI ancla a UTC
// medianoche adrede, porque ahi ya se trabaja sobre un yyyy-MM-dd conocido,
// sin ambiguedad de zona horaria que resolver.
function todayIso() {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, "0");
  const day = String(ahora.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIso(iso, dias) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonthIso(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function lastDayOfMonthIso(iso) {
  const primerDiaMesSiguiente = addMonthsIso(firstDayOfMonthIso(iso), 1);
  return addDaysIso(primerDiaMesSiguiente, -1);
}

function addMonthsIso(iso, meses) {
  const [year, month] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + meses, 1));
  return date.toISOString().slice(0, 10);
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const DIAS_SEMANA_CORTOS = ["lu", "ma", "mi", "ju", "vi", "sa", "do"];

function formatDiaCorto(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MESES_CORTOS[month - 1]}`;
}

const RANGO_PRESETS = [
  { tipo: "hoy", label: "Hoy", etiquetaDelta: "vs ayer", calc: () => ({ desde: todayIso(), hasta: todayIso() }) },
  {
    tipo: "ayer",
    label: "Ayer",
    etiquetaDelta: "vs el dia anterior",
    calc: () => ({ desde: addDaysIso(todayIso(), -1), hasta: addDaysIso(todayIso(), -1) }),
  },
  {
    tipo: "7dias",
    label: "Ultimos 7 dias",
    etiquetaDelta: "vs semana anterior",
    calc: () => ({ desde: addDaysIso(todayIso(), -6), hasta: todayIso() }),
  },
  {
    tipo: "30dias",
    label: "Ultimos 30 dias",
    etiquetaDelta: "vs periodo anterior",
    calc: () => ({ desde: addDaysIso(todayIso(), -29), hasta: todayIso() }),
  },
  {
    tipo: "mesActual",
    label: "Mes en curso",
    etiquetaDelta: "vs periodo anterior",
    calc: () => ({ desde: firstDayOfMonthIso(todayIso()), hasta: todayIso() }),
  },
  {
    tipo: "mesPasado",
    label: "Mes pasado",
    etiquetaDelta: "vs el mes anterior a ese",
    calc: () => {
      const hasta = addDaysIso(firstDayOfMonthIso(todayIso()), -1);
      return { desde: firstDayOfMonthIso(hasta), hasta };
    },
  },
];

function matchPreset(rango) {
  if (!rango) {
    return null;
  }
  return RANGO_PRESETS.find((preset) => {
    const calculado = preset.calc();
    return calculado.desde === rango.desde && calculado.hasta === rango.hasta;
  }) || null;
}

function formatRangoTriggerLabel(rango) {
  if (!rango) {
    return "Hoy";
  }
  const preset = matchPreset(rango);
  if (preset) {
    return preset.label;
  }
  if (rango.desde === rango.hasta) {
    return formatDiaCorto(rango.desde);
  }
  return `${formatDiaCorto(rango.desde)} - ${formatDiaCorto(rango.hasta)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBs(value) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toFiniteNumber(value));
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toFiniteNumber(value));
}

function formatBsCompact(value) {
  return new Intl.NumberFormat("es-VE", { notation: "compact", maximumFractionDigits: 2 }).format(toFiniteNumber(value));
}

function formatUsdCompact(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(toFiniteNumber(value));
}

function formatPercent(value) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(toFiniteNumber(value));
}

function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch (error) {
    return "";
  }
}

function setToken(token) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // localStorage puede fallar en contextos restringidos; la sesion
    // simplemente no persiste entre recargas, no es fatal.
  }
}

function renderIcon(icon) {
  switch (icon) {
    case "lock":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M8 10V7a4 4 0 1 1 8 0v3M7 10h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
            fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
          />
        </svg>
      `;
    case "arrow":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        </svg>
      `;
    case "shield":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 3 6 5v5c0 4.5 2.4 8.5 6 10 3.6-1.5 6-5.5 6-10V5l-6-2Z"
            fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
          />
          <path d="m9.5 12 1.6 1.7 3.4-3.7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        </svg>
      `;
    case "trending-up":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
          <path d="M15 6h6v6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        </svg>
      `;
    case "trending-down":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 7l6 6 4-4 8 8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
          <path d="M15 18h6v-6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        </svg>
      `;
    case "scale":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3v18M8 21h8M5 7h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
          <path
            d="M5 7 2.5 12.5a2.7 2.7 0 0 0 5 0L5 7ZM19 7l-2.5 5.5a2.7 2.7 0 0 0 5 0L19 7Z"
            fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"
          />
        </svg>
      `;
    default:
      return "";
  }
}

function renderFlash() {
  if (!state.flash?.message) {
    return "";
  }

  return `
    <div class="flash flash-${state.flash.type || "info"}">
      <span class="flash-message">${escapeHtml(state.flash.message)}</span>
    </div>
  `;
}

function setFlash(message, type = "info") {
  state.flash = message ? { message, type } : null;
}

function render() {
  app.innerHTML = state.view === "panel" ? renderPanelShell() : renderLoginView();
  bindEvents();
}

function renderLoginView() {
  return `
    <main class="login-shell">
      <section class="login-stage login-stage-compact">
        <section class="login-access-card">
          <div class="login-access-header">
            <p class="eyebrow login-eyebrow">Bodega de datos</p>
            <h1>Conectar a la nube</h1>
          </div>

          ${renderFlash()}
          <form id="login-form" class="form-stack login-form">
            <label class="field login-field">
              <span>Token</span>
              <span class="login-input-wrap">
                <span class="login-input-icon">${renderIcon("lock")}</span>
                <input
                  id="token-input"
                  type="password"
                  name="token"
                  placeholder="Token compartido de INGEST_AUTH_TOKEN"
                  autocomplete="current-password"
                  required
                />
              </span>
            </label>

            <div class="button-row login-button-row">
              <button class="button button-primary login-submit" type="submit" ${state.loading ? "disabled" : ""}>
                <span>${state.loading ? "Conectando..." : "Conectar"}</span>
                ${state.loading ? "" : `<span class="login-submit-arrow">${renderIcon("arrow")}</span>`}
              </button>
            </div>
          </form>

          <div class="login-security-strip">
            <span class="login-security-badge">${renderIcon("shield")}</span>
            <div class="login-security-copy">
              <strong>Solo lectura</strong>
              <span>Muestra el resumen de todas las tiendas en bodega_datos. No modifica ni exporta nada.</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  `;
}

// ---- Datos derivados del estado -------------------------------------------------

function findRow(rows, codigo) {
  return (Array.isArray(rows) ? rows : []).find((row) => row.codigo_legacy === codigo) || null;
}

function findTotalRow(rows) {
  return findRow(rows, "TOTAL");
}

// Con filtro de tienda activo, "el total" pasa a ser la fila de esa tienda
// (asi las tarjetas KPI y el banner de alerta reflejan la tienda elegida en
// vez del agregado de todas).
function getEffectiveTotalRow(rows) {
  if (state.tiendaFiltro) {
    return findRow(rows, state.tiendaFiltro);
  }
  return findTotalRow(rows);
}

function getStoreOptions() {
  const codes = new Set();
  (state.inventario || []).forEach((row) => {
    if (row.codigo_legacy && row.codigo_legacy !== "TOTAL") {
      codes.add(row.codigo_legacy);
    }
  });
  return Array.from(codes).sort((a, b) => a.localeCompare(b, "es"));
}

function getTasaValor() {
  return toFiniteNumber(state.tasaCambio?.tasa);
}

// Todas las cifras de ventas/costo/ganancia se guardan en bolivares (cada
// venta ya trae su propia tasa historica, ver ventasResumenPorPeriodo en el
// backend). Para mostrarlas en dolares se usa la tasa MAS RECIENTE conocida
// -- una vista rapida "de un vistazo", no una conversion contable exacta
// fila por fila.
function convertirDesdeBs(valorBs) {
  if (state.moneda !== "USD") {
    return toFiniteNumber(valorBs);
  }
  const tasa = getTasaValor();
  return tasa > 0 ? toFiniteNumber(valorBs) / tasa : 0;
}

// El inventario llega en dolares (no hay tasa por fila para existencias, ver
// nota en inventarioResumen del backend); para bolivares se usa la misma
// tasa mas reciente.
function convertirDesdeUsd(valorUsd) {
  if (state.moneda !== "BS") {
    return toFiniteNumber(valorUsd);
  }
  const tasa = getTasaValor();
  return toFiniteNumber(valorUsd) * tasa;
}

// IMPORTANTE: recibe el valor en su moneda ORIGEN y hace la conversion aqui
// mismo -- no hay que convertir en el llamador. Ventas/costo/ganancia nacen
// en bolivares (Bs), asi que esta es la version por defecto.
function formatMoneda(valorBs, options = {}) {
  const valor = convertirDesdeBs(valorBs);
  if (options.compact) {
    return state.moneda === "USD" ? `US$ ${formatUsdCompact(valor)}` : `Bs ${formatBsCompact(valor)}`;
  }
  return state.moneda === "USD" ? `US$ ${formatUsd(valor)}` : `Bs ${formatBs(valor)}`;
}

// Igual que formatMoneda(), pero para el unico valor que nace en dolares
// (el inventario -- ver convertirDesdeUsd).
function formatMonedaDesdeUsd(valorUsd, options = {}) {
  const valor = convertirDesdeUsd(valorUsd);
  if (options.compact) {
    return state.moneda === "USD" ? `US$ ${formatUsdCompact(valor)}` : `Bs ${formatBsCompact(valor)}`;
  }
  return state.moneda === "USD" ? `US$ ${formatUsd(valor)}` : `Bs ${formatBs(valor)}`;
}

function calcularMargenPct(row) {
  const vendido = toFiniteNumber(row?.total_pago);
  const ganancia = toFiniteNumber(row?.ganancia);
  if (vendido <= 0) {
    return 0;
  }
  return (ganancia / vendido) * 100;
}

// Compara el total del rango elegido contra ventasAnterior (el mismo rango,
// misma duracion en dias, inmediatamente anterior -- ya calculado por el
// backend). La etiqueta sale del preset que coincida con el rango actual
// (Hoy -> "vs ayer", 7 dias -> "vs semana anterior", etc.); si el rango es
// personalizado, queda un texto generico.
function getDeltaPeriodo(metricKey) {
  const actualRow = getEffectiveTotalRow(state.ventas);
  const previoRow = getEffectiveTotalRow(state.ventasAnterior);
  if (!actualRow || !previoRow) {
    return null;
  }

  const actual = toFiniteNumber(actualRow[metricKey]);
  const previo = toFiniteNumber(previoRow[metricKey]);
  if (previo === 0) {
    return null;
  }

  const preset = matchPreset(state.rango);
  const etiqueta = preset ? preset.etiquetaDelta : "vs periodo anterior";
  return { pct: ((actual - previo) / Math.abs(previo)) * 100, etiqueta };
}

function getSparklinePuntos(metricKey, dias = 7) {
  const serie = Array.isArray(state.serieDiaria) ? state.serieDiaria : [];
  return serie.slice(-dias).map((row) => toFiniteNumber(row[metricKey]));
}

// Mini-grafica de tendencia dentro de una tarjeta KPI: linea en el tono
// "de-enfasis" (texto secundario del sistema) con el ultimo punto resaltado
// en el color de acento de la tarjeta -- nunca la linea completa en un color
// fuerte, para que la cifra grande siga siendo lo unico "ruidoso" de la
// tarjeta. <title> por punto da un tooltip nativo con el valor exacto.
function renderSparkline(puntos, toneColor) {
  if (!Array.isArray(puntos) || puntos.length < 2) {
    return "";
  }

  const width = 96;
  const height = 32;
  const padding = 4;
  const min = Math.min(...puntos);
  const max = Math.max(...puntos);
  const span = max - min || 1;
  const stepX = (width - padding * 2) / (puntos.length - 1);

  const coords = puntos.map((valor, index) => {
    const x = padding + stepX * index;
    const y = height - padding - ((valor - min) / span) * (height - padding * 2);
    return { x, y, valor };
  });

  const pathD = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  const titles = coords
    .map((point, index) => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7" fill="transparent"><title>${escapeHtml(formatMoneda(point.valor))}</title></circle>`)
    .join("");

  return `
    <svg class="stat-sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      <path d="${pathD}" fill="none" stroke="#5f6b74" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" />
      <circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="4" fill="${toneColor}" stroke="#fffaf1" stroke-width="2" />
      ${titles}
    </svg>
  `;
}

function renderDelta(delta) {
  if (!delta) {
    return "";
  }
  const isUp = delta.pct >= 0;
  return `
    <span class="stat-delta ${isUp ? "stat-delta-up" : "stat-delta-down"}">
      ${isUp ? "&#8599;" : "&#8600;"} ${escapeHtml(formatPercent(delta.pct))}%
      <span class="stat-delta-label">${escapeHtml(delta.etiqueta)}</span>
    </span>
  `;
}

// ---- Shell principal --------------------------------------------------------

function renderPanelShell() {
  return `
    <main class="desktop-shell">
      <section class="desktop-frame">
        <header class="modern-topbar">
          <div class="modern-topbar-main">
            <div class="modern-brand">
              <div class="modern-brand-mark">R</div>
              <div class="modern-brand-copy">
                <strong>RockyMax</strong>
              </div>
            </div>
          </div>
          <div class="modern-session-area">
            <button class="button button-ghost" type="button" data-action="logout">Cerrar sesion</button>
          </div>
        </header>

        <section class="desktop-workspace">
          <div class="modern-workspace-shell">
            ${renderFlash()}

            <div class="modern-page">
              <div class="modern-page-header">
                <div>
                  <h1>${state.balanceVisible ? "Balance" : "Todas las tiendas"}</h1>
                  <p>${
                    state.balanceVisible
                      ? "Ingresos y egresos registrados a mano, por tienda o varias a la vez."
                      : "Ventas, costo, margen e inventario de todas las tiendas."
                  }</p>
                </div>
                <div class="modern-page-actions">
                  <button class="button button-ghost" type="button" data-action="refresh" ${state.loading ? "disabled" : ""}>
                    ${state.loading ? "Actualizando..." : "Actualizar"}
                  </button>
                  ${state.lastUpdated ? `<span class="bodega-updated-hint">${escapeHtml(formatUpdatedHint(state.lastUpdated))}</span>` : ""}
                </div>
              </div>

              ${renderControlsBar()}
              ${
                state.balanceVisible
                  ? renderBalanceSection()
                  : `
                    ${renderSummaryCards()}
                    ${renderAlertBanner()}
                    ${renderDesempenoTable()}
                    ${renderInventarioSection()}
                  `
              }
            </div>
          </div>
        </section>
      </section>
    </main>
  `;
}

function formatUpdatedHint(date) {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin <= 0) {
    return "Actualizado hace instantes";
  }
  if (diffMin === 1) {
    return "Actualizado hace 1 min";
  }
  if (diffMin < 60) {
    return `Actualizado hace ${diffMin} min`;
  }
  const diffHoras = Math.floor(diffMin / 60);
  return `Actualizado hace ${diffHoras} h`;
}

// ---- Selector de rango (boton + calendario desplegable) -------------------

function ensureRangoPickerMes() {
  if (state.rangoPickerMes) {
    return;
  }
  const base = state.rango?.hasta || todayIso();
  const [year, month] = base.split("-").map(Number);
  state.rangoPickerMes = { year, month: month - 1 };
}

function buildCalendarMatrix(year, month) {
  const primerDiaMes = new Date(Date.UTC(year, month, 1));
  const ultimoDiaMes = new Date(Date.UTC(year, month + 1, 0));
  // JS: 0=domingo..6=sabado. La grilla empieza en lunes, asi que se convierte
  // a 0=lunes..6=domingo para saber cuantos dias del mes anterior hacen falta.
  const offsetInicio = (primerDiaMes.getUTCDay() + 6) % 7;
  const offsetFin = (7 - ((ultimoDiaMes.getUTCDay() + 6) % 7) - 1) % 7;

  const cursor = new Date(primerDiaMes);
  cursor.setUTCDate(cursor.getUTCDate() - offsetInicio);
  const fin = new Date(ultimoDiaMes);
  fin.setUTCDate(fin.getUTCDate() + offsetFin);

  const dias = [];
  while (cursor.getTime() <= fin.getTime()) {
    dias.push({
      iso: cursor.toISOString().slice(0, 10),
      day: cursor.getUTCDate(),
      inCurrentMonth: cursor.getUTCMonth() === month,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

function renderCalendarGrid() {
  ensureRangoPickerMes();
  const { year, month } = state.rangoPickerMes;
  const dias = buildCalendarMatrix(year, month);
  const hoy = todayIso();
  const inicio = state.rangoPickerInicio;
  const rango = state.rango || { desde: hoy, hasta: hoy };

  return `
    <div class="rango-calendar">
      <div class="rango-calendar-header">
        <button type="button" class="rango-calendar-nav" data-rango-mes-prev aria-label="Mes anterior">&#8249;</button>
        <span class="rango-calendar-titulo">${escapeHtml(MESES_LARGOS[month])} ${year}</span>
        <button type="button" class="rango-calendar-nav" data-rango-mes-next aria-label="Mes siguiente">&#8250;</button>
      </div>
      <div class="rango-calendar-weekdays">
        ${DIAS_SEMANA_CORTOS.map((dia) => `<span>${dia}</span>`).join("")}
      </div>
      <div class="rango-calendar-grid">
        ${dias
          .map((dia) => {
            let clase = "rango-calendar-day";
            if (!dia.inCurrentMonth) {
              clase += " is-outside";
            }
            if (dia.iso === hoy) {
              clase += " is-today";
            }
            if (inicio) {
              if (dia.iso === inicio) {
                clase += " is-selected is-range-start";
              }
            } else if (dia.iso === rango.desde && dia.iso === rango.hasta) {
              clase += " is-selected";
            } else if (dia.iso === rango.desde) {
              clase += " is-selected is-range-start";
            } else if (dia.iso === rango.hasta) {
              clase += " is-selected is-range-end";
            } else if (dia.iso > rango.desde && dia.iso < rango.hasta) {
              clase += " is-in-range";
            }
            return `<button type="button" class="${clase}" data-rango-dia="${dia.iso}">${dia.day}</button>`;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderRangoPickerPopover() {
  const rango = state.rango || { desde: todayIso(), hasta: todayIso() };
  const activo = matchPreset(rango);

  return `
    <div class="rango-picker-popover" data-rango-popover>
      <div class="rango-picker-presets">
        ${RANGO_PRESETS.map(
          (preset) => `
            <button
              type="button"
              class="rango-preset-btn ${activo?.tipo === preset.tipo ? "is-active" : ""}"
              data-rango-preset="${preset.tipo}"
            >${escapeHtml(preset.label)}</button>
          `,
        ).join("")}
      </div>
      <div class="rango-picker-calendar-side">
        <div class="bodega-controls-group rango-picker-modo" role="group" aria-label="Modo de seleccion">
          <button type="button" class="bodega-toggle-button ${state.rangoPickerModo === "dia" ? "is-active" : ""}" data-rango-modo="dia">Un dia</button>
          <button type="button" class="bodega-toggle-button ${state.rangoPickerModo === "rango" ? "is-active" : ""}" data-rango-modo="rango">Rango</button>
        </div>
        ${renderCalendarGrid()}
      </div>
    </div>
  `;
}

function renderRangoPicker() {
  const rango = state.rango || { desde: todayIso(), hasta: todayIso() };
  return `
    <div class="rango-picker">
      <button type="button" class="rango-picker-trigger" data-rango-toggle>
        <span class="rango-picker-icon">&#128197;</span>
        <span>${escapeHtml(formatRangoTriggerLabel(rango))}</span>
        <span class="rango-picker-chevron">&#9662;</span>
      </button>
      ${state.rangoPickerOpen ? renderRangoPickerPopover() : ""}
    </div>
  `;
}

function renderControlsBar() {
  const storeOptions = getStoreOptions();
  const tasa = state.tasaCambio;

  return `
    <div class="bodega-controls-bar">
      ${renderRangoPicker()}

      <label class="bodega-select-wrap">
        <span class="sr-only">Tienda</span>
        <select data-tienda-filtro>
          <option value="">Todas las tiendas</option>
          ${storeOptions
            .map(
              (codigo) => `
                <option value="${escapeHtml(codigo)}" ${state.tiendaFiltro === codigo ? "selected" : ""}>${escapeHtml(codigo)}</option>
              `,
            )
            .join("")}
        </select>
      </label>

      <div class="bodega-controls-group" role="group" aria-label="Moneda">
        <button type="button" class="bodega-toggle-button ${state.moneda === "BS" ? "is-active" : ""}" data-moneda="BS">Bs</button>
        <button type="button" class="bodega-toggle-button ${state.moneda === "USD" ? "is-active" : ""}" data-moneda="USD">US$</button>
      </div>

      <button type="button" class="button button-ghost bodega-balance-toggle ${state.balanceVisible ? "is-active" : ""}" data-balance-toggle>
        Balance
      </button>

      ${
        tasa
          ? `<span class="bodega-tasa-hint">Tasa Bs ${escapeHtml(formatBs(tasa.tasa))} / US$ &middot; ${escapeHtml(formatFechaHora(tasa.fecha))}</span>`
          : ""
      }
    </div>
  `;
}

function formatFechaHora(fechaIso) {
  const date = new Date(fechaIso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hoy = new Date();
  const esHoy = date.toDateString() === hoy.toDateString();
  const hora = date.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" });
  return esHoy ? `hoy ${hora}` : `${date.toLocaleDateString("es-VE")} ${hora}`;
}

// Mismo componente visual que las tarjetas ejecutivas del Panel de Control
// (getExecutiveCardItems/renderExecutiveCards en apps/api/public/app.js):
// .modern-summary-grid con tarjetas .modern-stat-card-<tono>.
function renderSummaryCards() {
  const ventas = state.ventas;
  const totalVentas = getEffectiveTotalRow(ventas);
  const totalInventario = getEffectiveTotalRow(state.inventario);
  const ganancia = toFiniteNumber(totalVentas?.ganancia);
  const margenPct = calcularMargenPct(totalVentas);

  const toneColors = { blue: "#2b6dc9", sky: "#0ea5e9", green: "#22c55e", danger: "#ab3f2f", gold: "#ba8b34" };
  const gananciaTone = ganancia >= 0 ? "green" : "danger";

  const items = [
    {
      label: "Vendido",
      value: formatMoneda(totalVentas?.total_pago),
      meta: `${escapeHtml(String(totalVentas?.facturas ?? "0"))} facturas${state.tiendaFiltro ? "" : " en todas las tiendas"}`,
      tone: "blue",
      delta: getDeltaPeriodo("total_pago"),
      puntos: getSparklinePuntos("total_pago"),
    },
    {
      label: "Costo de mercancia",
      value: formatMoneda(totalVentas?.total_costo_bs),
      meta: "Costo de lo vendido",
      tone: "sky",
      delta: getDeltaPeriodo("total_costo_bs"),
      puntos: getSparklinePuntos("total_costo_bs"),
    },
    {
      label: "Ganancia",
      value: formatMoneda(totalVentas?.ganancia),
      meta: `Margen ${escapeHtml(formatPercent(margenPct))}%`,
      tone: gananciaTone,
      delta: getDeltaPeriodo("ganancia"),
      puntos: getSparklinePuntos("ganancia"),
    },
    {
      label: "Inventario a costo",
      value: formatMonedaDesdeUsd(totalInventario?.valor_costo_usd, { compact: true }),
      meta: `${escapeHtml(String(totalInventario?.articulos ?? "0"))} articulos`,
      tone: "gold",
      delta: null,
      puntos: [],
    },
  ];

  return `
    <div class="modern-summary-grid">
      ${items
        .map(
          (item) => `
            <article class="modern-stat-card modern-stat-card-${item.tone === "danger" ? "gold" : item.tone}">
              <div class="modern-stat-copy">
                <span class="modern-stat-eyebrow">${escapeHtml(item.label)}</span>
                <strong class="modern-stat-value">${escapeHtml(item.value)}</strong>
                ${renderDelta(item.delta)}
                <span class="modern-stat-meta">${item.meta}</span>
              </div>
              ${item.puntos.length ? renderSparkline(item.puntos, toneColors[item.tone]) : ""}
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAlertBanner() {
  const ventas = state.ventas;
  const total = getEffectiveTotalRow(ventas);
  const ganancia = toFiniteNumber(total?.ganancia);
  if (ganancia >= 0) {
    return "";
  }

  return `
    <div class="flash flash-error bodega-alert-banner">
      <span class="flash-message">
        El costo de la mercancia vendida supera las ventas en ${escapeHtml(formatMoneda(Math.abs(ganancia)))}.
        Revisa las tiendas con margen en rojo en la tabla.
      </span>
    </div>
  `;
}

function renderDesempenoTable() {
  const ventas = state.ventas;
  const filas = (Array.isArray(ventas) ? ventas : []).filter((row) => row.codigo_legacy !== "TOTAL");
  const total = findTotalRow(ventas);

  const filtradas = state.tiendaFiltro ? filas.filter((row) => row.codigo_legacy === state.tiendaFiltro) : filas;

  const ordenadas = [...filtradas].sort((a, b) => {
    const diff = toFiniteNumber(a.total_pago) - toFiniteNumber(b.total_pago);
    return state.sortDir === "asc" ? diff : -diff;
  });

  const periodoLabel = formatRangoTriggerLabel(state.rango);

  return `
    <section class="modern-card">
      <div class="modern-card-head">
        <div>
          <h2>Desempeno por tienda</h2>
        </div>
        <span class="modern-chip">${escapeHtml(periodoLabel.toUpperCase())}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tienda</th>
              <th>Facturas</th>
              <th class="bodega-sortable-th" data-sort-vendido>
                Vendido ${state.sortDir === "asc" ? "&#8593;" : "&#8595;"}
              </th>
              <th>Costo</th>
              <th>Ganancia</th>
              <th>Margen</th>
            </tr>
          </thead>
          <tbody>
            ${
              ordenadas.length
                ? ordenadas
                    .map((row) => renderDesempenoRow(row, false))
                    .join("")
                : `<tr><td colspan="6"><div class="empty-state"><p>Sin datos todavia.</p></div></td></tr>`
            }
            ${total && !state.tiendaFiltro ? renderDesempenoRow(total, true) : ""}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDesempenoRow(row, isTotal) {
  const margenPct = calcularMargenPct(row);
  const margenTone = Math.abs(margenPct) < 0.005 ? "neutral" : margenPct >= 0 ? "positivo" : "negativo";
  const ganancia = toFiniteNumber(row.ganancia);
  const gananciaTone = Math.abs(ganancia) < 0.005 ? "neutral" : ganancia >= 0 ? "positivo" : "negativo";

  return `
    <tr class="${isTotal ? "is-selected-row" : ""}">
      <td>${isTotal ? "<strong>TOTAL</strong>" : escapeHtml(row.codigo_legacy || "-")}</td>
      <td>${escapeHtml(String(row.facturas ?? "0"))}</td>
      <td>${escapeHtml(formatMoneda(row.total_pago))}</td>
      <td>${escapeHtml(formatMoneda(row.total_costo_bs))}</td>
      <td class="bodega-ganancia-cell bodega-ganancia-${gananciaTone}">${escapeHtml(formatMoneda(row.ganancia))}</td>
      <td><span class="bodega-margen-badge bodega-margen-${margenTone}">${escapeHtml(formatPercent(margenPct))}%</span></td>
    </tr>
  `;
}

function renderInventarioSection() {
  const filas = (Array.isArray(state.inventario) ? state.inventario : []).filter((row) => row.codigo_legacy !== "TOTAL");
  const total = findTotalRow(state.inventario);
  const totalValor = toFiniteNumber(total?.valor_costo_usd) || 1;

  const filtradas = state.tiendaFiltro ? filas.filter((row) => row.codigo_legacy === state.tiendaFiltro) : filas;

  return `
    <section class="modern-card">
      <div class="modern-card-head">
        <div>
          <h2>Inventario actual (a costo)</h2>
        </div>
        <span class="modern-chip">VALORADO EN ${state.moneda === "USD" ? "US$" : "BS"}</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Tienda</th>
              <th>Articulos</th>
              <th>Unidades</th>
              <th>Valor a costo / Participacion</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtradas.length
                ? filtradas.map((row) => renderInventarioRow(row, totalValor, false)).join("")
                : `<tr><td colspan="4"><div class="empty-state"><p>Sin datos todavia.</p></div></td></tr>`
            }
            ${total && !state.tiendaFiltro ? renderInventarioRow(total, totalValor, true) : ""}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderInventarioRow(row, totalValor, isTotal) {
  const valorUsd = toFiniteNumber(row.valor_costo_usd);
  const participacion = isTotal ? 100 : Math.min(100, (valorUsd / totalValor) * 100);

  return `
    <tr class="${isTotal ? "is-selected-row" : ""}">
      <td>${isTotal ? "<strong>TOTAL</strong>" : escapeHtml(row.codigo_legacy || "-")}</td>
      <td>${escapeHtml(String(row.articulos ?? "0"))}</td>
      <td>${escapeHtml(formatBs(row.unidades))}</td>
      <td>
        <div class="bodega-participacion-cell">
          <span>${escapeHtml(formatMonedaDesdeUsd(valorUsd))}</span>
          <span class="bodega-participacion-bar-track">
            <span class="bodega-participacion-bar-fill" style="width:${participacion.toFixed(1)}%"></span>
          </span>
        </div>
      </td>
    </tr>
  `;
}

// Balance con lo que se puede calcular con certeza a partir de bodega_datos:
// el inventario a costo (activo real) y la ganancia acumulada del periodo
// elegido (resultado, no un "activo" contable formal). NO incluye cuentas
// por cobrar/pagar, deudas ni el efectivo real de caja/banco -- esos datos
// no se sincronizan hoy a bodega_datos, y mostrar un cero ahi seria peor que
// no mostrar la fila: daria la impresion de que la tienda no tiene deudas ni
// efectivo, cuando en realidad simplemente no lo estamos midiendo. Reusa
// state.inventario/state.ventas ya cargados -- no dispara ninguna consulta
// nueva al servidor.
function filtrarMovimientos(tipo) {
  const lista = Array.isArray(state.balanceMovimientos) ? state.balanceMovimientos : [];
  return lista
    .filter((mov) => mov.tipo === tipo)
    .filter(
      (mov) =>
        !state.tiendaFiltro || (Array.isArray(mov.codigos_tienda) && mov.codigos_tienda.includes(state.tiendaFiltro)),
    );
}

function sumarMontos(movimientos, soloOperativos) {
  return movimientos
    .filter((mov) => !soloOperativos || mov.es_operativo)
    .reduce((acc, mov) => acc + toFiniteNumber(mov.monto), 0);
}

function renderBalanceSection() {
  const ingresos = filtrarMovimientos("ingreso");
  const egresos = filtrarMovimientos("egreso");
  const totalIngresos = sumarMontos(ingresos, false);
  const totalEgresos = sumarMontos(egresos, false);
  const neto = totalIngresos - totalEgresos;
  const netoTone = neto >= 0 ? "positivo" : "negativo";

  return `
    <div class="bodega-balance-kpi-grid">
      <article class="bodega-balance-kpi-card bodega-balance-kpi-ingreso">
        <div class="bodega-balance-kpi-head">
          <span class="bodega-balance-kpi-label">INGRESOS</span>
          <span class="bodega-balance-kpi-icon">${renderIcon("trending-up")}</span>
        </div>
        <strong class="bodega-balance-kpi-value">${escapeHtml(formatMoneda(totalIngresos))}</strong>
        <span class="bodega-balance-kpi-meta">${ingresos.length} registro(s)</span>
      </article>
      <article class="bodega-balance-kpi-card bodega-balance-kpi-egreso">
        <div class="bodega-balance-kpi-head">
          <span class="bodega-balance-kpi-label">EGRESOS</span>
          <span class="bodega-balance-kpi-icon">${renderIcon("trending-down")}</span>
        </div>
        <strong class="bodega-balance-kpi-value">${escapeHtml(formatMoneda(totalEgresos))}</strong>
        <span class="bodega-balance-kpi-meta">${egresos.length} registro(s)</span>
      </article>
      <article class="bodega-balance-kpi-card bodega-balance-kpi-neto">
        <div class="bodega-balance-kpi-head">
          <span class="bodega-balance-kpi-label">BALANCE NETO</span>
          <span class="bodega-balance-kpi-icon">${renderIcon("scale")}</span>
        </div>
        <strong class="bodega-balance-kpi-value bodega-balance-kpi-value-${netoTone}">${escapeHtml(formatMoneda(neto))}</strong>
        <span class="bodega-balance-kpi-meta">${neto >= 0 ? "A favor" : "En contra"} en el periodo</span>
      </article>
    </div>

    <div class="bodega-movimientos-grid">
      ${renderMovimientosBlock("ingreso", ingresos, totalIngresos)}
      ${renderMovimientosBlock("egreso", egresos, totalEgresos)}
    </div>
  `;
}

function renderMovimientosBlock(tipo, movimientos, total) {
  const titulo = tipo === "ingreso" ? "Ingresos" : "Egresos";
  const formAbierto = state.balanceFormAbierto === tipo;

  return `
    <div class="bodega-movimientos-card bodega-movimientos-card-${tipo}">
      <div class="bodega-movimientos-card-head">
        <div class="bodega-movimientos-card-title">
          <span class="bodega-movimientos-dot"></span>
          <h3>${titulo}</h3>
          <span class="bodega-movimientos-count">${movimientos.length}</span>
        </div>
        <button type="button" class="bodega-movimientos-toggle-btn ${formAbierto ? "is-open" : ""}" data-balance-form-toggle="${tipo}">
          ${formAbierto ? "&times; Cancelar" : "+ Agregar"}
        </button>
      </div>
      ${formAbierto ? renderMovimientoForm(tipo) : ""}
      ${
        movimientos.length
          ? `<div class="bodega-movimientos-list">
              ${movimientos
                .map(
                  (mov) => `
                    <div class="bodega-movimiento-row">
                      <div class="bodega-movimiento-row-main">
                        <span class="bodega-movimiento-desc">${escapeHtml(mov.descripcion || "-")}</span>
                        <span class="bodega-movimiento-meta">
                          ${escapeHtml(formatDiaCorto(mov.fecha))} &middot; ${escapeHtml((mov.codigos_tienda || []).join(", "))}${mov.es_operativo ? " &middot; Operativo" : ""}
                        </span>
                      </div>
                      <div class="bodega-movimiento-row-amount">
                        <strong>${escapeHtml(formatMoneda(mov.monto))}</strong>
                        <button type="button" class="bodega-movimiento-delete" data-balance-eliminar="${escapeHtml(mov.id)}" title="Eliminar">&times;</button>
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : `<div class="bodega-movimientos-empty">Sin ${titulo.toLowerCase()} registrados en este periodo.</div>`
      }
      <div class="bodega-movimientos-total">
        <span>TOTAL</span>
        <strong>${escapeHtml(formatMoneda(total))}</strong>
      </div>
    </div>
  `;
}

function renderMovimientoForm(tipo) {
  const storeOptions = getStoreOptions();

  return `
    <form class="bodega-movimiento-form" data-balance-form="${tipo}">
      <div class="bodega-movimiento-form-row">
        <label>
          <span>Monto (${state.moneda === "USD" ? "US$" : "Bs"})</span>
          <input type="number" step="0.01" min="0.01" name="monto" placeholder="0.00" required>
        </label>
        <label>
          <span>Fecha</span>
          <input type="date" name="fecha" value="${escapeHtml(todayIso())}" required>
        </label>
      </div>
      <p class="bodega-movimiento-form-hint">Sin puntos de miles: escribe 1000 (no 1.000). Usa punto solo para decimales, ej. 1000.50.</p>
      <label class="bodega-movimiento-form-full">
        <span>Descripcion</span>
        <input type="text" name="descripcion" maxlength="300" placeholder="Ej. pago de flete" required>
      </label>
      <div class="bodega-movimiento-tiendas">
        <span>Tienda(s)</span>
        <div class="bodega-movimiento-tiendas-list">
          <label class="bodega-tienda-pill">
            <input type="checkbox" data-balance-todas-tiendas checked>
            <span class="bodega-tienda-pill-check">&check;</span>
            Todas
          </label>
          ${storeOptions
            .map(
              (codigo) => `
                <label class="bodega-tienda-pill">
                  <input type="checkbox" name="codigosTienda" value="${escapeHtml(codigo)}" data-balance-tienda-pill checked>
                  <span class="bodega-tienda-pill-check">&check;</span>
                  ${escapeHtml(codigo)}
                </label>
              `,
            )
            .join("")}
        </div>
      </div>
      <div class="bodega-movimiento-form-row bodega-movimiento-form-footer">
        <label class="bodega-checkbox-inline bodega-movimiento-operativo">
          <input type="checkbox" name="esOperativo">
          <span class="bodega-operativo-dot"></span>
          Es operativo
        </label>
        <button type="submit" class="button button-primary" ${state.balanceFormSaving ? "disabled" : ""}>
          ${state.balanceFormSaving ? "Guardando..." : "Guardar"}
        </button>
      </div>
      ${state.balanceFormError ? `<p class="bodega-movimiento-form-error">${escapeHtml(state.balanceFormError)}</p>` : ""}
    </form>
  `;
}

// ---- Carga de datos y eventos ------------------------------------------------

async function loadPanel() {
  const token = getToken();
  if (!token) {
    state.view = "login";
    render();
    return;
  }

  state.loading = true;
  setFlash(state.view === "panel" ? "Actualizando..." : "Conectando...", "info");
  render();

  if (!state.rango) {
    state.rango = { desde: todayIso(), hasta: todayIso() };
  }

  let response;
  let movimientosResponse;
  try {
    const params = new URLSearchParams({ desde: state.rango.desde, hasta: state.rango.hasta });
    [response, movimientosResponse] = await Promise.all([
      window.fetch(apiUrl(`bodega/validaciones/panel-resumen?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      }),
      window.fetch(apiUrl(`bodega/balance-movimientos?${params.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);
  } catch (error) {
    state.loading = false;
    setFlash(`No se pudo contactar el servidor: ${error?.message || error}`, "error");
    render();
    return;
  }

  if (response.status === 401 || response.status === 403) {
    setToken("");
    state.view = "login";
    state.loading = false;
    setFlash("Token invalido o expirado. Ingresalo de nuevo.", "error");
    render();
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    state.loading = false;
    setFlash(`El servidor respondio ${response.status}: ${text || "sin detalle"}`, "error");
    render();
    return;
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    state.loading = false;
    setFlash("Respuesta invalida del servidor.", "error");
    render();
    return;
  }

  state.view = "panel";
  state.loading = false;
  state.flash = null;
  state.ventas = Array.isArray(data.ventas) ? data.ventas : [];
  state.ventasAnterior = Array.isArray(data.ventasAnterior) ? data.ventasAnterior : [];
  state.inventario = Array.isArray(data.inventario) ? data.inventario : [];
  state.serieDiaria = Array.isArray(data.serieDiaria) ? data.serieDiaria : [];
  state.tasaCambio = data.tasaCambio || null;
  state.lastUpdated = new Date();
  try {
    state.balanceMovimientos =
      movimientosResponse && movimientosResponse.ok ? await movimientosResponse.json() : [];
  } catch (error) {
    state.balanceMovimientos = [];
  }
  render();
}

function bindEvents() {
  document.getElementById("login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = String(document.getElementById("token-input")?.value || "").trim();
    if (!token) {
      setFlash("Ingresa el token para conectar.", "error");
      render();
      return;
    }

    setToken(token);
    void loadPanel();
  });

  document.querySelector('[data-action="logout"]')?.addEventListener("click", () => {
    setToken("");
    state.view = "login";
    state.flash = null;
    render();
  });

  document.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    void loadPanel();
  });

  document.querySelector("[data-rango-toggle]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    state.rangoPickerOpen = !state.rangoPickerOpen;
    if (state.rangoPickerOpen) {
      state.rangoPickerInicio = null;
      state.rangoPickerMes = null;
    }
    render();
  });

  document.querySelectorAll("[data-rango-preset]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const preset = RANGO_PRESETS.find((item) => item.tipo === button.getAttribute("data-rango-preset"));
      if (preset) {
        seleccionarRango(preset.calc());
      }
    });
  });

  document.querySelectorAll("[data-rango-modo]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.rangoPickerModo = button.getAttribute("data-rango-modo");
      state.rangoPickerInicio = null;
      render();
    });
  });

  document.querySelector("[data-rango-mes-prev]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const mes = state.rangoPickerMes;
    state.rangoPickerMes = { year: mes.month === 0 ? mes.year - 1 : mes.year, month: (mes.month + 11) % 12 };
    render();
  });

  document.querySelector("[data-rango-mes-next]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const mes = state.rangoPickerMes;
    state.rangoPickerMes = { year: mes.month === 11 ? mes.year + 1 : mes.year, month: (mes.month + 1) % 12 };
    render();
  });

  document.querySelectorAll("[data-rango-dia]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      seleccionarDiaCalendario(button.getAttribute("data-rango-dia"));
    });
  });

  document.querySelector("[data-rango-popover]")?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.querySelectorAll("[data-moneda]").forEach((button) => {
    button.addEventListener("click", () => {
      state.moneda = button.getAttribute("data-moneda");
      render();
    });
  });

  document.querySelector("[data-tienda-filtro]")?.addEventListener("change", (event) => {
    state.tiendaFiltro = event.target.value || "";
    render();
  });

  document.querySelector("[data-sort-vendido]")?.addEventListener("click", () => {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    render();
  });

  document.querySelector("[data-balance-toggle]")?.addEventListener("click", () => {
    state.balanceVisible = !state.balanceVisible;
    state.balanceFormAbierto = null;
    state.balanceFormError = null;
    render();
  });

  document.querySelectorAll("[data-balance-form-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const tipo = button.getAttribute("data-balance-form-toggle");
      state.balanceFormAbierto = state.balanceFormAbierto === tipo ? null : tipo;
      state.balanceFormError = null;
      render();
    });
  });

  document.querySelectorAll("[data-balance-todas-tiendas]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const form = event.target.closest("form");
      const marcado = event.target.checked;
      form?.querySelectorAll('input[name="codigosTienda"]').forEach((input) => {
        input.checked = marcado;
      });
    });
  });

  document.querySelectorAll("[data-balance-tienda-pill]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const form = event.target.closest("form");
      if (!form) return;
      const pills = form.querySelectorAll('input[name="codigosTienda"]');
      const todas = form.querySelector("[data-balance-todas-tiendas]");
      if (todas) {
        todas.checked = Array.from(pills).every((input) => input.checked);
      }
    });
  });

  document.querySelectorAll("[data-balance-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitMovimientoForm(form);
    });
  });

  document.querySelectorAll("[data-balance-eliminar]").forEach((button) => {
    button.addEventListener("click", () => {
      void eliminarMovimiento(button.getAttribute("data-balance-eliminar"));
    });
  });
}

async function submitMovimientoForm(form) {
  const tipo = form.getAttribute("data-balance-form");
  const formData = new FormData(form);
  const montoIngresado = Number(formData.get("monto"));
  const descripcion = String(formData.get("descripcion") || "").trim();
  const fecha = String(formData.get("fecha") || "");
  const esOperativo = formData.get("esOperativo") === "on";
  const codigosTienda = formData.getAll("codigosTienda").map((value) => String(value));

  if (!montoIngresado || montoIngresado <= 0) {
    state.balanceFormError = "El monto debe ser mayor a 0.";
    render();
    return;
  }
  if (!descripcion) {
    state.balanceFormError = "La descripcion es requerida.";
    render();
    return;
  }
  if (!codigosTienda.length) {
    state.balanceFormError = "Selecciona al menos una tienda.";
    render();
    return;
  }

  // El backend guarda el monto en bolivares (mismo criterio que
  // Ventas.TotalPago). Si la vista esta en US$, el usuario tipeo dolares --
  // se convierte a Bs con la tasa vigente antes de enviarlo.
  let monto = montoIngresado;
  if (state.moneda === "USD") {
    const tasa = getTasaValor();
    if (!(tasa > 0)) {
      state.balanceFormError = "No hay tasa de cambio disponible para convertir el monto a bolivares.";
      render();
      return;
    }
    monto = montoIngresado * tasa;
  }

  state.balanceFormSaving = true;
  state.balanceFormError = null;
  render();

  const token = getToken();
  try {
    const response = await window.fetch(apiUrl("bodega/balance-movimientos"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tipo, esOperativo, monto, descripcion, fecha, codigosTienda }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      state.balanceFormError = `No se pudo guardar: ${text || response.status}`;
      state.balanceFormSaving = false;
      render();
      return;
    }
  } catch (error) {
    state.balanceFormError = `No se pudo contactar el servidor: ${error?.message || error}`;
    state.balanceFormSaving = false;
    render();
    return;
  }

  state.balanceFormSaving = false;
  state.balanceFormAbierto = null;
  await loadPanel();
}

async function eliminarMovimiento(id) {
  if (!id || !window.confirm("Eliminar este movimiento?")) {
    return;
  }
  const token = getToken();
  try {
    const response = await window.fetch(apiUrl(`bodega/balance-movimientos/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      setFlash(`No se pudo eliminar: ${text || response.status}`, "error");
      render();
      return;
    }
  } catch (error) {
    setFlash(`No se pudo contactar el servidor: ${error?.message || error}`, "error");
    render();
    return;
  }
  await loadPanel();
}

// Cierra el desplegable si el clic fue fuera de el. Registrado UNA sola vez
// a nivel de documento (no dentro de bindEvents, que corre en cada render())
// para no ir apilando listeners duplicados en cada re-render.
document.addEventListener("click", () => {
  if (state.rangoPickerOpen) {
    state.rangoPickerOpen = false;
    state.rangoPickerInicio = null;
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.rangoPickerOpen) {
    state.rangoPickerOpen = false;
    state.rangoPickerInicio = null;
    render();
  }
});

function seleccionarRango(rango) {
  state.rango = rango;
  state.rangoPickerOpen = false;
  state.rangoPickerInicio = null;
  state.rangoPickerMes = null;
  void loadPanel();
}

function seleccionarDiaCalendario(iso) {
  if (state.rangoPickerModo === "dia") {
    seleccionarRango({ desde: iso, hasta: iso });
    return;
  }

  if (!state.rangoPickerInicio) {
    state.rangoPickerInicio = iso;
    render();
    return;
  }

  const desde = state.rangoPickerInicio < iso ? state.rangoPickerInicio : iso;
  const hasta = state.rangoPickerInicio < iso ? iso : state.rangoPickerInicio;
  seleccionarRango({ desde, hasta });
}

void loadPanel();
