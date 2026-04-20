const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "rocky.maxx.access-token";
const USER_STORAGE_KEY = "rocky.maxx.user";

const state = {
  booting: true,
  token: window.localStorage.getItem(TOKEN_STORAGE_KEY) || "",
  user: readStoredJson(USER_STORAGE_KEY),
  flash: null,
  isAuthenticating: false,
  currentView: "articulos",
  navigation: {
    openMenu: "",
    openSubmenu: "",
  },
  loginDraft: {
    usuario: "",
    password: "",
  },
  metadata: null,
  loadingMetadata: false,
  loadingArticles: false,
  articles: [],
  pagination: {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  },
  search: {
    buscar: "",
    status: "",
    tipo: "",
  },
  formMode: "create",
  activeArticleCode: "",
  selectedArticle: null,
  formDraft: null,
  loadingForm: false,
  submittingForm: false,
  deletingCode: "",
};

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((error) => {
    console.error(error);
    state.booting = false;
    setFlash("No se pudo iniciar la aplicacion.", "error");
    render();
  });
});

async function bootstrap() {
  if (state.token) {
    try {
      await hydrateAuthenticatedState();
    } catch (error) {
      console.error(error);
      clearSession();
      setFlash("La sesion anterior ya no es valida. Inicia sesion nuevamente.", "error");
    }
  }

  if (!state.formDraft) {
    state.formDraft = createEmptyDraft();
  }

  state.booting = false;
  render();
}

async function hydrateAuthenticatedState() {
  const session = await apiFetch("/auth/me");
  state.user = session.usuario;
  persistUser();
  await Promise.all([
    loadCreationMetadata({ renderAfter: false }),
    loadArticles(1, { renderAfter: false }),
  ]);
  state.currentView = "articulos";
  state.navigation = {
    openMenu: "",
    openSubmenu: "",
  };
  state.formMode = "create";
  state.activeArticleCode = "";
  state.selectedArticle = null;
  state.formDraft = createEmptyDraft();
}

function render() {
  const app = document.getElementById("app");
  if (!app) {
    return;
  }

  if (state.booting) {
    app.innerHTML = renderBootScreen();
    return;
  }

  if (!state.token || !state.user) {
    app.innerHTML = renderLoginView();
    bindLoginEvents();
    return;
  }

  app.innerHTML = renderShellView();
  bindShellEvents();
}

function renderBootScreen() {
  return `
    <main class="boot-screen">
      <section class="boot-card">
        <p class="eyebrow">Rocky Maxx</p>
        <h1>Preparando el panel de articulos</h1>
        <p>Estamos validando tu sesion y conectando la interfaz con el backend.</p>
      </section>
    </main>
  `;
}

