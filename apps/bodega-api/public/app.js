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
  ventasHoy: [],
  ventasMes: [],
  inventario: [],
};

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

        <div class="modern-page">
          <div class="modern-page-header">
            <div>
              <h1>Todas las tiendas</h1>
              <p>Ventas, costo, ganancia (en bolivares) e inventario a costo (en dolares) combinados de todas las tiendas.</p>
            </div>
            <div class="modern-page-actions">
              <button class="button button-ghost" type="button" data-action="refresh" ${state.loading ? "disabled" : ""}>
                ${state.loading ? "Actualizando..." : "Actualizar"}
              </button>
            </div>
          </div>

          ${renderFlash()}

          <section class="modern-card">
            <div class="modern-card-head">
              <div>
                <h2>Ventas de hoy</h2>
              </div>
            </div>
            ${renderVentasTable(state.ventasHoy)}
          </section>

          <section class="modern-card">
            <div class="modern-card-head">
              <div>
                <h2>Ventas del mes en curso</h2>
              </div>
            </div>
            ${renderVentasTable(state.ventasMes)}
          </section>

          <section class="modern-card">
            <div class="modern-card-head">
              <div>
                <h2>Inventario actual (a costo)</h2>
              </div>
            </div>
            ${renderInventarioTable(state.inventario)}
          </section>
        </div>
      </section>
    </main>
  `;
}

function renderVentasTable(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return `<div class="empty-state"><p>Sin datos todavia.</p></div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Tienda</th>
            <th>Facturas</th>
            <th>Vendido (Bs)</th>
            <th>Costo (Bs)</th>
            <th>Ganancia (Bs)</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((row) => {
              const isTotal = row.codigo_legacy === "TOTAL";
              return `
                <tr class="${isTotal ? "is-selected-row" : ""}">
                  <td>${isTotal ? "<strong>TOTAL</strong>" : escapeHtml(row.codigo_legacy || "-")}</td>
                  <td>${escapeHtml(String(row.facturas ?? "0"))}</td>
                  <td>${escapeHtml(formatBs(row.total_pago))}</td>
                  <td>${escapeHtml(formatBs(row.total_costo_bs))}</td>
                  <td>${escapeHtml(formatBs(row.ganancia))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventarioTable(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return `<div class="empty-state"><p>Sin datos todavia.</p></div>`;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Tienda</th>
            <th>Articulos</th>
            <th>Unidades</th>
            <th>Valor a costo (USD)</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((row) => {
              const isTotal = row.codigo_legacy === "TOTAL";
              return `
                <tr class="${isTotal ? "is-selected-row" : ""}">
                  <td>${isTotal ? "<strong>TOTAL</strong>" : escapeHtml(row.codigo_legacy || "-")}</td>
                  <td>${escapeHtml(String(row.articulos ?? "0"))}</td>
                  <td>${escapeHtml(formatBs(row.unidades))}</td>
                  <td>${escapeHtml(formatUsd(row.valor_costo_usd))}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

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
  state.ventasMes = Array.isArray(data.ventasMes) ? data.ventasMes : [];
  state.inventario = Array.isArray(data.inventario) ? data.inventario : [];
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
}

void loadPanel();
