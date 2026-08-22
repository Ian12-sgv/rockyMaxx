const TOKEN_STORAGE_KEY = "rocky.bodega.token";

const loginView = document.getElementById("login-view");
const panelView = document.getElementById("panel-view");
const loginForm = document.getElementById("login-form");
const tokenInput = document.getElementById("token-input");
const loginFlash = document.getElementById("login-flash");
const panelFlash = document.getElementById("panel-flash");
const logoutButton = document.getElementById("logout-button");
const refreshButton = document.getElementById("refresh-button");
const ventasHoyTable = document.getElementById("ventas-hoy-table");
const ventasMesTable = document.getElementById("ventas-mes-table");
const inventarioTable = document.getElementById("inventario-table");

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

function setFlash(target, message, type) {
  if (!message) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = `<div class="flash flash-${type}">${escapeHtml(message)}</div>`;
}

function showLogin(message) {
  loginView.hidden = false;
  panelView.hidden = true;
  logoutButton.hidden = true;
  setFlash(loginFlash, message || "", "error");
}

function showPanel() {
  loginView.hidden = true;
  panelView.hidden = false;
  logoutButton.hidden = false;
}

function renderVentasTable(container, rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    container.innerHTML = `<div class="empty-state">Sin datos todavia.</div>`;
    return;
  }

  container.innerHTML = `
    <table>
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
              <tr class="${isTotal ? "total-row" : ""}">
                <td>${escapeHtml(row.codigo_legacy || "-")}</td>
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
  `;
}

function renderInventarioTable(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    inventarioTable.innerHTML = `<div class="empty-state">Sin datos todavia.</div>`;
    return;
  }

  inventarioTable.innerHTML = `
    <table>
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
              <tr class="${isTotal ? "total-row" : ""}">
                <td>${escapeHtml(row.codigo_legacy || "-")}</td>
                <td>${escapeHtml(String(row.articulos ?? "0"))}</td>
                <td>${escapeHtml(formatBs(row.unidades))}</td>
                <td>${escapeHtml(formatUsd(row.valor_costo_usd))}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

async function loadPanel() {
  const token = getToken();
  if (!token) {
    showLogin("");
    return;
  }

  setFlash(panelFlash, "Cargando resumen...", "info");

  let response;
  try {
    response = await window.fetch("/bodega/validaciones/panel-resumen", {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    setFlash(panelFlash, `No se pudo contactar el servidor: ${error?.message || error}`, "error");
    return;
  }

  if (response.status === 401 || response.status === 403) {
    setToken("");
    showLogin("Token invalido o expirado. Ingresalo de nuevo.");
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    setFlash(panelFlash, `El servidor respondio ${response.status}: ${text || "sin detalle"}`, "error");
    return;
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    setFlash(panelFlash, "Respuesta invalida del servidor.", "error");
    return;
  }

  showPanel();
  setFlash(panelFlash, "", "info");
  renderVentasTable(ventasHoyTable, data.ventasHoy);
  renderVentasTable(ventasMesTable, data.ventasMes);
  renderInventarioTable(data.inventario);
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = String(tokenInput.value || "").trim();
  if (!token) {
    setFlash(loginFlash, "Ingresa el token para conectar.", "error");
    return;
  }

  setToken(token);
  tokenInput.value = "";
  void loadPanel();
});

logoutButton.addEventListener("click", () => {
  setToken("");
  showLogin("");
});

refreshButton.addEventListener("click", () => {
  void loadPanel();
});

void loadPanel();