function renderLoginView() {
  return `
    <main class="login-shell">
      <section class="login-stage login-stage-compact">
        <section class="login-access-card">
          <div class="login-access-header">
            <p class="eyebrow login-eyebrow">Inicio de sesion</p>
            <h2>Acceso al sistema</h2>
            <p>
              Ingresa tus credenciales para continuar con el modulo
              <strong>Archivo &gt; Articulos</strong>.
            </p>
          </div>

          ${renderFlash()}
          <form id="login-form" class="form-stack">
            <label class="field">
              <span>Usuario</span>
              <input
                type="text"
                name="usuario"
                placeholder="admin"
                autocomplete="username"
                value="${escapeHtml(state.loginDraft.usuario)}"
                required
              />
            </label>

            <label class="field">
              <span>Clave</span>
              <input
                type="password"
                name="password"
                placeholder="Ingresa tu clave"
                autocomplete="current-password"
                value="${escapeHtml(state.loginDraft.password)}"
                required
              />
            </label>

            <div class="button-row">
              <button class="button button-primary" type="submit" ${state.isAuthenticating ? "disabled" : ""}>
                ${state.isAuthenticating ? "Validando acceso..." : "Ingresar"}
              </button>
            </div>
          </form>

          <div class="login-security-strip">
            <strong>Acceso autorizado</strong>
            <span>Uso exclusivo para personal administrativo y gestion interna.</span>
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderShellView() {
  const primaryGroup = state.user?.grupos?.[0]?.nombre || "Administrador";
  const userCode = (state.user?.codUsuario || "admin").toUpperCase();

  return `
    <main class="desktop-shell">
      <section class="desktop-frame">
        <header class="modern-topbar">
          <div class="modern-topbar-main">
            <div class="modern-brand">
              <div class="modern-brand-mark">S</div>
              <div class="modern-brand-copy">
                <strong>SPDV</strong>
              </div>
            </div>

            <nav class="modern-nav">
              ${renderDesktopMenu("sistema", "Sistema", `
                ${renderDesktopMenuLink("desktop", "Panel principal")}
                <button class="modern-dropdown-link" type="button" data-menu-action="logout">Cerrar sesion</button>
              `)}
              ${renderDesktopMenu("archivos", "Archivos", renderDesktopArchivoMenuV2())}
              ${renderDesktopMenu("procesos", "Procesos", `
                ${renderDesktopMenuLink("reportes", "Movimientos")}
              `)}
              ${renderDesktopMenu("reportes", "Reportes", `
                ${renderDesktopMenuLink("reportes", "General")}
              `)}
              ${renderDesktopMenu("utilidades", "Utilidades", `
                ${renderDesktopMenuLink("usuarios", "Usuarios")}
                ${renderDesktopMenuLink("roles", "Roles")}
              `)}
              ${renderDesktopMenu("ayuda", "Ayuda", `
                ${renderDesktopMenuLink("ayuda", "Acerca de Rocky Maxx")}
              `)}
            </nav>
          </div>

          <span class="modern-session-label">
            <span class="modern-session-dot"></span>
            ${escapeHtml(`${userCode} | ${primaryGroup}`)}
          </span>
        </header>

        <section class="desktop-workspace">
          <div class="modern-workspace-shell">
            ${renderFlash()}
            ${renderDesktopWorkspace()}
            ${renderSystemFooter()}
          </div>
        </section>
      </section>
    </main>
  `;
}

function renderDesktopMenu(menuKey, label, dropdownContent) {
  const isOpen = state.navigation.openMenu === menuKey;

  return `
    <div class="modern-menu-item">
      <button
        class="modern-menu-button ${isOpen ? "modern-menu-button-active" : ""}"
        type="button"
        data-menu="${menuKey}"
        aria-expanded="${isOpen ? "true" : "false"}"
      >
        ${label}
      </button>
      ${isOpen ? `<div class="modern-dropdown modern-dropdown-${menuKey}">${dropdownContent}</div>` : ""}
    </div>
  `;
}

function renderDesktopArchivoMenu() {
  return `
    <div class="modern-mega-menu">
      <div class="modern-mega-column">
        <button class="modern-mega-head" type="button" data-menu-view="desktop">
          <span>Inventario</span>
          <span>›</span>
        </button>
        <button class="modern-dropdown-link" type="button" data-menu-view="clientes">Clientes</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="sucursales">Sucursales</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="personal">Personal</button>
      </div>
      <div class="modern-mega-column">
        <button class="modern-mega-head" type="button" data-menu-view="articulos">
          <span>Artículos</span>
          <span>›</span>
        </button>
        <button class="modern-dropdown-link" type="button" data-menu-view="tallas">Tallas</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="colores">Colores</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="fabricantes">Fabricantes</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="marcas">Marcas</button>
        <button class="modern-dropdown-link" type="button" data-menu-view="categorias">Categorías</button>
      </div>
    </div>
  `;
}

function renderDesktopWorkspace() {
  if (state.currentView === "articulos") {
    return renderDesktopArticlesWorkspaceV2();
  }

  if (state.currentView === "desktop") {
    return renderDesktopDashboardV2();
  }

  return renderDesktopPlaceholderWindowV2(
    getDesktopViewLabelV2(state.currentView),
    "Este modulo quedara disponible en las siguientes iteraciones del sistema.",
  );
}

function renderDesktopArticlesWorkspace() {
  const selectedLabel =
    state.formMode === "edit" && state.activeArticleCode ? state.activeArticleCode : "Nuevo registro";

  return `
    <div class="modern-page">
      <div class="modern-breadcrumb">
        <span>Archivos</span>
        <span>›</span>
        <span>Inventario</span>
        <span>›</span>
        <strong>Artículos</strong>
      </div>

      <div class="modern-page-header">
        <div>
          <h1>Artículos</h1>
          <p>Catálogo completo de productos y configuración del módulo.</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-ghost" type="button" data-refresh>
            ${state.loadingMetadata || state.loadingArticles ? "Actualizando..." : "Actualizar"}
          </button>
          <button class="button button-primary" type="button" data-new-article>
            ${state.formMode === "edit" ? `Nuevo (${escapeHtml(selectedLabel)})` : "Nuevo"}
          </button>
        </div>
      </div>

      <div class="modern-module-grid">
        <section class="modern-card modern-card-list">
          <div class="modern-card-head">
            <div>
              <h2>Artículos</h2>
              <p>Total registrados: ${escapeHtml(String(state.pagination.total || 0))}</p>
            </div>
            <div class="modern-chip">
              ${state.loadingMetadata ? "Catálogos cargando" : "Catálogos listos"}
            </div>
          </div>
          <div class="modern-search-wrap">
            ${renderSearchForm()}
          </div>
          ${renderArticlesTable()}
          ${renderPagination()}
        </section>

        <aside class="modern-card modern-card-editor">
          ${renderArticleEditor()}
        </aside>
      </div>
    </div>
  `;
}

function renderDesktopPlaceholderWindow(title, description) {
  return `
    <div class="modern-page">
      <div class="modern-breadcrumb">
        <span>Sistema</span>
        <span>›</span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="modern-card modern-card-placeholder">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description)}</p>
      </div>
    </div>
  `;
}

function getDesktopViewLabel(view) {
  const labels = {
    desktop: "Panel principal",
    articulos: "Artículos",
    tallas: "Tallas",
    colores: "Colores",
    fabricantes: "Fabricantes",
    marcas: "Marcas",
    categorias: "Categorías",
    clientes: "Clientes",
    sucursales: "Sucursales",
    personal: "Personal",
    reportes: "Reportes",
    usuarios: "Usuarios",
    roles: "Roles",
    ayuda: "Ayuda",
  };

  return labels[view] || "Panel principal";
}

function renderDesktopArchivoMenuV2() {
  const inventoryOpen = state.navigation.openSubmenu === "inventario";

  return `
    <div class="modern-mega-menu">
      <div class="modern-mega-column modern-mega-column-root">
        <button
          class="modern-dropdown-link modern-dropdown-link-with-arrow ${inventoryOpen ? "modern-dropdown-link-open" : ""}"
          type="button"
          data-submenu="inventario"
          aria-expanded="${inventoryOpen ? "true" : "false"}"
        >
          <span>Inventario</span>
          <span class="modern-dropdown-link-arrow">&rsaquo;</span>
        </button>
        ${renderDesktopMenuLink("clientes", "Clientes")}
        ${renderDesktopMenuLink("sucursales", "Sucursales")}
        ${renderDesktopMenuLink("personal", "Personal")}
      </div>
      ${
        inventoryOpen
          ? `
            <div class="modern-archive-submenu">
              ${renderDesktopMenuLink("articulos", "Articulos")}
              ${renderDesktopMenuLink("tallas", "Tallas")}
              ${renderDesktopMenuLink("colores", "Colores")}
              ${renderDesktopMenuLink("fabricantes", "Fabricantes")}
              ${renderDesktopMenuLink("marcas", "Marcas")}
              ${renderDesktopMenuLink("categorias", "Categorias")}
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderDesktopMenuLink(view, label) {
  return `
    <button
      class="modern-dropdown-link"
      type="button"
      data-menu-view="${view}"
    >
      ${label}
    </button>
  `;
}

function renderDesktopArticlesWorkspaceV2() {
  const selectedLabel =
    state.formMode === "edit" && state.activeArticleCode ? state.activeArticleCode : "Nuevo registro";

  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(["Archivos", "Inventario", "Articulos"])}

      <div class="modern-page-header">
        <div>
          <h1>Articulos</h1>
          <p>Catalogo completo de productos, precios y configuracion comercial del modulo.</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-primary" type="button" data-new-article>
            ${state.formMode === "edit" ? `Nuevo (${escapeHtml(selectedLabel)})` : "Nuevo"}
          </button>
          <button class="button button-ghost" type="button" data-refresh>
            ${state.loadingMetadata || state.loadingArticles ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      ${renderExecutiveCards()}

      <div class="modern-module-grid">
        <section class="modern-card modern-card-list">
          <div class="modern-card-head">
            <div>
              <h2>Articulos</h2>
              <p>Total registrados: ${escapeHtml(String(state.pagination.total || 0))}</p>
            </div>
            <div class="modern-chip">
              ${state.loadingMetadata ? "Catalogos cargando" : "Catalogos listos"}
            </div>
          </div>
          <div class="modern-search-wrap">
            ${renderSearchForm()}
          </div>
          ${renderArticlesTable()}
          ${renderPagination()}
        </section>

        <div class="modern-side-stack">
          ${renderCriticalStockCard()}
          <aside class="modern-card modern-card-editor">
            ${renderArticleEditor()}
          </aside>
        </div>
      </div>
    </div>
  `;
}

