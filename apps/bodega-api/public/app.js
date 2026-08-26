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
  periodo: "hoy",
  moneda: "BS",
  tiendaFiltro: "",
  sortDir: "desc",
  ventasHoy: [],
  ventas7Dias: [],
  ventasMes: [],
  inventario: [],
  serieDiaria: [],
  tasaCambio: null,
  lastUpdated: null,
};

const PERIODOS = [
  { key: "hoy", label: "Hoy" },
  { key: "7dias", label: "7 dias" },
  { key: "mes", label: "Mes" },
];

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

function getVentasPorPeriodo() {
  if (state.periodo === "7dias") {
    return state.ventas7Dias;
  }
  if (state.periodo === "mes") {
    return state.ventasMes;
  }
  return state.ventasHoy;
}

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

function formatMoneda(valor) {
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

// vs-ayer (hoy) o vs-los-7-dias-anteriores (7 dias), calculado sobre la
// misma serie diaria de 14 dias que alimenta las mini-graficas -- para "mes"
// no hay suficiente historial (solo 14 dias) para un punto de comparacion
// honesto, asi que no se muestra delta.
function getDeltaPeriodo(metricKey) {
  const serie = Array.isArray(state.serieDiaria) ? state.serieDiaria : [];
  if (state.periodo === "hoy") {
    if (serie.length < 2) {
      return null;
    }
    const hoy = toFiniteNumber(serie[serie.length - 1][metricKey]);
    const ayer = toFiniteNumber(serie[serie.length - 2][metricKey]);
    if (ayer === 0) {
      return null;
    }
    return { pct: ((hoy - ayer) / Math.abs(ayer)) * 100, etiqueta: "vs ayer" };
  }

  if (state.periodo === "7dias") {
    if (serie.length < 14) {
      return null;
    }
    const ultimos7 = serie.slice(-7);
    const previos7 = serie.slice(-14, -7);
    const sum = (arr) => arr.reduce((acc, row) => acc + toFiniteNumber(row[metricKey]), 0);
    const actual = sum(ultimos7);
    const previo = sum(previos7);
    if (previo === 0) {
      return null;
    }
    return { pct: ((actual - previo) / Math.abs(previo)) * 100, etiqueta: "vs semana anterior" };
  }

  return null;
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
                  <h1>Todas las tiendas</h1>
                  <p>Ventas, costo, margen e inventario de todas las tiendas.</p>
                </div>
                <div class="modern-page-actions">
                  <button class="button button-ghost" type="button" data-action="refresh" ${state.loading ? "disabled" : ""}>
                    ${state.loading ? "Actualizando..." : "Actualizar"}
                  </button>
                  ${state.lastUpdated ? `<span class="bodega-updated-hint">${escapeHtml(formatUpdatedHint(state.lastUpdated))}</span>` : ""}
                </div>
              </div>

              ${renderControlsBar()}
              ${renderSummaryCards()}
              ${renderAlertBanner()}
              ${renderDesempenoTable()}
              ${renderInventarioSection()}
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

function renderControlsBar() {
  const storeOptions = getStoreOptions();
  const tasa = state.tasaCambio;

  return `
    <div class="bodega-controls-bar">
      <div class="bodega-controls-group" role="group" aria-label="Periodo">
        ${PERIODOS.map(
          (periodo) => `
            <button
              type="button"
              class="bodega-toggle-button ${state.periodo === periodo.key ? "is-active" : ""}"
              data-periodo="${periodo.key}"
            >${escapeHtml(periodo.label)}</button>
          `,
        ).join("")}
      </div>

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
  const ventas = getVentasPorPeriodo();
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
      value: formatMoneda(state.moneda === "USD" ? totalInventario?.valor_costo_usd : convertirDesdeUsd(totalInventario?.valor_costo_usd)),
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
                <strong class="modern-stat-value">${item.value}</strong>
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
  const ventas = getVentasPorPeriodo();
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
  const ventas = getVentasPorPeriodo();
  const filas = (Array.isArray(ventas) ? ventas : []).filter((row) => row.codigo_legacy !== "TOTAL");
  const total = findTotalRow(ventas);

  const filtradas = state.tiendaFiltro ? filas.filter((row) => row.codigo_legacy === state.tiendaFiltro) : filas;

  const ordenadas = [...filtradas].sort((a, b) => {
    const diff = toFiniteNumber(a.total_pago) - toFiniteNumber(b.total_pago);
    return state.sortDir === "asc" ? diff : -diff;
  });

  const periodoLabel = PERIODOS.find((periodo) => periodo.key === state.periodo)?.label || "Hoy";

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
              <th>Margen</th>
            </tr>
          </thead>
          <tbody>
            ${
              ordenadas.length
                ? ordenadas
                    .map((row) => renderDesempenoRow(row, false))
                    .join("")
                : `<tr><td colspan="5"><div class="empty-state"><p>Sin datos todavia.</p></div></td></tr>`
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

  return `
    <tr class="${isTotal ? "is-selected-row" : ""}">
      <td>${isTotal ? "<strong>TOTAL</strong>" : escapeHtml(row.codigo_legacy || "-")}</td>
      <td>${escapeHtml(String(row.facturas ?? "0"))}</td>
      <td>${escapeHtml(formatMoneda(row.total_pago))}</td>
      <td>${escapeHtml(formatMoneda(row.total_costo_bs))}</td>
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
          <span>${escapeHtml(formatMoneda(convertirDesdeUsd(valorUsd)))}</span>
          <span class="bodega-participacion-bar-track">
            <span class="bodega-participacion-bar-fill" style="width:${participacion.toFixed(1)}%"></span>
          </span>
        </div>
      </td>
    </tr>
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

  let response;
  try {
    response = await window.fetch(apiUrl("bodega/validaciones/panel-resumen"), {
      headers: { Authorization: `Bearer ${token}` },
    });
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
  state.ventasHoy = Array.isArray(data.ventasHoy) ? data.ventasHoy : [];
  state.ventas7Dias = Array.isArray(data.ventas7Dias) ? data.ventas7Dias : [];
  state.ventasMes = Array.isArray(data.ventasMes) ? data.ventasMes : [];
  state.inventario = Array.isArray(data.inventario) ? data.inventario : [];
  state.serieDiaria = Array.isArray(data.serieDiaria) ? data.serieDiaria : [];
  state.tasaCambio = data.tasaCambio || null;
  state.lastUpdated = new Date();
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

  document.querySelectorAll("[data-periodo]").forEach((button) => {
    button.addEventListener("click", () => {
      state.periodo = button.getAttribute("data-periodo");
      render();
    });
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
}

void loadPanel();