function renderDesktopPlaceholderWindowV2(title, description) {
  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(getDesktopBreadcrumb(state.currentView))}
      <div class="modern-card modern-card-placeholder">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description)}</p>
      </div>
    </div>
  `;
}

function renderDesktopDashboardV2() {
  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(["Sistema", "Dashboard"])}

      <div class="modern-page-header">
        <div>
          <h1>Panel de Control</h1>
          <p>Resumen ejecutivo del sistema SPDV para administracion de articulos e inventario.</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-primary" type="button" data-menu-view="articulos">
            Abrir articulos
          </button>
        </div>
      </div>

      ${renderExecutiveCards()}

      <div class="modern-dashboard-grid">
        <section class="modern-card modern-card-chart">
          <div class="modern-card-head">
            <div>
              <h2>Actividad semanal</h2>
              <p>Resumen visual para el equipo administrativo.</p>
            </div>
            <div class="modern-chip">Operacion estable</div>
          </div>
          <div class="modern-chart-placeholder">
            <div class="modern-chart-bars">
              <span style="height: 38%"></span>
              <span style="height: 52%"></span>
              <span style="height: 46%"></span>
              <span style="height: 68%"></span>
              <span style="height: 61%"></span>
              <span style="height: 74%"></span>
              <span style="height: 58%"></span>
            </div>
            <div class="modern-chart-axis">
              <span>Lun</span>
              <span>Mar</span>
              <span>Mie</span>
              <span>Jue</span>
              <span>Vie</span>
              <span>Sab</span>
              <span>Dom</span>
            </div>
          </div>
        </section>

        ${renderCriticalStockCard()}
      </div>
    </div>
  `;
}

function renderDesktopBreadcrumb(items) {
  return `
    <div class="modern-breadcrumb">
      ${items
        .map((item, index) => {
          const isLast = index === items.length - 1;

          return `
            <span class="${isLast ? "modern-breadcrumb-current" : ""}">
              ${escapeHtml(item)}
            </span>
          `;
        })
        .join('<span class="modern-breadcrumb-separator">&rsaquo;</span>')}
    </div>
  `;
}

function renderExecutiveCards() {
  return `
    <div class="modern-summary-grid">
      ${getExecutiveCardItems()
        .map(
          (item) => `
            <article class="modern-stat-card modern-stat-card-${item.tone}">
              <div class="modern-stat-copy">
                <span class="modern-stat-eyebrow">${escapeHtml(item.label)}</span>
                <strong class="modern-stat-value">${escapeHtml(item.value)}</strong>
                <span class="modern-stat-meta">${escapeHtml(item.meta)}</span>
                <span class="modern-stat-badge">${escapeHtml(item.badge)}</span>
              </div>
              <span class="modern-stat-icon">${escapeHtml(item.icon)}</span>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCriticalStockCard() {
  const criticalItems = getCriticalStockItems();

  return `
    <section class="modern-card modern-card-critical">
      <div class="modern-card-head modern-card-head-tight">
        <div>
          <h2>Stock critico</h2>
          <p>Articulos que requieren reposicion.</p>
        </div>
        <div class="modern-chip modern-chip-alert">${escapeHtml(String(criticalItems.length))} alertas</div>
      </div>

      ${
        criticalItems.length > 0
          ? `
            <div class="modern-critical-list">
              ${criticalItems
                .map(
                  (item) => `
                    <article class="modern-critical-item">
                      <div class="modern-critical-avatar">${escapeHtml(item.icon)}</div>
                      <div class="modern-critical-copy">
                        <strong>${escapeHtml(item.name)}</strong>
                        <span>${escapeHtml(item.code)}</span>
                      </div>
                      <span class="modern-critical-badge ${item.levelClass}">${escapeHtml(item.stockLabel)}</span>
                    </article>
                  `,
                )
                .join("")}
            </div>
          `
          : `
            <div class="modern-critical-empty">
              <strong>Sin alertas criticas</strong>
              <p>Los articulos visibles se encuentran por encima del punto de recorte.</p>
            </div>
          `
      }
    </section>
  `;
}

function renderSystemFooter() {
  const host = window.location.hostname || "127.0.0.1";

  return `
    <footer class="modern-system-footer">
      <div class="modern-system-footer-main">
        <span class="modern-system-footer-eyebrow">Sistema Operativo</span>
        <strong>SPDV - Rocky Maxx</strong>
        <span>Usuario ${escapeHtml((state.user?.codUsuario || "admin").toUpperCase())} | Version 2.0.0</span>
      </div>
      <div class="modern-system-footer-grid">
        <div class="modern-system-footer-block">
          <span>Servidor</span>
          <strong>${escapeHtml(host)}</strong>
        </div>
        <div class="modern-system-footer-block">
          <span>Base de datos</span>
          <strong>rocky_maxx</strong>
        </div>
      </div>
    </footer>
  `;
}

function getDesktopBreadcrumb(view) {
  if (view === "desktop") {
    return ["Sistema", "Panel principal"];
  }

  if (["articulos", "tallas", "colores", "fabricantes", "marcas", "categorias"].includes(view)) {
    return ["Archivos", "Inventario", getDesktopViewLabelV2(view)];
  }

  if (["clientes", "sucursales", "personal"].includes(view)) {
    return ["Archivos", "Inventario", getDesktopViewLabelV2(view)];
  }

  if (view === "reportes") {
    return ["Reportes", "General"];
  }

  if (["usuarios", "roles"].includes(view)) {
    return ["Utilidades", getDesktopViewLabelV2(view)];
  }

  if (view === "ayuda") {
    return ["Ayuda", getDesktopViewLabelV2(view)];
  }

  return ["Sistema", getDesktopViewLabelV2(view)];
}

function getDesktopViewLabelV2(view) {
  const labels = {
    desktop: "Panel principal",
    articulos: "Articulos",
    tallas: "Tallas",
    colores: "Colores",
    fabricantes: "Fabricantes",
    marcas: "Marcas",
    categorias: "Categorias",
    clientes: "Clientes",
    sucursales: "Sucursales",
    personal: "Personal",
    reportes: "Reportes",
    usuarios: "Usuarios",
    roles: "Roles",
    ayuda: "Ayuda",
  };

  return labels[view] || "Panel principal";
}

function getExecutiveCardItems() {
  const total = state.pagination.total || state.articles.length;
  const activeCount = state.articles.filter((item) => item.general?.status?.nombre === "activo").length;
  const promotionCount = state.articles.filter((item) => Boolean(item.precios?.promocion?.activa)).length;
  const criticalCount = state.articles.filter((item) => isCriticalStockArticle(item)).length;

  return [
    {
      label: "Articulos registrados",
      value: formatCompactMetric(total),
      meta: `${state.articles.length} visibles en la consulta actual`,
      badge: `${activeCount} activos`,
      icon: "AR",
      tone: "blue",
    },
    {
      label: "Catalogos disponibles",
      value: formatCompactMetric(countLoadedCatalogEntries()),
      meta: "Categorias, tallas, colores, fabricantes e impuestos",
      badge: state.loadingMetadata ? "Sincronizando" : "Listos",
      icon: "CT",
      tone: "sky",
    },
    {
      label: "Promociones activas",
      value: formatCompactMetric(promotionCount),
      meta: "Articulos con precio promocional vigente",
      badge: promotionCount > 0 ? "Con descuento" : "Sin promociones",
      icon: "PR",
      tone: "gold",
    },
    {
      label: "Stock critico",
      value: formatCompactMetric(criticalCount),
      meta: "Registros por debajo o al limite del punto de recorte",
      badge: criticalCount > 0 ? "Atencion requerida" : "Controlado",
      icon: "ST",
      tone: "green",
    },
  ];
}

function getCriticalStockItems() {
  return [...state.articles]
    .filter((item) => isCriticalStockArticle(item))
    .sort((left, right) => getArticleStockValue(left) - getArticleStockValue(right))
    .slice(0, 5)
    .map((item, index) => {
      const stock = getArticleStockValue(item);

      return {
        icon: `${index + 1}`,
        name: item.general?.nombre || "Articulo sin nombre",
        code: item.codigoBarra || "SIN-CODIGO",
        stockLabel: `${formatCompactMetric(stock)} und`,
        levelClass: stock <= 0 ? "modern-critical-badge-danger" : "modern-critical-badge-warning",
      };
    });
}

function isCriticalStockArticle(article) {
  return getArticleStockValue(article) <= getArticleCutoffValue(article);
}

function getArticleStockValue(article) {
  return toFiniteNumber(article?.inventario?.existenciaActual);
}

function getArticleCutoffValue(article) {
  return toFiniteNumber(article?.general?.puntoRecorte);
}

function countLoadedCatalogEntries() {
  const catalogos = state.metadata?.catalogos;
  if (!catalogos) {
    return 0;
  }

  return [
    catalogos.categorias,
    catalogos.fabricantes,
    catalogos.marcas,
    catalogos.colores,
    catalogos.tallas,
    catalogos.impuestos,
  ].reduce((total, collection) => total + (Array.isArray(collection) ? collection.length : 0), 0);
}

function formatCompactMetric(value) {
  return new Intl.NumberFormat("es-VE").format(toFiniteNumber(value));
}

function toFiniteNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderSearchForm() {
  return `
    <form id="article-search-form" class="search-grid">
      <label class="field">
        <span>Buscar</span>
        <input
          type="text"
          name="buscar"
          placeholder="Codigo, nombre, familia, categoria"
          value="${escapeHtml(state.search.buscar)}"
        />
      </label>
      <label class="field">
        <span>Status</span>
        <select name="status">
          ${renderSelectOptions(
            [
              { value: "", label: "Todos" },
              { value: "activo", label: "Activo" },
              { value: "inactivo", label: "Inactivo" },
            ],
            state.search.status,
          )}
        </select>
      </label>
      <label class="field">
        <span>Tipo</span>
        <select name="tipo">
          ${renderSelectOptions(
            [
              { value: "", label: "Todos" },
              { value: "articulo", label: "Articulo" },
              { value: "servicio", label: "Servicio" },
            ],
            state.search.tipo,
          )}
        </select>
      </label>
      <div class="search-actions">
        <button class="button button-primary" type="submit" ${state.loadingArticles ? "disabled" : ""}>
          ${state.loadingArticles ? "Buscando..." : "Buscar"}
        </button>
        <button class="button button-ghost" type="button" data-clear-search>
          Limpiar
        </button>
      </div>
    </form>
  `;
}

function renderArticlesTable() {
  if (state.loadingArticles && state.articles.length === 0) {
    return `
      <div class="empty-state">
        <h3>Cargando articulos</h3>
        <p>Estamos consultando el backend para traer la lista mas reciente.</p>
      </div>
    `;
  }

  if (state.articles.length === 0) {
    return `
      <div class="empty-state">
        <h3>No hay resultados</h3>
        <p>Ajusta la busqueda o crea un nuevo articulo desde el formulario lateral.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Codigo</th>
            <th>Nombre</th>
            <th>Categoria</th>
            <th>Color / Talla</th>
            <th>Detal</th>
            <th>Status</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${state.articles.map(renderArticleRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderArticleRow(article) {
  const isSelected = article.codigoBarra === state.activeArticleCode;
  const statusName = article.general?.status?.nombre || "desconocido";
  const colorName =
    article.tallasColores?.colores?.nombre ||
    article.tallasColores?.colores?.codigo ||
    "Sin color";
  const tallaCode = article.tallasColores?.talla?.codigo || "-";

  return `
    <tr class="${isSelected ? "row-selected" : ""}">
      <td><strong>${escapeHtml(article.codigoBarra || "-")}</strong></td>
      <td>
        <strong>${escapeHtml(article.general?.nombre || "Sin nombre")}</strong><br />
        <span class="muted">${escapeHtml(article.general?.familia || "-")}</span>
      </td>
      <td>${escapeHtml(article.general?.categoria?.nombre || article.general?.categoria?.codigo || "-")}</td>
      <td>${escapeHtml(colorName)} / ${escapeHtml(tallaCode)}</td>
      <td>${escapeHtml(toDisplayValue(article.precios?.detal))}</td>
      <td>
        <span class="status-pill ${statusName === "activo" ? "status-active" : "status-inactive"}">
          ${escapeHtml(statusName)}
        </span>
      </td>
      <td>
        <div class="row-actions">
          <button class="button button-secondary" type="button" data-edit-code="${escapeHtml(article.codigoBarra)}">
            Editar
          </button>
          <button
            class="button button-danger"
            type="button"
            data-delete-code="${escapeHtml(article.codigoBarra)}"
            ${state.deletingCode === article.codigoBarra ? "disabled" : ""}
          >
            ${state.deletingCode === article.codigoBarra ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderPagination() {
  const page = state.pagination.page || 1;
  const totalPages = state.pagination.totalPages || 1;

  return `
    <div class="pagination">
      <div class="pagination-summary">
        Pagina ${escapeHtml(String(page))} de ${escapeHtml(String(totalPages))}
      </div>
      <div class="pagination-actions">
        <button
          class="button button-ghost"
          type="button"
          data-page-direction="prev"
          ${page <= 1 || state.loadingArticles ? "disabled" : ""}
        >
          Anterior
        </button>
        <button
          class="button button-ghost"
          type="button"
          data-page-direction="next"
          ${page >= totalPages || state.loadingArticles ? "disabled" : ""}
        >
          Siguiente
        </button>
      </div>
    </div>
  `;
}

function renderArticleEditor() {
  const draft = ensureDraft();
  const promotionActive = Boolean(draft.precios.promocionActiva);
  const taxOptions = state.metadata?.catalogos?.impuestos || [];
  const categoryOptions = state.metadata?.catalogos?.categorias || [];
  const manufacturerOptions = state.metadata?.catalogos?.fabricantes || [];
  const sizeOptions = state.metadata?.catalogos?.tallas || [];
  const colorOptions = state.metadata?.catalogos?.colores || [];
  const updateLabel = state.formMode === "edit" ? "Editar articulo" : "Crear articulo";
  const promoMessage = promotionActive
    ? "Promocion activa: completa descuento o precio con rango de fechas."
    : "Promocion inactiva: el precio promocional no se aplicara.";

  if (state.loadingForm) {
    return `
      <div class="empty-state">
        <h3>Cargando articulo</h3>
        <p>Estamos trayendo la informacion completa del registro seleccionado.</p>
      </div>
    `;
  }

  return `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Formulario</p>
        <h2>${updateLabel}</h2>
        <p>
          Los campos estan agrupados para trabajar tal como lo pediste: General,
          Tallas-Colores y Precios.
        </p>
      </div>
      <div class="panel-tag">
        <span>${state.formMode === "edit" ? "Editando" : "Nuevo"}</span>
        <strong>${escapeHtml(state.activeArticleCode || "Sin codigo")}</strong>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-card">
        <span>Modo</span>
        <strong>${state.formMode === "edit" ? "Edicion" : "Creacion"}</strong>
      </div>
      <div class="meta-card">
        <span>Catalogos</span>
        <strong>${state.loadingMetadata ? "Cargando" : "Disponibles"}</strong>
      </div>
      <div class="meta-card">
        <span>Ultimo cambio</span>
        <strong>${escapeHtml(formatDateDisplay(state.selectedArticle?.inventario?.fechas?.ultimaActualizacion))}</strong>
      </div>
    </div>

    <form id="article-form" class="article-form">
      <section class="form-section">
        <div class="section-title">
          <strong>General</strong>
          <small>Datos base del articulo</small>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Codigo de barra</span>
            <input
              type="text"
              name="codigoBarra"
              value="${escapeHtml(draft.codigoBarra)}"
              placeholder="Ej. ART001"
              ${state.formMode === "edit" ? "disabled" : ""}
              required
            />
          </label>
          <label class="field">
            <span>Categoria</span>
            <input
              type="text"
              name="categoria"
              list="categorias-list"
              value="${escapeHtml(draft.general.categoria)}"
              placeholder="Categoria"
              required
            />
          </label>
          <label class="field">
            <span>Fabricante</span>
            <input
              type="text"
              name="fabricante"
              list="fabricantes-list"
              value="${escapeHtml(draft.general.fabricante)}"
              placeholder="Fabricante"
              required
            />
          </label>
          <label class="field">
            <span>Nombre</span>
            <input
              type="text"
              name="nombre"
              value="${escapeHtml(draft.general.nombre)}"
              placeholder="Nombre comercial"
              required
            />
          </label>
          <label class="field">
            <span>Pto. de recorte</span>
            <input
              type="text"
              name="puntoRecorte"
              value="${escapeHtml(draft.general.puntoRecorte)}"
              placeholder="0"
            />
          </label>
          <label class="field">
            <span>Familia</span>
            <input
              type="text"
              name="familia"
              value="${escapeHtml(draft.general.familia)}"
              placeholder="Familia"
              required
            />
          </label>
          <label class="field">
            <span>Tipo</span>
            <select name="tipo">
              ${renderSelectOptions(
                [
                  { value: "articulo", label: "Articulo" },
                  { value: "servicio", label: "Servicio" },
                ],
                draft.general.tipo,
              )}
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select name="status">
              ${renderSelectOptions(
                [
                  { value: "activo", label: "Activo" },
                  { value: "inactivo", label: "Inactivo" },
                ],
                draft.general.status,
              )}
            </select>
          </label>
          <label class="field field-span-2">
            <span>Nota</span>
            <textarea name="nota" placeholder="Observaciones del articulo">${escapeHtml(draft.general.nota)}</textarea>
          </label>
        </div>
      </section>

      <section class="form-section">
        <div class="section-title">
          <strong>Tallas-Colores</strong>
          <small>Variantes visuales y de medida</small>
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Talla</span>
            <input
              type="text"
              name="talla"
              list="tallas-list"
              value="${escapeHtml(draft.tallasColores.talla)}"
              placeholder="Talla"
              required
            />
          </label>
          <label class="field">
            <span>Colores</span>
            <input
              type="text"
              name="colores"
              list="colores-list"
              value="${escapeHtml(draft.tallasColores.colores)}"
              placeholder="Color"
              required
            />
          </label>
        </div>
      </section>

      <section class="form-section">
        <div class="section-title">
          <strong>Precios</strong>
          <small>Impuesto, escalas y promocion</small>
        </div>
        <div class="subtle-box">
          ${escapeHtml(promoMessage)}
        </div>
        <div class="form-grid">
          <label class="field">
            <span>Impuesto</span>
            <select name="impuestoCodigo">
              ${renderTaxOptions(taxOptions, draft.precios.impuestoCodigo)}
            </select>
          </label>
          <label class="field">
            <span>Detal</span>
            <input
              type="text"
              name="detal"
              value="${escapeHtml(draft.precios.detal)}"
              placeholder="0.00"
            />
          </label>
          <label class="field">
            <span>Mayor</span>
            <input
              type="text"
              name="mayor"
              value="${escapeHtml(draft.precios.mayor)}"
              placeholder="0.00"
            />
          </label>
          <label class="field">
            <span>Afiliado</span>
            <input
              type="text"
              name="afiliado"
              value="${escapeHtml(draft.precios.afiliado)}"
              placeholder="0.00"
            />
          </label>
          <label class="field field-span-2">
            <span>Promocion</span>
            <div class="field-toggle">
              <div>
                <strong>${promotionActive ? "Activa" : "Inactiva"}</strong>
                <div class="muted">Activa descuento, precio y rango de fechas para la promocion.</div>
              </div>
              <label class="switch">
                <input type="checkbox" name="promocionActiva" ${promotionActive ? "checked" : ""} />
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
              </label>
            </div>
          </label>
          <label class="field">
            <span>% descuento</span>
            <input
              type="text"
              name="descuento"
              value="${escapeHtml(draft.precios.descuento)}"
              placeholder="10"
              ${promotionActive ? "" : "disabled"}
            />
          </label>
          <label class="field">
            <span>Precio promocion</span>
            <input
              type="text"
              name="precioPromocion"
              value="${escapeHtml(draft.precios.precio)}"
              placeholder="0.00"
              ${promotionActive ? "" : "disabled"}
            />
          </label>
          <label class="field">
            <span>Desde</span>
            <input
              type="datetime-local"
              name="promocionDesde"
              value="${escapeHtml(draft.precios.desde)}"
              ${promotionActive ? "" : "disabled"}
            />
          </label>
          <label class="field">
            <span>Hasta</span>
            <input
              type="datetime-local"
              name="promocionHasta"
              value="${escapeHtml(draft.precios.hasta)}"
              ${promotionActive ? "" : "disabled"}
            />
          </label>
        </div>
      </section>

      <div class="form-actions">
        <button class="button button-primary" type="submit" ${state.submittingForm ? "disabled" : ""}>
          ${
            state.submittingForm
              ? "Guardando..."
              : state.formMode === "edit"
                ? "Guardar cambios"
                : "Crear articulo"
          }
        </button>
        <button class="button button-ghost" type="button" data-reset-form>
          Limpiar formulario
        </button>
        ${
          state.formMode === "edit" && state.activeArticleCode
            ? `
              <button
                class="button button-danger"
                type="button"
                data-delete-current
                ${state.deletingCode === state.activeArticleCode ? "disabled" : ""}
              >
                ${state.deletingCode === state.activeArticleCode ? "Eliminando..." : "Eliminar articulo"}
              </button>
            `
            : ""
        }
      </div>
    </form>

    <datalist id="categorias-list">
      ${categoryOptions.map((item) => `<option value="${escapeHtml(item.nombre || item.codigo)}"></option>`).join("")}
    </datalist>
    <datalist id="fabricantes-list">
      ${manufacturerOptions.map((item) => `<option value="${escapeHtml(item.nombre || item.codigo)}"></option>`).join("")}
    </datalist>
    <datalist id="tallas-list">
      ${sizeOptions.map((item) => `<option value="${escapeHtml(item.codigo)}"></option>`).join("")}
    </datalist>
    <datalist id="colores-list">
      ${colorOptions.map((item) => `<option value="${escapeHtml(item.nombre || item.codigo)}"></option>`).join("")}
    </datalist>
  `;
}

function bindLoginEvents() {
  const form = document.getElementById("login-form");
  if (!form) {
    return;
  }

  form.addEventListener("input", () => {
    state.loginDraft = readLoginDraft(form);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.loginDraft = readLoginDraft(form);
    await handleLogin();
  });
}

function bindShellEvents() {
  const shell = document.querySelector(".desktop-shell");
  if (shell) {
    shell.addEventListener("click", (event) => {
      if (event.target.closest(".modern-menu-item")) {
        return;
      }

      if (state.navigation.openMenu) {
        state.navigation.openMenu = "";
        state.navigation.openSubmenu = "";
        render();
      }
    });
  }

  document.querySelector(".modern-nav")?.addEventListener("mouseleave", () => {
    if (!state.navigation.openMenu) {
      return;
    }

    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    render();
  });

  document.querySelectorAll(".modern-menu-item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      const button = item.querySelector("[data-menu]");
      const menu = button?.getAttribute("data-menu") || "";
      if (!menu || state.navigation.openMenu === menu) {
        return;
      }

      state.navigation.openMenu = menu;
      state.navigation.openSubmenu = "";
      render();
    });
  });

  document.querySelectorAll("[data-menu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = button.getAttribute("data-menu") || "";
      state.navigation.openMenu = state.navigation.openMenu === menu ? "" : menu;
      state.navigation.openSubmenu = "";
      render();
    });
  });

  document.querySelectorAll("[data-submenu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const submenu = button.getAttribute("data-submenu") || "";
      if (!submenu) {
        return;
      }

      state.navigation.openMenu = "archivos";
      state.navigation.openSubmenu = state.navigation.openSubmenu === submenu ? "" : submenu;
      render();
    });
  });

  document.querySelectorAll("[data-menu-view]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.currentView = button.getAttribute("data-menu-view") || "articulos";
      state.navigation.openMenu = "";
      state.navigation.openSubmenu = "";
      render();
    });
  });

  document.querySelectorAll("[data-menu-action='logout']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      clearSession();
      setFlash("Sesion cerrada correctamente.", "info");
      render();
    });
  });

  document.querySelectorAll("[data-new-article]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentView = "articulos";
      resetArticleForm();
      render();
    });
  });

  document.querySelector("[data-refresh]")?.addEventListener("click", async () => {
    await refreshDashboard();
  });

  bindArticleEvents();
}

function bindArticleEvents() {
  const searchForm = document.getElementById("article-search-form");
  if (searchForm) {
    searchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const nextSearch = readSearchDraft(searchForm);
      state.search = nextSearch;
      await loadArticles(1);
    });
  }

  document.querySelector("[data-clear-search]")?.addEventListener("click", async () => {
    state.search = {
      buscar: "",
      status: "",
      tipo: "",
    };
    await loadArticles(1);
  });

  document.querySelectorAll("[data-page-direction]").forEach((button) => {
    button.addEventListener("click", async () => {
      const direction = button.getAttribute("data-page-direction");
      const currentPage = state.pagination.page || 1;
      const targetPage = direction === "prev" ? currentPage - 1 : currentPage + 1;
      await loadArticles(targetPage);
    });
  });

  document.querySelectorAll("[data-edit-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.getAttribute("data-edit-code");
      if (!code) {
        return;
      }
      await loadArticleForEdit(code);
    });
  });

  document.querySelectorAll("[data-delete-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.getAttribute("data-delete-code");
      if (!code) {
        return;
      }
      await deleteArticle(code);
    });
  });

  const articleForm = document.getElementById("article-form");
  if (articleForm) {
    articleForm.addEventListener("input", () => {
      state.formDraft = readArticleDraft(articleForm);
    });

    articleForm.addEventListener("change", (event) => {
      state.formDraft = readArticleDraft(articleForm);

      if (event.target && event.target.name === "promocionActiva") {
        render();
      }
    });

    articleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.formDraft = readArticleDraft(articleForm);
      await saveArticle();
    });
  }

  document.querySelector("[data-reset-form]")?.addEventListener("click", () => {
    resetArticleForm();
    render();
  });

  document.querySelector("[data-delete-current]")?.addEventListener("click", async () => {
    if (!state.activeArticleCode) {
      return;
    }
    await deleteArticle(state.activeArticleCode);
  });
}

async function handleLogin() {
  state.isAuthenticating = true;
  clearFlash();
  render();

  try {
    const payload = {
      usuario: state.loginDraft.usuario.trim(),
      password: state.loginDraft.password,
    };

    const response = await apiFetch("/auth/login", {
      method: "POST",
      auth: false,
      body: payload,
    });

    state.token = response.accessToken;
    state.user = response.usuario;
    persistSession();

    await Promise.all([
      loadCreationMetadata({ renderAfter: false }),
      loadArticles(1, { renderAfter: false }),
    ]);

    state.currentView = "articulos";
    state.navigation = {
      openMenu: "",
      openSubmenu: "",
    };
    resetArticleForm();
    state.loginDraft = { usuario: "", password: "" };
    setFlash(`Bienvenido ${state.user?.nombreUsuario || state.user?.codUsuario || ""}.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.isAuthenticating = false;
    render();
  }
}

async function refreshDashboard() {
  clearFlash();
  await Promise.all([
    loadCreationMetadata(),
    loadArticles(state.pagination.page || 1),
  ]);
}

async function loadCreationMetadata(options = {}) {
  const { renderAfter = true } = options;
  state.loadingMetadata = true;
  if (renderAfter) {
    render();
  }

  try {
    state.metadata = await apiFetch("/inventory/creation-metadata");
    if (state.formMode === "create") {
      state.formDraft = withDraftDefaults(state.formDraft || createEmptyDraft());
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar los catalogos: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.loadingMetadata = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadArticles(page = 1, options = {}) {
  const { renderAfter = true } = options;
  state.loadingArticles = true;
  if (renderAfter) {
    render();
  }

  try {
    const params = new URLSearchParams();
    params.set("page", String(Math.max(page, 1)));
    params.set("limit", String(state.pagination.limit || 10));

    if (state.search.buscar) {
      params.set("buscar", state.search.buscar);
    }
    if (state.search.status) {
      params.set("status", state.search.status);
    }
    if (state.search.tipo) {
      params.set("tipo", state.search.tipo);
    }

    const response = await apiFetch(`/inventory?${params.toString()}`);
    state.articles = Array.isArray(response.data) ? response.data : [];
    state.pagination = response.pagination || {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    };
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo consultar el archivo de articulos: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.loadingArticles = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadArticleForEdit(code) {
  state.loadingForm = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/inventory/${encodeURIComponent(code)}`);
    state.selectedArticle = response.mercancia;
    state.activeArticleCode = response.mercancia?.codigoBarra || code;
    state.formMode = "edit";
    state.formDraft = articleToDraft(response.mercancia);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el articulo ${code}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.loadingForm = false;
    render();
  }
}

async function saveArticle() {
  const draft = withDraftDefaults(state.formDraft || createEmptyDraft());
  const validationMessage = validateDraft(draft);

  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  state.submittingForm = true;
  clearFlash();
  render();

  try {
    const isEditing = state.formMode === "edit" && Boolean(state.activeArticleCode);
    const payload = buildArticlePayload(draft, !isEditing);
    const response = isEditing
      ? await apiFetch(`/inventory/${encodeURIComponent(state.activeArticleCode)}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch("/inventory", {
          method: "POST",
          body: payload,
        });

    const savedArticle = response.mercancia;
    state.selectedArticle = savedArticle;
    state.activeArticleCode = savedArticle?.codigoBarra || state.activeArticleCode;
    state.formMode = "edit";
    state.formDraft = articleToDraft(savedArticle);
    await loadArticles(isEditing ? state.pagination.page || 1 : 1, { renderAfter: false });
    setFlash(
      isEditing
        ? `Articulo ${state.activeArticleCode} actualizado correctamente.`
        : `Articulo ${state.activeArticleCode} creado correctamente.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.submittingForm = false;
    render();
  }
}

async function deleteArticle(code) {
  const confirmed = window.confirm(`Se eliminara el articulo ${code}. Deseas continuar?`);
  if (!confirmed) {
    return;
  }

  state.deletingCode = code;
  clearFlash();
  render();

  try {
    await apiFetch(`/inventory/${encodeURIComponent(code)}`, {
      method: "DELETE",
    });

    if (state.activeArticleCode === code) {
      resetArticleForm();
    }

    const targetPage =
      state.articles.length === 1 && (state.pagination.page || 1) > 1
        ? (state.pagination.page || 1) - 1
        : state.pagination.page || 1;

    await loadArticles(targetPage, { renderAfter: false });
    setFlash(`Articulo ${code} eliminado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.deletingCode = "";
    render();
  }
}

function resetArticleForm() {
  state.formMode = "create";
  state.activeArticleCode = "";
  state.selectedArticle = null;
  state.formDraft = createEmptyDraft();
}

function createEmptyDraft() {
  return withDraftDefaults({
    codigoBarra: "",
    general: {
      categoria: "",
      fabricante: "",
      nombre: "",
      puntoRecorte: "0",
      familia: "",
      nota: "",
      tipo: "articulo",
      status: "activo",
    },
    tallasColores: {
      talla: "",
      colores: "",
    },
    precios: {
      impuestoCodigo: "",
      detal: "",
      mayor: "",
      afiliado: "",
      promocionActiva: false,
      descuento: "",
      precio: "",
      desde: "",
      hasta: "",
    },
  });
}

function withDraftDefaults(draft) {
  const defaultTaxCode = String(state.metadata?.defaults?.precios?.impuesto || 1);
  return {
    codigoBarra: draft?.codigoBarra || "",
    general: {
      categoria: draft?.general?.categoria || "",
      fabricante: draft?.general?.fabricante || "",
      nombre: draft?.general?.nombre || "",
      puntoRecorte: draft?.general?.puntoRecorte || "0",
      familia: draft?.general?.familia || "",
      nota: draft?.general?.nota || "",
      tipo: draft?.general?.tipo || "articulo",
      status: draft?.general?.status || "activo",
    },
    tallasColores: {
      talla: draft?.tallasColores?.talla || "",
      colores: draft?.tallasColores?.colores || "",
    },
    precios: {
      impuestoCodigo: draft?.precios?.impuestoCodigo || defaultTaxCode,
      detal: draft?.precios?.detal || "",
      mayor: draft?.precios?.mayor || "",
      afiliado: draft?.precios?.afiliado || "",
      promocionActiva: Boolean(draft?.precios?.promocionActiva),
      descuento: draft?.precios?.descuento || "",
      precio: draft?.precios?.precio || "",
      desde: draft?.precios?.desde || "",
      hasta: draft?.precios?.hasta || "",
    },
  };
}

function ensureDraft() {
  if (!state.formDraft) {
    state.formDraft = createEmptyDraft();
  }

  return withDraftDefaults(state.formDraft);
}

function articleToDraft(article) {
  return withDraftDefaults({
    codigoBarra: article?.codigoBarra || "",
    general: {
      categoria: article?.general?.categoria?.nombre || article?.general?.categoria?.codigo || "",
      fabricante: article?.general?.fabricante?.nombre || article?.general?.fabricante?.codigo || "",
      nombre: article?.general?.nombre || "",
      puntoRecorte: toInputValue(article?.general?.puntoRecorte),
      familia: article?.general?.familia || "",
      nota: article?.general?.nota || "",
      tipo: article?.general?.tipo?.nombre || "articulo",
      status: article?.general?.status?.nombre || "activo",
    },
    tallasColores: {
      talla: article?.tallasColores?.talla?.codigo || "",
      colores: article?.tallasColores?.colores?.nombre || article?.tallasColores?.colores?.codigo || "",
    },
    precios: {
      impuestoCodigo:
        article?.precios?.impuesto?.codigo === 0 || article?.precios?.impuesto?.codigo
          ? String(article.precios.impuesto.codigo)
          : "",
      detal: toInputValue(article?.precios?.detal),
      mayor: toInputValue(article?.precios?.mayor),
      afiliado: toInputValue(article?.precios?.afiliado),
      promocionActiva: Boolean(article?.precios?.promocion?.activa),
      descuento: article?.precios?.promocion?.activa
        ? toInputValue(article?.precios?.promocion?.porcentajeDescuento)
        : "",
      precio: article?.precios?.promocion?.activa
        ? toInputValue(article?.precios?.promocion?.precio)
        : "",
      desde: article?.precios?.promocion?.activa
        ? toDateTimeLocalValue(article?.precios?.promocion?.desde)
        : "",
      hasta: article?.precios?.promocion?.activa
        ? toDateTimeLocalValue(article?.precios?.promocion?.hasta)
        : "",
    },
  });
}

function buildArticlePayload(draft, includeCode) {
  const payload = {
    general: {
      categoria: draft.general.categoria.trim(),
      fabricante: draft.general.fabricante.trim(),
      nombre: draft.general.nombre.trim(),
      puntoRecorte: draft.general.puntoRecorte.trim(),
      familia: draft.general.familia.trim(),
      nota: draft.general.nota.trim(),
      tipo: draft.general.tipo,
      status: draft.general.status,
    },
    tallasColores: {
      talla: draft.tallasColores.talla.trim(),
      colores: draft.tallasColores.colores.trim(),
    },
    precios: {
      impuesto: draft.precios.impuestoCodigo
        ? { codigo: Number.parseInt(draft.precios.impuestoCodigo, 10) }
        : undefined,
      detal: draft.precios.detal.trim(),
      mayor: draft.precios.mayor.trim(),
      afiliado: draft.precios.afiliado.trim(),
      promocion: draft.precios.promocionActiva
        ? {
            activa: true,
            porcentajeDescuento: draft.precios.descuento.trim() || undefined,
            precio: draft.precios.precio.trim() || undefined,
            desde: toApiDateTime(draft.precios.desde),
            hasta: toApiDateTime(draft.precios.hasta),
          }
        : {
            activa: false,
          },
    },
  };

  if (includeCode) {
    payload.codigoBarra = draft.codigoBarra.trim().toUpperCase();
  }

  return cleanPayload(payload);
}

function cleanPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanPayload(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(([key, item]) => [key, cleanPayload(item)]);

  return Object.fromEntries(entries);
}

function validateDraft(draft) {
  const requiredFields = [
    { value: draft.codigoBarra, label: "codigo de barra", onlyCreate: true },
    { value: draft.general.categoria, label: "categoria" },
    { value: draft.general.fabricante, label: "fabricante" },
    { value: draft.general.nombre, label: "nombre" },
    { value: draft.general.familia, label: "familia" },
    { value: draft.tallasColores.talla, label: "talla" },
    { value: draft.tallasColores.colores, label: "color" },
  ];

  const missing = requiredFields
    .filter((field) => {
      if (field.onlyCreate && state.formMode === "edit") {
        return false;
      }
      return !field.value || !field.value.trim();
    })
    .map((field) => field.label);

  if (missing.length > 0) {
    return `Completa los siguientes campos antes de guardar: ${missing.join(", ")}.`;
  }

  if (draft.precios.impuestoCodigo && Number.isNaN(Number.parseInt(draft.precios.impuestoCodigo, 10))) {
    return "El impuesto debe tener un codigo numerico valido.";
  }

  if (draft.precios.promocionActiva) {
    if (!draft.precios.desde || !draft.precios.hasta) {
      return "La promocion activa requiere fecha desde y hasta.";
    }

    if (!draft.precios.descuento.trim() && !draft.precios.precio.trim()) {
      return "La promocion activa requiere porcentaje de descuento o precio promocion.";
    }
  }

  return null;
}

function readLoginDraft(form) {
  return {
    usuario: form.elements.usuario.value,
    password: form.elements.password.value,
  };
}

function readSearchDraft(form) {
  return {
    buscar: form.elements.buscar.value.trim(),
    status: form.elements.status.value,
    tipo: form.elements.tipo.value,
  };
}

function readArticleDraft(form) {
  return withDraftDefaults({
    codigoBarra: state.formMode === "edit" ? state.activeArticleCode : form.elements.codigoBarra.value,
    general: {
      categoria: form.elements.categoria.value,
      fabricante: form.elements.fabricante.value,
      nombre: form.elements.nombre.value,
      puntoRecorte: form.elements.puntoRecorte.value,
      familia: form.elements.familia.value,
      nota: form.elements.nota.value,
      tipo: form.elements.tipo.value,
      status: form.elements.status.value,
    },
    tallasColores: {
      talla: form.elements.talla.value,
      colores: form.elements.colores.value,
    },
    precios: {
      impuestoCodigo: form.elements.impuestoCodigo.value,
      detal: form.elements.detal.value,
      mayor: form.elements.mayor.value,
      afiliado: form.elements.afiliado.value,
      promocionActiva: form.elements.promocionActiva.checked,
      descuento: form.elements.descuento.value,
      precio: form.elements.precioPromocion.value,
      desde: form.elements.promocionDesde.value,
      hasta: form.elements.promocionHasta.value,
    },
  });
}

function renderFlash() {
  if (!state.flash?.message) {
    return "";
  }

  return `
    <div class="flash flash-${escapeHtml(state.flash.type || "info")}">
      ${escapeHtml(state.flash.message)}
    </div>
  `;
}

function renderSelectOptions(options, selectedValue) {
  return options
    .map((option) => {
      const isSelected = option.value === selectedValue;
      return `
        <option value="${escapeHtml(option.value)}" ${isSelected ? "selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `;
    })
    .join("");
}

function renderTaxOptions(options, selectedValue) {
  if (!options.length) {
    return `<option value="${escapeHtml(selectedValue || "1")}" selected>${escapeHtml(selectedValue || "1")}</option>`;
  }

  return options
    .map((option) => {
      const optionValue = String(option.codigo);
      const labelParts = [option.codigo, option.nombre].filter(Boolean);
      if (option.porcentajeImpuesto) {
        labelParts.push(`${option.porcentajeImpuesto}%`);
      }

      return `
        <option value="${escapeHtml(optionValue)}" ${optionValue === selectedValue ? "selected" : ""}>
          ${escapeHtml(labelParts.join(" - "))}
        </option>
      `;
    })
    .join("");
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (options.auth !== false && state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
  }

  const response = await window.fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = await readResponsePayload(response);

  if (!response.ok) {
    const error = new Error(extractMessageFromPayload(payload) || `Error ${response.status}`);
    error.status = response.status;
    error.payload = payload;

    if (response.status === 401 && options.auth !== false) {
      clearSession();
      setFlash("La sesion expiro. Vuelve a iniciar sesion.", "error");
      render();
    }

    throw error;
  }

  return payload;
}

async function readResponsePayload(response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

function extractMessageFromPayload(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload?.message)) {
    return payload.message.join(". ");
  }

  if (typeof payload?.message === "string") {
    return payload.message;
  }

  if (typeof payload?.error === "string") {
    return payload.error;
  }

  return "";
}

function extractErrorMessage(error) {
  return error?.message || "Ocurrio un error inesperado.";
}

function setFlash(message, type = "info") {
  state.flash = { message, type };
}

function clearFlash() {
  state.flash = null;
}

function persistSession() {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, state.token);
  persistUser();
}

function persistUser() {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(state.user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  state.currentView = "articulos";
  state.navigation = {
    openMenu: "",
    openSubmenu: "",
  };
  state.articles = [];
  state.metadata = null;
  state.pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };
  state.search = {
    buscar: "",
    status: "",
    tipo: "",
  };
  state.loginDraft = {
    usuario: "",
    password: "",
  };
  resetArticleForm();
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

function readStoredJson(key) {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(error);
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toDisplayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function toInputValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toApiDateTime(value) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function formatDateDisplay(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return date.toLocaleString("es-VE", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
