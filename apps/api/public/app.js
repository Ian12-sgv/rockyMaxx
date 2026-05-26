const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "rocky.maxx.access-token";
const USER_STORAGE_KEY = "rocky.maxx.user";
const REMEMBER_SESSION_STORAGE_KEY = "rocky.maxx.remember-session";
const CATALOG_IMPORT_EXCEL_PERMISSION_CODE = "CATALOG_IMPORT_EXCEL";
const EXISTENCE_AUTO_REFRESH_MS = 30000;

let existenceAutoRefreshHandle = null;
let devReturnRemotePullInFlight = false;
let devReturnRemotePullLastAt = 0;

const state = {
  booting: true,
  token: readStoredToken(),
  user: readStoredUser(),
  flash: null,
  isAuthenticating: false,
  currentView: "desktop",
  navigation: {
    openMenu: "",
    openSubmenu: "",
    menuPinned: false,
  },
  loginDraft: {
    usuario: "",
    password: "",
    mantenerSesion: hasPersistentSession(),
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
  articleEditorTab: "general",
  activeArticleCode: "",
  selectedArticle: null,
  formDraft: null,
  articleLookup: {
    open: false,
    loading: false,
    items: [],
  },
  inventoryExistence: {
    loading: false,
    refreshing: false,
    items: [],
    lastUpdatedAt: "",
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    },
    search: {
      buscar: "",
      status: "",
      tipo: "",
    },
  },
  catalogImport: {
    uploadingKind: "",
    loadingKind: "",
    deletingEntryKey: "",
    itemsByKind: {},
    manualDraftsByKind: {},
    manualSubmittingKind: "",
  },
  roleAccess: {
    loading: false,
    savingRole: "",
    roles: [],
  },
  transfers: {
    loadingList: false,
    loadingMetadata: false,
    loadingDetail: false,
    saving: false,
    approving: false,
    deleting: false,
    items: [],
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "25",
    },
    selectedNumero: null,
    receiptNumero: null,
    draft: createEmptyTransferDraft(),
  },
  devReturns: {
    loadingMetadata: false,
    loadingDetail: false,
    loadingDashboard: false,
    loadingInboundDetail: false,
    saving: false,
    exporting: false,
    approvingInbound: false,
    items: [],
    inboundItems: [],
    inboundDetail: null,
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "50",
    },
    selectedNumero: null,
    selectedInboundGlobalId: "",
    draft: createEmptyDevReturnDraft(),
  },
  devReturnRecords: {
    loading: false,
    loadingDetail: false,
    exporting: false,
    items: [],
    detail: null,
    selectedNumero: null,
  },
  devReturnInbound: {
    loading: false,
    loadingDetail: false,
    approving: false,
    items: [],
    detail: null,
    selectedNumero: null,
    selectedCodigoEnvia: "",
  },
  adjustments: {
    loadingMetadata: false,
    saving: false,
    approving: false,
    metadata: null,
    draft: createEmptyAdjustmentDraft(),
  },
  adjustmentLookup: {
    open: false,
    loading: false,
    items: [],
  },
  transferLookup: {
    open: false,
    loading: false,
    items: [],
  },
  devReturnLookup: {
    open: false,
    loading: false,
    items: [],
    mode: "drafts",
  },
  sucursales: {
    loading: false,
    saving: false,
    deleting: false,
    items: [],
    search: "",
    selectedCodigo: "",
    draft: createEmptySucursalDraft(),
  },
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
  await preloadAuthenticatedDesktopData();
  state.currentView = "desktop";
  state.navigation = {
    openMenu: "",
    openSubmenu: "",
    menuPinned: false,
  };
  state.articleLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.inventoryExistence = {
    loading: false,
    refreshing: false,
    items: [],
    lastUpdatedAt: "",
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    },
    search: {
      buscar: "",
      status: "",
      tipo: "",
    },
  };
  state.catalogImport = {
    uploadingKind: "",
    loadingKind: "",
    deletingEntryKey: "",
    itemsByKind: {},
    manualDraftsByKind: {},
    manualSubmittingKind: "",
  };
  state.roleAccess = {
    loading: false,
    savingRole: "",
    roles: [],
  };
  state.transfers = {
    loadingList: false,
    loadingMetadata: false,
    loadingDetail: false,
    saving: false,
    approving: false,
    deleting: false,
    items: [],
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "25",
    },
    selectedNumero: null,
    receiptNumero: null,
    draft: createEmptyTransferDraft(),
  };
  state.devReturns = {
    loadingMetadata: false,
    loadingDetail: false,
    loadingDashboard: false,
    loadingInboundDetail: false,
    saving: false,
    exporting: false,
    approvingInbound: false,
    items: [],
    inboundItems: [],
    inboundDetail: null,
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "50",
    },
    selectedNumero: null,
    selectedInboundGlobalId: "",
    draft: createEmptyDevReturnDraft(),
  };
  state.devReturnRecords = {
    loading: false,
    loadingDetail: false,
    exporting: false,
    items: [],
    detail: null,
    selectedNumero: null,
  };
  state.devReturnInbound = {
    loading: false,
    loadingDetail: false,
    approving: false,
    items: [],
    detail: null,
    selectedNumero: null,
    selectedCodigoEnvia: "",
  };
  state.adjustments = {
    loadingMetadata: false,
    saving: false,
    approving: false,
    metadata: null,
    draft: createEmptyAdjustmentDraft(),
  };
  state.adjustmentLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.transferLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.devReturnLookup = {
    open: false,
    loading: false,
    items: [],
    mode: "drafts",
  };
  state.sucursales = {
    loading: false,
    saving: false,
    deleting: false,
    items: [],
    search: "",
    selectedCodigo: "",
    draft: createEmptySucursalDraft(),
  };
  state.articleEditorTab = "general";
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
    clearExistenceAutoRefresh();
    app.innerHTML = renderBootScreen();
    return;
  }

  if (!state.token || !state.user) {
    clearExistenceAutoRefresh();
    app.innerHTML = renderLoginView();
    bindLoginEvents();
    bindFlashEvents();
    return;
  }

  app.innerHTML = renderShellView();
  bindShellEvents();
  bindFlashEvents();
  syncExistenceAutoRefresh();
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

function renderLoginIcon(icon) {
  switch (icon) {
    case "user":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8a6 6 0 0 1 12 0"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      `;
    case "lock":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M8 10V7a4 4 0 1 1 8 0v3M7 10h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      `;
    case "eye":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
          <circle
            cx="12"
            cy="12"
            r="2.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
          />
        </svg>
      `;
    case "arrow":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M5 12h14M13 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      `;
    case "shield":
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 3 6 5v5c0 4.5 2.4 8.5 6 10 3.6-1.5 6-5.5 6-10V5l-6-2Z"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
          <path
            d="m9.5 12 1.6 1.7 3.4-3.7"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.8"
          />
        </svg>
      `;
    default:
      return "";
  }
}

function renderLoginView() {
  const submitLabel = state.isAuthenticating ? "Validando acceso..." : "Ingresar";

  return `
    <main class="login-shell">
      <section class="login-stage login-stage-compact">
        <section class="login-access-card">
          <div class="login-access-header">
            <p class="eyebrow login-eyebrow">Inicio de sesion</p>
            <h1>Acceso al sistema</h1>
          </div>

          ${renderFlash()}
          <form id="login-form" class="form-stack login-form">
            <label class="field login-field">
              <span>Usuario</span>
              <span class="login-input-wrap">
                <span class="login-input-icon">${renderLoginIcon("user")}</span>
                <input
                  type="text"
                  name="usuario"
                  placeholder="Ingresa tu usuario"
                  autocomplete="username"
                  value="${escapeHtml(state.loginDraft.usuario)}"
                  required
                />
              </span>
            </label>

            <label class="field login-field">
              <span>Clave</span>
              <span class="login-input-wrap">
                <span class="login-input-icon">${renderLoginIcon("lock")}</span>
                <input
                  id="login-password-input"
                  type="password"
                  name="password"
                  placeholder="Ingresa tu clave"
                  autocomplete="current-password"
                  value="${escapeHtml(state.loginDraft.password)}"
                  required
                />
                <button
                  class="login-toggle-password"
                  type="button"
                  data-action="toggle-password"
                  aria-label="Mostrar clave"
                  aria-pressed="false"
                >
                  ${renderLoginIcon("eye")}
                </button>
              </span>
            </label>

            <div class="login-meta-row">
              <label class="login-remember">
                <input type="checkbox" name="mantenerSesion" ${state.loginDraft.mantenerSesion ? "checked" : ""} />
                <span>Mantener sesion iniciada</span>
              </label>
              <button class="login-link-button" type="button" data-action="forgot-password">
                Olvidaste tu clave?
              </button>
            </div>

            <div class="button-row login-button-row">
              <button class="button button-primary login-submit" type="submit" ${state.isAuthenticating ? "disabled" : ""}>
                <span>${submitLabel}</span>
                ${state.isAuthenticating ? "" : `<span class="login-submit-arrow">${renderLoginIcon("arrow")}</span>`}
              </button>
            </div>
          </form>

          <div class="login-security-strip">
            <span class="login-security-badge">${renderLoginIcon("shield")}</span>
            <div class="login-security-copy">
              <strong>Acceso autorizado</strong>
              <span>Uso exclusivo para personal administrativo y gestion interna.</span>
            </div>
          </div>
        </section>

        <footer class="login-page-footer">
          <p>&copy; 2026 RockyMax. Todos los derechos reservados.</p>
          <div class="login-page-footer-links">
            <span>Soporte</span>
            <span>Privacidad</span>
            <span>Terminos</span>
          </div>
        </footer>
      </section>
    </main>
  `;
}

function renderShellView() {
  const primaryGroup = state.user?.grupos?.[0]?.nombre || "Administrador";
  const userCode = (state.user?.codUsuario || "admin").toUpperCase();
  const showUtilitiesMenu = userIsSystemOperator();

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

            <nav class="modern-nav">
              ${renderDesktopMenu("sistema", "Sistema", `
                ${renderDesktopMenuLink("desktop", "Panel principal")}
                <button class="modern-dropdown-link" type="button" data-menu-action="logout">Cerrar sesion</button>
              `)}
              ${renderDesktopMenu("archivos", "Archivos", renderDesktopArchivoMenuV2())}
              ${renderDesktopMenu("procesos", "Procesos", renderDesktopProcesosMenu())}
                ${renderDesktopMenu("reportes", "Reportes", `
                  ${renderDesktopMenuLink("reportes", "General")}
                `)}
                ${
                  showUtilitiesMenu
                    ? renderDesktopMenu("utilidades", "Utilidades", `
                        ${renderDesktopMenuLink("usuarios", "Usuarios")}
                        ${renderDesktopMenuLink("roles", "Roles")}
                      `)
                    : ""
                }
                ${renderDesktopMenu("ayuda", "Ayuda", `
                  ${renderDesktopMenuLink("ayuda", "Acerca de Rocky Maxx")}
                `)}
              </nav>
          </div>

          <div class="modern-session-area">
            <span class="modern-session-label">
              <span class="modern-session-dot"></span>
              ${escapeHtml(`${userCode} | ${primaryGroup}`)}
            </span>
            <button class="modern-session-exit" type="button" data-menu-action="logout">
              Salir
            </button>
          </div>
        </header>

        <section class="desktop-workspace">
          <div class="modern-workspace-shell">
            ${renderFlash()}
            ${renderDesktopWorkspace()}
          </div>
        </section>
      </section>
      ${renderArticleLookupModal()}
      ${renderAdjustmentLookupModal()}
      ${renderTransferLookupModal()}
      ${renderDevReturnLookupModal()}
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
  if (["usuarios", "roles"].includes(state.currentView) && !userIsSystemOperator()) {
    return renderDesktopPlaceholderWindowV2(
      "Acceso restringido",
      "Este modulo solo esta disponible para el usuario sistema.",
    );
  }

  if (state.currentView === "articulos") {
    return renderDesktopArticlesWorkspaceV2();
  }

  if (state.currentView === "existencia") {
    return renderInventoryExistenceWorkspace();
  }

  if (state.currentView === "desktop") {
    return renderDesktopDashboardV2();
  }

  if (state.currentView === "roles") {
    return renderRoleAccessWorkspace();
  }

  if (state.currentView === "transferencias" || state.currentView === "registro-transferencia") {
    return renderTransfersWorkspace();
  }

  if (state.currentView === "borrador-devoluciones") {
    return renderDevReturnsWorkspace();
  }

  if (state.currentView === "registro-devoluciones") {
    return renderDevReturnRecordsWorkspace();
  }

  if (state.currentView === "cargar-devoluciones") {
    return renderLoadDevReturnsWorkspace();
  }

  if (state.currentView === "cargar-transferencia") {
    return renderLoadTransferWorkspace();
  }

  if (state.currentView === "ajuste-inventario") {
    return renderInventoryAdjustmentWorkspace();
  }

  if (state.currentView === "sucursales") {
    return renderSucursalesWorkspace();
  }

  if (["categorias", "marcas", "tallas", "colores", "fabricantes"].includes(state.currentView)) {
    return renderCatalogImportWorkspace(state.currentView);
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
              ${renderDesktopMenuLink("existencia", "Existencia")}
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

function renderDesktopProcesosMenu() {
  const transfersOpen = state.navigation.openSubmenu === "transferencias-procesos";

  return `
    <div class="modern-mega-menu">
      <div class="modern-mega-column modern-mega-column-root">
        ${renderDesktopMenuLink("borrador-devoluciones", "Borrador devoluciones")}
        ${renderDesktopMenuLink("ajuste-inventario", "Ajuste de inventario")}
        <button
          class="modern-dropdown-link modern-dropdown-link-with-arrow ${transfersOpen ? "modern-dropdown-link-open" : ""}"
          type="button"
          data-submenu="transferencias-procesos"
          data-submenu-owner="procesos"
          aria-expanded="${transfersOpen ? "true" : "false"}"
        >
          <span>Transferencias</span>
          <span class="modern-dropdown-link-arrow">&rsaquo;</span>
        </button>
      </div>
      ${
        transfersOpen
          ? `
            <div class="modern-archive-submenu modern-process-submenu">
              ${renderDesktopMenuLink("registro-transferencia", "Registro de transferencias")}
              ${renderDesktopMenuLink("registro-devoluciones", "Registro de devoluciones")}
              ${renderDesktopMenuLink("cargar-transferencia", "Carga de transferencias")}
              ${renderDesktopMenuLink("cargar-devoluciones", "Carga de devoluciones")}
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
  return `
    <div class="modern-page modern-page-articulos">
      ${renderDesktopBreadcrumb(["Archivos", "Inventario", "Articulos"])}

      <section class="modern-card modern-card-editor modern-card-editor-full modern-card-editor-window">
        ${renderArticleEditor()}
      </section>
    </div>
  `;
}

function getCatalogImportConfig(kind) {
  const configs = {
    categorias: {
      title: "Categorias",
      singular: "categoria",
      canDelete: true,
      maxCodeLength: 6,
      maxNameLength: 60,
      description: "Carga categorias desde Excel a la base de datos. Esta operacion esta pensada para administradores.",
      helpText: "Usa encabezados como Codigo, Nombre y Status. Si falta el codigo, el sistema lo genera automaticamente. Si tu rol no puede importar por Excel, puedes registrar el dato manualmente aqui mismo.",
      columns: [
        { key: "codigo", label: "Codigo" },
        { key: "nombre", label: "Nombre" },
        { key: "status", label: "Status" },
      ],
    },
    marcas: {
      title: "Marcas",
      singular: "marca",
      canDelete: true,
      maxCodeLength: 3,
      maxNameLength: 20,
      description: "Carga marcas desde Excel a la base de datos. Esta operacion esta pensada para administradores.",
      helpText: "Usa encabezados como Codigo, Nombre y Status. Si falta el codigo, el sistema lo genera automaticamente. Si tu rol no puede importar por Excel, puedes registrar el dato manualmente aqui mismo.",
      columns: [
        { key: "codigo", label: "Codigo" },
        { key: "nombre", label: "Nombre" },
        { key: "status", label: "Status" },
      ],
    },
    tallas: {
      title: "Tallas",
      singular: "talla",
      canDelete: true,
      maxCodeLength: 6,
      description: "Carga tallas desde Excel a la base de datos. Esta operacion esta pensada para administradores.",
      helpText: "Usa encabezados como Codigo, Talla o Nombre. En este catalogo solo se guarda el codigo de la talla. Si tu rol no puede importar por Excel, puedes registrar la talla manualmente.",
      columns: [{ key: "codigo", label: "Codigo" }],
    },
    colores: {
      title: "Colores",
      singular: "color",
      canDelete: true,
      maxCodeLength: 3,
      maxNameLength: 30,
      description: "Carga colores desde Excel a la base de datos. Esta operacion esta pensada para administradores.",
      helpText: "Usa encabezados como Codigo, Nombre y Status. Si falta el codigo, el sistema lo genera automaticamente. Si tu rol no puede importar por Excel, puedes registrar el dato manualmente aqui mismo.",
      columns: [
        { key: "codigo", label: "Codigo" },
        { key: "nombre", label: "Nombre" },
        { key: "status", label: "Status" },
      ],
    },
    fabricantes: {
      title: "Fabricantes",
      singular: "fabricante",
      canDelete: false,
      maxCodeLength: 12,
      maxNameLength: 50,
      description: "Carga fabricantes desde Excel a la base de datos. Esta operacion esta pensada para administradores.",
      helpText: "Usa encabezados como Codigo, Nombre y Status. Si falta el codigo, el sistema lo genera automaticamente. Si tu rol no puede importar por Excel, puedes registrar el dato manualmente aqui mismo.",
      columns: [
        { key: "codigo", label: "Codigo" },
        { key: "nombre", label: "Nombre" },
        { key: "status", label: "Status" },
      ],
    },
  };

  return configs[kind] || null;
}

function renderCatalogImportWorkspace(kind) {
  const config = getCatalogImportConfig(kind);
  if (!config) {
    return renderDesktopPlaceholderWindowV2(
      getDesktopViewLabelV2(kind),
      "Este modulo quedara disponible en las siguientes iteraciones del sistema.",
    );
  }

  const { title, singular, description, helpText } = config;
  const items = Array.isArray(state.catalogImport.itemsByKind?.[kind])
    ? state.catalogImport.itemsByKind[kind]
    : Array.isArray(state.metadata?.catalogos?.[kind])
      ? state.metadata.catalogos[kind]
      : [];
  const manualDraft = getCatalogManualDraft(kind);
  const isUploading = state.catalogImport.uploadingKind === kind;
  const isManualSubmitting = state.catalogImport.manualSubmittingKind === kind;
  const isLoading = state.catalogImport.loadingKind === kind;
  const supportsName = config.columns.some((column) => column.key === "nombre");
  const supportsStatus = config.columns.some((column) => column.key === "status");
  const canImportFromExcel = userCanImportCatalogsFromExcel();
  const codeLimitHint = config.maxCodeLength ? `Max. ${config.maxCodeLength} caracteres` : "";
  const nameLimitHint = config.maxNameLength ? `Max. ${config.maxNameLength} caracteres` : "";

  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(["Archivos", "Inventario", title])}

      <div class="modern-page-header">
        <div>
          <h1>Importar ${title}</h1>
          <p>${description}</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-ghost" type="button" data-refresh-catalogs ${isLoading ? "disabled" : ""}>
            ${isLoading ? "Actualizando..." : "Actualizar catalogo"}
          </button>
        </div>
      </div>

        <div class="catalog-import-layout">
          <section class="modern-card catalog-import-card">
            ${
              canImportFromExcel
                ? `
                  <div class="modern-card-head">
                    <div>
                      <h2>Subida por Excel</h2>
                      <p>Formatos aceptados: <strong>.xlsx</strong> y <strong>.xls</strong>. Esta accion depende del permiso de tu rol.</p>
                    </div>
                    <div class="modern-chip">${escapeHtml(String(items.length))} registros actuales</div>
                  </div>

                  <form class="catalog-import-form" data-catalog-import-form data-catalog-kind="${kind}">
                    <label class="field">
                      <span>Archivo Excel de ${singular}s</span>
                      <input type="file" name="file" accept=".xlsx,.xls" required />
                    </label>

                    <div class="catalog-import-actions">
                      <button class="button button-primary" type="submit" ${isUploading ? "disabled" : ""}>
                        ${isUploading ? "Importando..." : `Importar ${title}`}
                      </button>
                    </div>
                  </form>

                  <div class="catalog-import-help">
                    <strong>Columnas recomendadas</strong>
                    <p>${helpText}</p>
                  </div>

                  <div class="catalog-manual-divider"></div>
                `
                : `
                  <div class="modern-card-head">
                    <div>
                      <h2>Carga manual</h2>
                      <p>Usa este formulario para registrar un ${singular} directamente en la base de datos.</p>
                    </div>
                    <div class="modern-chip">${escapeHtml(String(items.length))} registros actuales</div>
                  </div>
                `
            }

            ${
              canImportFromExcel
                ? `
                  <div class="modern-card-head catalog-manual-head">
                    <div>
                      <h2>Carga manual</h2>
                      <p>Usa este formulario para registrar un ${singular} directamente en la base de datos.</p>
                    </div>
                  </div>
                `
                : ""
            }

            <form class="catalog-import-form" data-catalog-manual-form data-catalog-kind="${kind}">
            <div class="catalog-manual-grid ${supportsName ? "" : "catalog-manual-grid-simple"}">
                <label class="field">
                  <span>${supportsName ? "Codigo (opcional)" : "Codigo"}</span>
                  <input
                    type="text"
                    name="codigo"
                    value="${escapeHtml(manualDraft.codigo)}"
                    placeholder="${supportsName ? "Automatico" : "Ej. U, M, L"}"
                    ${config.maxCodeLength ? `maxlength="${config.maxCodeLength}"` : ""}
                  />
                  ${codeLimitHint ? `<small class="field-hint">${escapeHtml(codeLimitHint)}</small>` : ""}
                </label>

                ${
                  supportsName
                    ? `
                    <label class="field">
                      <span>Nombre</span>
                        <input
                            type="text"
                            name="nombre"
                            value="${escapeHtml(manualDraft.nombre)}"
                            placeholder="Nombre"
                            ${config.maxNameLength ? `maxlength="${config.maxNameLength}"` : ""}
                            required
                          />
                        ${nameLimitHint ? `<small class="field-hint">${escapeHtml(nameLimitHint)}</small>` : ""}
                      </label>
                    `
                    : ""
                }

              ${
                supportsStatus
                  ? `
                    <label class="field">
                      <span>Status</span>
                      <select name="status">
                        <option value="1" ${manualDraft.status === "1" ? "selected" : ""}>Activo</option>
                        <option value="0" ${manualDraft.status === "0" ? "selected" : ""}>Inactivo</option>
                      </select>
                    </label>
                  `
                  : ""
              }
            </div>

            <div class="catalog-import-actions">
              <button class="button button-primary" type="submit" ${isManualSubmitting ? "disabled" : ""}>
                ${isManualSubmitting ? "Guardando..." : `Guardar ${capitalize(config.singular)}`}
              </button>
            </div>
          </form>
        </section>

        <section class="modern-card catalog-import-card">
          <div class="modern-card-head">
            <div>
              <h2>${title} cargadas</h2>
              <p>Listado actual del catalogo en la base de datos.</p>
            </div>
          </div>
          ${isLoading ? renderLoadingState("Actualizando catalogo...") : renderCatalogImportTable(kind, items, config)}
        </section>
      </div>
    </div>
  `;
}

function renderCatalogImportTable(kind, items, config) {
  const { title, columns, canDelete = false } = config;

  if (!items.length) {
    return `
      <div class="empty-state">
        <h3>Sin registros</h3>
        <p>No hay ${title.toLowerCase()} cargadas todavia en este catalogo.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap catalog-import-table-wrap">
      <table class="data-table catalog-import-table">
        <thead>
          <tr>
            ${columns
              .map((column) => `<th>${escapeHtml(column.label)}</th>`)
              .join("")}
            ${canDelete ? "<th>Acciones</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${items
            .map(
              (item) => {
                const deleteKey = buildCatalogEntryDeleteKey(kind, item.codigo);
                const isDeleting = state.catalogImport.deletingEntryKey === deleteKey;

                return `
                <tr>
                  ${columns
                    .map((column) => {
                      const rawValue =
                        column.key === "nombre" ? item.nombre || item.codigo || "-" : item[column.key];
                      const displayValue = column.key === "status" ? toDisplayValue(rawValue) : rawValue || "-";
                      const content = escapeHtml(displayValue);

                      if (column.key === "codigo") {
                        return `<td><strong>${content}</strong></td>`;
                      }

                      return `<td>${content}</td>`;
                    })
                    .join("")}
                  ${
                    canDelete
                      ? `
                        <td class="catalog-import-action-cell">
                          <button
                            class="button button-danger catalog-delete-button"
                            type="button"
                            data-delete-catalog-kind="${escapeHtml(kind)}"
                            data-delete-catalog-code="${escapeHtml(item.codigo || "")}"
                            ${isDeleting ? "disabled" : ""}
                          >
                            ${isDeleting ? "Eliminando..." : "Eliminar"}
                          </button>
                        </td>
                      `
                      : ""
                  }
                </tr>
              `;
              },
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRoleAccessWorkspace() {
  const isSystemOperator = userIsSystemOperator();
  const roles = Array.isArray(state.roleAccess.roles) ? state.roleAccess.roles : [];

  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(["Utilidades", "Roles"])}

      <div class="modern-page-header">
        <div>
          <h1>Acceso a Importacion Excel</h1>
          <p>Desde aqui el usuario sistema decide que roles pueden cargar informacion mediante Excel a la base de datos.</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-ghost" type="button" data-refresh-role-access ${state.roleAccess.loading ? "disabled" : ""}>
            ${state.roleAccess.loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <section class="modern-card role-access-card">
        <div class="modern-card-head">
          <div>
            <h2>Permiso por Rol</h2>
            <p>Activa o quita la accion de importar catalogos desde Excel sin alterar otros permisos del rol.</p>
          </div>
          <div class="modern-chip">${escapeHtml(String(roles.length))} roles</div>
        </div>

        ${
          isSystemOperator
            ? `
              <div class="role-access-note">
                <strong>Control sistema</strong>
                <p>Puedes permitir o revocar este acceso por rol, incluyendo el rol administrador si asi lo decides.</p>
              </div>
            `
            : `
              <div class="role-access-note role-access-note-muted">
                <strong>Solo lectura</strong>
                <p>Solo el usuario sistema puede cambiar este permiso. Desde esta cuenta solo ves el estado actual.</p>
              </div>
            `
        }

        ${
          state.roleAccess.loading
            ? renderLoadingState("Cargando roles...")
            : renderRoleAccessTable(roles, { canManage: isSystemOperator })
        }
      </section>
    </div>
  `;
}

function renderRoleAccessTable(roles, options = {}) {
  const { canManage = false } = options;

  if (!roles.length) {
    return `
      <div class="empty-state">
        <h3>Sin roles</h3>
        <p>No hay roles disponibles para configurar en este momento.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap role-access-table-wrap">
      <table class="data-table role-access-table">
        <thead>
          <tr>
            <th>Codigo</th>
            <th>Rol</th>
            <th>Usuarios</th>
            <th>Importacion Excel</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          ${roles
            .map((role) => {
              const hasPermission = roleHasCatalogImportPermission(role);
              const isSaving = state.roleAccess.savingRole === role.codigo;
              const protectedBadges = [
                role.protegidoSistema ? "Sistema" : "",
                role.protegidoAdmin ? "Admin" : "",
              ].filter(Boolean);

              return `
                <tr>
                  <td><strong>${escapeHtml(role.codigo || "-")}</strong></td>
                  <td>
                    <div class="role-access-role">
                      <strong>${escapeHtml(role.nombre || role.codigo || "-")}</strong>
                      ${
                        protectedBadges.length > 0
                          ? `<span class="role-access-badges">${protectedBadges.map((badge) => `<span class="modern-chip">${escapeHtml(badge)}</span>`).join("")}</span>`
                          : ""
                      }
                    </div>
                  </td>
                  <td>${escapeHtml(String(role.totalUsuarios || 0))}</td>
                  <td>
                    <span class="role-access-status ${hasPermission ? "role-access-status-on" : "role-access-status-off"}">
                      ${hasPermission ? "Permitido" : "Bloqueado"}
                    </span>
                  </td>
                  <td>
                    <button
                      class="button ${hasPermission ? "button-ghost" : "button-primary"} role-access-action"
                      type="button"
                      data-role-import-toggle="${escapeHtml(role.codigo || "")}"
                      data-role-import-enabled="${hasPermission ? "false" : "true"}"
                      ${canManage && !isSaving ? "" : "disabled"}
                    >
                      ${isSaving ? "Guardando..." : hasPermission ? "Quitar" : "Permitir"}
                    </button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTransfersWorkspace() {
  const draft = state.transfers.draft || createEmptyTransferDraft();
  const isLocked = Boolean(draft.numero) && Number(draft.status) === 1;
  const isSaving = state.transfers.saving;
  const isApproving = state.transfers.approving;
  const isDeleting = state.transfers.deleting;
  const isBusy = isSaving || isApproving || isDeleting;
  const transferCreatedAt = draft.fecha || new Date().toISOString();
  const transferApprovedAt =
    Number(draft.status) === 1 && draft.fechaEmision ? formatDateDisplay(draft.fechaEmision) : "Pendiente";

  return `
    <div class="modern-page transfer-register-page">
      ${renderDesktopBreadcrumb(["Procesos", "Transferencias", "Registro de transferencias"])}

      <div class="modern-page-header">
        <div>
          <h1>Registro de transferencias de mercancia</h1>
        </div>
      </div>

      <section class="transfer-register-shell">
        <form id="transfer-form" class="transfer-register-form">
          <div class="transfer-command-bar" role="toolbar" aria-label="Acciones de transferencias">
            <button class="transfer-command-button" type="button" data-new-transfer ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">+</span>
              Crear
            </button>
            <button class="transfer-command-button" type="button" data-open-load-transfer ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">B</span>
              Buscar
            </button>
            <button class="transfer-command-button" type="button" data-print-transfer>
              <span class="transfer-command-icon">P</span>
              Imprimir
            </button>
            <button class="transfer-command-button transfer-command-primary" type="submit" ${isLocked || isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">G</span>
              ${isSaving ? "Guardando" : "Guardar"}
            </button>
            <button
              class="transfer-command-button transfer-command-primary"
              type="button"
              data-approve-transfer
              ${draft.numero && Number(draft.status) === 0 && !isBusy ? "" : "disabled"}
            >
              <span class="transfer-command-icon">A</span>
              ${isApproving ? "Aprobando" : "Aprobar"}
            </button>
            <button class="transfer-command-button" type="button" data-transfer-exit ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">S</span>
              Salir
            </button>
          </div>

          <div class="transfer-header-panel">
            <label class="transfer-field transfer-number-field">
              <span>Numero</span>
              <input type="text" name="numero" value="${escapeHtml(draft.numero ? String(draft.numero) : "0")}" readonly />
            </label>
            <label class="transfer-field">
              <span>Fecha registro</span>
              <input type="text" value="${escapeHtml(formatDateDisplay(transferCreatedAt))}" readonly />
            </label>
            <label class="transfer-field">
              <span>Fecha aprobacion</span>
              <input type="text" value="${escapeHtml(transferApprovedAt)}" readonly />
            </label>
            <label class="transfer-check-field">
              <span>Usa lector</span>
              <input type="checkbox" name="usaLector" />
            </label>

            <label class="transfer-field transfer-wide-field">
              <span>Sucursal</span>
              <select
                name="codigoRecibe"
                ${isLocked ? "disabled" : ""}
              >
                ${renderTransferLocationOptions(
                  Array.isArray(state.transfers.metadata?.sucursales) ? state.transfers.metadata.sucursales : [],
                  String(draft.codigoRecibe || ""),
                )}
              </select>
            </label>
            <label class="transfer-field">
              <span>Documento origen</span>
              <input
                type="text"
                name="documentoOrigen"
                value="${escapeHtml(toInputValue(draft.documentoOrigen))}"
                maxlength="12"
                ${isLocked ? "disabled" : ""}
              />
            </label>

            <label class="transfer-field transfer-full-field">
              <span>Observacion</span>
              <input name="observacion" maxlength="100" value="${escapeHtml(toInputValue(draft.observacion))}" ${isLocked ? "disabled" : ""} />
            </label>

            <label class="transfer-field transfer-wide-field">
              <span>Despacho</span>
              <select name="idDespacho" ${isLocked ? "disabled" : ""}>
                ${renderTransferDispatchOptions(
                  Array.isArray(state.transfers.metadata?.tiposDespacho) ? state.transfers.metadata.tiposDespacho : [],
                  String(draft.idDespacho || state.transfers.metadata?.defaults?.idDespacho || "0"),
                )}
              </select>
            </label>
            <label class="transfer-field">
              <span>Lote</span>
              <input
                type="text"
                name="zona"
                value="${escapeHtml(toInputValue(draft.zona))}"
                maxlength="50"
                ${isLocked ? "disabled" : ""}
              />
            </label>
            <label class="transfer-correction-field">
              <input type="checkbox" name="transferenciaCorreccion" ${draft.correccion ? "checked" : ""} ${isLocked ? "disabled" : ""} />
              <span>Transferencia de Correccion</span>
            </label>
          </div>

          <input type="hidden" name="codigoEnvia" value="${escapeHtml(toInputValue(draft.codigoEnvia))}" />

          <div class="transfer-lines-panel">
            <div class="transfer-grid-actions">
              <button class="button button-ghost" type="button" data-transfer-add-line ${isLocked || isBusy ? "disabled" : ""}>
                Agregar linea
              </button>
            </div>
              ${renderTransferLinesEditor(draft, { isLocked, allowReferenceEdit: Boolean(draft.correccion) })}
          </div>

          <div class="transfer-summary-row">
            <strong>F2 = Cambiar N de Caja</strong>
            <label>
              <span>Total Caja N 1</span>
              <input type="text" value="${escapeHtml(formatTransferAmount(computeTransferDraftTotal(draft)))}" readonly />
            </label>
            <label>
              <span>Cantidad</span>
              <input type="text" value="${escapeHtml(formatTransferQuantity(computeTransferDraftQuantity(draft)))}" readonly />
            </label>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderDevReturnsWorkspace() {
  const draft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);
  const isLocked = Boolean(draft.numero) && Number(draft.status) !== 0;
  const isBusy = state.devReturns.saving
    || state.devReturns.exporting
    || state.devReturns.loadingMetadata
    || state.devReturns.loadingDashboard
    || state.devReturns.loadingInboundDetail
    || state.devReturns.approvingInbound;
  const inboundDetail = state.devReturns.inboundDetail;

  return `
    <div class="modern-page transfer-register-page dev-return-page">
      ${renderDesktopBreadcrumb(["Procesos", "Borrador devoluciones"])}

      <div class="modern-page-header">
        <div>
          <h1>Borrador de devoluciones</h1>
          <p>Gestiona los borradores locales, los envios exportados y las aprobaciones recibidas desde la bodega.</p>
        </div>
      </div>

      <section class="transfer-register-shell adjustment-window dev-return-window">
        <form id="dev-return-form" class="transfer-register-form adjustment-form dev-return-form">
          <div class="transfer-command-bar adjustment-command-bar dev-return-command-bar" role="toolbar" aria-label="Acciones de borrador devoluciones">
            <button class="transfer-command-button" type="button" data-dev-return-new ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">+</span>
              Nueva
            </button>
            <button class="transfer-command-button" type="button" data-dev-return-open-lookup ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">B</span>
              Buscar
            </button>
            <button class="transfer-command-button transfer-command-primary" type="submit" ${isLocked || isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">G</span>
              ${state.devReturns.saving ? "Guardando" : "Guardar"}
            </button>
            <button
              class="transfer-command-button transfer-command-primary"
              type="button"
              data-dev-return-export
              ${draft.numero && Number(draft.status) === 0 && !isBusy ? "" : "disabled"}
            >
              <span class="transfer-command-icon">E</span>
              ${state.devReturns.exporting ? "Exportando" : "Exportar"}
            </button>
            <button class="transfer-command-button" type="button" data-dev-return-exit ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">S</span>
              Salir
            </button>
          </div>

          <div class="adjustment-header-panel dev-return-header-panel">
            <label class="adjustment-field adjustment-number-field">
              <span>Numero</span>
              <input type="text" name="numero" value="${escapeHtml(draft.numero ? String(draft.numero) : "")}" readonly />
            </label>
            <div class="adjustment-status ${renderDevReturnStatusClass(draft.status)}">
              ${escapeHtml(renderDevReturnStatusText(draft.status))}
            </div>
            <label class="adjustment-field adjustment-date-field">
              <span>Fecha</span>
              <input type="date" name="fecha" value="${escapeHtml(toInputValue(draft.fecha))}" ${isLocked ? "disabled" : ""} />
            </label>
            <label class="adjustment-field dev-return-origin-field">
              <span>Origen</span>
              <select name="codigoOrigen" ${isLocked ? "disabled" : ""}>
                ${renderDevReturnOriginOptions(String(draft.codigoOrigen || ""))}
              </select>
            </label>
            <label class="adjustment-field dev-return-destination-field">
              <span>Destino</span>
              <select name="codigoDestino" ${isLocked ? "disabled" : ""}>
                ${renderDevReturnDestinationOptions(String(draft.codigoDestino || ""), String(draft.codigoOrigen || ""))}
              </select>
            </label>
            <label class="adjustment-field adjustment-observation-field">
              <span>Observacion</span>
              <input name="observacion" maxlength="250" value="${escapeHtml(toInputValue(draft.observacion))}" ${isLocked ? "disabled" : ""} />
            </label>
          </div>

          <div class="adjustment-lines-panel dev-return-lines-panel">
            ${renderDevReturnLinesEditor(draft, { isLocked })}
          </div>

          <div class="transfer-summary-row dev-return-summary-row">
            <strong>F2 = Cambiar N de Caja</strong>
            <label>
              <span>Total Caja N 1</span>
              <input type="text" value="${escapeHtml(formatTransferAmount(computeDevReturnDraftTotal(draft)))}" readonly />
            </label>
            <label>
              <span>Cantidad</span>
              <input type="text" value="${escapeHtml(formatTransferQuantity(computeDevReturnDraftQuantity(draft)))}" readonly />
            </label>
          </div>
        </form>
      </section>

      ${
        inboundDetail
          ? `
            <section class="modern-card dev-return-inbound-detail-card">
              <div class="panel-heading">
                <div>
                  <h2>Revisión de borrador recibido</h2>
                  <p>Valida el borrador recibido desde la sucursal y apruébalo para disparar el registro en origen.</p>
                </div>
                <div class="dev-return-inline-actions">
                  <button class="button button-ghost" type="button" data-dev-return-close-inbound-detail ${isBusy ? "disabled" : ""}>
                    Cerrar detalle
                  </button>
                  <button
                    class="button button-primary"
                    type="button"
                    data-dev-return-approve-inbound
                    ${String(inboundDetail.status || "").toUpperCase() === "RECEIVED" && !isBusy ? "" : "disabled"}
                  >
                    ${state.devReturns.approvingInbound ? "Aprobando..." : "Aprobar borrador"}
                  </button>
                </div>
              </div>
              ${renderDevReturnInboundDraftDetail(inboundDetail)}
            </section>
          `
          : ""
      }

      <section class="modern-card dev-return-board-card">
        <div class="panel-heading">
          <div>
            <h2>Bandejas</h2>
            <p>Consulta lo que ya salió hacia la bodega y lo que llegó pendiente por revisar.</p>
          </div>
        </div>
        <div class="dev-return-board-grid">
          <section class="dev-return-board-pane">
            <div class="dev-return-pane-header">
              <div>
                <h3>Enviados</h3>
                <p>${escapeHtml(String((state.devReturns.items || []).length))} borrador(es)</p>
              </div>
              <button class="button button-ghost" type="button" data-dev-return-refresh-board ${isBusy ? "disabled" : ""}>
                Actualizar
              </button>
            </div>
            ${renderDevReturnSentDraftsTable(state.devReturns.items || [])}
          </section>
          <section class="dev-return-board-pane">
            <div class="dev-return-pane-header">
              <div>
                <h3>Recibidos</h3>
                <p>${escapeHtml(String((state.devReturns.inboundItems || []).length))} borrador(es)</p>
              </div>
            </div>
            ${renderDevReturnReceivedDraftsTable(state.devReturns.inboundItems || [])}
          </section>
        </div>
      </section>
    </div>
  `;
}

function renderInventoryExistenceWorkspace() {
  if (!userCanAccessFullInventory()) {
    return renderDesktopPlaceholderWindowV2(
      "Existencia",
      "Este modulo requiere acceso completo al inventario.",
    );
  }

  const items = Array.isArray(state.inventoryExistence.items) ? state.inventoryExistence.items : [];
  const pagination = state.inventoryExistence.pagination || {
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  };
  const isBusy = state.inventoryExistence.loading || state.inventoryExistence.refreshing;
  const syncedLabel = state.inventoryExistence.lastUpdatedAt
    ? `Actualizado ${formatDateDisplay(state.inventoryExistence.lastUpdatedAt)}`
    : "Sin consulta reciente";

  return `
    <div class="modern-page inventory-existence-page">
      ${renderDesktopBreadcrumb(["Archivos", "Inventario", "Existencia"])}

      <div class="modern-page-header">
        <div>
          <h1>Existencia</h1>
          <p>Consulta viva del inventario con todos los atributos actuales de cada articulo.</p>
        </div>
        <div class="modern-page-actions">
          <span class="modern-chip">${escapeHtml(String(pagination.total || 0))} articulos</span>
          <span class="modern-chip">${escapeHtml(syncedLabel)}</span>
          <button class="button button-ghost" type="button" data-existence-refresh ${isBusy ? "disabled" : ""}>
            ${state.inventoryExistence.loading ? "Consultando..." : state.inventoryExistence.refreshing ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
      </div>

      <section class="modern-card inventory-existence-card">
        <div class="modern-search-wrap inventory-existence-search-wrap">
          ${renderInventoryExistenceSearchForm()}
        </div>
        ${renderInventoryExistenceTable(items)}
        ${renderInventoryExistencePagination()}
      </section>
    </div>
  `;
}

function renderInventoryExistenceSearchForm() {
  const metadata = state.metadata || {};
  const statusOptions = Array.isArray(metadata?.opciones?.status) ? metadata.opciones.status : [];
  const typeOptions = Array.isArray(metadata?.opciones?.tipos) ? metadata.opciones.tipos : [];
  const search = state.inventoryExistence.search || {};
  const pagination = state.inventoryExistence.pagination || {};

  return `
    <form class="search-form inventory-existence-search-grid" data-existence-search-form>
      <label class="field">
        <span>Buscar</span>
        <input
          type="text"
          name="buscar"
          placeholder="Codigo, referencia, nombre, familia"
          value="${escapeHtml(search.buscar || "")}"
        />
      </label>
      <label class="field">
        <span>Status</span>
        <select name="status">
          <option value="">Todos</option>
          ${statusOptions.map((option) => `
            <option value="${escapeHtml(String(option.codigo))}" ${String(search.status || "") === String(option.codigo) ? "selected" : ""}>
              ${escapeHtml(capitalize(option.nombre || String(option.codigo)))}
            </option>
          `).join("")}
        </select>
      </label>
      <label class="field">
        <span>Tipo</span>
        <select name="tipo">
          <option value="">Todos</option>
          ${typeOptions.map((option) => `
            <option value="${escapeHtml(String(option.codigo))}" ${String(search.tipo || "") === String(option.codigo) ? "selected" : ""}>
              ${escapeHtml(capitalize(option.nombre || String(option.codigo)))}
            </option>
          `).join("")}
        </select>
      </label>
      <label class="field">
        <span>Limite</span>
        <select name="limit">
          ${["25", "50", "100"].map((value) => `
            <option value="${value}" ${String(pagination.limit || 25) === value ? "selected" : ""}>${value}</option>
          `).join("")}
        </select>
      </label>
      <div class="search-actions inventory-existence-search-actions">
        <button class="button button-primary" type="submit" ${state.inventoryExistence.loading ? "disabled" : ""}>
          ${state.inventoryExistence.loading ? "Consultando..." : "Consultar"}
        </button>
        <button class="button button-ghost" type="button" data-existence-clear>
          Limpiar
        </button>
      </div>
    </form>
  `;
}

function renderInventoryExistenceTable(items) {
  if (state.inventoryExistence.loading && items.length === 0) {
    return `
      <div class="empty-state">
        <h3>Cargando existencia</h3>
        <p>Estamos consultando el inventario actualizado para mostrar todos sus atributos.</p>
      </div>
    `;
  }

  if (!items.length) {
    return `
      <div class="empty-state">
        <h3>Sin articulos</h3>
        <p>No hay resultados con los filtros actuales.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap inventory-existence-table-wrap">
      <table class="data-table inventory-existence-table">
        <thead>
          <tr>
            <th>Codigo barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Familia</th>
            <th>Categoria</th>
            <th>Fabricante</th>
            <th>Marca</th>
            <th>Talla</th>
            <th>Color</th>
            <th>Tipo</th>
            <th>Status</th>
            <th>Impuesto</th>
            <th>% Imp.</th>
            <th>Detal</th>
            <th>Mayor</th>
            <th>Afiliado</th>
            <th>Promocion</th>
            <th>% Desc.</th>
            <th>Precio promo</th>
            <th>Costo inicial</th>
            <th>Costo promedio</th>
            <th>Ultimo costo</th>
            <th>Costo dolar</th>
            <th>Existencia inicial</th>
            <th>Existencia actual</th>
            <th>Punto recorte</th>
            <th>Serializado</th>
            <th>Nota</th>
            <th>Fecha promo desde</th>
            <th>Fecha promo hasta</th>
            <th>Primer movimiento</th>
            <th>Ultima actualizacion</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(renderInventoryExistenceRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryExistenceRow(article) {
  return `
    <tr>
      <td><strong>${escapeHtml(article.codigoBarra || "-")}</strong></td>
      <td>${escapeHtml(article.referencia || "-")}</td>
      <td>${escapeHtml(article.general?.nombre || "-")}</td>
      <td>${escapeHtml(article.general?.familia || "-")}</td>
      <td>${escapeHtml(formatInventoryCatalogLabel(article.general?.categoria))}</td>
      <td>${escapeHtml(formatInventoryCatalogLabel(article.general?.fabricante))}</td>
      <td>${escapeHtml(formatInventoryCatalogLabel(article.general?.marca))}</td>
      <td>${escapeHtml(article.tallasColores?.talla?.codigo || "-")}</td>
      <td>${escapeHtml(formatInventoryCatalogLabel(article.tallasColores?.colores))}</td>
      <td>${escapeHtml(capitalize(article.general?.tipo?.nombre || "-"))}</td>
      <td>${escapeHtml(capitalize(article.general?.status?.nombre || "-"))}</td>
      <td>${escapeHtml(formatInventoryCatalogLabel(article.precios?.impuesto))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.impuesto?.porcentaje))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.detal))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.mayor))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.afiliado))}</td>
      <td>${escapeHtml(formatInventoryBoolean(article.precios?.promocion?.activa))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.promocion?.porcentajeDescuento))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.precios?.promocion?.precio))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.inventario?.costos?.inicial))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.inventario?.costos?.promedio))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.inventario?.costos?.ultimo))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.inventario?.costos?.dolar))}</td>
      <td>${escapeHtml(formatInventoryNumeric(article.inventario?.existenciaInicial))}</td>
      <td><strong>${escapeHtml(formatInventoryNumeric(article.inventario?.existenciaActual))}</strong></td>
      <td>${escapeHtml(formatInventoryNumeric(article.general?.puntoRecorte))}</td>
      <td>${escapeHtml(formatInventoryBoolean(article.inventario?.serializado))}</td>
      <td>${escapeHtml(article.general?.nota || "-")}</td>
      <td>${escapeHtml(formatInventoryDate(article.precios?.promocion?.desde))}</td>
      <td>${escapeHtml(formatInventoryDate(article.precios?.promocion?.hasta))}</td>
      <td>${escapeHtml(formatInventoryDate(article.inventario?.fechas?.fechaPrimerMovimiento))}</td>
      <td>${escapeHtml(formatInventoryDate(article.inventario?.fechas?.ultimaActualizacion))}</td>
    </tr>
  `;
}

function renderInventoryExistencePagination() {
  const pagination = state.inventoryExistence.pagination || {};
  const page = pagination.page || 1;
  const totalPages = pagination.totalPages || 1;

  return `
    <div class="pagination inventory-existence-pagination">
      <div class="pagination-summary">
        Pagina ${escapeHtml(String(page))} de ${escapeHtml(String(totalPages))}
      </div>
      <div class="pagination-actions">
        <button
          class="button button-ghost"
          type="button"
          data-existence-page="prev"
          ${page <= 1 || state.inventoryExistence.loading ? "disabled" : ""}
        >
          Anterior
        </button>
        <button
          class="button button-ghost"
          type="button"
          data-existence-page="next"
          ${page >= totalPages || state.inventoryExistence.loading ? "disabled" : ""}
        >
          Siguiente
        </button>
      </div>
    </div>
  `;
}

function renderDevReturnStatusText(status) {
  const normalizedStatus = Number(status || 0);
  if (normalizedStatus === 1) {
    return "EXPORTADA";
  }

  if (normalizedStatus === 2) {
    return "APROBADA";
  }

  if (normalizedStatus === 3) {
    return "REGISTRADA";
  }

  if (normalizedStatus === 4) {
    return "COMPLETADA";
  }

  return "GUARDADA";
}

function renderDevReturnStatusClass(status) {
  return Number(status || 0) > 0 ? "adjustment-status-approved" : "adjustment-status-pending";
}

function renderDevReturnSyncStatusChip(label, tone = "neutral") {
  const toneClass =
    tone === "success"
      ? "modern-chip-success"
      : tone === "warning"
        ? "modern-chip-warning"
        : tone === "danger"
          ? "modern-chip-danger"
          : "";

  return `<span class="modern-chip ${toneClass}">${escapeHtml(label || "-")}</span>`;
}

function renderDevReturnOriginOptions(selectedValue) {
  const origenes = Array.isArray(state.devReturns.metadata?.origenes) ? state.devReturns.metadata.origenes : [];
  if (!origenes.length) {
    return `<option value="">Sin origenes</option>`;
  }

  return origenes
    .map((item) => `
      <option value="${escapeHtml(String(item.codigo || ""))}" ${String(selectedValue || "") === String(item.codigo || "") ? "selected" : ""}>
        ${escapeHtml(formatLocationOptionLabel(item))}
      </option>
    `)
    .join("");
}

function renderDevReturnDestinationOptions(selectedValue, originValue = "") {
  const destinos = Array.isArray(state.devReturns.metadata?.destinos) ? state.devReturns.metadata.destinos : [];
  if (!destinos.length) {
    return `<option value="">Sin bodegas</option>`;
  }

  return destinos
    .map((item) => `
      <option value="${escapeHtml(String(item.codigo || ""))}" ${String(selectedValue || "") === String(item.codigo || "") ? "selected" : ""}>
        ${escapeHtml(formatLocationOptionLabel(item))}
      </option>
    `)
    .join("");
}

function formatLocationOptionLabel(item) {
  const codigo = String(item?.codigo || "").trim();
  const nombre = String(item?.nombre || "").trim();
  if (codigo && nombre) {
    return `${codigo} - ${nombre}`;
  }

  return nombre || codigo || "";
}

function renderDevReturnLinesEditor(draft, { isLocked = false } = {}) {
  const rows = [...(draft.items || [])];
  while (rows.length < 15) {
    rows.push(createEmptyDevReturnLineDraft());
  }

  return `
    <div class="adjustment-grid-wrap">
      <table class="adjustment-grid dev-return-grid">
        <thead>
          <tr>
            <th class="adjustment-row-number"></th>
            <th>Codigo Barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Caja</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((line, index) => `
              <tr data-dev-return-line-row="${index}">
                <td class="adjustment-row-number">${index + 1}</td>
                <td>
                  <input
                    name="codigoBarra"
                    data-dev-return-barcode-input="${index}"
                    value="${escapeHtml(toInputValue(line.codigoBarra))}"
                    maxlength="15"
                    ${isLocked ? "disabled" : ""}
                  />
                </td>
                <td>
                  <input name="referencia" value="${escapeHtml(toInputValue(line.referencia))}" readonly />
                </td>
                <td>
                  <input name="nombre" value="${escapeHtml(toInputValue(line.nombre))}" readonly />
                  <input type="hidden" name="costo" value="${escapeHtml(toInputValue(line.costo))}" />
                </td>
                <td>
                  <input
                    name="numeroCaja"
                    value="${escapeHtml(toInputValue(line.numeroCaja))}"
                    inputmode="numeric"
                    ${isLocked ? "disabled" : ""}
                  />
                </td>
                <td>
                  <input
                    class="adjustment-quantity-input"
                    name="cantidad"
                    value="${escapeHtml(toInputValue(line.cantidad))}"
                    inputmode="decimal"
                    ${isLocked ? "disabled" : ""}
                  />
                </td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDevReturnSentDraftsTable(items) {
  if (!items.length) {
    return `
      <div class="empty-state dev-return-mini-empty">
        <h3>Sin enviados</h3>
        <p>Todavía no has exportado borradores desde esta instancia.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table dev-return-board-table">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Fecha</th>
            <th>Origen</th>
            <th>Destino</th>
            <th>Status</th>
            <th>Total</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
              <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
              <td>${escapeHtml(item.codigoOrigenInfo?.nombre || item.codigoOrigen || "-")}</td>
              <td>${escapeHtml(item.codigoDestinoInfo?.nombre || item.codigoDestino || "-")}</td>
              <td>${renderDevReturnSyncStatusChip(renderDevReturnStatusText(item.status), Number(item.status || 0) > 0 ? "success" : "warning")}</td>
              <td>${escapeHtml(formatTransferAmount(item.totalValor))}</td>
              <td>
                <button class="button button-ghost" type="button" data-dev-return-open-draft="${escapeHtml(String(item.numero || ""))}">
                  Abrir
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDevReturnReceivedDraftsTable(items) {
  if (!items.length) {
    return `
      <div class="empty-state dev-return-mini-empty">
        <h3>Sin recibidos</h3>
        <p>No hay borradores remotos pendientes por revisar en esta base.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table dev-return-board-table">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Origen</th>
            <th>Fecha</th>
            <th>Status</th>
            <th>Total</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
              <td>${escapeHtml(item.codigoOrigen || "-")}</td>
              <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
              <td>${renderDevReturnSyncStatusChip(item.statusNombre || item.status || "-", String(item.status || "").toUpperCase() === "RECEIVED" ? "warning" : "success")}</td>
              <td>${escapeHtml(formatTransferAmount(item.totalValor))}</td>
              <td>
                <button class="button button-ghost" type="button" data-dev-return-open-inbound="${escapeHtml(String(item.globalId || ""))}">
                  Revisar
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDevReturnInboundDraftDetail(detail) {
  return `
    <div class="dev-return-detail-grid">
      <div class="dev-return-detail-meta">
        <div><strong>Numero:</strong> ${escapeHtml(String(detail.numero || "-"))}</div>
        <div><strong>Origen:</strong> ${escapeHtml(detail.codigoOrigen || "-")}</div>
        <div><strong>Destino:</strong> ${escapeHtml(detail.codigoDestino || "-")}</div>
        <div><strong>Status:</strong> ${renderDevReturnSyncStatusChip(detail.statusNombre || detail.status || "-")}</div>
        <div><strong>Recibido:</strong> ${escapeHtml(formatDateDisplay(detail.recibido || detail.fecha))}</div>
        <div><strong>Observacion:</strong> ${escapeHtml(detail.observacion || "-")}</div>
      </div>
      ${renderDevReturnReadOnlyLines(detail.items || [], "Cantidad")}
    </div>
  `;
}

function renderDevReturnReadOnlyLines(items, lastColumnLabel = "Valor") {
  const showValue = String(lastColumnLabel || "").toLowerCase() === "valor";
  return `
    <div class="table-wrap">
      <table class="data-table dev-return-board-table dev-return-readonly-lines">
        <thead>
          <tr>
            <th>Item</th>
            <th>Codigo Barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Caja</th>
            <th>${escapeHtml(lastColumnLabel)}</th>
          </tr>
        </thead>
        <tbody>
          ${(items || []).map((item) => `
            <tr>
              <td>${escapeHtml(String(item.item || "-"))}</td>
              <td>${escapeHtml(item.codigoBarra || "-")}</td>
              <td>${escapeHtml(item.articulo?.referencia || item.referencia || "-")}</td>
              <td>${escapeHtml(item.articulo?.nombre || item.nombre || "-")}</td>
              <td>${escapeHtml(String(item.numeroCaja ?? "-"))}</td>
              <td>${escapeHtml(showValue ? formatTransferAmount(item.valor || "0") : formatTransferQuantity(item.cantidad || "0"))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDevReturnLookupModal() {
  if (!state.devReturnLookup.open) {
    return "";
  }

  const isRecordLookup = state.devReturnLookup.mode === "records";
  const items = Array.isArray(state.devReturnLookup.items) ? state.devReturnLookup.items : [];
  const totalLabel = state.devReturnLookup.loading
    ? isRecordLookup ? "Cargando devoluciones registradas..." : "Cargando borradores..."
    : `Catalogo (${escapeHtml(String(items.length))} Registros)`;
  const titleEyebrow = isRecordLookup ? "Registro de devoluciones" : "Borradores";
  const description = isRecordLookup
    ? "Haz clic sobre una devolución ya registrada para cargar su detalle."
    : "Haz clic sobre un borrador guardado o exportado para cargarlo en el formulario.";
  const loadingTitle = isRecordLookup ? "Cargando devoluciones" : "Cargando borradores";
  const loadingCopy = isRecordLookup
    ? "Estamos trayendo las devoluciones ya registradas en esta sede."
    : "Estamos trayendo los borradores guardados y exportados.";
  const emptyTitle = isRecordLookup ? "Sin devoluciones" : "Sin borradores";
  const emptyCopy = isRecordLookup
    ? "No hay devoluciones registradas para mostrar en este catalogo."
    : "No hay borradores para mostrar en este catalogo.";

  return `
    <div class="article-lookup-overlay adjustment-lookup-overlay">
      <button class="article-lookup-backdrop" type="button" data-dev-return-lookup-close aria-label="Cerrar catalogo"></button>
      <section class="article-lookup-dialog adjustment-lookup-dialog dev-return-lookup-dialog" role="dialog" aria-modal="true" aria-labelledby="dev-return-lookup-title">
        <div class="article-lookup-header adjustment-lookup-header">
          <div class="article-lookup-header-copy">
            <p class="eyebrow">${titleEyebrow}</p>
            <h3 id="dev-return-lookup-title">${totalLabel}</h3>
            <p>${description}</p>
          </div>
          <div class="article-lookup-header-actions">
            <span class="article-lookup-count">
              ${state.devReturnLookup.loading ? "Cargando..." : `${escapeHtml(String(items.length))} registros`}
            </span>
            <button class="article-command-button" type="button" data-dev-return-lookup-refresh ${state.devReturnLookup.loading ? "disabled" : ""}>
              Actualizar
            </button>
            <button class="article-command-button" type="button" data-dev-return-lookup-close>
              Cerrar
            </button>
          </div>
        </div>

        ${
          state.devReturnLookup.loading
            ? `
              <div class="empty-state article-lookup-empty">
                <h3>${loadingTitle}</h3>
                <p>${loadingCopy}</p>
              </div>
            `
            : items.length === 0
              ? `
                <div class="empty-state article-lookup-empty">
                  <h3>${emptyTitle}</h3>
                  <p>${emptyCopy}</p>
                </div>
              `
              : `
                <div class="table-wrap article-lookup-table-wrap adjustment-lookup-table-wrap">
                  <table class="data-table article-lookup-table adjustment-lookup-table dev-return-lookup-table">
                    <thead>
                      <tr>
                        <th>Numero</th>
                        <th>Fecha</th>
                        <th>Origen</th>
                        <th>Destino</th>
                        <th>Status</th>
                        <th>Observacion</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(renderDevReturnLookupRow).join("")}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>
    </div>
  `;
}

function renderDevReturnLookupRow(item) {
  const isExported = Number(item.status || 0) > 0;
  const originLabel = item.codigoOrigenInfo?.nombre || item.codigoEnviaInfo?.nombre || item.codigoOrigen || item.codigoEnvia || "-";
  const destinationLabel = item.codigoDestinoInfo?.nombre || item.codigoRecibeInfo?.nombre || item.codigoDestino || item.codigoRecibe || "-";

  return `
    <tr class="adjustment-lookup-row ${isExported ? "adjustment-lookup-row-approved" : "adjustment-lookup-row-pending"}" data-dev-return-lookup-select="${escapeHtml(String(item.numero || ""))}">
      <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
      <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
      <td>${escapeHtml(originLabel)}</td>
      <td>${escapeHtml(destinationLabel)}</td>
      <td>${renderDevReturnLookupStatusBadge(item.statusNombre || item.status)}</td>
      <td>${escapeHtml(item.observacion || "-")}</td>
    </tr>
  `;
}

function renderDevReturnLookupStatusBadge(status) {
  return `<span class="modern-chip">${escapeHtml(renderDevReturnStatusText(status))}</span>`;
}

function renderLegacyDevReturnRecordsWorkspace() {
  const detail = state.devReturnRecords.detail;

  if (detail) {
    return `
      <div class="modern-page transfer-import-detail-page">
        ${renderDesktopBreadcrumb(["Procesos", "Registro de devoluciones", "Detalle"])}
        <div class="modern-page-header">
          <div>
            <h1>Registro de devoluciones</h1>
            <p>Documento ${escapeHtml(String(detail.numero || "-"))} listo para seguimiento en origen.</p>
          </div>
          <div class="dev-return-inline-actions">
            <button class="button button-ghost" type="button" data-dev-return-record-back>
              Volver
            </button>
          </div>
        </div>
        <section class="modern-card dev-return-inbound-detail-card">
          <div class="dev-return-detail-meta">
            <div><strong>Numero:</strong> ${escapeHtml(String(detail.numero || "-"))}</div>
            <div><strong>Envia:</strong> ${escapeHtml(detail.codigoEnvia || "-")}</div>
            <div><strong>Recibe:</strong> ${escapeHtml(detail.codigoRecibe || "-")}</div>
            <div><strong>Status:</strong> ${renderDevReturnSyncStatusChip(detail.statusNombre || "-")}</div>
            <div><strong>Fecha:</strong> ${escapeHtml(formatDateDisplay(detail.fecha))}</div>
            <div><strong>Observacion:</strong> ${escapeHtml(detail.observacion || "-")}</div>
          </div>
          ${renderDevReturnReadOnlyLines(detail.items || [], "Valor")}
        </section>
      </div>
    `;
  }

  return `
    <div class="modern-page transfer-import-page">
      ${renderDesktopBreadcrumb(["Procesos", "Registro de devoluciones"])}
      <div class="modern-page-header">
        <div>
          <h1>Registro de devoluciones</h1>
          <p>Revisa las devoluciones ya registradas en origen y su avance hacia el destino.</p>
        </div>
      </div>
      <section class="modern-card dev-return-board-card">
        <div class="panel-heading">
          <div>
            <h2>Documentos</h2>
            <p>${escapeHtml(String((state.devReturnRecords.items || []).length))} registro(s) visibles.</p>
          </div>
          <button class="button button-ghost" type="button" data-dev-return-record-refresh ${state.devReturnRecords.loading ? "disabled" : ""}>
            ${state.devReturnRecords.loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
        ${renderDevReturnRecordsTable(state.devReturnRecords.items || [])}
      </section>
    </div>
  `;
}

function renderDevReturnRecordsTable(items) {
  if (!items.length) {
    return `
      <div class="empty-state dev-return-mini-empty">
        <h3>Sin registros</h3>
        <p>Las devoluciones aprobadas en origen aparecerán aquí.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table dev-return-board-table">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Fecha</th>
            <th>Envia</th>
            <th>Recibe</th>
            <th>Status</th>
            <th>Total</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
              <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
              <td>${escapeHtml(item.codigoEnviaInfo?.nombre || item.codigoEnvia || "-")}</td>
              <td>${escapeHtml(item.codigoRecibeInfo?.nombre || item.codigoRecibe || "-")}</td>
              <td>${renderDevReturnSyncStatusChip(item.statusNombre || "-")}</td>
              <td>${escapeHtml(formatTransferAmount(item.totalValor))}</td>
              <td>
                <button class="button button-ghost" type="button" data-dev-return-record-open="${escapeHtml(String(item.numero || ""))}">
                  Ver detalle
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderDevReturnRecordsWorkspace() {
  const detail = state.devReturnRecords.detail || null;
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const totalQuantity = items.reduce((total, item) => total + Number(item?.cantidad || 0), 0);
  const statusLabel = detail ? String(detail.statusNombre || "-").toUpperCase() : "SIN CARGAR";
  const statusClass = detail && Number(detail.status || 0) === 1
    ? "adjustment-status adjustment-status-approved"
    : "adjustment-status";
  const branchLabel = detail?.codigoRecibeInfo?.nombre || detail?.codigoRecibe || "";
  const originLabel = detail?.codigoEnviaInfo?.nombre || detail?.codigoEnvia || "";
  const alreadyExported = Boolean(detail?.exportacion?.bloqueada);
  const exportDisabled = !detail || alreadyExported || state.devReturnRecords.exporting || state.devReturnRecords.loadingDetail;
  const helperCopy = detail
    ? alreadyExported
      ? `Documento ${escapeHtml(String(detail.numero || "-"))} ya exportado al destino. El boton queda bloqueado para evitar reenvios duplicados.`
      : `Documento ${escapeHtml(String(detail.numero || "-"))} listo para seguimiento y exportacion al destino.`
    : "Usa Buscar para cargar un borrador que ya fue aprobado por el destino.";

  return `
    <div class="modern-page dev-return-record-page">
      ${renderDesktopBreadcrumb(["Procesos", "Devoluciones", "Registro de devoluciones"])}

      <div class="modern-page-header">
        <div>
          <h1>Registro de devoluciones</h1>
          <p>${helperCopy}</p>
        </div>
      </div>

      <section class="transfer-register-shell dev-return-record-shell">
        <div class="transfer-register-form dev-return-record-form">
          <div class="transfer-command-bar" role="toolbar" aria-label="Acciones de registro de devoluciones">
            <button class="transfer-command-button" type="button" data-dev-return-record-new>
              <span class="transfer-command-icon">+</span>
              Crear
            </button>
            <button class="transfer-command-button" type="button" data-dev-return-record-search ${state.devReturnRecords.loading ? "disabled" : ""}>
              <span class="transfer-command-icon">B</span>
              Buscar
            </button>
            <button
              class="transfer-command-button transfer-command-primary"
              type="button"
              data-dev-return-record-export
              ${exportDisabled ? "disabled" : ""}
            >
              <span class="transfer-command-icon">E</span>
              ${state.devReturnRecords.exporting ? "Exportando" : alreadyExported ? "Exportada" : "Exportar"}
            </button>
            <button class="transfer-command-button" type="button" data-dev-return-record-exit>
              <span class="transfer-command-icon">S</span>
              Salir
            </button>
          </div>

          <div class="transfer-header-panel dev-return-record-header-panel">
            <label class="transfer-field transfer-number-field">
              <span>Numero</span>
              <input type="text" value="${escapeHtml(detail ? String(detail.numero || "0") : "0")}" readonly />
            </label>
            <div class="dev-return-record-status-block">
              <span>Status</span>
              <strong class="${statusClass}">${escapeHtml(statusLabel)}</strong>
            </div>
            <label class="transfer-field">
              <span>Fecha</span>
              <input type="text" value="${escapeHtml(detail ? formatDateDisplay(detail.fecha) : "")}" readonly />
            </label>
            <label class="transfer-field">
              <span>Fecha emision</span>
              <input type="text" value="${escapeHtml(detail ? formatDateDisplay(detail.fechaEmision) : "")}" readonly />
            </label>

            <label class="transfer-field transfer-wide-field">
              <span>Sucursal</span>
              <input type="text" value="${escapeHtml(branchLabel)}" readonly />
            </label>
            <label class="transfer-field">
              <span>Documento origen</span>
              <input type="text" value="${escapeHtml(detail?.codigoOrigen || "")}" readonly />
            </label>

            <label class="transfer-field transfer-full-field">
              <span>Observacion</span>
              <input type="text" value="${escapeHtml(detail?.observacion || "")}" readonly />
            </label>

            <label class="transfer-field dev-return-record-origin-field">
              <span>Envia</span>
              <input type="text" value="${escapeHtml(originLabel)}" readonly />
            </label>
            <label class="transfer-field">
              <span>Lote</span>
              <input type="text" value="${escapeHtml(detail?.lote?.lote || "")}" readonly />
            </label>
          </div>

          <div class="transfer-lines-panel dev-return-record-lines-panel">
            ${renderDevReturnRecordLinesGrid(items)}
          </div>

          <div class="transfer-summary-row dev-return-record-summary-row">
            <strong>${detail ? "Documento listo para exportacion y seguimiento." : "Buscar carga un borrador aprobado para convertirlo en registro visible."}</strong>
            <label>
              <span>Renglones</span>
              <input type="text" value="${escapeHtml(String(items.filter(Boolean).length))}" readonly />
            </label>
            <label>
              <span>Cantidad</span>
              <input type="text" value="${escapeHtml(formatTransferQuantity(totalQuantity))}" readonly />
            </label>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderDevReturnRecordLinesGrid(items) {
  const normalizedItems = Array.isArray(items) ? [...items] : [];
  const minRows = Math.max(12, normalizedItems.length || 0);
  while (normalizedItems.length < minRows) {
    normalizedItems.push(null);
  }

  return `
    <div class="adjustment-lines-panel dev-return-record-grid-panel">
      <div class="adjustment-grid-wrap dev-return-record-grid-wrap">
        <table class="adjustment-grid dev-return-record-grid">
          <thead>
            <tr>
              <th></th>
              <th>Codigo Barra</th>
              <th>Referencia</th>
              <th>Nombre</th>
              <th>Caja</th>
              <th>Cantidad</th>
            </tr>
          </thead>
          <tbody>
            ${normalizedItems.map((item, index) => item
              ? `
                <tr>
                  <td class="adjustment-row-number">${index + 1}</td>
                  <td><span class="dev-return-record-cell">${escapeHtml(item.codigoBarra || "-")}</span></td>
                  <td><span class="dev-return-record-cell">${escapeHtml(item.articulo?.referencia || item.referencia || "-")}</span></td>
                  <td><span class="dev-return-record-cell">${escapeHtml(item.articulo?.nombre || item.nombre || "-")}</span></td>
                  <td><span class="dev-return-record-cell dev-return-record-cell-number">${escapeHtml(String(item.numeroCaja ?? "-"))}</span></td>
                  <td><span class="dev-return-record-cell dev-return-record-cell-number">${escapeHtml(formatTransferQuantity(item.cantidad || "0"))}</span></td>
                </tr>
              `
              : `
                <tr class="dev-return-record-empty-row">
                  <td class="adjustment-row-number">${index + 1}</td>
                  <td><span class="dev-return-record-cell">&nbsp;</span></td>
                  <td><span class="dev-return-record-cell">&nbsp;</span></td>
                  <td><span class="dev-return-record-cell">&nbsp;</span></td>
                  <td><span class="dev-return-record-cell">&nbsp;</span></td>
                  <td><span class="dev-return-record-cell">&nbsp;</span></td>
                </tr>
              `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderLoadDevReturnsWorkspace() {
  const detail = state.devReturnInbound.detail;

  if (detail) {
    return `
      <div class="modern-page transfer-import-detail-page">
        ${renderDesktopBreadcrumb(["Procesos", "Carga de devoluciones", "Detalle"])}
        <div class="modern-page-header">
          <div>
            <h1>Carga de devoluciones</h1>
            <p>Aprueba la devolución recibida para sumar inventario en el destino.</p>
          </div>
          <div class="dev-return-inline-actions">
            <button class="button button-ghost" type="button" data-dev-return-inbound-back ${state.devReturnInbound.approving ? "disabled" : ""}>
              Volver
            </button>
            <button
              class="button button-primary"
              type="button"
              data-dev-return-inbound-approve
              ${Number(detail.status || 0) === 0 && !state.devReturnInbound.approving ? "" : "disabled"}
            >
              ${state.devReturnInbound.approving ? "Aprobando..." : "Aprobar devolución"}
            </button>
          </div>
        </div>
        <section class="modern-card dev-return-inbound-detail-card">
          <div class="dev-return-detail-meta">
            <div><strong>Numero:</strong> ${escapeHtml(String(detail.numero || "-"))}</div>
            <div><strong>Envia:</strong> ${escapeHtml(detail.codigoEnvia || "-")}</div>
            <div><strong>Recibe:</strong> ${escapeHtml(detail.codigoRecibe || "-")}</div>
            <div><strong>Status:</strong> ${renderDevReturnSyncStatusChip(detail.statusNombre || "-")}</div>
            <div><strong>Fecha:</strong> ${escapeHtml(formatDateDisplay(detail.fecha))}</div>
            <div><strong>Observacion:</strong> ${escapeHtml(detail.observacion || "-")}</div>
          </div>
          ${renderDevReturnReadOnlyLines(detail.items || [], "Cantidad")}
        </section>
      </div>
    `;
  }

  return `
    <div class="modern-page transfer-import-page">
      ${renderDesktopBreadcrumb(["Procesos", "Carga de devoluciones"])}
      <div class="modern-page-header">
        <div>
          <h1>Carga de devoluciones</h1>
          <p>Estas devoluciones ya fueron registradas en origen y esperan aprobación del destino.</p>
        </div>
      </div>
      <section class="modern-card dev-return-board-card">
        <div class="panel-heading">
          <div>
            <h2>Pendientes del destino</h2>
            <p>${escapeHtml(String((state.devReturnInbound.items || []).length))} devolución(es) visibles.</p>
          </div>
          <button class="button button-ghost" type="button" data-dev-return-inbound-refresh ${state.devReturnInbound.loading ? "disabled" : ""}>
            ${state.devReturnInbound.loading ? "Actualizando..." : "Actualizar"}
          </button>
        </div>
        ${renderInboundDevReturnTable(state.devReturnInbound.items || [])}
      </section>
    </div>
  `;
}

function renderInboundDevReturnTable(items) {
  if (!items.length) {
    return `
      <div class="empty-state dev-return-mini-empty">
        <h3>Sin devoluciones por cargar</h3>
        <p>Cuando el origen registre una devolución aprobada, aparecerá aquí.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table dev-return-board-table">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Fecha</th>
            <th>Envia</th>
            <th>Status</th>
            <th>Total</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
              <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
              <td>${escapeHtml(item.codigoEnviaInfo?.nombre || item.codigoEnvia || "-")}</td>
              <td>${renderDevReturnSyncStatusChip(item.statusNombre || "-", Number(item.status || 0) === 0 ? "warning" : "success")}</td>
              <td>${escapeHtml(formatTransferAmount(item.totalValor))}</td>
              <td>
                <button
                  class="button button-ghost"
                  type="button"
                  data-dev-return-inbound-open="${escapeHtml(String(item.numero || ""))}"
                  data-dev-return-inbound-source="${escapeHtml(String(item.codigoEnvia || ""))}"
                >
                  Ver detalle
                </button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventoryAdjustmentWorkspace() {
  const draft = state.adjustments.draft || createEmptyAdjustmentDraft(state.adjustments.metadata);
  const isApproved = Number(draft.status) === 1;
  const isBusy = state.adjustments.saving || state.adjustments.approving || state.adjustments.loadingMetadata;
  const statusText = isApproved ? "APROBADA" : "PENDIENTE";

  return `
    <div class="modern-page transfer-register-page adjustment-page">
      ${renderDesktopBreadcrumb(["Procesos", "Ajuste de inventario"])}

      <div class="modern-page-header">
        <div>
          <h1>Ajuste de inventario</h1>
        </div>
      </div>

      <section class="transfer-register-shell adjustment-window">
        <form id="adjustment-form" class="transfer-register-form adjustment-form">
          <div class="transfer-command-bar adjustment-command-bar" role="toolbar" aria-label="Acciones de ajustes">
            <button class="transfer-command-button" type="button" data-adjustment-new ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">+</span>
              Crear
            </button>
            <button class="transfer-command-button" type="button" data-adjustment-open-lookup ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">B</span>
              Buscar
            </button>
            <button class="transfer-command-button transfer-command-primary" type="submit" ${isApproved || isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">G</span>
              ${state.adjustments.saving ? "Guardando" : "Guardar"}
            </button>
            <button
              class="transfer-command-button transfer-command-primary"
              type="button"
              data-adjustment-approve
              ${draft.numero && !isApproved && !isBusy ? "" : "disabled"}
            >
              <span class="transfer-command-icon">A</span>
              ${state.adjustments.approving ? "Aprobando" : "Aprobar"}
            </button>
            <button class="transfer-command-button" type="button" data-adjustment-exit ${isBusy ? "disabled" : ""}>
              <span class="transfer-command-icon">S</span>
              Salir
            </button>
          </div>

          <div class="adjustment-header-panel">
            <label class="adjustment-field adjustment-number-field">
              <span>Numero</span>
              <input type="text" name="numero" value="${escapeHtml(draft.numero ? String(draft.numero) : "")}" readonly />
            </label>
            <div class="adjustment-status ${isApproved ? "adjustment-status-approved" : "adjustment-status-pending"}">
              ${statusText}
            </div>
            <label class="adjustment-field adjustment-date-field">
              <span>Fecha</span>
              <input type="date" name="fecha" value="${escapeHtml(toInputValue(draft.fecha))}" ${isApproved ? "disabled" : ""} />
            </label>
            <label class="adjustment-field adjustment-type-field">
              <span>Tipo ajuste</span>
              <select name="tipo" ${isApproved ? "disabled" : ""}>
                ${renderAdjustmentTypeOptions(draft.tipo)}
              </select>
            </label>
            <label class="adjustment-field adjustment-lot-field">
              <span>Lote</span>
              <select name="idLote" ${isApproved ? "disabled" : ""}>
                ${renderAdjustmentLotOptions(draft.idLote)}
              </select>
            </label>
            <label class="adjustment-field adjustment-observation-field">
              <span>Observacion</span>
              <input name="observacion" maxlength="250" value="${escapeHtml(toInputValue(draft.observacion))}" ${isApproved ? "disabled" : ""} />
            </label>
          </div>

          <div class="adjustment-lines-panel">
            ${renderAdjustmentLinesEditor(draft, { isApproved })}
          </div>

          <div class="adjustment-summary-row">
            <label>
              <span>Cantidad:</span>
              <input type="text" value="${escapeHtml(formatTransferQuantity(computeAdjustmentDraftQuantity(draft)))}" readonly />
            </label>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderAdjustmentTypeOptions(selectedValue) {
  const tipos = Array.isArray(state.adjustments.metadata?.tiposAjuste)
    ? state.adjustments.metadata.tiposAjuste
    : [
        { tipo: "positivo", descripcion: "POSITIVO - SUMA" },
        { tipo: "negativo", descripcion: "NEGATIVO - RESTA" },
      ];

  return tipos
    .map((item) => {
      const value = String(item.tipo || "");
      return `
        <option value="${escapeHtml(value)}" ${String(selectedValue || "positivo") === value ? "selected" : ""}>
          ${escapeHtml(item.descripcion || value)}
        </option>
      `;
    })
    .join("");
}

function renderAdjustmentLotOptions(selectedValue) {
  const lotes = Array.isArray(state.adjustments.metadata?.lotes) ? state.adjustments.metadata.lotes : [];
  if (lotes.length === 0) {
    return `<option value="${escapeHtml(String(selectedValue || ""))}">S/DEFINIR</option>`;
  }

  return lotes
    .map((item) => {
      const value = String(item.id);
      const label = item.lote || item.descripcion || value;
      return `
        <option value="${escapeHtml(value)}" ${String(selectedValue || "") === value ? "selected" : ""}>
          ${escapeHtml(label)}
        </option>
      `;
    })
    .join("");
}

function renderAdjustmentLinesEditor(draft, { isApproved = false } = {}) {
  const rows = [...(draft.items || [])];
  while (rows.length < 15) {
    rows.push(createEmptyAdjustmentLineDraft());
  }

  return `
    <div class="adjustment-grid-wrap">
      <table class="adjustment-grid">
        <thead>
          <tr>
            <th class="adjustment-row-number"></th>
            <th>Codigo Barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((line, index) => `
              <tr data-adjustment-line-row="${index}">
                <td class="adjustment-row-number">${index + 1}</td>
                <td>
                  <input
                    name="codigoBarra"
                    data-adjustment-barcode-input="${index}"
                    value="${escapeHtml(toInputValue(line.codigoBarra))}"
                    maxlength="15"
                    ${isApproved ? "disabled" : ""}
                  />
                </td>
                <td>
                  <input name="referencia" value="${escapeHtml(toInputValue(line.referencia))}" readonly />
                </td>
                <td>
                  <input name="nombre" value="${escapeHtml(toInputValue(line.nombre))}" readonly />
                  <input type="hidden" name="costo" value="${escapeHtml(toInputValue(line.costo))}" />
                </td>
                <td>
                  <input
                    class="adjustment-quantity-input"
                    name="cantidad"
                    value="${escapeHtml(toInputValue(line.cantidad))}"
                    inputmode="decimal"
                    ${isApproved ? "disabled" : ""}
                  />
                </td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLoadTransferWorkspace() {
  if (hasLoadedTransferReceipt()) {
    return `
      <div class="modern-page transfer-import-detail-page">
        ${renderDesktopBreadcrumb(["Procesos", "Cargar transferencia", "Detalle"])}
        <div class="modern-page-header">
          <div>
            <h1>Importar transferencias de mercancia</h1>
            <p>Revisa la transferencia recibida y aplicala en inventario cuando los renglones esten correctos.</p>
          </div>
        </div>
        ${renderLoadedTransferReceiptPanel()}
      </div>
    `;
  }

  return `
    <div class="modern-page">
      ${renderDesktopBreadcrumb(["Procesos", "Cargar transferencia"])}

      <div class="modern-page-header">
        <div>
          <h1>Cargar transferencia</h1>
          <p>Busca transferencias llegadas para analizarlas, validarlas y aprobar su recepcion.</p>
        </div>
      </div>

      <section class="modern-card catalog-import-card">
        <form id="transfer-search-form" class="catalog-import-form">
          <div class="catalog-manual-grid">
            <label class="field">
              <span>Buscar</span>
              <input
                type="text"
                name="buscar"
                value="${escapeHtml(toInputValue(state.transfers.search?.buscar))}"
                maxlength="30"
                placeholder="Numero, origen, destino, documento"
              />
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status">
                <option value="" ${String(state.transfers.search?.status || "") === "" ? "selected" : ""}>Todos</option>
                <option value="0" ${String(state.transfers.search?.status || "") === "0" ? "selected" : ""}>No aprobada</option>
                <option value="1" ${String(state.transfers.search?.status || "") === "1" ? "selected" : ""}>Aprobada</option>
              </select>
            </label>
            <label class="field">
              <span>Limite</span>
              <input
                type="number"
                name="limit"
                min="1"
                max="100"
                step="1"
                value="${escapeHtml(toInputValue(state.transfers.search?.limit || "25"))}"
              />
            </label>
          </div>
          <div class="catalog-import-actions">
            <button class="button button-primary" type="submit" ${state.transfers.loadingList ? "disabled" : ""}>
              ${state.transfers.loadingList ? "Buscando..." : "Buscar transferencia"}
            </button>
            <button class="button button-ghost" type="button" data-clear-transfer-search ${state.transfers.loadingList ? "disabled" : ""}>
              Limpiar
            </button>
          </div>
        </form>
      </section>

      <section class="modern-card catalog-import-card">
        <div class="modern-card-head">
          <div>
            <h2>Resultados</h2>
            <p>${escapeHtml(String(state.transfers.items.length || 0))} documento(s) visibles.</p>
          </div>
          <div class="modern-chip">${state.transfers.loadingList ? "Buscando" : "Listas"}</div>
        </div>
        ${state.transfers.loadingList ? renderLoadingState("Buscando transferencias...") : renderTransfersTable()}
      </section>
    </div>
  `;
}

function hasLoadedTransferReceipt() {
  const draft = state.transfers.draft;
  return Boolean(
    draft?.numero &&
      state.currentView === "cargar-transferencia" &&
      Number(state.transfers.receiptNumero || 0) === Number(draft.numero || 0),
  );
}

function renderTransfersTable() {
  const items = Array.isArray(state.transfers.items) ? state.transfers.items : [];

  if (!items.length) {
    return `
      <div class="empty-state">
        <h3>Sin transferencias</h3>
        <p>No hay documentos registrados todavia. Usa el formulario para crear el primero.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Numero</th>
            <th>Fecha</th>
            <th>Envia</th>
            <th>Recibe</th>
            <th>Status</th>
            <th>Total</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map((item) => {
              const isSelected = Number(state.transfers.selectedNumero || 0) === Number(item.numero || 0);

              return `
                <tr class="${isSelected ? "is-selected-row" : ""}">
                  <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
                  <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
                  <td>${escapeHtml(item.codigoEnviaInfo?.nombre || item.codigoEnvia || "-")}</td>
                  <td>${escapeHtml(item.codigoRecibeInfo?.nombre || item.codigoRecibe || "-")}</td>
                  <td>${renderTransferStatusBadge(item.status)}</td>
                  <td>${escapeHtml(formatTransferAmount(item.totalValor))}</td>
                  <td>
                    <button class="button button-ghost" type="button" data-transfer-load-receipt="${escapeHtml(String(item.numero || ""))}">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLoadedTransferReceiptPanel() {
  const draft = state.transfers.draft;
  if (!hasLoadedTransferReceipt()) {
    return "";
  }

  const isBusy = state.transfers.loadingDetail || state.transfers.approving;
  const originName = draft.codigoEnviaNombre || draft.codigoEnvia || "-";
  const isLoaded = Boolean(draft.cargada);
  const loadedLabel = isLoaded ? "Cargada" : "Pendiente de carga";
  const lineCount = countTransferDraftLines(draft);
  const quantityTotal = formatTransferQuantity(computeTransferDraftQuantity(draft));
  const loadButtonLabel = isLoaded ? "Carga aplicada" : state.transfers.approving ? "Cargando" : "Cargar";
  const detailStatusText = Number(draft.status || 0) === 1 ? "APROBADA" : "PENDIENTE";

  return `
    <section class="transfer-register-shell transfer-import-window">
      <div class="transfer-register-form transfer-import-form">
        <div class="transfer-command-bar transfer-import-command-bar" role="toolbar" aria-label="Acciones de carga de transferencia">
        <button
          class="transfer-command-button transfer-command-primary"
          type="button"
          data-load-inbound-transfer
          ${!draft.numero || isBusy || isLoaded ? "disabled" : ""}
        >
          <span class="transfer-command-icon">C</span>
          ${loadButtonLabel}
        </button>
        <button class="transfer-command-button" type="button" data-clear-loaded-transfer ${isBusy ? "disabled" : ""}>
          <span class="transfer-command-icon">S</span>
          Salir
        </button>
        <span class="transfer-import-load-state">${escapeHtml(loadedLabel)}</span>
        </div>

        <div class="transfer-header-panel transfer-import-header">
          <label class="transfer-field transfer-number-field">
            <span>Numero</span>
            <input type="text" value="${escapeHtml(toDisplayValue(draft.numero))}" readonly />
          </label>
          <strong class="transfer-import-status">${escapeHtml(detailStatusText)}</strong>
          <label class="transfer-field">
            <span>Fecha</span>
            <input type="text" value="${escapeHtml(formatDateOnlyDisplay(draft.fecha))}" readonly />
          </label>
          <label class="transfer-field">
            <span>Fecha emision</span>
            <input type="text" value="${escapeHtml(formatDateOnlyDisplay(draft.fechaEmision || draft.fecha))}" readonly />
          </label>

          <label class="transfer-field transfer-import-origin">
            <span>Origen</span>
            <input type="text" value="${escapeHtml(originName)}" readonly />
          </label>

          <label class="transfer-field transfer-import-status-field">
            <span>Estado carga</span>
            <input type="text" value="${escapeHtml(loadedLabel)}" readonly />
          </label>

          <label class="transfer-field transfer-full-field">
            <span>Observacion</span>
            <input type="text" value="${escapeHtml(toInputValue(draft.observacion))}" readonly />
          </label>
        </div>

        <div class="transfer-lines-panel transfer-import-lines-panel">
          ${renderLoadedTransferLines(draft)}
        </div>

        <div class="transfer-summary-row transfer-import-summary">
          <strong>${isLoaded ? "Transferencia aplicada en inventario" : "Transferencia lista para cargar"}</strong>
          <label>
            Renglones:
            <input type="text" value="${escapeHtml(String(lineCount))}" readonly />
          </label>
          <label>
            Cantidad:
            <input type="text" value="${escapeHtml(quantityTotal)}" readonly />
          </label>
        </div>
      </div>
    </section>
  `;
}

function countTransferDraftLines(draft) {
  return (draft?.items || []).filter((item) => item.codigoBarra || item.referencia || item.articuloNombre).length;
}

function renderReadonlyTransferField(label, value) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="text" value="${escapeHtml(toDisplayValue(value))}" readonly />
    </label>
  `;
}

function renderLoadedTransferLines(draft) {
  const lines = (draft.items || []).filter((item) => item.codigoBarra || item.referencia || item.articuloNombre);
  const rows = lines.length >= 15 ? lines : [...lines, ...Array.from({ length: 15 - lines.length }, () => null)];

  if (!lines.length) {
    return `
      <div class="empty-state">
        <h3>Sin articulos</h3>
        <p>Esta transferencia no tiene renglones para recibir.</p>
      </div>
    `;
  }

  return `
    <div class="table-wrap">
      <table class="data-table transfer-import-lines-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Codigo barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Caja</th>
            <th>Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((line, index) =>
              line
                ? `
                <tr>
                  <td>${index + 1}</td>
                  <td><strong>${escapeHtml(line.codigoBarra || "-")}</strong></td>
                  <td>${escapeHtml(line.referencia || "-")}</td>
                  <td>${escapeHtml(line.articuloNombre || "-")}</td>
                  <td>${escapeHtml(toDisplayValue(line.numeroCaja))}</td>
                  <td>${escapeHtml(toDisplayValue(line.cantidad))}</td>
                </tr>
              `
                : `
                <tr class="transfer-import-empty-row">
                  <td>${index + 1}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTransferLinesEditor(draft, options = {}) {
  const { isLocked = false, allowReferenceEdit = false } = options;
  const lines = Array.isArray(draft.items) && draft.items.length > 0 ? draft.items : [createEmptyTransferLineDraft()];

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th></th>
            <th>Codigo barra</th>
            <th>Referencia</th>
            <th>Nombre</th>
            <th>Caja</th>
            <th>Cantidad</th>
            <th>Lote</th>
            <th>E</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (line, index) => `
                <tr data-transfer-line-row="${index}">
                  <td>${index + 1}</td>
                  <td>
                    <input
                      type="text"
                      name="codigoBarra"
                      data-transfer-barcode-input="${index}"
                      value="${escapeHtml(toInputValue(line.codigoBarra))}"
                      maxlength="15"
                      placeholder="Codigo"
                      ${isLocked ? "disabled" : ""}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      name="referencia"
                      value="${escapeHtml(toInputValue(line.referencia))}"
                      maxlength="30"
                      placeholder="Referencia"
                      ${allowReferenceEdit ? "" : "readonly"}
                      ${isLocked ? "disabled" : ""}
                    />
                  </td>
                  <td>
                    <span data-transfer-item-name>${escapeHtml(line.articuloNombre || line.nombre || "Pendiente")}</span>
                  </td>
                  <td>
                    <input
                      type="number"
                      name="numeroCaja"
                      min="0"
                      step="1"
                      value="${escapeHtml(toInputValue(line.numeroCaja || "0"))}"
                      ${isLocked ? "disabled" : ""}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      name="cantidad"
                      min="0.01"
                      step="0.01"
                      value="${escapeHtml(toInputValue(line.cantidad || "1"))}"
                      ${isLocked ? "disabled" : ""}
                    />
                  </td>
                  <td>
                    <span>${escapeHtml(resolveTransferLineLotLabel())}</span>
                  </td>
                  <td>
                    <span data-transfer-line-existence>${escapeHtml(toInputValue(line.existenciaLote || line.existenciaActual || ""))}</span>
                  </td>
                  <td>
                    <button
                      class="button button-danger"
                      type="button"
                      data-transfer-remove-line="${index}"
                      ${isLocked ? "disabled" : ""}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTransferLocationOptions(items, selectedValue = "") {
  const options = items.map((item) => ({
    value: String(item.codigo || ""),
    label: item.nombre || item.codigo || "Sin nombre",
  }));

  if (selectedValue && !options.some((item) => item.value === selectedValue)) {
    options.push({
      value: selectedValue,
      label: selectedValue,
    });
  }

  return [
    `<option value="">Selecciona sucursal</option>`,
    ...options.map(
      (item) => `
        <option value="${escapeHtml(item.value)}" ${String(selectedValue || "") === item.value ? "selected" : ""}>
          ${escapeHtml(item.label)}
        </option>
      `,
    ),
  ].join("");
}

function renderTransferDispatchOptions(items, selectedValue) {
  const options = items.map((item) => ({
    value: String(item.id),
    label: `${item.id} - ${item.descripcion || "Sin descripcion"}`,
  }));

  if (!options.length) {
    options.push({
      value: selectedValue || "0",
      label: "0 - Sin definir",
    });
  }

  return renderSelectOptions(options, selectedValue || "0");
}

function renderTransferStatusBadge(status) {
  const numericStatus = Number(status || 0);
  const label = numericStatus === 1 ? "Aprobada" : "No aprobada";
  return `<span class="modern-chip">${escapeHtml(label)}</span>`;
}

function renderSucursalesWorkspace() {
  const draft = state.sucursales.draft || createEmptySucursalDraft();
  const isSaving = state.sucursales.saving;
  const isDeleting = state.sucursales.deleting;
  const isBusy = isSaving || isDeleting;

  return `
    <div class="modern-page sucursales-page">
      ${renderDesktopBreadcrumb(["Archivos", "Inventario", "Sucursales"])}

      <div class="modern-page-header">
        <div>
          <h1>Sucursales</h1>
          <p>Administra tiendas y bodegas con el formato operativo del sistema.</p>
        </div>
      </div>

      <div class="sucursal-command-bar" role="toolbar" aria-label="Acciones de sucursales">
        <button class="sucursal-command-button" type="button" data-new-sucursal ${isBusy ? "disabled" : ""}>
          <span class="sucursal-command-icon">+</span>
          Crear
        </button>
        <button class="sucursal-command-button sucursal-command-primary" type="submit" form="sucursal-form" ${isBusy ? "disabled" : ""}>
          <span class="sucursal-command-icon">G</span>
          ${isSaving ? "Guardando" : "Guardar"}
        </button>
        <button class="sucursal-command-button" type="button" data-sucursal-exit ${isBusy ? "disabled" : ""}>
          <span class="sucursal-command-icon">S</span>
          Salir
        </button>
      </div>

      <div class="sucursal-layout">
        <section class="modern-card modern-card-list sucursal-list-card">
          <div class="modern-card-head">
            <div>
              <h2>Sucursales registradas</h2>
              <p>${escapeHtml(String(state.sucursales.items.length || 0))} registro(s) visibles.</p>
            </div>
            <div class="modern-chip">${state.sucursales.loading ? "Cargando" : "Listas"}</div>
          </div>
          <div class="sucursal-search-row">
            <label class="field">
              <span>Buscar</span>
              <input
                type="search"
                name="sucursalBuscar"
                data-sucursal-search
                value="${escapeHtml(toInputValue(state.sucursales.search))}"
                placeholder="Codigo, nombre, telefono o direccion"
              />
            </label>
            <button class="button button-ghost" type="button" data-refresh-sucursales ${state.sucursales.loading || isBusy ? "disabled" : ""}>
              ${state.sucursales.loading ? "Actualizando..." : "Actualizar"}
            </button>
          </div>
          ${state.sucursales.loading ? renderLoadingState("Cargando sucursales...") : renderSucursalesTable()}
        </section>

        <aside class="modern-card modern-card-editor sucursal-form-card">
          <form id="sucursal-form" class="sucursal-editor-form">
            <div class="sucursal-form-title">
              <div>
                <span class="article-editor-eyebrow">Datos</span>
                <h2>${draft.codigo ? `Sucursal ${escapeHtml(String(draft.codigo))}` : "Nueva sucursal"}</h2>
              </div>
              ${renderSucursalStatusBadge(draft.status)}
            </div>

            <div class="sucursal-data-panel">
              <label class="sucursal-field-row sucursal-field-code">
                <span>Codigo</span>
                <input
                  type="text"
                  name="codigo"
                  value="${escapeHtml(toInputValue(draft.codigo))}"
                  maxlength="15"
                  placeholder="Automatico"
                />
              </label>

              <label class="sucursal-field-row">
                <span>Nombre</span>
                <input
                  type="text"
                  name="nombre"
                  value="${escapeHtml(toInputValue(draft.nombre))}"
                  maxlength="80"
                  placeholder="Nombre de tienda o bodega"
                />
              </label>

              <label class="sucursal-field-row sucursal-field-phone">
                <span>Telefono</span>
                <input
                  type="text"
                  name="telefono"
                  value="${escapeHtml(toInputValue(draft.telefono))}"
                  maxlength="30"
                  placeholder="Telefono"
                />
              </label>

              <label class="sucursal-field-row sucursal-field-address">
                <span>Direccion</span>
                <textarea name="direccion" rows="3" maxlength="120" placeholder="Direccion">${escapeHtml(toInputValue(draft.direccion))}</textarea>
              </label>

              <label class="sucursal-checkbox-row">
                <input type="checkbox" name="exentaImpuesto" disabled />
                <span>Exenta de impuesto</span>
              </label>

              <label class="sucursal-percentage-row">
                <span>Porcentaje de redondeo</span>
                <input
                  type="number"
                  name="porcentajeDeRedondeo"
                  min="0"
                  step="0.0001"
                  value="${escapeHtml(toInputValue(draft.porcentajeDeRedondeo))}"
                  placeholder="0"
                />
              </label>

              <fieldset class="sucursal-status-row">
                <legend>Status</legend>
                <label>
                  <input type="radio" name="status" value="1" ${String(draft.status ?? "1") === "1" ? "checked" : ""} />
                  Activo
                </label>
                <label>
                  <input type="radio" name="status" value="0" ${String(draft.status ?? "1") === "0" ? "checked" : ""} />
                  Inactivo
                </label>
              </fieldset>

              <div class="sucursal-form-footer">
                <button class="button button-ghost" type="button" data-sucursal-reset ${isBusy ? "disabled" : ""}>
                  Limpiar campos
                </button>
              </div>
            </div>
          </form>
        </aside>
      </div>
    </div>
  `;
}

function renderSucursalesTable() {
  const items = Array.isArray(state.sucursales.items) ? state.sucursales.items : [];
  const search = normalizeSearchText(state.sucursales.search);
  const visibleItems = search
    ? items.filter((item) =>
        normalizeSearchText(
          `${item.codigo || ""} ${item.nombre || ""} ${item.telefono || ""} ${item.direccion || ""}`,
        ).includes(search),
      )
    : items;

  if (!visibleItems.length) {
    return `
      <div class="empty-state">
        <h3>Sin sucursales</h3>
        <p>${search ? "No hay resultados para la busqueda actual." : "No hay tiendas o bodegas registradas todavia."}</p>
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
            <th>Telefono</th>
            <th>Status</th>
            <th>Redondeo</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>
          ${visibleItems
            .map((item) => {
              const isSelected = String(state.sucursales.selectedCodigo || "") === String(item.codigo || "");

              return `
                <tr class="${isSelected ? "is-selected-row" : ""}">
                  <td><strong>${escapeHtml(item.codigo || "-")}</strong></td>
                  <td>${escapeHtml(item.nombre || "-")}</td>
                  <td>${escapeHtml(item.telefono || "-")}</td>
                  <td>${renderSucursalStatusBadge(item.status)}</td>
                  <td>${escapeHtml(formatTransferAmount(item.porcentajeDeRedondeo || 0))}</td>
                  <td class="sucursal-row-actions">
                    <button class="button button-ghost" type="button" data-sucursal-select="${escapeHtml(item.codigo || "")}">
                      Abrir
                    </button>
                    <button
                      class="button button-danger"
                      type="button"
                      data-delete-sucursal="${escapeHtml(item.codigo || "")}"
                      ${state.sucursales.deleting ? "disabled" : ""}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderSucursalStatusBadge(status) {
  const numericStatus = Number(status ?? 1);
  return `<span class="modern-chip">${numericStatus === 0 ? "Cerrada" : "Abierta"}</span>`;
}

function renderLoadingState(message) {
  return `
    <div class="empty-state">
      <h3>${escapeHtml(message)}</h3>
      <p>Espera un momento mientras sincronizamos la informacion.</p>
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
          <p>Resumen ejecutivo del sistema RockyMax para administracion de articulos e inventario.</p>
        </div>
        <div class="modern-page-actions">
          <button class="button button-primary" type="button" data-menu-view="articulos">
            Abrir articulos
          </button>
        </div>
      </div>

      ${renderExecutiveCards()}

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

function renderSystemFooter() {
  const host = window.location.hostname || "127.0.0.1";

  return `
    <footer class="modern-system-footer">
      <div class="modern-system-footer-main">
        <span class="modern-system-footer-eyebrow">Sistema Operativo</span>
        <strong>RockyMax - Rocky Maxx</strong>
        <span>Usuario ${escapeHtml((state.user?.codUsuario || "admin").toUpperCase())} | Version 2.0.1</span>
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

  if (["articulos", "existencia", "tallas", "colores", "fabricantes", "marcas", "categorias"].includes(view)) {
    return ["Archivos", "Inventario", getDesktopViewLabelV2(view)];
  }

  if (["clientes", "sucursales", "personal"].includes(view)) {
    return ["Archivos", "Inventario", getDesktopViewLabelV2(view)];
  }

  if (view === "reportes") {
    return ["Reportes", "General"];
  }

  if (view === "transferencias" || view === "registro-transferencia") {
    return ["Procesos", "Transferencias", "Registro de transferencias"];
  }

  if (view === "cargar-transferencia") {
    return ["Procesos", "Transferencias", "Carga de transferencias"];
  }

  if (view === "ajuste-inventario") {
    return ["Procesos", "Ajuste de inventario"];
  }

  if (view === "borrador-devoluciones") {
    return ["Procesos", "Borrador devoluciones"];
  }

  if (view === "registro-devoluciones") {
    return ["Procesos", "Transferencias", "Registro de devoluciones"];
  }

  if (view === "cargar-devoluciones") {
    return ["Procesos", "Transferencias", "Carga de devoluciones"];
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
    existencia: "Existencia",
    tallas: "Tallas",
    colores: "Colores",
    fabricantes: "Fabricantes",
    marcas: "Marcas",
    categorias: "Categorias",
    clientes: "Clientes",
    sucursales: "Sucursales",
    personal: "Personal",
    transferencias: "Transferencias",
    "registro-transferencia": "Registro de transferencias",
    "cargar-transferencia": "Carga de transferencias",
    "ajuste-inventario": "Ajuste de inventario",
    "borrador-devoluciones": "Borrador devoluciones",
    "registro-devoluciones": "Registro de devoluciones",
    "cargar-devoluciones": "Carga de devoluciones",
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

function capitalize(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function formatDateDisplay(value) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatDateOnlyDisplay(value) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function toDisplayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return String(value);
}

function formatTransferAmount(value) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toFiniteNumber(value));
}

function formatInventoryNumeric(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return formatTransferAmount(value);
}

function formatInventoryBoolean(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return Number(value) === 1 || value === true ? "Si" : "No";
}

function formatInventoryDate(value) {
  if (!value) {
    return "-";
  }

  return formatDateDisplay(value);
}

function formatInventoryCatalogLabel(value) {
  if (!value) {
    return "-";
  }

  const parts = [value.codigo, value.nombre].filter(Boolean);
  return parts.length ? parts.join(" - ") : "-";
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
          placeholder="Codigo, nombre, referencia, familia"
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
  const activeTab = state.articleEditorTab || "general";
  const promotionActive = Boolean(draft.precios.promocionActiva);
  const taxOptions = state.metadata?.catalogos?.impuestos || [];
  const brandOptions = state.metadata?.catalogos?.marcas || [];
  const canDelete = state.formMode === "edit" && Boolean(state.activeArticleCode);
  const isDeletingCurrent = Boolean(state.deletingCode) && state.deletingCode === state.activeArticleCode;
  const canCreateArticles = userCanCreateArticlesInCurrentInstance();
  const creatingBlocked = state.formMode !== "edit" && !canCreateArticles;

  if (state.loadingForm) {
    return `
      <div class="empty-state">
        <h3>Cargando articulo</h3>
        <p>Estamos trayendo la informacion completa del registro seleccionado.</p>
      </div>
    `;
  }

  return `
    <div class="article-commandbar">
      <div class="article-commandbar-copy">
        <h2>Articulo</h2>
        <p>${
          canCreateArticles
            ? "Edita la informacion, variantes y precios del producto."
            : "En esta instancia puedes consultar y editar articulos existentes. Los nuevos solo se crean en la bodega principal."
        }</p>
      </div>
      <div class="article-commandbar-actions">
        <button class="article-command-button" type="button" data-toolbar-new ${state.submittingForm || !canCreateArticles ? "disabled" : ""}>
          Nuevo
        </button>
        <button class="article-command-button" type="button" data-toolbar-search ${state.submittingForm ? "disabled" : ""}>
          Buscar
        </button>
        <button
          class="article-command-button"
          type="button"
          data-delete-current
          ${canDelete ? "" : "disabled"}
          ${isDeletingCurrent ? "disabled" : ""}
        >
          ${isDeletingCurrent ? "Eliminando..." : "Eliminar"}
        </button>
        <button class="article-command-button" type="button" data-toolbar-print>
          Imprimir
        </button>
        <button class="article-command-button" type="button" data-toolbar-close>
          Cerrar
        </button>
        <button
          class="article-command-button article-command-button-primary"
          type="submit"
          form="article-form"
          ${state.submittingForm || creatingBlocked ? "disabled" : ""}
        >
          ${state.submittingForm ? "Guardando..." : creatingBlocked ? "Solo principal" : "Guardar"}
        </button>
      </div>
    </div>

    <form id="article-form" class="article-form">
      <div class="article-editor-shell">
        <div class="article-editor-topbar">
          <label class="field">
            <span>Referencia</span>
            <input
              type="text"
              name="referencia"
              value="${escapeHtml(draft.referencia)}"
              placeholder="Ingresa la referencia"
            />
          </label>
          <label class="field">
            <span>Marca</span>
            ${renderScrollableCatalogInput("marca", draft.general.marca, brandOptions, "Marca")}
          </label>
        </div>

        <div class="article-editor-tabs" role="tablist" aria-label="Secciones del articulo">
          ${renderArticleEditorTab("general", "General", activeTab)}
          ${renderArticleEditorTab("variantes", "Tallas - Colores", activeTab)}
          ${renderArticleEditorTab("precios", "Precios", activeTab)}
        </div>

        <section class="article-editor-panel">
          ${
            activeTab === "general"
              ? renderArticleGeneralPanel(draft)
              : activeTab === "variantes"
                ? renderArticleVariantsPanel(draft)
                : renderArticlePricesPanel(draft, promotionActive, taxOptions)
          }
        </section>
      </div>
    </form>
  `;
}

function renderArticleLookupModal() {
  if (!state.articleLookup.open) {
    return "";
  }

  const totalLabel = state.articleLookup.loading
    ? "Cargando registros..."
    : `Catalogo (${escapeHtml(String(state.articleLookup.items.length))} Registros)`;

  return `
    <div class="article-lookup-overlay">
      <button class="article-lookup-backdrop" type="button" data-lookup-close aria-label="Cerrar buscador"></button>
      <section class="article-lookup-dialog" role="dialog" aria-modal="true" aria-labelledby="article-lookup-title">
        <div class="article-lookup-header">
          <div class="article-lookup-header-copy">
            <p class="eyebrow">Buscador</p>
            <h3 id="article-lookup-title">${totalLabel}</h3>
            <p>Haz clic sobre un articulo para cargarlo en el formulario actual.</p>
          </div>
          <div class="article-lookup-header-actions">
            <span class="article-lookup-count">
              ${state.articleLookup.loading ? "Cargando..." : `${escapeHtml(String(state.articleLookup.items.length))} registros`}
            </span>
            <button class="article-command-button" type="button" data-lookup-refresh ${state.articleLookup.loading ? "disabled" : ""}>
              Actualizar
            </button>
            <button class="article-command-button" type="button" data-lookup-close>
              Cerrar
            </button>
          </div>
        </div>

        ${
          state.articleLookup.loading
            ? `
              <div class="empty-state article-lookup-empty">
                <h3>Cargando articulos</h3>
                <p>Estamos trayendo el listado completo para que puedas buscar y seleccionar uno.</p>
              </div>
            `
            : state.articleLookup.items.length === 0
              ? `
                <div class="empty-state article-lookup-empty">
                  <h3>Sin articulos</h3>
                  <p>Todavia no hay articulos creados para mostrar en este buscador.</p>
                </div>
              `
              : `
                <div class="table-wrap article-lookup-table-wrap">
                  <table class="data-table article-lookup-table">
                    <thead>
                      <tr>
                        <th>CodigoBarra</th>
                        <th>Referencia</th>
                        <th>CodigoMarca</th>
                        <th>CodigoFamilia</th>
                        <th>Talla</th>
                        <th>Nombre</th>
                        <th>Accion</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${state.articleLookup.items.map(renderArticleLookupRow).join("")}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>
    </div>
  `;
}

function renderArticleLookupRow(article) {
  const referencia = article.referencia || article.codigoBarraAnt || article.codigoBarra || "-";
  const codigoMarca = article.general?.marca?.codigo || "-";
  const codigoFamilia = article.general?.familia || "-";
  const talla = article.tallasColores?.talla?.codigo || "-";
  const nombre = article.general?.nombre || "Sin nombre";

  return `
    <tr class="article-lookup-row" data-lookup-select-code="${escapeHtml(article.codigoBarra)}">
      <td><strong>${escapeHtml(article.codigoBarra || "-")}</strong></td>
      <td>${escapeHtml(referencia)}</td>
      <td>${escapeHtml(codigoMarca)}</td>
      <td>${escapeHtml(codigoFamilia)}</td>
      <td>${escapeHtml(talla)}</td>
      <td>${escapeHtml(nombre)}</td>
      <td>
        <button
          class="article-command-button article-lookup-edit-button"
          type="button"
          data-lookup-edit-code="${escapeHtml(article.codigoBarra)}"
        >
          Editar
        </button>
      </td>
    </tr>
  `;
}

function renderTransferLookupModal() {
  if (!state.transferLookup.open) {
    return "";
  }

  const items = Array.isArray(state.transferLookup.items) ? state.transferLookup.items : [];
  const totalLabel = state.transferLookup.loading
    ? "Cargando registros..."
    : `Catalogo (${escapeHtml(String(items.length))} Registros)`;

  return `
    <div class="article-lookup-overlay transfer-lookup-overlay">
      <button class="article-lookup-backdrop" type="button" data-transfer-lookup-close aria-label="Cerrar catalogo"></button>
      <section class="article-lookup-dialog transfer-lookup-dialog" role="dialog" aria-modal="true" aria-labelledby="transfer-lookup-title">
        <div class="article-lookup-header transfer-lookup-header">
          <div class="article-lookup-header-copy">
            <p class="eyebrow">Transferencias</p>
            <h3 id="transfer-lookup-title">${totalLabel}</h3>
            <p>Haz clic sobre una transferencia para cargarla en el registro.</p>
          </div>
          <div class="article-lookup-header-actions">
            <span class="article-lookup-count">
              ${state.transferLookup.loading ? "Cargando..." : `${escapeHtml(String(items.length))} registros`}
            </span>
            <button class="article-command-button" type="button" data-transfer-lookup-refresh ${state.transferLookup.loading ? "disabled" : ""}>
              Actualizar
            </button>
            <button class="article-command-button" type="button" data-transfer-lookup-close>
              Cerrar
            </button>
          </div>
        </div>

        ${
          state.transferLookup.loading
            ? `
              <div class="empty-state article-lookup-empty">
                <h3>Cargando transferencias</h3>
                <p>Estamos trayendo transferencias guardadas y aprobadas.</p>
              </div>
            `
            : items.length === 0
              ? `
                <div class="empty-state article-lookup-empty">
                  <h3>Sin transferencias</h3>
                  <p>No hay transferencias para mostrar en este catalogo.</p>
                </div>
              `
              : `
                <div class="table-wrap article-lookup-table-wrap transfer-lookup-table-wrap">
                  <table class="data-table article-lookup-table transfer-lookup-table">
                    <thead>
                      <tr>
                        <th>Numero</th>
                        <th>Fecha</th>
                        <th>Nombre</th>
                        <th>Observacion</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(renderTransferLookupRow).join("")}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>
    </div>
  `;
}

function renderAdjustmentLookupModal() {
  if (!state.adjustmentLookup.open) {
    return "";
  }

  const items = Array.isArray(state.adjustmentLookup.items) ? state.adjustmentLookup.items : [];
  const totalLabel = state.adjustmentLookup.loading
    ? "Cargando ajustes..."
    : `Catalogo (${escapeHtml(String(items.length))} Registros)`;

  return `
    <div class="article-lookup-overlay adjustment-lookup-overlay">
      <button class="article-lookup-backdrop" type="button" data-adjustment-lookup-close aria-label="Cerrar catalogo"></button>
      <section class="article-lookup-dialog adjustment-lookup-dialog" role="dialog" aria-modal="true" aria-labelledby="adjustment-lookup-title">
        <div class="article-lookup-header adjustment-lookup-header">
          <div class="article-lookup-header-copy">
            <p class="eyebrow">Ajustes</p>
            <h3 id="adjustment-lookup-title">${totalLabel}</h3>
            <p>Haz clic sobre un ajuste guardado o aprobado para cargarlo en el formulario.</p>
          </div>
          <div class="article-lookup-header-actions">
            <span class="article-lookup-count">
              ${state.adjustmentLookup.loading ? "Cargando..." : `${escapeHtml(String(items.length))} registros`}
            </span>
            <button class="article-command-button" type="button" data-adjustment-lookup-refresh ${state.adjustmentLookup.loading ? "disabled" : ""}>
              Actualizar
            </button>
            <button class="article-command-button" type="button" data-adjustment-lookup-close>
              Cerrar
            </button>
          </div>
        </div>

        ${
          state.adjustmentLookup.loading
            ? `
              <div class="empty-state article-lookup-empty">
                <h3>Cargando ajustes</h3>
                <p>Estamos trayendo ajustes guardados y aprobados.</p>
              </div>
            `
            : items.length === 0
              ? `
                <div class="empty-state article-lookup-empty">
                  <h3>Sin ajustes</h3>
                  <p>No hay ajustes para mostrar en este catalogo.</p>
                </div>
              `
              : `
                <div class="table-wrap article-lookup-table-wrap adjustment-lookup-table-wrap">
                  <table class="data-table article-lookup-table adjustment-lookup-table">
                    <thead>
                      <tr>
                        <th>Numero</th>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Observacion</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(renderAdjustmentLookupRow).join("")}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>
    </div>
  `;
}

function renderAdjustmentLookupRow(item) {
  const isApproved = Number(item.status || 0) === 1;

  return `
    <tr class="adjustment-lookup-row ${isApproved ? "adjustment-lookup-row-approved" : "adjustment-lookup-row-pending"}" data-adjustment-lookup-select="${escapeHtml(String(item.numero || ""))}">
      <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
      <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
      <td>${escapeHtml(item.tipo === "negativo" ? "NEGATIVO - RESTA" : "POSITIVO - SUMA")}</td>
      <td>${escapeHtml(item.observacion || "-")}</td>
      <td>${renderAdjustmentLookupStatusBadge(item.status)}</td>
    </tr>
  `;
}

function renderAdjustmentLookupStatusBadge(status) {
  return `<span class="modern-chip">${Number(status || 0) === 1 ? "Aprobada" : "Pendiente"}</span>`;
}

function renderTransferLookupRow(item) {
  const nombre = item.codigoRecibeInfo?.nombre || item.codigoRecibe || "-";
  const isApproved = Number(item.status || 0) === 1;

  return `
    <tr class="transfer-lookup-row ${isApproved ? "transfer-lookup-row-approved" : "transfer-lookup-row-pending"}" data-transfer-lookup-select="${escapeHtml(String(item.numero || ""))}">
      <td><strong>${escapeHtml(String(item.numero || "-"))}</strong></td>
      <td>${escapeHtml(formatDateDisplay(item.fecha))}</td>
      <td>${escapeHtml(nombre)}</td>
      <td>${escapeHtml(item.observacion || "-")}</td>
      <td>${renderTransferStatusBadge(item.status)}</td>
    </tr>
  `;
}

function renderArticleEditorTab(key, label, activeTab) {
  const isActive = key === activeTab;

  return `
    <button
      class="article-editor-tab ${isActive ? "article-editor-tab-active" : ""}"
      type="button"
      data-editor-tab="${key}"
      aria-pressed="${isActive ? "true" : "false"}"
    >
      ${label}
    </button>
  `;
}

function getCatalogOptionLabels(items) {
  const labels = [];
  const seen = new Set();

  for (const item of items || []) {
    const label = String(item?.nombre || item?.codigo || "").trim();
    if (!label) {
      continue;
    }

    const key = label.toUpperCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    labels.push(label);
  }

  return labels;
}

function renderScrollableCatalogInput(fieldName, value, options, placeholder, required = false) {
  const optionLabels = getCatalogOptionLabels(options);
  const normalizedValue = String(value || "").trim().toUpperCase();

  return `
    <div class="catalog-combobox" data-catalog-combobox="${fieldName}">
      <div class="catalog-combobox-control">
        <input
          type="text"
          name="${fieldName}"
          value="${escapeHtml(value)}"
          placeholder="${escapeHtml(placeholder)}"
          autocomplete="off"
          data-catalog-input="${fieldName}"
          aria-expanded="false"
          ${required ? "required" : ""}
        />
        <button
          class="catalog-combobox-toggle"
          type="button"
          data-catalog-toggle="${fieldName}"
          aria-label="Mostrar opciones de ${escapeHtml(fieldName)}"
        >
          <span>&#9662;</span>
        </button>
      </div>
      <div class="catalog-combobox-menu" data-catalog-menu="${fieldName}">
        ${
          optionLabels.length > 0
            ? optionLabels
                .map((label) => {
                  const isSelected = normalizedValue === label.toUpperCase();

                  return `
                    <button
                      class="catalog-combobox-option ${isSelected ? "catalog-combobox-option-active" : ""}"
                      type="button"
                      data-catalog-option="${fieldName}"
                      data-catalog-value="${escapeHtml(label)}"
                    >
                      ${escapeHtml(label)}
                    </button>
                  `;
                })
                .join("")
            : `<div class="catalog-combobox-empty">No hay opciones disponibles.</div>`
        }
      </div>
    </div>
  `;
}

function renderArticleGeneralPanel(draft) {
  const categoryOptions = state.metadata?.catalogos?.categorias || [];
  const manufacturerOptions = state.metadata?.catalogos?.fabricantes || [];

  return `
    <div class="section-title">
      <strong>General</strong>
      <small>Categoria, fabricante, nombre, recorte, familia, nota, tipo y status.</small>
    </div>
    <div class="form-grid">
      <label class="field field-span-2">
        <span>Categoria</span>
        ${renderScrollableCatalogInput("categoria", draft.general.categoria, categoryOptions, "Categoria", true)}
        </label>
        <label class="field">
          <span>Fabricante</span>
          ${renderScrollableCatalogInput("fabricante", draft.general.fabricante, manufacturerOptions, "Fabricante", true)}
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
  `;
}

function renderArticleVariantsPanel(draft) {
  const sizeOptions = state.metadata?.catalogos?.tallas || [];
  const colorOptions = state.metadata?.catalogos?.colores || [];

  return `
    <div class="section-title">
      <strong>Tallas - Colores</strong>
      <small>Configura las variantes visuales y de medida del articulo.</small>
    </div>
    <div class="form-grid">
      <label class="field field-span-2">
        <span>Codigo de barra</span>
        <input
          type="text"
          name="codigoBarra"
          value="${escapeHtml(draft.codigoBarra)}"
          placeholder="Ingresa el codigo de barra"
          required
        />
      </label>
      <label class="field">
        <span>Talla</span>
        ${renderScrollableCatalogInput("talla", draft.tallasColores.talla, sizeOptions, "Talla", true)}
      </label>
      <label class="field">
        <span>Colores</span>
        ${renderScrollableCatalogInput("colores", draft.tallasColores.colores, colorOptions, "Color", true)}
      </label>
      <div class="article-editor-note field-span-2">
        <strong>Vista actual</strong>
        <span data-article-current-view>
          ${escapeHtml(draft.tallasColores.talla || "Sin talla")} /
          ${escapeHtml(draft.tallasColores.colores || "Sin color")}
        </span>
      </div>
    </div>
  `;
}

function renderArticlePricesPanel(draft, promotionActive, taxOptions) {
  const promoMessage = promotionActive
    ? "Promocion activa: completa descuento o precio con rango de fechas."
    : "Promocion inactiva: el precio promocional no se aplicara.";

  return `
    <div class="section-title">
      <strong>Precios</strong>
      <small>Impuesto, detal, mayor, afiliado y configuracion de promocion.</small>
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
          type="date"
          name="promocionDesde"
          value="${escapeHtml(draft.precios.desde)}"
          ${promotionActive ? "" : "disabled"}
        />
      </label>
      <label class="field">
        <span>Hasta</span>
        <input
          type="date"
          name="promocionHasta"
          value="${escapeHtml(draft.precios.hasta)}"
          ${promotionActive ? "" : "disabled"}
        />
      </label>
    </div>
  `;
}

function bindLoginEvents() {
  const form = document.getElementById("login-form");
  if (!form) {
    return;
  }

  const passwordInput = form.elements.password;
  const togglePasswordButton = form.querySelector("[data-action='toggle-password']");
  const forgotPasswordButton = form.querySelector("[data-action='forgot-password']");

  form.addEventListener("input", () => {
    state.loginDraft = readLoginDraft(form);
  });

  togglePasswordButton?.addEventListener("click", () => {
    if (!(passwordInput instanceof HTMLInputElement)) {
      return;
    }

    const isVisible = passwordInput.type === "text";
    passwordInput.type = isVisible ? "password" : "text";
    togglePasswordButton.setAttribute("aria-pressed", String(!isVisible));
    togglePasswordButton.setAttribute("aria-label", isVisible ? "Mostrar clave" : "Ocultar clave");
    togglePasswordButton.classList.toggle("login-toggle-password-active", !isVisible);
  });

  forgotPasswordButton?.addEventListener("click", () => {
    setFlash("Solicita al administrador el reinicio o cambio de tu clave.", "info");
    render();
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
        state.navigation.menuPinned = false;
        render();
      }
    });
  }

  document.querySelector(".modern-nav")?.addEventListener("mouseleave", () => {
    if (!state.navigation.openMenu || state.navigation.menuPinned) {
      return;
    }

    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    render();
  });

  document.querySelectorAll(".modern-menu-item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      const button = item.querySelector("[data-menu]");
      const menu = button?.getAttribute("data-menu") || "";
      if (!menu || state.navigation.openMenu === menu) {
        return;
      }

      const keepPinned = state.navigation.menuPinned;
      state.navigation.openMenu = menu;
      state.navigation.openSubmenu = "";
      state.navigation.menuPinned = keepPinned;
      render();
    });
  });

  document.querySelectorAll("[data-menu]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const menu = button.getAttribute("data-menu") || "";
      const shouldClose = state.navigation.openMenu === menu && state.navigation.menuPinned;

      state.navigation.openMenu = shouldClose ? "" : menu;
      state.navigation.openSubmenu = "";
      state.navigation.menuPinned = !shouldClose;
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

      state.navigation.openMenu = button.getAttribute("data-submenu-owner") || "archivos";
      state.navigation.openSubmenu = state.navigation.openSubmenu === submenu ? "" : submenu;
      state.navigation.menuPinned = true;
      render();
    });
  });

  document.querySelectorAll("[data-menu-view]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const nextView = button.getAttribute("data-menu-view") || "articulos";
      state.currentView = nextView;
      state.navigation.openMenu = "";
      state.navigation.openSubmenu = "";
      state.navigation.menuPinned = false;
      render();

      if (isCatalogImportView(nextView)) {
        await loadCatalogImportItems(nextView);
        return;
      }

      if (nextView === "articulos" && userCanAccessFullInventory()) {
        await loadCreationMetadata();
        return;
      }

      if (nextView === "existencia" && userCanAccessFullInventory()) {
        await loadInventoryExistenceWorkspace();
        return;
      }

      if (nextView === "roles") {
        await loadRoleAccess();
        return;
      }

      if (nextView === "transferencias" || nextView === "registro-transferencia") {
        await loadTransfersMetadata();
        return;
      }

      if (nextView === "borrador-devoluciones") {
        await loadDevReturnsModule();
        return;
      }

      if (nextView === "registro-devoluciones") {
        await loadDevReturnRecords();
        return;
      }

      if (nextView === "cargar-devoluciones") {
        await loadInboundDevReturns();
        return;
      }

      if (nextView === "cargar-transferencia") {
        await loadTransfers();
        return;
      }

      if (nextView === "ajuste-inventario") {
        await loadAdjustmentsMetadata();
        return;
      }

      if (nextView === "sucursales") {
        await loadSucursales();
      }
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
    button.addEventListener("click", async () => {
      state.currentView = "articulos";
      if (userCanCreateArticlesInCurrentInstance()) {
        resetArticleForm();
      }
      render();

      if (userCanAccessFullInventory()) {
        await loadCreationMetadata();
      }
    });
  });

  document.querySelector("[data-refresh]")?.addEventListener("click", async () => {
    await refreshDashboard();
  });

  document.querySelector("[data-refresh-catalogs]")?.addEventListener("click", async () => {
    if (isCatalogImportView(state.currentView)) {
      await loadCatalogImportItems(state.currentView);
      return;
    }

    await loadCreationMetadata();
  });

  document.querySelector("[data-refresh-role-access]")?.addEventListener("click", async () => {
    await loadRoleAccess();
  });

  bindArticleEvents();
  bindInventoryExistenceEvents();
  bindTransferEvents();
  bindDevReturnEvents();
  bindAdjustmentEvents();
  bindSucursalEvents();

  document.querySelectorAll("[data-role-import-toggle]").forEach((button) => {
    button.addEventListener("click", async () => {
      const roleCode = button.getAttribute("data-role-import-toggle") || "";
      const nextEnabled = button.getAttribute("data-role-import-enabled") === "true";

      if (!roleCode) {
        return;
      }

      await setRoleCatalogImportAccess(roleCode, nextEnabled);
    });
  });
}

function bindInventoryExistenceEvents() {
  document.querySelector("[data-existence-search-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    state.inventoryExistence.search = {
      buscar: readFormFieldValue(form, "buscar", ""),
      status: readFormFieldValue(form, "status", ""),
      tipo: readFormFieldValue(form, "tipo", ""),
    };
    state.inventoryExistence.pagination.limit = Number.parseInt(readFormFieldValue(form, "limit", "25"), 10) || 25;
    await loadInventoryExistence(1);
  });

  document.querySelector("[data-existence-clear]")?.addEventListener("click", async () => {
    state.inventoryExistence.search = {
      buscar: "",
      status: "",
      tipo: "",
    };
    state.inventoryExistence.pagination.limit = 25;
    await loadInventoryExistence(1);
  });

  document.querySelector("[data-existence-refresh]")?.addEventListener("click", async () => {
    await loadInventoryExistence(state.inventoryExistence.pagination.page || 1);
  });

  document.querySelectorAll("[data-existence-page]").forEach((button) => {
    button.addEventListener("click", async () => {
      const direction = button.getAttribute("data-existence-page");
      const page = state.inventoryExistence.pagination.page || 1;
      const totalPages = state.inventoryExistence.pagination.totalPages || 1;
      const nextPage = direction === "prev" ? page - 1 : page + 1;

      if (nextPage < 1 || nextPage > totalPages) {
        return;
      }

      await loadInventoryExistence(nextPage);
    });
  });
}

function bindArticleEvents() {
  const closeCatalogComboboxes = () => {
    document.querySelectorAll("[data-catalog-combobox].catalog-combobox-open").forEach((element) => {
      element.classList.remove("catalog-combobox-open");
      element.querySelector("[data-catalog-input]")?.setAttribute("aria-expanded", "false");
    });
  };

  const openCatalogCombobox = (fieldName) => {
    if (!fieldName) {
      return;
    }

    const combobox = document.querySelector(`[data-catalog-combobox="${fieldName}"]`);
    if (!combobox) {
      return;
    }

    closeCatalogComboboxes();
    combobox.classList.add("catalog-combobox-open");
    combobox.querySelector("[data-catalog-input]")?.setAttribute("aria-expanded", "true");
  };

  document.querySelectorAll("[data-editor-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.getAttribute("data-editor-tab") || "general";
      if (state.articleEditorTab === nextTab) {
        return;
      }

      captureArticleDraft();
      state.articleEditorTab = nextTab;
      render();
    });
  });

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
      syncArticleFormPreview(articleForm);
    });

    articleForm.addEventListener("change", (event) => {
      syncArticleFormPreview(articleForm);

      if (event.target && event.target.name === "promocionActiva") {
        render();
      }
    });

    articleForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      syncArticleFormPreview(articleForm);
      await saveArticle();
    });

    syncArticleFormPreview(articleForm);
  }

  document.querySelectorAll("[data-catalog-import-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const kind = form.getAttribute("data-catalog-kind") || "";
      const fileInput = form.elements.namedItem("file");

      if (!(fileInput instanceof HTMLInputElement) || !fileInput.files || fileInput.files.length === 0) {
        setFlash("Selecciona un archivo Excel antes de importar.", "error");
        render();
        return;
      }

      await importCatalogExcel(kind, fileInput.files[0]);
    });
  });

  document.querySelectorAll("[data-catalog-manual-form]").forEach((form) => {
    form.addEventListener("input", () => {
      const kind = form.getAttribute("data-catalog-kind") || "";
      state.catalogImport.manualDraftsByKind = {
        ...(state.catalogImport.manualDraftsByKind || {}),
        [kind]: readCatalogManualDraft(form, kind),
      };
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const kind = form.getAttribute("data-catalog-kind") || "";
      state.catalogImport.manualDraftsByKind = {
        ...(state.catalogImport.manualDraftsByKind || {}),
        [kind]: readCatalogManualDraft(form, kind),
      };
      await saveCatalogManualEntry(kind);
    });
  });

  document.querySelectorAll("[data-delete-catalog-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.getAttribute("data-delete-catalog-kind") || "";
      const code = button.getAttribute("data-delete-catalog-code") || "";
      if (!kind || !code) {
        return;
      }

      await deleteCatalogEntry(kind, code);
    });
  });

  document.querySelectorAll("[data-catalog-input]").forEach((input) => {
    input.addEventListener("focus", () => {
      openCatalogCombobox(input.getAttribute("data-catalog-input") || "");
    });

    input.addEventListener("click", (event) => {
      event.stopPropagation();
      openCatalogCombobox(input.getAttribute("data-catalog-input") || "");
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeCatalogComboboxes();
      }
    });
  });

  document.querySelectorAll("[data-catalog-toggle]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const fieldName = button.getAttribute("data-catalog-toggle") || "";
      const combobox = button.closest("[data-catalog-combobox]");
      const isOpen = combobox?.classList.contains("catalog-combobox-open");

      if (isOpen) {
        closeCatalogComboboxes();
        return;
      }

      openCatalogCombobox(fieldName);
      combobox?.querySelector("[data-catalog-input]")?.focus();
    });
  });

  document.querySelectorAll("[data-catalog-option]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const fieldName = button.getAttribute("data-catalog-option") || "";
      const nextValue = button.getAttribute("data-catalog-value") || "";
      const input = document.querySelector(`[data-catalog-input="${fieldName}"]`);

      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      input.value = nextValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      closeCatalogComboboxes();
    });
  });

  document.querySelector("[data-reset-form]")?.addEventListener("click", () => {
    resetArticleForm();
    render();
  });

  document.querySelector("[data-toolbar-new]")?.addEventListener("click", () => {
    if (!userCanCreateArticlesInCurrentInstance()) {
      setFlash("Solo la bodega principal puede crear articulos nuevos.", "error");
      render();
      return;
    }

    resetArticleForm();
    render();
  });

  document.querySelector("[data-toolbar-search]")?.addEventListener("click", async () => {
    await openArticleLookupModal();
  });

  document.querySelector("[data-toolbar-print]")?.addEventListener("click", () => {
    window.print();
  });

  document.querySelector("[data-toolbar-close]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-delete-current]")?.addEventListener("click", async () => {
    if (!state.activeArticleCode) {
      return;
    }
    await deleteArticle(state.activeArticleCode);
  });

  document.querySelectorAll("[data-lookup-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeArticleLookupModal();
      render();
    });
  });

  document.querySelector("[data-lookup-refresh]")?.addEventListener("click", async () => {
    await openArticleLookupModal();
  });

  document.querySelectorAll("[data-lookup-select-code]").forEach((row) => {
    row.addEventListener("click", async () => {
      const code = row.getAttribute("data-lookup-select-code");
      if (!code) {
        return;
      }

      closeArticleLookupModal();
      await loadArticleForEdit(code);
    });
  });

  document.querySelectorAll("[data-lookup-edit-code]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const code = button.getAttribute("data-lookup-edit-code");
      if (!code) {
        return;
      }

      closeArticleLookupModal();
      await loadArticleForEdit(code);
    });
  });

  document.querySelectorAll("[data-transfer-lookup-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeTransferLookupModal();
      render();
    });
  });

  document.querySelector("[data-transfer-lookup-refresh]")?.addEventListener("click", async () => {
    await openTransferLookupModal();
  });

  document.querySelectorAll("[data-transfer-lookup-select]").forEach((row) => {
    row.addEventListener("click", async () => {
      const numero = Number.parseInt(row.getAttribute("data-transfer-lookup-select") || "", 10);
      if (!numero) {
        return;
      }

      closeTransferLookupModal();
      await loadTransferForEdit(numero);
    });
  });

  document.querySelectorAll("[data-adjustment-lookup-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeAdjustmentLookupModal();
      render();
    });
  });

  document.querySelector("[data-adjustment-lookup-refresh]")?.addEventListener("click", async () => {
    await openAdjustmentLookupModal();
  });

  document.querySelectorAll("[data-adjustment-lookup-select]").forEach((row) => {
    row.addEventListener("click", async () => {
      const numero = Number.parseInt(row.getAttribute("data-adjustment-lookup-select") || "", 10);
      if (!numero) {
        return;
      }

      closeAdjustmentLookupModal();
      await loadAdjustmentForEdit(numero);
    });
  });

  document.querySelectorAll("[data-dev-return-lookup-close]").forEach((button) => {
    button.addEventListener("click", () => {
      closeDevReturnLookupModal();
      render();
    });
  });

  document.querySelector("[data-dev-return-lookup-refresh]")?.addEventListener("click", async () => {
    await openDevReturnLookupModal({ mode: state.devReturnLookup.mode || "drafts" });
  });

  document.querySelectorAll("[data-dev-return-lookup-select]").forEach((row) => {
    row.addEventListener("click", async () => {
      const numero = Number.parseInt(row.getAttribute("data-dev-return-lookup-select") || "", 10);
      if (!numero) {
        return;
      }

      const lookupMode = state.devReturnLookup.mode;
      closeDevReturnLookupModal();
      if (lookupMode === "records") {
        await loadDevReturnRecordDetail(numero);
        return;
      }

      await loadDevReturnDraftForEdit(numero);
    });
  });

  document.querySelector(".desktop-shell")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-catalog-combobox]")) {
      return;
    }

    closeCatalogComboboxes();
  });
}

function bindTransferEvents() {
  document.querySelector("[data-refresh-transfers]")?.addEventListener("click", async () => {
    await loadTransfersModule();
  });

  document.querySelector("[data-open-load-transfer]")?.addEventListener("click", async () => {
    await openTransferLookupModal();
  });

  document.querySelector("[data-print-transfer]")?.addEventListener("click", () => {
    window.print();
  });

  document.querySelector("[data-transfer-exit]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-clear-transfer-search]")?.addEventListener("click", async () => {
    state.transfers.search = createEmptyTransferSearch();
    await loadTransfers();
  });

  const transferSearchForm = document.getElementById("transfer-search-form");
  if (transferSearchForm) {
    transferSearchForm.addEventListener("input", () => {
      state.transfers.search = readTransferSearch(transferSearchForm);
    });

    transferSearchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.transfers.search = readTransferSearch(transferSearchForm);
      await loadTransfers();
    });
  }

  document.querySelector("[data-new-transfer]")?.addEventListener("click", () => {
    resetTransferDraft();
    clearFlash();
    render();
  });

  document.querySelector("[data-transfer-reset]")?.addEventListener("click", () => {
    resetTransferDraft();
    clearFlash();
    render();
  });

  document.querySelector("[data-transfer-add-line]")?.addEventListener("click", () => {
    captureTransferDraft();
    state.transfers.draft.items = [...state.transfers.draft.items, createEmptyTransferLineDraft()];
    render();
  });

  document.querySelectorAll("[data-transfer-remove-line]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number.parseInt(button.getAttribute("data-transfer-remove-line") || "-1", 10);
      if (index < 0) {
        return;
      }

      captureTransferDraft();
      if (state.transfers.draft.items.length <= 1) {
        state.transfers.draft.items = [createEmptyTransferLineDraft()];
      } else {
        state.transfers.draft.items = state.transfers.draft.items.filter((_, currentIndex) => currentIndex !== index);
      }
      render();
    });
  });

  document.querySelectorAll("[data-transfer-barcode-input]").forEach((input) => {
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const index = Number.parseInt(input.getAttribute("data-transfer-barcode-input") || "-1", 10);
      const codigoBarra = String(input.value || "").trim();
      if (index < 0 || !codigoBarra) {
        return;
      }

      await fillTransferLineFromInventory(index, codigoBarra);
    });
  });

  document.querySelectorAll("[data-transfer-load-receipt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const numero = Number.parseInt(button.getAttribute("data-transfer-load-receipt") || "", 10);
      if (!Number.isInteger(numero)) {
        return;
      }

      await loadTransferForReceipt(numero);
    });
  });

  document.querySelector("[data-clear-loaded-transfer]")?.addEventListener("click", () => {
    state.transfers.selectedNumero = null;
    state.transfers.receiptNumero = null;
    state.transfers.draft = createEmptyTransferDraft(state.transfers.metadata);
    clearFlash();
    render();
  });

  document.querySelector("[data-approve-transfer]")?.addEventListener("click", async () => {
    const numero = Number.parseInt(String(state.transfers.draft?.numero || ""), 10);
    if (!Number.isInteger(numero)) {
      return;
    }

    await approveTransfer(numero);
  });

  document.querySelector("[data-load-inbound-transfer]")?.addEventListener("click", async () => {
    const numero = Number.parseInt(String(state.transfers.draft?.numero || ""), 10);
    if (!Number.isInteger(numero)) {
      return;
    }

    await loadInboundTransfer(numero);
  });

  document.querySelector("[data-delete-transfer]")?.addEventListener("click", async () => {
    const numero = Number.parseInt(String(state.transfers.draft?.numero || ""), 10);
    if (!Number.isInteger(numero)) {
      return;
    }

    await deleteTransfer(numero);
  });

  const transferForm = document.getElementById("transfer-form");
  if (transferForm) {
    transferForm.addEventListener("input", () => {
      captureTransferDraft();
    });

    transferForm.addEventListener("change", (event) => {
      captureTransferDraft();
      if (event.target?.name === "transferenciaCorreccion") {
        render();
      }
    });

    transferForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      captureTransferDraft();
      await saveTransfer();
    });
  }
}

function bindDevReturnEvents() {
  const form = document.getElementById("dev-return-form");
  if (form) {
    form.addEventListener("input", () => {
      captureDevReturnDraft();
    });

    form.addEventListener("change", (event) => {
      captureDevReturnDraft();
      if (event?.target?.name === "codigoOrigen") {
        const draft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);
        const destinos = Array.isArray(state.devReturns.metadata?.destinos) ? state.devReturns.metadata.destinos : [];
        const currentOrigin = String(draft.codigoOrigen || "").trim().toUpperCase();
        const currentDestination = String(draft.codigoDestino || "").trim().toUpperCase();
        if (currentOrigin && currentOrigin === currentDestination) {
          const fallbackDestination = destinos.find(
            (item) => String(item.codigo || "").trim().toUpperCase() !== currentOrigin,
          );
          draft.codigoDestino = fallbackDestination?.codigo || draft.codigoDestino || "";
          state.devReturns.draft = draft;
        }
        render();
      }
    });

    const destinationSelect = form.elements?.namedItem?.("codigoDestino");
    if (destinationSelect) {
      const triggerRemotePull = () => {
        void pullDevReturnsFromRemoteForDraft();
      };

      destinationSelect.addEventListener("focus", triggerRemotePull);
      destinationSelect.addEventListener("click", triggerRemotePull);
      destinationSelect.addEventListener("change", triggerRemotePull);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      captureDevReturnDraft();
      await saveDevReturn();
    });

    document.querySelectorAll("[data-dev-return-barcode-input]").forEach((input) => {
      input.addEventListener("keydown", async (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        const index = Number.parseInt(input.getAttribute("data-dev-return-barcode-input") || "-1", 10);
        const codigoBarra = String(input.value || "").trim();
        if (index >= 0 && codigoBarra) {
          await fillDevReturnLineFromInventory(index, codigoBarra);
        }
      });

      input.addEventListener("blur", async () => {
        const index = Number.parseInt(input.getAttribute("data-dev-return-barcode-input") || "-1", 10);
        const codigoBarra = String(input.value || "").trim();
        const row = input.closest("[data-dev-return-line-row]");
        const currentName = row?.querySelector('[name="nombre"]')?.value || "";
        if (index >= 0 && codigoBarra && !currentName) {
          await fillDevReturnLineFromInventory(index, codigoBarra);
        }
      });
    });
  }

  document.querySelector("[data-dev-return-new]")?.addEventListener("click", () => {
    resetDevReturnDraft();
    clearFlash();
    render();
  });

  document.querySelector("[data-dev-return-open-lookup]")?.addEventListener("click", async () => {
    await openDevReturnLookupModal();
  });

  document.querySelector("[data-dev-return-exit]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-dev-return-export]")?.addEventListener("click", async () => {
    captureDevReturnDraft();
    const numero = Number.parseInt(String(state.devReturns.draft?.numero || ""), 10);
    if (!Number.isInteger(numero)) {
      setFlash("Guarda el borrador antes de exportarlo.", "error");
      render();
      return;
    }

    await exportDevReturn(numero);
  });

  document.querySelector("[data-dev-return-refresh-board]")?.addEventListener("click", async () => {
    await loadDevReturnsModule();
  });

  document.querySelectorAll("[data-dev-return-open-draft]").forEach((button) => {
    button.addEventListener("click", async () => {
      const numero = Number.parseInt(button.getAttribute("data-dev-return-open-draft") || "", 10);
      if (!Number.isInteger(numero)) {
        return;
      }

      await loadDevReturnDraftForEdit(numero);
    });
  });

  document.querySelectorAll("[data-dev-return-open-inbound]").forEach((button) => {
    button.addEventListener("click", async () => {
      const globalId = button.getAttribute("data-dev-return-open-inbound") || "";
      if (!globalId) {
        return;
      }

      await loadInboundDevReturnDraftDetail(globalId);
    });
  });

  document.querySelector("[data-dev-return-close-inbound-detail]")?.addEventListener("click", () => {
    state.devReturns.selectedInboundGlobalId = "";
    state.devReturns.inboundDetail = null;
    clearFlash();
    render();
  });

  document.querySelector("[data-dev-return-approve-inbound]")?.addEventListener("click", async () => {
    const globalId = state.devReturns.selectedInboundGlobalId || state.devReturns.inboundDetail?.globalId || "";
    if (!globalId) {
      return;
    }

    await approveInboundDevReturnDraft(globalId);
  });

  document.querySelector("[data-dev-return-record-refresh]")?.addEventListener("click", async () => {
    await loadDevReturnRecords();
  });

  document.querySelector("[data-dev-return-record-new]")?.addEventListener("click", () => {
    state.devReturnRecords.detail = null;
    state.devReturnRecords.selectedNumero = null;
    clearFlash();
    render();
  });

  document.querySelector("[data-dev-return-record-search]")?.addEventListener("click", async () => {
    await openDevReturnLookupModal({ mode: "records" });
  });

  document.querySelector("[data-dev-return-record-export]")?.addEventListener("click", async () => {
    const numero = Number.parseInt(String(state.devReturnRecords.detail?.numero || ""), 10);
    if (!Number.isInteger(numero)) {
      setFlash("Busca primero un borrador aprobado para exportar su registro.", "error");
      render();
      return;
    }

    await exportDevReturnRecord(numero);
  });

  document.querySelector("[data-dev-return-record-exit]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-dev-return-record-back]")?.addEventListener("click", () => {
    state.devReturnRecords.detail = null;
    state.devReturnRecords.selectedNumero = null;
    clearFlash();
    render();
  });

  document.querySelectorAll("[data-dev-return-record-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const numero = Number.parseInt(button.getAttribute("data-dev-return-record-open") || "", 10);
      if (!Number.isInteger(numero)) {
        return;
      }

      await loadDevReturnRecordDetail(numero);
    });
  });

  document.querySelector("[data-dev-return-inbound-refresh]")?.addEventListener("click", async () => {
    await loadInboundDevReturns();
  });

  document.querySelector("[data-dev-return-inbound-back]")?.addEventListener("click", () => {
    state.devReturnInbound.detail = null;
    state.devReturnInbound.selectedNumero = null;
    state.devReturnInbound.selectedCodigoEnvia = "";
    clearFlash();
    render();
  });

  document.querySelectorAll("[data-dev-return-inbound-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const numero = Number.parseInt(button.getAttribute("data-dev-return-inbound-open") || "", 10);
      const codigoEnvia = button.getAttribute("data-dev-return-inbound-source") || "";
      if (!Number.isInteger(numero)) {
        return;
      }

      await loadInboundDevReturnDetail(numero, codigoEnvia);
    });
  });

  document.querySelector("[data-dev-return-inbound-approve]")?.addEventListener("click", async () => {
    const numero = Number.parseInt(String(state.devReturnInbound.detail?.numero || ""), 10);
    const codigoEnvia = state.devReturnInbound.detail?.codigoEnvia || state.devReturnInbound.selectedCodigoEnvia || "";
    if (!Number.isInteger(numero)) {
      return;
    }

    await approveInboundDevReturn(numero, codigoEnvia);
  });
}

function bindAdjustmentEvents() {
  const form = document.getElementById("adjustment-form");
  if (!form) {
    return;
  }

  form.addEventListener("input", () => {
    captureAdjustmentDraft();
  });

  form.addEventListener("change", () => {
    captureAdjustmentDraft();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    captureAdjustmentDraft();
    await saveAdjustment();
  });

  document.querySelector("[data-adjustment-new]")?.addEventListener("click", () => {
    resetAdjustmentDraft();
    clearFlash();
    render();
  });

  document.querySelector("[data-adjustment-open-lookup]")?.addEventListener("click", async () => {
    await openAdjustmentLookupModal();
  });

  document.querySelector("[data-adjustment-exit]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-adjustment-approve]")?.addEventListener("click", async () => {
    captureAdjustmentDraft();
    const numero = state.adjustments.draft?.numero;
    if (!numero) {
      setFlash("Guarda el ajuste antes de aprobarlo.", "error");
      render();
      return;
    }

    await approveAdjustment(numero);
  });

  document.querySelectorAll("[data-adjustment-barcode-input]").forEach((input) => {
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      const index = Number.parseInt(input.getAttribute("data-adjustment-barcode-input") || "-1", 10);
      const codigoBarra = String(input.value || "").trim();
      if (index >= 0 && codigoBarra) {
        await fillAdjustmentLineFromInventory(index, codigoBarra);
      }
    });

    input.addEventListener("blur", async () => {
      const index = Number.parseInt(input.getAttribute("data-adjustment-barcode-input") || "-1", 10);
      const codigoBarra = String(input.value || "").trim();
      const row = input.closest("[data-adjustment-line-row]");
      const currentName = row?.querySelector('[name="nombre"]')?.value || "";
      if (index >= 0 && codigoBarra && !currentName) {
        await fillAdjustmentLineFromInventory(index, codigoBarra);
      }
    });
  });
}

function bindSucursalEvents() {
  document.querySelector("[data-refresh-sucursales]")?.addEventListener("click", async () => {
    await loadSucursales();
  });

  document.querySelector("[data-new-sucursal]")?.addEventListener("click", () => {
    resetSucursalDraft();
    clearFlash();
    render();
  });

  document.querySelectorAll("[data-delete-sucursal]").forEach((button) => {
    button.addEventListener("click", async () => {
      const codigo = button.getAttribute("data-delete-sucursal") || "";
      if (!codigo) {
        return;
      }

      await deleteSucursal(codigo);
    });
  });

  document.querySelector("[data-sucursal-exit]")?.addEventListener("click", () => {
    state.currentView = "desktop";
    state.navigation.openMenu = "";
    state.navigation.openSubmenu = "";
    state.navigation.menuPinned = false;
    clearFlash();
    render();
  });

  document.querySelector("[data-sucursal-reset]")?.addEventListener("click", () => {
    resetSucursalDraft();
    clearFlash();
    render();
  });

  document.querySelector("[data-sucursal-search]")?.addEventListener("input", (event) => {
    state.sucursales.search = event.target.value || "";
    render();
  });

  document.querySelectorAll("[data-sucursal-select]").forEach((button) => {
    button.addEventListener("click", async () => {
      const codigo = button.getAttribute("data-sucursal-select") || "";
      if (!codigo) {
        return;
      }

      await loadSucursalForEdit(codigo);
    });
  });

  const sucursalForm = document.getElementById("sucursal-form");
  if (sucursalForm) {
    sucursalForm.addEventListener("input", () => {
      captureSucursalDraft();
    });

    sucursalForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      captureSucursalDraft();
      await saveSucursal();
    });
  }

  document.onkeydown = async (event) => {
    if (state.currentView !== "sucursales" || !event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    const key = String(event.key || "").toLowerCase();
    if (!["c", "g", "s"].includes(key)) {
      return;
    }

    event.preventDefault();

    if (state.sucursales.saving || state.sucursales.deleting) {
      return;
    }

    if (key === "c") {
      resetSucursalDraft();
      clearFlash();
      render();
      return;
    }

    if (key === "g") {
      const sucursalForm = document.getElementById("sucursal-form");
      if (sucursalForm) {
        captureSucursalDraft();
        await saveSucursal();
      }
      return;
    }

    if (key === "s") {
      state.currentView = "desktop";
      state.navigation.openMenu = "";
      state.navigation.openSubmenu = "";
      state.navigation.menuPinned = false;
      clearFlash();
      render();
    }
  };
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

    await preloadAuthenticatedDesktopData();

    state.currentView = "desktop";
    state.navigation = {
      openMenu: "",
      openSubmenu: "",
      menuPinned: false,
    };
    state.articleEditorTab = "general";
    resetArticleForm();
    state.loginDraft = {
      usuario: "",
      password: "",
      mantenerSesion: state.loginDraft.mantenerSesion,
    };
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
  if (!userCanAccessFullInventory()) {
    render();
    return;
  }

  await Promise.all([
    loadCreationMetadata(),
    loadArticles(state.pagination.page || 1),
  ]);
}

async function loadCreationMetadata(options = {}) {
  if (!userCanAccessFullInventory()) {
    return;
  }

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

async function importCatalogExcel(kind, file) {
  const config = getCatalogImportConfig(kind);
  if (!config) {
    setFlash("El catalogo seleccionado no admite importacion por Excel.", "error");
    render();
    return;
  }

  state.catalogImport.uploadingKind = kind;
  clearFlash();
  render();

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await apiFetch(`/inventory/catalogs/import/${encodeURIComponent(kind)}`, {
      method: "POST",
      body: formData,
    });

    await loadCatalogImportItems(kind, { renderAfter: false });
    if (userCanAccessFullInventory()) {
      await loadCreationMetadata({ renderAfter: false });
    }

    const summary = response?.resumen || {};
    const title = config.title;
    const detailErrors = Array.isArray(summary.detalleErrores) && summary.detalleErrores.length > 0
      ? ` Primeros errores: ${summary.detalleErrores.join(" | ")}`
      : "";

    setFlash(
      `${title} importadas. Procesadas: ${summary.procesados || 0}, creadas: ${summary.creados || 0}, actualizadas: ${summary.actualizados || 0}, omitidas: ${summary.omitidos || 0}, errores: ${summary.errores || 0}.${detailErrors}`,
      summary.errores > 0 ? "info" : "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.catalogImport.uploadingKind = "";
    render();
  }
}

async function saveCatalogManualEntry(kind) {
  const config = getCatalogImportConfig(kind);
  if (!config) {
    return;
  }

  const draft = getCatalogManualDraft(kind);
  const validationMessage = validateCatalogManualDraft(kind, draft);
  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  state.catalogImport.manualSubmittingKind = kind;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/inventory/catalogs/${encodeURIComponent(kind)}`, {
      method: "POST",
      body: buildCatalogManualPayload(kind, draft),
    });

    await loadCatalogImportItems(kind, { renderAfter: false });
    if (userCanAccessFullInventory()) {
      await loadCreationMetadata({ renderAfter: false });
    }

    state.catalogImport.manualDraftsByKind = {
      ...(state.catalogImport.manualDraftsByKind || {}),
      [kind]: createCatalogManualDraft(kind),
    };

    const savedItem = response?.item || {};
    const summary = savedItem.nombre ? `${savedItem.codigo || ""} ${savedItem.nombre}`.trim() : savedItem.codigo || config.singular;
    setFlash(`${capitalize(config.singular)} ${summary} guardado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.catalogImport.manualSubmittingKind = "";
    render();
  }
}

async function deleteCatalogEntry(kind, code) {
  const config = getCatalogImportConfig(kind);
  if (!config || !config.canDelete) {
    setFlash("Este catalogo no admite eliminacion desde esta pantalla.", "error");
    render();
    return;
  }

  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) {
    setFlash("No se encontro el codigo del registro a eliminar.", "error");
    render();
    return;
  }

  const catalogLabel = getCatalogSingularLabel(config.singular);
  const confirmed = window.confirm(
    `Vas a eliminar ${catalogLabel} con codigo ${normalizedCode}. Esta accion no se puede deshacer. ¿Deseas continuar?`,
  );

  if (!confirmed) {
    return;
  }

  state.catalogImport.deletingEntryKey = buildCatalogEntryDeleteKey(kind, normalizedCode);
  clearFlash();
  render();

  try {
    await apiFetch(`/inventory/catalogs/${encodeURIComponent(kind)}/${encodeURIComponent(normalizedCode)}`, {
      method: "DELETE",
    });

    await loadCatalogImportItems(kind, { renderAfter: false });
    if (userCanAccessFullInventory()) {
      await loadCreationMetadata({ renderAfter: false });
    }

    setFlash(`Registro ${normalizedCode} eliminado correctamente del catalogo de ${config.title.toLowerCase()}.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.catalogImport.deletingEntryKey = "";
    render();
  }
}

async function loadCatalogImportItems(kind, options = {}) {
  const config = getCatalogImportConfig(kind);
  if (!config) {
    return;
  }

  const { renderAfter = true } = options;
  state.catalogImport.loadingKind = kind;
  if (renderAfter) {
    render();
  }

  try {
    const response = await apiFetch(`/inventory/catalogs/${encodeURIComponent(kind)}`);
    state.catalogImport.itemsByKind = {
      ...(state.catalogImport.itemsByKind || {}),
      [kind]: Array.isArray(response.items) ? response.items : [],
    };
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el catalogo ${config.title.toLowerCase()}: ${extractErrorMessage(error)}`, "error");
  } finally {
    if (state.catalogImport.loadingKind === kind) {
      state.catalogImport.loadingKind = "";
    }
    if (renderAfter) {
      render();
    }
  }
}

async function loadRoleAccess(options = {}) {
  const { renderAfter = true } = options;
  state.roleAccess.loading = true;
  if (renderAfter) {
    render();
  }

  try {
    const response = await apiFetch("/roles");
    state.roleAccess.roles = Array.isArray(response.roles) ? response.roles : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar los roles: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.roleAccess.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function setRoleCatalogImportAccess(roleCode, enabled) {
  if (!userIsSystemOperator()) {
    setFlash("Solo el usuario sistema puede cambiar este permiso.", "error");
    render();
    return;
  }

  state.roleAccess.savingRole = roleCode;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/roles/${encodeURIComponent(roleCode)}/catalog-import-access`, {
      method: "PATCH",
      body: {
        enabled,
      },
    });

    const updatedRole = response?.rol || null;
    if (updatedRole) {
      state.roleAccess.roles = state.roleAccess.roles.map((role) =>
        role.codigo === updatedRole.codigo ? updatedRole : role,
      );
    } else {
      await loadRoleAccess({ renderAfter: false });
    }

    setFlash(
      `Acceso de importacion Excel ${enabled ? "habilitado" : "revocado"} para el rol ${roleCode}.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.roleAccess.savingRole = "";
    render();
  }
}

async function loadTransfersModule(options = {}) {
  const { renderAfter = true } = options;

  await Promise.all([
    loadTransfersMetadata({ renderAfter: false }),
    loadTransfers({ renderAfter: false }),
  ]);

  if (renderAfter) {
    render();
  }
}

async function loadTransfersMetadata(options = {}) {
  const { renderAfter = true } = options;
  state.transfers.loadingMetadata = true;
  if (renderAfter) {
    render();
  }

  try {
    state.transfers.metadata = await apiFetch("/transfers/metadata");
    if (!state.transfers.draft?.numero) {
      state.transfers.draft = createEmptyTransferDraft(state.transfers.metadata);
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la configuracion de transferencias: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingMetadata = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadTransfers(options = {}) {
  const { renderAfter = true } = options;
  state.transfers.loadingList = true;
  if (renderAfter) {
    render();
  }

  try {
    const params = new URLSearchParams();
    const search = state.transfers.search || createEmptyTransferSearch();

    if (search.buscar) {
      params.set("buscar", search.buscar);
    }
    if (search.status !== "") {
      params.set("status", search.status);
    }
    if (search.limit) {
      params.set("limit", search.limit);
    }

    const query = params.toString();
    const endpoint = state.currentView === "cargar-transferencia" ? "/transfers/inbound" : "/transfers";
    const response = await apiFetch(`${endpoint}${query ? `?${query}` : ""}`);
    state.transfers.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar las transferencias: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingList = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadTransferForEdit(numero) {
  state.transfers.loadingDetail = true;
  clearFlash();
  render();

  try {
    if (!state.transfers.metadata) {
      await loadTransfersMetadata({ renderAfter: false });
    }

    const response = await apiFetch(`/transfers/${encodeURIComponent(numero)}`);
    state.transfers.selectedNumero = numero;
    state.transfers.receiptNumero = null;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
    state.currentView = "registro-transferencia";
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la transferencia ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingDetail = false;
    render();
  }
}

async function loadTransferForReceipt(numero) {
  state.transfers.loadingDetail = true;
  clearFlash();
  render();

  try {
    if (!state.transfers.metadata) {
      await loadTransfersMetadata({ renderAfter: false });
    }

    const response = await apiFetch(`/transfers/inbound/${encodeURIComponent(numero)}`);
    state.transfers.selectedNumero = numero;
    state.transfers.receiptNumero = numero;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
    state.currentView = "cargar-transferencia";
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la transferencia ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingDetail = false;
    render();
  }
}

async function fillTransferLineFromInventory(index, codigoBarra) {
  captureTransferDraft();
  const draft = state.transfers.draft || createEmptyTransferDraft(state.transfers.metadata);
  const items = Array.isArray(draft.items) && draft.items.length ? [...draft.items] : [createEmptyTransferLineDraft()];

  try {
    const response = await apiFetch(`/inventory/${encodeURIComponent(codigoBarra)}`);
    const article = response.mercancia || response;
    const currentLine = items[index] || createEmptyTransferLineDraft();
    const preserveCorrectionReference = Boolean(draft.correccion);

    items[index] = {
      ...currentLine,
      codigoBarra: article.codigoBarra || codigoBarra,
      referencia: preserveCorrectionReference
        ? currentLine.referencia || article.referencia || ""
        : article.referencia || currentLine.referencia || "",
      articuloNombre: article.general?.nombre || article.nombre || currentLine.articuloNombre || "",
      existenciaActual: toInputValue(article.inventario?.existenciaActual ?? currentLine.existenciaActual ?? ""),
      existenciaLote: toInputValue(article.inventario?.existenciaActual ?? currentLine.existenciaLote ?? ""),
      valor: toInputValue(article.inventario?.costos?.ultimo ?? currentLine.valor ?? ""),
    };

    state.transfers.draft = {
      ...draft,
      items,
    };
    clearFlash();
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el articulo ${codigoBarra}: ${extractErrorMessage(error)}`, "error");
  } finally {
    render();
  }
}

async function saveTransfer() {
  const draft = state.transfers.draft || createEmptyTransferDraft(state.transfers.metadata);
  const validationMessage = validateTransferDraft(draft);
  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  state.transfers.saving = true;
  clearFlash();
  render();

  try {
    const payload = buildTransferPayload(draft);
    const response = draft.numero
      ? await apiFetch(`/transfers/${encodeURIComponent(draft.numero)}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch("/transfers", {
          method: "POST",
          body: payload,
        });

    state.transfers.selectedNumero = response.transferencia?.numero || draft.numero || null;
    state.transfers.receiptNumero = null;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);

    await Promise.all([
      loadTransfers({ renderAfter: false }),
      loadTransfersMetadata({ renderAfter: false }),
    ]);

    setFlash(
      draft.numero
        ? `Transferencia ${response.transferencia?.numero || draft.numero} actualizada correctamente.`
        : `Transferencia ${response.transferencia?.numero || ""} guardada correctamente.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.saving = false;
    render();
  }
}

async function approveTransfer(numero) {
  state.transfers.approving = true;
  clearFlash();
  render();

  try {
    await approveTransferWithPayload(numero);
  } catch (error) {
    console.error(error);
    if (isTransferDuplicateBarcodeError(error)) {
      await resolveDuplicateBarcodesAndApprove(numero, error);
      return;
    }

    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.approving = false;
    render();
  }
}

async function loadInboundTransfer(numero) {
  state.transfers.approving = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/transfers/inbound/${encodeURIComponent(numero)}/load`, {
      method: "POST",
    });

    state.transfers.selectedNumero = numero;
    state.transfers.receiptNumero = numero;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
    await loadTransfers({ renderAfter: false });

    setFlash(
      response.alreadyLoaded
        ? `Transferencia ${numero} ya estaba cargada en inventario.`
        : `Transferencia ${numero} cargada correctamente en inventario.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.approving = false;
    render();
  }
}

async function approveTransferWithPayload(numero, payload = {}) {
  const response = await apiFetch(`/transfers/${encodeURIComponent(numero)}/approve`, {
    method: "POST",
    body: payload,
  });

  state.transfers.selectedNumero = numero;
  if (state.currentView === "cargar-transferencia") {
    state.transfers.receiptNumero = numero;
  }
  state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
  await loadTransfers({ renderAfter: false });
  setFlash(`Transferencia ${numero} aprobada correctamente.`, "success");
}

async function resolveDuplicateBarcodesAndApprove(numero, error) {
  const duplicates = Array.isArray(error?.payload?.duplicates) ? error.payload.duplicates : [];
  if (!duplicates.length) {
    setFlash(extractErrorMessage(error), "error");
    return;
  }

  const duplicateResolutions = [];

  for (const item of duplicates) {
    const codigoBarra = String(item.codigoBarra || "").trim().toUpperCase();
    const nombre = item.nombre ? ` - ${item.nombre}` : "";
    const shouldModifyExisting = window.confirm(
      `El codigo de barra ${codigoBarra}${nombre} ya existe en inventario.\n\nAceptar: modificar el articulo existente con los atributos de la transferencia.\nCancelar: crear un articulo nuevo con otro codigo de barra.`,
    );

    if (shouldModifyExisting) {
      duplicateResolutions.push({
        codigoBarra,
        action: "modify-existing",
      });
      continue;
    }

    const nuevoCodigoBarra = window.prompt(
      `Indica el nuevo codigo de barra para crear el articulo recibido desde ${codigoBarra}.`,
      "",
    );

    if (!nuevoCodigoBarra || !String(nuevoCodigoBarra).trim()) {
      setFlash("La aprobacion fue cancelada porque falta el nuevo codigo de barra.", "error");
      return;
    }

    duplicateResolutions.push({
      codigoBarra,
      action: "create-new",
      nuevoCodigoBarra: String(nuevoCodigoBarra).trim().toUpperCase(),
    });
  }

  try {
    await approveTransferWithPayload(numero, { duplicateResolutions });
  } catch (retryError) {
    console.error(retryError);
    setFlash(extractErrorMessage(retryError), "error");
  }
}

function isTransferDuplicateBarcodeError(error) {
  return error?.payload?.code === "TRANSFER_DUPLICATE_BARCODE";
}

async function deleteTransfer(numero) {
  const confirmed = window.confirm(
    `Se eliminara la transferencia pendiente ${numero} y se devolvera al inventario lo descontado. Deseas continuar?`,
  );
  if (!confirmed) {
    return;
  }

  state.transfers.deleting = true;
  clearFlash();
  render();

  try {
    await apiFetch(`/transfers/${encodeURIComponent(numero)}`, {
      method: "DELETE",
    });

    resetTransferDraft();
    await Promise.all([
      loadTransfers({ renderAfter: false }),
      loadTransfersMetadata({ renderAfter: false }),
    ]);
    setFlash(`Transferencia ${numero} eliminada correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.deleting = false;
    render();
  }
}

async function loadDevReturnsMetadata(options = {}) {
  const { renderAfter = true } = options;
  state.devReturns.loadingMetadata = true;
  if (renderAfter) {
    render();
  }

  try {
    state.devReturns.metadata = await apiFetch("/dev-returns/metadata");
    if (!state.devReturns.draft?.numero) {
      state.devReturns.draft = createEmptyDevReturnDraft(state.devReturns.metadata);
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la configuracion de devoluciones: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingMetadata = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadDevReturnsModule(options = {}) {
  const { renderAfter = true } = options;
  state.devReturns.loadingDashboard = true;
  if (renderAfter) {
    render();
  }

  try {
    if (!state.devReturns.metadata) {
      await loadDevReturnsMetadata({ renderAfter: false });
    }

    await pullDevReturnsFromRemoteForDraft({
      force: true,
      limit: 100,
    });

    const [sentResponse, inboundResponse] = await Promise.all([
      apiFetch("/dev-returns/drafts?limit=12"),
      apiFetch("/dev-returns/drafts/inbound?limit=12"),
    ]);
    state.devReturns.items = Array.isArray(sentResponse.items) ? sentResponse.items : [];
    state.devReturns.inboundItems = Array.isArray(inboundResponse.items) ? inboundResponse.items : [];
    if (!state.devReturns.draft?.numero) {
      state.devReturns.draft = createEmptyDevReturnDraft(state.devReturns.metadata);
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar las bandejas de devoluciones: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingDashboard = false;
    if (renderAfter) {
      render();
    }
  }
}

async function pullDevReturnsFromRemoteForDraft(options = {}) {
  if (!state.token || devReturnRemotePullInFlight) {
    return null;
  }

  const now = Date.now();
  const force = Boolean(options.force);
  const limit = Number.parseInt(String(options.limit || "100"), 10);
  if (!force && now - devReturnRemotePullLastAt < 5000) {
    return null;
  }

  devReturnRemotePullInFlight = true;
  devReturnRemotePullLastAt = now;

  try {
    return await apiFetch("/dev-returns/sync/pull", {
      method: "POST",
      body: {
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100,
      },
    });
  } catch (error) {
    console.error(error);
    return null;
  } finally {
    devReturnRemotePullInFlight = false;
  }
}

async function openDevReturnLookupModal(options = {}) {
  const mode = options.mode === "records" ? "records" : "drafts";
  if (mode === "drafts") {
    captureDevReturnDraft();
  }
  state.devReturnLookup.open = true;
  state.devReturnLookup.loading = true;
  state.devReturnLookup.items = [];
  state.devReturnLookup.mode = mode;
  render();

  try {
    const response = await apiFetch(mode === "records" ? "/dev-returns/returns?limit=50" : "/dev-returns/drafts?limit=50");
    const items = Array.isArray(response.items) ? response.items : [];
    state.devReturnLookup.items = items;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el catalogo de borradores: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnLookup.loading = false;
    render();
  }
}

function closeDevReturnLookupModal() {
  state.devReturnLookup.open = false;
  state.devReturnLookup.loading = false;
  state.devReturnLookup.mode = "drafts";
}

async function loadDevReturnDraftForEdit(numero) {
  state.devReturns.loadingDetail = true;
  clearFlash();
  render();

  try {
    if (!state.devReturns.metadata) {
      await loadDevReturnsMetadata({ renderAfter: false });
    }

    const response = await apiFetch(`/dev-returns/drafts/${encodeURIComponent(numero)}`);
    state.devReturns.selectedNumero = numero;
    state.devReturns.inboundDetail = null;
    state.devReturns.selectedInboundGlobalId = "";
    state.devReturns.draft = devReturnToDraft(response.borrador, state.devReturns.metadata);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el borrador ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingDetail = false;
    render();
  }
}

async function loadInboundDevReturnDraftDetail(globalId) {
  state.devReturns.loadingInboundDetail = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/dev-returns/drafts/inbound/${encodeURIComponent(globalId)}`);
    state.devReturns.selectedInboundGlobalId = globalId;
    state.devReturns.inboundDetail = response.borrador || null;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el borrador recibido: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingInboundDetail = false;
    render();
  }
}

async function approveInboundDevReturnDraft(globalId) {
  state.devReturns.approvingInbound = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/dev-returns/drafts/inbound/${encodeURIComponent(globalId)}/approve`, {
      method: "POST",
    });
    state.devReturns.inboundDetail = response.borrador || state.devReturns.inboundDetail;
    await loadDevReturnsModule({ renderAfter: false });
    await loadDevReturnRecords({ renderAfter: false });
    const returnNumero = Number.parseInt(String(response.returnNumero || ""), 10);
    setFlash(
      Number.isInteger(returnNumero)
        ? `Borrador aprobado correctamente. La devolución ${returnNumero} ya quedó registrada.`
        : "Borrador aprobado correctamente.",
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturns.approvingInbound = false;
    render();
  }
}

async function saveDevReturn() {
  const draft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);
  const validationMessage = validateDevReturnDraft(draft);
  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  state.devReturns.saving = true;
  clearFlash();
  render();

  try {
    const payload = buildDevReturnPayload(draft);
    const response = draft.numero
      ? await apiFetch(`/dev-returns/drafts/${encodeURIComponent(draft.numero)}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch("/dev-returns/drafts", {
          method: "POST",
          body: payload,
        });

    state.devReturns.selectedNumero = response.borrador?.numero || draft.numero || null;
    state.devReturns.draft = devReturnToDraft(response.borrador, state.devReturns.metadata);
    await loadDevReturnsModule({ renderAfter: false });
    setFlash(
      draft.numero
        ? `Borrador ${response.borrador?.numero || draft.numero} actualizado correctamente.`
        : `Borrador ${response.borrador?.numero || ""} guardado correctamente.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturns.saving = false;
    render();
  }
}

async function exportDevReturn(numero) {
  state.devReturns.exporting = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/dev-returns/drafts/${encodeURIComponent(numero)}/export`, {
      method: "POST",
    });

    state.devReturns.selectedNumero = numero;
    state.devReturns.draft = devReturnToDraft(response.borrador, state.devReturns.metadata);
    await loadDevReturnsModule({ renderAfter: false });
    setFlash(`Borrador ${numero} exportado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturns.exporting = false;
    render();
  }
}

async function loadDevReturnRecords(options = {}) {
  const { renderAfter = true } = options;
  state.devReturnRecords.loading = true;
  if (renderAfter) {
    render();
  }

  try {
    const response = await apiFetch("/dev-returns/returns?limit=25");
    state.devReturnRecords.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el registro de devoluciones: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnRecords.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadDevReturnRecordDetail(numero) {
  state.devReturnRecords.loadingDetail = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/dev-returns/returns/${encodeURIComponent(numero)}`);
    state.devReturnRecords.selectedNumero = numero;
    state.devReturnRecords.detail = response.devolucion || null;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la devolución ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnRecords.loadingDetail = false;
    render();
  }
}

async function exportDevReturnRecord(numero) {
  state.devReturnRecords.exporting = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/dev-returns/returns/${encodeURIComponent(numero)}/export`, {
      method: "POST",
    });
    state.devReturnRecords.selectedNumero = numero;
    state.devReturnRecords.detail = response.devolucion || state.devReturnRecords.detail;
    await loadDevReturnRecords({ renderAfter: false });
    setFlash(`Registro de devolución ${numero} exportado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturnRecords.exporting = false;
    render();
  }
}

async function loadInboundDevReturns(options = {}) {
  const { renderAfter = true } = options;
  state.devReturnInbound.loading = true;
  if (renderAfter) {
    render();
  }

  try {
    await pullDevReturnsFromRemoteForDraft({
      force: true,
      limit: 100,
    });

    const response = await apiFetch("/dev-returns/inbound?limit=25");
    state.devReturnInbound.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la bandeja de devoluciones recibidas: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnInbound.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadInboundDevReturnDetail(numero, codigoEnvia) {
  state.devReturnInbound.loadingDetail = true;
  clearFlash();
  render();

  try {
    const query = codigoEnvia ? `?codigoEnvia=${encodeURIComponent(codigoEnvia)}` : "";
    const response = await apiFetch(`/dev-returns/inbound/${encodeURIComponent(numero)}${query}`);
    state.devReturnInbound.selectedNumero = numero;
    state.devReturnInbound.selectedCodigoEnvia = codigoEnvia || "";
    state.devReturnInbound.detail = response.devolucion || null;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la devolución recibida ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnInbound.loadingDetail = false;
    render();
  }
}

async function approveInboundDevReturn(numero, codigoEnvia) {
  state.devReturnInbound.approving = true;
  clearFlash();
  render();

  try {
    const query = codigoEnvia ? `?codigoEnvia=${encodeURIComponent(codigoEnvia)}` : "";
    const response = await apiFetch(`/dev-returns/inbound/${encodeURIComponent(numero)}/approve${query}`, {
      method: "POST",
    });
    state.devReturnInbound.detail = response.devolucion || state.devReturnInbound.detail;
    await loadInboundDevReturns({ renderAfter: false });
    setFlash("Devolución aprobada correctamente. El inventario ya fue cargado en destino.", "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturnInbound.approving = false;
    render();
  }
}

async function fillDevReturnLineFromInventory(index, codigoBarra) {
  captureDevReturnDraft();
  const initialDraft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);

  try {
    const response = await apiFetch(`/inventory/${encodeURIComponent(codigoBarra)}`);
    const article = response.mercancia || response;
    captureDevReturnDraft();
    const latestDraft = state.devReturns.draft || initialDraft;
    const items = Array.isArray(latestDraft.items) && latestDraft.items.length
      ? [...latestDraft.items]
      : [createEmptyDevReturnLineDraft()];
    const currentLine = items[index] || createEmptyDevReturnLineDraft();
    const ultimoCosto = article.inventario?.costos?.ultimo ?? article.costos?.ultimo ?? currentLine.costo ?? "";

    items[index] = {
      ...currentLine,
      codigoBarra: article.codigoBarra || codigoBarra,
      referencia: article.referencia || currentLine.referencia || "",
      nombre: article.general?.nombre || article.nombre || currentLine.nombre || "",
      costo: toInputValue(ultimoCosto),
      cantidad: currentLine.cantidad || "1",
      numeroCaja: currentLine.numeroCaja || "0",
    };

    state.devReturns.draft = {
      ...latestDraft,
      items,
    };
    clearFlash();
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el articulo ${codigoBarra}: ${extractErrorMessage(error)}`, "error");
  } finally {
    render();
  }
}

async function loadAdjustmentsMetadata(options = {}) {
  const { renderAfter = true } = options;
  state.adjustments.loadingMetadata = true;
  if (renderAfter) {
    render();
  }

  try {
    state.adjustments.metadata = await apiFetch("/adjustments/metadata");
    if (!state.adjustments.draft?.numero) {
      state.adjustments.draft = createEmptyAdjustmentDraft(state.adjustments.metadata);
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la configuracion de ajustes: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.adjustments.loadingMetadata = false;
    if (renderAfter) {
      render();
    }
  }
}

async function fillAdjustmentLineFromInventory(index, codigoBarra) {
  captureAdjustmentDraft();
  const draft = state.adjustments.draft || createEmptyAdjustmentDraft(state.adjustments.metadata);
  const items = Array.isArray(draft.items) && draft.items.length ? [...draft.items] : [createEmptyAdjustmentLineDraft()];

  try {
    const response = await apiFetch(`/inventory/${encodeURIComponent(codigoBarra)}`);
    const article = response.mercancia || response;
    const currentLine = items[index] || createEmptyAdjustmentLineDraft();
    const ultimoCosto = article.inventario?.costos?.ultimo ?? article.costos?.ultimo ?? currentLine.costo ?? "";

    items[index] = {
      ...currentLine,
      codigoBarra: article.codigoBarra || codigoBarra,
      referencia: article.referencia || currentLine.referencia || "",
      nombre: article.general?.nombre || article.nombre || currentLine.nombre || "",
      costo: toInputValue(ultimoCosto),
      existenciaActual: toInputValue(article.inventario?.existenciaActual ?? currentLine.existenciaActual ?? ""),
      cantidad: currentLine.cantidad || "1",
    };

    state.adjustments.draft = {
      ...draft,
      items,
    };
    clearFlash();
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el articulo ${codigoBarra}: ${extractErrorMessage(error)}`, "error");
  } finally {
    render();
  }
}

async function saveAdjustment() {
  const draft = state.adjustments.draft || createEmptyAdjustmentDraft(state.adjustments.metadata);
  const validationMessage = validateAdjustmentDraft(draft);
  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  state.adjustments.saving = true;
  clearFlash();
  render();

  try {
    const payload = buildAdjustmentPayload(draft);
    const response = draft.numero
      ? await apiFetch(`/adjustments/${encodeURIComponent(draft.numero)}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch("/adjustments", {
          method: "POST",
          body: payload,
        });

    state.adjustments.draft = adjustmentToDraft(response.ajuste, state.adjustments.metadata);
    setFlash(
      draft.numero
        ? `Ajuste ${response.ajuste?.numero || draft.numero} actualizado correctamente.`
        : `Ajuste ${response.ajuste?.numero || ""} guardado correctamente.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.adjustments.saving = false;
    render();
  }
}

async function approveAdjustment(numero) {
  state.adjustments.approving = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/adjustments/${encodeURIComponent(numero)}/approve`, {
      method: "POST",
      body: {},
    });

    state.adjustments.draft = adjustmentToDraft(response.ajuste, state.adjustments.metadata);
    setFlash(`Ajuste ${response.ajuste?.numero || numero} aprobado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.adjustments.approving = false;
    render();
  }
}

async function loadSucursales(options = {}) {
  const { renderAfter = true } = options;
  state.sucursales.loading = true;
  if (renderAfter) {
    render();
  }

  try {
    const response = await apiFetch("/sucursales");
    state.sucursales.items = Array.isArray(response.sucursales) ? response.sucursales : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar las sucursales: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.sucursales.loading = false;
    if (renderAfter) {
      render();
    }
  }
}

async function loadSucursalForEdit(codigo) {
  state.sucursales.loading = true;
  clearFlash();
  render();

  try {
    const response = await apiFetch(`/sucursales/${encodeURIComponent(codigo)}`);
    state.sucursales.selectedCodigo = response.sucursal?.codigo || codigo;
    state.sucursales.draft = sucursalToDraft(response.sucursal);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la sucursal ${codigo}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.sucursales.loading = false;
    render();
  }
}

async function loadInventoryExistenceWorkspace() {
  if (!state.metadata && userCanAccessFullInventory()) {
    await loadCreationMetadata({ renderAfter: false });
  }

  await loadInventoryExistence(state.inventoryExistence.pagination.page || 1);
}

async function loadInventoryExistence(page = 1, options = {}) {
  const { renderAfter = true, background = false } = options;

  if (background) {
    state.inventoryExistence.refreshing = true;
  } else {
    state.inventoryExistence.loading = true;
  }

  if (renderAfter && !background) {
    render();
  }

  try {
    const params = new URLSearchParams();
    const pagination = state.inventoryExistence.pagination || {};
    const search = state.inventoryExistence.search || {};
    const limit = Math.max(1, Math.min(Number(pagination.limit || 25), 100));

    params.set("page", String(Math.max(page, 1)));
    params.set("limit", String(limit));

    if (search.buscar) {
      params.set("buscar", search.buscar);
    }
    if (search.status) {
      params.set("status", search.status);
    }
    if (search.tipo) {
      params.set("tipo", search.tipo);
    }

    const response = await apiFetch(`/inventory?${params.toString()}`);
    state.inventoryExistence.items = Array.isArray(response.data) ? response.data : [];
    state.inventoryExistence.pagination = response.pagination || {
      page: 1,
      limit,
      total: 0,
      totalPages: 0,
    };
    state.inventoryExistence.lastUpdatedAt = new Date().toISOString();
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo consultar la existencia del inventario: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.inventoryExistence.loading = false;
    state.inventoryExistence.refreshing = false;
    if (renderAfter) {
      render();
    }
  }
}

async function saveSucursal() {
  const draft = state.sucursales.draft || createEmptySucursalDraft();
  state.sucursales.saving = true;
  clearFlash();
  render();

  try {
    const payload = buildSucursalPayload(draft);
    const response = draft.originalCodigo
      ? await apiFetch(`/sucursales/${encodeURIComponent(draft.originalCodigo)}`, {
          method: "PATCH",
          body: payload,
        })
      : await apiFetch("/sucursales", {
          method: "POST",
          body: payload,
        });

    state.sucursales.selectedCodigo = response.sucursal?.codigo || draft.codigo || "";
    state.sucursales.draft = sucursalToDraft(response.sucursal);
    await loadSucursales({ renderAfter: false });
    setFlash(
      draft.originalCodigo
        ? `Sucursal ${response.sucursal?.codigo || draft.originalCodigo} actualizada correctamente.`
        : `Sucursal ${response.sucursal?.codigo || ""} guardada correctamente.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.sucursales.saving = false;
    render();
  }
}

async function deleteSucursal(codigo) {
  const normalizedCode = String(codigo || "").trim();
  if (!normalizedCode) {
    return;
  }

  const confirmed = window.confirm(`Se eliminara la sucursal ${normalizedCode}. Deseas continuar?`);
  if (!confirmed) {
    return;
  }

  state.sucursales.deleting = true;
  clearFlash();
  render();

  try {
    await apiFetch(`/sucursales/${encodeURIComponent(normalizedCode)}`, {
      method: "DELETE",
    });

    resetSucursalDraft();
    await loadSucursales({ renderAfter: false });
    setFlash(`Sucursal ${normalizedCode} eliminada correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.sucursales.deleting = false;
    render();
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
    state.articleEditorTab = "general";
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
  const isEditing = state.formMode === "edit" && Boolean(state.activeArticleCode);

  if (validationMessage) {
    setFlash(validationMessage, "error");
    render();
    return;
  }

  if (!isEditing && !userCanCreateArticlesInCurrentInstance()) {
    setFlash("Solo la bodega principal puede crear articulos nuevos.", "error");
    render();
    return;
  }

  state.submittingForm = true;
  clearFlash();
  render();

  try {
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
    const savedCode = savedArticle?.codigoBarra || state.activeArticleCode;

    if (isEditing) {
      state.selectedArticle = savedArticle;
      state.activeArticleCode = savedCode;
      state.formMode = "edit";
      state.formDraft = articleToDraft(savedArticle);
    }

    await loadArticles(isEditing ? state.pagination.page || 1 : 1, { renderAfter: false });

    if (isEditing) {
      setFlash(`Articulo ${savedCode} actualizado correctamente.`, "success");
    } else {
      resetArticleForm();
      setFlash(`Articulo ${savedCode} creado correctamente.`, "success");
    }
  } catch (error) {
    console.error(error);
    if (error?.status === 409) {
      const conflictMessage = extractArticleConflictMessage(error);
      if (conflictMessage.toLowerCase().includes("codigo de barra")) {
        state.articleEditorTab = "variantes";
      } else if (conflictMessage.toLowerCase().includes("referencia")) {
        state.articleEditorTab = "general";
      }
      setFlash(`No se pudo guardar el articulo. ${conflictMessage}`, "error");
    } else {
      setFlash(extractErrorMessage(error), "error");
    }
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

async function openArticleLookupModal() {
  captureArticleDraft();
  state.articleLookup.open = true;
  state.articleLookup.loading = true;
  state.articleLookup.items = [];
  render();

  try {
    state.articleLookup.items = await fetchAllArticlesForLookup();
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el buscador de articulos: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.articleLookup.loading = false;
    render();
  }
}

function closeArticleLookupModal() {
  state.articleLookup.open = false;
  state.articleLookup.loading = false;
}

async function openAdjustmentLookupModal() {
  captureAdjustmentDraft();
  state.adjustmentLookup.open = true;
  state.adjustmentLookup.loading = true;
  state.adjustmentLookup.items = [];
  render();

  try {
    const response = await apiFetch("/adjustments?limit=50");
    state.adjustmentLookup.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el catalogo de ajustes: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.adjustmentLookup.loading = false;
    render();
  }
}

function closeAdjustmentLookupModal() {
  state.adjustmentLookup.open = false;
  state.adjustmentLookup.loading = false;
}

async function openTransferLookupModal() {
  captureTransferDraft();
  state.transferLookup.open = true;
  state.transferLookup.loading = true;
  state.transferLookup.items = [];
  render();

  try {
    const endpoint = state.currentView === "cargar-transferencia" ? "/transfers/inbound" : "/transfers";
    const response = await apiFetch(`${endpoint}?limit=100`);
    state.transferLookup.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el catalogo de transferencias: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transferLookup.loading = false;
    render();
  }
}

function closeTransferLookupModal() {
  state.transferLookup.open = false;
  state.transferLookup.loading = false;
}

async function loadAdjustmentForEdit(numero) {
  state.loadingForm = true;
  clearFlash();
  render();

  try {
    if (!state.adjustments.metadata) {
      await loadAdjustmentsMetadata({ renderAfter: false });
    }

    const response = await apiFetch(`/adjustments/${encodeURIComponent(numero)}`);
    state.adjustments.draft = adjustmentToDraft(response.ajuste, state.adjustments.metadata);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el ajuste ${numero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.loadingForm = false;
    render();
  }
}

async function fetchAllArticlesForLookup() {
  const items = [];
  const limit = 100;
  let page = 1;
  let totalPages = 1;

  do {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));

    const response = await apiFetch(`/inventory?${params.toString()}`);
    const pageItems = Array.isArray(response.data) ? response.data : [];
    items.push(...pageItems);
    totalPages = response.pagination?.totalPages || 1;
    page += 1;
  } while (page <= totalPages);

  return items;
}

function resetTransferDraft() {
  state.transfers.selectedNumero = null;
  state.transfers.receiptNumero = null;
  state.transfers.draft = createEmptyTransferDraft(state.transfers.metadata);
}

function createEmptyTransferSearch() {
  return {
    buscar: "",
    status: "",
    limit: "25",
  };
}

function readTransferSearch(form) {
  return {
    buscar: readFormFieldValue(form, "buscar", ""),
    status: readFormFieldValue(form, "status", ""),
    limit: readFormFieldValue(form, "limit", "25") || "25",
  };
}

function createEmptyTransferDraft(metadata) {
  return {
    numero: null,
    fecha: new Date().toISOString(),
    fechaEmision: null,
    codigoEnvia: "",
    codigoEnviaNombre: "",
    codigoRecibe: "",
    codigoRecibeNombre: "",
    documentoOrigen: "",
    observacion: "",
    idDespacho: String(metadata?.defaults?.idDespacho ?? "0"),
    zona: "",
    correccion: false,
    status: 0,
    syncStatus: "",
    cargada: false,
    fechaCarga: null,
    items: [createEmptyTransferLineDraft()],
  };
}

function createEmptyTransferLineDraft() {
  return {
    codigoBarra: "",
    referencia: "",
    cantidad: "1",
    valor: "",
    numeroCaja: "0",
    articuloNombre: "",
    existenciaActual: "",
    existenciaLote: "",
  };
}

function captureTransferDraft() {
  const form = document.getElementById("transfer-form");
  if (!form) {
    return;
  }

  state.transfers.draft = readTransferDraft(form);
}

function readTransferDraft(form) {
  const currentDraft = state.transfers.draft || createEmptyTransferDraft(state.transfers.metadata);
  const rows = Array.from(form.querySelectorAll("[data-transfer-line-row]"));
  const items = rows
    .map((row) => ({
      codigoBarra: readRowFieldValue(row, "codigoBarra", ""),
      referencia: readRowFieldValue(row, "referencia", ""),
      cantidad: readRowFieldValue(row, "cantidad", "1"),
      numeroCaja: readRowFieldValue(row, "numeroCaja", "0"),
      articuloNombre: String(row.querySelector("[data-transfer-item-name]")?.textContent || "").trim(),
      existenciaActual: String(row.querySelector("[data-transfer-line-existence]")?.textContent || "").trim(),
    }))
    .filter((item) => item.codigoBarra || item.referencia || item.cantidad || item.articuloNombre);

  return {
    numero: currentDraft.numero,
    fecha: currentDraft.fecha,
    fechaEmision: currentDraft.fechaEmision,
    codigoEnvia: readFormFieldValue(form, "codigoEnvia", currentDraft.codigoEnvia),
    codigoRecibe: readFormFieldValue(form, "codigoRecibe", currentDraft.codigoRecibe),
    documentoOrigen: readFormFieldValue(form, "documentoOrigen", currentDraft.documentoOrigen),
    observacion: readFormFieldValue(form, "observacion", currentDraft.observacion),
    idDespacho: readFormFieldValue(form, "idDespacho", currentDraft.idDespacho),
    zona: readFormFieldValue(form, "zona", currentDraft.zona),
    correccion: readFormCheckboxValue(form, "transferenciaCorreccion", currentDraft.correccion),
    status: currentDraft.status,
    items: items.length ? items : [createEmptyTransferLineDraft()],
  };
}

function readRowFieldValue(row, name, fallback = "") {
  const field = row?.querySelector(`[name="${name}"]`);
  if (!field || !("value" in field)) {
    return fallback;
  }

  return field.value;
}

function validateTransferDraft(draft) {
  const codigoEnvia = String(draft.codigoEnvia || "").trim().toUpperCase();
  const codigoRecibe = String(draft.codigoRecibe || "").trim().toUpperCase();

  if (codigoEnvia && codigoRecibe && codigoEnvia === codigoRecibe) {
    return "El origen y el destino no pueden ser iguales.";
  }

  const validLines = (draft.items || []).filter((item) => String(item.codigoBarra || "").trim());

  for (const item of validLines) {
    const cantidad = Number(item.cantidad || 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return `La cantidad del articulo ${item.codigoBarra || ""} debe ser mayor a cero.`;
    }
  }

  return "";
}

function buildTransferPayload(draft) {
  return {
    codigoEnvia: String(draft.codigoEnvia || "").trim().toUpperCase() || undefined,
    codigoRecibe: String(draft.codigoRecibe || "").trim().toUpperCase() || undefined,
    documentoOrigen: String(draft.documentoOrigen || "").trim() || undefined,
    observacion: String(draft.observacion || "").trim() || undefined,
    idDespacho: Number.parseInt(String(draft.idDespacho || "0"), 10),
    zona: String(draft.zona || "").trim() || undefined,
    correccion: Boolean(draft.correccion),
    items: (draft.items || [])
      .filter((item) => String(item.codigoBarra || "").trim())
      .map((item) => ({
        codigoBarra: String(item.codigoBarra || "").trim().toUpperCase(),
        referencia: String(item.referencia || "").trim().toUpperCase(),
        cantidad: String(item.cantidad || "").trim(),
        numeroCaja: Number.parseInt(String(item.numeroCaja || "0"), 10) || 0,
      })),
  };
}

function transferToDraft(transfer, metadata = state.transfers?.metadata) {
  return {
    numero: transfer?.numero ?? null,
    fecha: transfer?.fecha || new Date().toISOString(),
    fechaEmision: Number(transfer?.status ?? 0) === 1 ? transfer?.fechaEmision || transfer?.fechaAprobacion || null : null,
    codigoEnvia: transfer?.codigoEnvia || "",
    codigoEnviaNombre: transfer?.codigoEnviaInfo?.nombre || transfer?.codigoEnvia || "",
    codigoRecibe: transfer?.codigoRecibe || "",
    codigoRecibeNombre: transfer?.codigoRecibeInfo?.nombre || transfer?.codigoRecibe || "",
    documentoOrigen: transfer?.documentoOrigen || "",
    observacion: transfer?.observacion || "",
    idDespacho: String(transfer?.idDespacho ?? metadata?.defaults?.idDespacho ?? "0"),
    zona: transfer?.zona || "",
    correccion: Boolean(transfer?.correccion),
    status: Number(transfer?.status ?? 0),
    syncStatus: transfer?.syncStatus || "",
    cargada: Boolean(transfer?.cargada),
    fechaCarga: transfer?.fechaCarga || null,
    items: Array.isArray(transfer?.items) && transfer.items.length > 0
      ? transfer.items.map((item) => ({
          codigoBarra: item.codigoBarra || "",
          referencia: item.articulo?.referencia || item.referencia || "",
          cantidad: toInputValue(item.cantidad),
          valor: toInputValue(item.valor),
          numeroCaja: toInputValue(item.numeroCaja),
          articuloNombre: item.articulo?.nombre || "",
          existenciaActual: item.articulo?.existenciaActual || "",
          existenciaLote: item.articulo?.existenciaActual || "",
        }))
      : [createEmptyTransferLineDraft()],
  };
}

function computeTransferDraftTotal(draft) {
  return (draft.items || []).reduce((total, item) => {
    return total + computeTransferLineTotal(item);
  }, 0);
}

function computeTransferDraftQuantity(draft) {
  return (draft.items || []).reduce((total, item) => {
    const quantity = Number(item?.cantidad || 0);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function computeTransferLineTotal(line) {
  const quantity = Number(line?.cantidad || 0);
  const value = Number(line?.valor || 0);
  if (!Number.isFinite(quantity) || !Number.isFinite(value)) {
    return 0;
  }

  return quantity * value;
}

function formatTransferQuantity(value) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function resetDevReturnDraft() {
  state.devReturns.selectedNumero = null;
  state.devReturns.draft = createEmptyDevReturnDraft(state.devReturns.metadata);
}

function createEmptyDevReturnDraft(metadata) {
  return {
    numero: null,
    fecha: toDateInputValue(new Date()),
    codigoOrigen: String(metadata?.defaults?.codigoOrigen || metadata?.origenes?.[0]?.codigo || metadata?.contexto?.sucursalCodigo || "ORIGEN"),
    codigoDestino: String(metadata?.defaults?.codigoDestino || metadata?.destinos?.[0]?.codigo || "ORIGEN"),
    observacion: "",
    status: 0,
    items: [createEmptyDevReturnLineDraft()],
  };
}

function createEmptyDevReturnLineDraft() {
  return {
    codigoBarra: "",
    referencia: "",
    nombre: "",
    cantidad: "",
    numeroCaja: "0",
    costo: "",
  };
}

function captureDevReturnDraft() {
  const form = document.getElementById("dev-return-form");
  if (!form) {
    return;
  }

  state.devReturns.draft = readDevReturnDraft(form);
}

function readDevReturnDraft(form) {
  const currentDraft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);
  const rows = Array.from(form.querySelectorAll("[data-dev-return-line-row]"));
  const items = rows
    .map((row) => ({
      codigoBarra: readRowFieldValue(row, "codigoBarra", ""),
      referencia: readRowFieldValue(row, "referencia", ""),
      nombre: readRowFieldValue(row, "nombre", ""),
      cantidad: readRowFieldValue(row, "cantidad", "1"),
      numeroCaja: readRowFieldValue(row, "numeroCaja", "0"),
      costo: readRowFieldValue(row, "costo", ""),
    }))
    .filter((item) => item.codigoBarra || item.referencia || item.nombre || item.cantidad);

  return {
    numero: currentDraft.numero,
    fecha: readFormFieldValue(form, "fecha", currentDraft.fecha),
    codigoOrigen: readFormFieldValue(form, "codigoOrigen", currentDraft.codigoOrigen),
    codigoDestino: readFormFieldValue(form, "codigoDestino", currentDraft.codigoDestino),
    observacion: readFormFieldValue(form, "observacion", currentDraft.observacion),
    status: currentDraft.status,
    items: items.length ? items : [createEmptyDevReturnLineDraft()],
  };
}

function validateDevReturnDraft(draft) {
  const codigoOrigen = String(draft.codigoOrigen || "").trim().toUpperCase();
  if (!codigoOrigen) {
    return "Debes indicar la bodega origen.";
  }

  const codigoDestino = String(draft.codigoDestino || "").trim().toUpperCase();
  if (!codigoDestino) {
    return "Debes indicar la bodega destino.";
  }

  if (codigoOrigen === codigoDestino) {
    return "El origen y el destino del borrador no pueden ser iguales.";
  }

  const validLines = (draft.items || []).filter((item) => String(item.codigoBarra || "").trim());
  if (!validLines.length) {
    return "El borrador de devolucion debe tener al menos un renglon.";
  }

  for (const item of validLines) {
    const cantidad = Number(item.cantidad || 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return `La cantidad del articulo ${item.codigoBarra || ""} debe ser mayor a cero.`;
    }
  }

  return "";
}

function buildDevReturnPayload(draft) {
  return {
    fecha: toApiDateTime(draft.fecha),
    codigoOrigen: String(draft.codigoOrigen || "").trim().toUpperCase() || undefined,
    codigoDestino: String(draft.codigoDestino || "").trim().toUpperCase() || undefined,
    observacion: String(draft.observacion || "").trim() || undefined,
    items: (draft.items || [])
      .filter((item) => String(item.codigoBarra || "").trim())
      .map((item) => ({
        codigoBarra: String(item.codigoBarra || "").trim().toUpperCase(),
        cantidad: String(item.cantidad || "").trim(),
        numeroCaja: Number.parseInt(String(item.numeroCaja || "0"), 10) || 0,
        costo: String(item.costo || "").trim() || undefined,
      })),
  };
}

function devReturnToDraft(draft, metadata = state.devReturns?.metadata) {
  return {
    numero: draft?.numero ?? null,
    fecha: toDateInputValue(draft?.fecha),
    codigoOrigen: draft?.codigoOrigen || metadata?.defaults?.codigoOrigen || metadata?.origenes?.[0]?.codigo || metadata?.contexto?.sucursalCodigo || "ORIGEN",
    codigoDestino: draft?.codigoDestino || metadata?.defaults?.codigoDestino || metadata?.destinos?.[0]?.codigo || "ORIGEN",
    observacion: draft?.observacion || "",
    status: Number(draft?.status ?? 0),
    items: Array.isArray(draft?.items) && draft.items.length > 0
      ? draft.items.map((item) => ({
          codigoBarra: item.codigoBarra || "",
          referencia: item.articulo?.referencia || item.referencia || "",
          nombre: item.articulo?.nombre || item.nombre || "",
          cantidad: toInputValue(item.cantidad),
          numeroCaja: toInputValue(item.numeroCaja),
          costo: toInputValue(item.costo),
        }))
      : [createEmptyDevReturnLineDraft()],
  };
}

function computeDevReturnDraftTotal(draft) {
  return (draft.items || []).reduce((total, item) => {
    const quantity = Number(item?.cantidad || 0);
    const cost = Number(item?.costo || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(cost)) {
      return total;
    }

    return total + quantity * cost;
  }, 0);
}

function computeDevReturnDraftQuantity(draft) {
  return (draft.items || []).reduce((total, item) => {
    const quantity = Number(item?.cantidad || 0);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function resetAdjustmentDraft() {
  state.adjustments.draft = createEmptyAdjustmentDraft(state.adjustments.metadata);
}

function createEmptyAdjustmentDraft(metadata) {
  return {
    numero: null,
    fecha: toDateInputValue(new Date()),
    tipo: metadata?.defaults?.tipo || "positivo",
    tipoAjuste: String(metadata?.defaults?.tipoAjuste ?? "1"),
    idLote: String(metadata?.defaults?.idLote ?? ""),
    observacion: "",
    status: 0,
    items: [createEmptyAdjustmentLineDraft()],
  };
}

function createEmptyAdjustmentLineDraft() {
  return {
    codigoBarra: "",
    referencia: "",
    nombre: "",
    cantidad: "",
    costo: "",
    existenciaActual: "",
  };
}

function captureAdjustmentDraft() {
  const form = document.getElementById("adjustment-form");
  if (!form) {
    return;
  }

  state.adjustments.draft = readAdjustmentDraft(form);
}

function readAdjustmentDraft(form) {
  const currentDraft = state.adjustments.draft || createEmptyAdjustmentDraft(state.adjustments.metadata);
  const rows = Array.from(form.querySelectorAll("[data-adjustment-line-row]"));
  const items = rows
    .map((row) => ({
      codigoBarra: readRowFieldValue(row, "codigoBarra", ""),
      referencia: readRowFieldValue(row, "referencia", ""),
      nombre: readRowFieldValue(row, "nombre", ""),
      cantidad: readRowFieldValue(row, "cantidad", ""),
      costo: readRowFieldValue(row, "costo", ""),
    }))
    .filter((item) => item.codigoBarra || item.referencia || item.nombre || item.cantidad);

  return {
    numero: currentDraft.numero,
    fecha: readFormFieldValue(form, "fecha", currentDraft.fecha),
    tipo: readFormFieldValue(form, "tipo", currentDraft.tipo || "positivo"),
    tipoAjuste: resolveAdjustmentTypeId(readFormFieldValue(form, "tipo", currentDraft.tipo || "positivo")),
    idLote: readFormFieldValue(form, "idLote", currentDraft.idLote),
    observacion: readFormFieldValue(form, "observacion", currentDraft.observacion),
    status: currentDraft.status,
    items: items.length ? items : [createEmptyAdjustmentLineDraft()],
  };
}

function validateAdjustmentDraft(draft) {
  const validLines = (draft.items || []).filter((item) => String(item.codigoBarra || "").trim());

  if (!validLines.length) {
    return "El ajuste debe tener al menos un renglon.";
  }

  for (const item of validLines) {
    const cantidad = Number(item.cantidad || 0);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return `La cantidad del articulo ${item.codigoBarra || ""} debe ser mayor a cero.`;
    }
  }

  return "";
}

function buildAdjustmentPayload(draft) {
  const tipo = String(draft.tipo || "positivo");
  const idLote = Number.parseInt(String(draft.idLote || ""), 10);

  return {
    tipo,
    fecha: toApiDateTime(draft.fecha),
    observacion: String(draft.observacion || "").trim() || undefined,
    idLote: Number.isInteger(idLote) ? idLote : undefined,
    tipoAjuste: resolveAdjustmentTypeId(tipo),
    items: (draft.items || [])
      .filter((item) => String(item.codigoBarra || "").trim())
      .map((item) => ({
        codigoBarra: String(item.codigoBarra || "").trim().toUpperCase(),
        cantidad: String(item.cantidad || "").trim(),
        costo: String(item.costo || "").trim() || undefined,
      })),
  };
}

function adjustmentToDraft(adjustment, metadata = state.adjustments?.metadata) {
  const tipo = adjustment?.tipo || (Number(adjustment?.signo || 1) === -1 ? "negativo" : "positivo");

  return {
    numero: adjustment?.numero ?? null,
    fecha: toDateInputValue(adjustment?.fecha),
    tipo,
    tipoAjuste: String(adjustment?.tipoAjuste ?? resolveAdjustmentTypeId(tipo)),
    idLote: String(adjustment?.idLote ?? metadata?.defaults?.idLote ?? ""),
    observacion: adjustment?.observacion || "",
    status: Number(adjustment?.status ?? 0),
    items: Array.isArray(adjustment?.items) && adjustment.items.length > 0
      ? adjustment.items.map((item) => ({
          codigoBarra: item.codigoBarra || "",
          referencia: item.referencia || "",
          nombre: item.nombre || "",
          cantidad: toInputValue(item.cantidad),
          costo: toInputValue(item.costo),
          existenciaActual: toInputValue(item.existenciaActual),
        }))
      : [createEmptyAdjustmentLineDraft()],
  };
}

function resolveAdjustmentTypeId(tipo) {
  return String(tipo || "positivo") === "negativo" ? 2 : 1;
}

function computeAdjustmentDraftQuantity(draft) {
  return (draft.items || []).reduce((total, item) => {
    const quantity = Number(item?.cantidad || 0);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function resolveTransferLineLotLabel() {
  const draft = state.transfers?.draft || {};
  const selected = String(draft.idLote || "").trim();
  return selected || "Auto";
}

function resetSucursalDraft() {
  state.sucursales.selectedCodigo = "";
  state.sucursales.draft = createEmptySucursalDraft();
}

function createEmptySucursalDraft() {
  return {
    originalCodigo: "",
    codigo: "",
    nombre: "",
    direccion: "",
    telefono: "",
    status: "1",
    porcentajeDeRedondeo: "0",
  };
}

function captureSucursalDraft() {
  const form = document.getElementById("sucursal-form");
  if (!form) {
    return;
  }

  state.sucursales.draft = readSucursalDraft(form);
}

function readSucursalDraft(form) {
  const currentDraft = state.sucursales.draft || createEmptySucursalDraft();

  return {
    originalCodigo: currentDraft.originalCodigo || "",
    codigo: readFormFieldValue(form, "codigo", currentDraft.codigo),
    nombre: readFormFieldValue(form, "nombre", currentDraft.nombre),
    direccion: readFormFieldValue(form, "direccion", currentDraft.direccion),
    telefono: readFormFieldValue(form, "telefono", currentDraft.telefono),
    status: readFormFieldValue(form, "status", currentDraft.status || "1"),
    porcentajeDeRedondeo: readFormFieldValue(
      form,
      "porcentajeDeRedondeo",
      currentDraft.porcentajeDeRedondeo || "0",
    ),
  };
}

function buildSucursalPayload(draft) {
  return {
    codigo: String(draft.codigo || "").trim().toUpperCase() || undefined,
    nombre: String(draft.nombre || "").trim() || undefined,
    direccion: String(draft.direccion || "").trim() || undefined,
    telefono: String(draft.telefono || "").trim() || undefined,
    status: Number.parseInt(String(draft.status ?? "1"), 10),
    porcentajeDeRedondeo: String(draft.porcentajeDeRedondeo || "").trim() || undefined,
  };
}

function sucursalToDraft(sucursal) {
  return {
    originalCodigo: sucursal?.codigo || "",
    codigo: sucursal?.codigo || "",
    nombre: sucursal?.nombre || "",
    direccion: sucursal?.direccion || "",
    telefono: sucursal?.telefono || "",
    status: String(sucursal?.status ?? 1),
    porcentajeDeRedondeo: toInputValue(sucursal?.porcentajeDeRedondeo ?? "0"),
  };
}

function resetArticleForm() {
  state.formMode = "create";
  state.articleEditorTab = "general";
  state.activeArticleCode = "";
  state.selectedArticle = null;
  state.formDraft = createEmptyDraft();
}

function createEmptyDraft() {
  return withDraftDefaults({
    codigoBarra: "",
    referencia: "",
    serializado: false,
    general: {
      categoria: "",
      fabricante: "",
      marca: "",
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
    referencia: draft?.referencia || "",
    serializado: Boolean(draft?.serializado),
    general: {
      categoria: draft?.general?.categoria || "",
      fabricante: draft?.general?.fabricante || "",
      marca: draft?.general?.marca || "",
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

function captureArticleDraft() {
  const articleForm = document.getElementById("article-form");
  if (!articleForm) {
    return;
  }

  state.formDraft = readArticleDraft(articleForm);
}

function syncArticleFormPreview(form) {
  state.formDraft = readArticleDraft(form);

  const preview = document.querySelector("[data-article-current-view]");
  if (!preview) {
    return;
  }

  preview.textContent = formatArticleCurrentView(state.formDraft);
}

function formatArticleCurrentView(draft) {
  const currentDraft = withDraftDefaults(draft || createEmptyDraft());
  return `${currentDraft.tallasColores.talla || "Sin talla"} / ${currentDraft.tallasColores.colores || "Sin color"}`;
}

function articleToDraft(article) {
  return withDraftDefaults({
    codigoBarra: article?.codigoBarra || "",
    referencia: article?.referencia || article?.codigoBarraAnt || "",
    serializado: Boolean(article?.inventario?.serializado),
    general: {
      categoria: article?.general?.categoria?.nombre || article?.general?.categoria?.codigo || "",
      fabricante: article?.general?.fabricante?.nombre || article?.general?.fabricante?.codigo || "",
      marca: article?.general?.marca?.nombre || article?.general?.marca?.codigo || "",
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
        ? toDateInputValue(article?.precios?.promocion?.desde)
        : "",
      hasta: article?.precios?.promocion?.activa
        ? toDateInputValue(article?.precios?.promocion?.hasta)
        : "",
    },
  });
}

function buildArticlePayload(draft, includeCode) {
  const payload = {
    codigoBarra: draft.codigoBarra.trim().toUpperCase(),
    referencia: draft.referencia.trim(),
    serializado: draft.serializado ? 1 : 0,
    general: {
      categoria: draft.general.categoria.trim(),
      fabricante: draft.general.fabricante.trim(),
      marca: draft.general.marca.trim(),
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
            desde: toApiDateTime(draft.precios.desde, "start"),
            hasta: toApiDateTime(draft.precios.hasta, "end"),
          }
        : {
            activa: false,
          },
    },
  };

  if (!includeCode) {
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
    { value: draft.codigoBarra, label: "codigo de barra" },
    { value: draft.referencia, label: "referencia" },
    { value: draft.general.categoria, label: "categoria" },
    { value: draft.general.fabricante, label: "fabricante" },
    { value: draft.general.nombre, label: "nombre" },
    { value: draft.general.familia, label: "familia" },
    { value: draft.tallasColores.talla, label: "talla" },
    { value: draft.tallasColores.colores, label: "color" },
  ];

  const missing = requiredFields
    .filter((field) => !field.value || !field.value.trim())
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
    mantenerSesion: Boolean(form.elements.mantenerSesion?.checked),
  };
}

function readSearchDraft(form) {
  return {
    buscar: form.elements.buscar.value.trim(),
    status: form.elements.status.value,
    tipo: form.elements.tipo.value,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toInputValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function toDateInputValue(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toApiDateTime(value, boundary = "start") {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return undefined;
  }

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    if (boundary === "end") {
      return `${year}-${month}-${day}T23:59:59.999`;
    }

    return `${year}-${month}-${day}T00:00:00.000`;
  }

  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toISOString();
}

function readArticleDraft(form) {
  const currentDraft = withDraftDefaults(state.formDraft || createEmptyDraft());

  return withDraftDefaults({
    codigoBarra: readFormFieldValue(form, "codigoBarra", currentDraft.codigoBarra),
    referencia: readFormFieldValue(form, "referencia", currentDraft.referencia),
    serializado: readFormCheckboxValue(form, "serializado", currentDraft.serializado),
    general: {
      categoria: readFormFieldValue(form, "categoria", currentDraft.general.categoria),
      fabricante: readFormFieldValue(form, "fabricante", currentDraft.general.fabricante),
      marca: readFormFieldValue(form, "marca", currentDraft.general.marca),
      nombre: readFormFieldValue(form, "nombre", currentDraft.general.nombre),
      puntoRecorte: readFormFieldValue(form, "puntoRecorte", currentDraft.general.puntoRecorte),
      familia: readFormFieldValue(form, "familia", currentDraft.general.familia),
      nota: readFormFieldValue(form, "nota", currentDraft.general.nota),
      tipo: readFormFieldValue(form, "tipo", currentDraft.general.tipo),
      status: readFormFieldValue(form, "status", currentDraft.general.status),
    },
    tallasColores: {
      talla: readFormFieldValue(form, "talla", currentDraft.tallasColores.talla),
      colores: readFormFieldValue(form, "colores", currentDraft.tallasColores.colores),
    },
    precios: {
      impuestoCodigo: readFormFieldValue(form, "impuestoCodigo", currentDraft.precios.impuestoCodigo),
      detal: readFormFieldValue(form, "detal", currentDraft.precios.detal),
      mayor: readFormFieldValue(form, "mayor", currentDraft.precios.mayor),
      afiliado: readFormFieldValue(form, "afiliado", currentDraft.precios.afiliado),
      promocionActiva: readFormCheckboxValue(form, "promocionActiva", currentDraft.precios.promocionActiva),
      descuento: readFormFieldValue(form, "descuento", currentDraft.precios.descuento),
      precio: readFormFieldValue(form, "precioPromocion", currentDraft.precios.precio),
      desde: readFormFieldValue(form, "promocionDesde", currentDraft.precios.desde),
      hasta: readFormFieldValue(form, "promocionHasta", currentDraft.precios.hasta),
    },
  });
}

function readFormFieldValue(form, fieldName, fallback = "") {
  const field = form?.elements?.namedItem?.(fieldName);
  if (!field || !("value" in field)) {
    return fallback;
  }

  return field.value;
}

function readFormCheckboxValue(form, fieldName, fallback = false) {
  const field = form?.elements?.namedItem?.(fieldName);
  if (!field || !("checked" in field)) {
    return fallback;
  }

  return Boolean(field.checked);
}

function createCatalogManualDraft(kind) {
  const config = getCatalogImportConfig(kind);
  const supportsStatus = config?.columns?.some((column) => column.key === "status");

  return {
    codigo: "",
    nombre: "",
    status: supportsStatus ? "1" : "",
  };
}

function getCatalogManualDraft(kind) {
  const existingDraft = state.catalogImport.manualDraftsByKind?.[kind];
  if (existingDraft) {
    return existingDraft;
  }

  const createdDraft = createCatalogManualDraft(kind);
  state.catalogImport.manualDraftsByKind = {
    ...(state.catalogImport.manualDraftsByKind || {}),
    [kind]: createdDraft,
  };
  return createdDraft;
}

function readCatalogManualDraft(form, kind) {
  const config = getCatalogImportConfig(kind);
  const supportsStatus = config?.columns?.some((column) => column.key === "status");

  return {
    codigo: readFormFieldValue(form, "codigo", ""),
    nombre: readFormFieldValue(form, "nombre", ""),
    status: supportsStatus ? readFormFieldValue(form, "status", "1") : "",
  };
}

function validateCatalogManualDraft(kind, draft) {
  const config = getCatalogImportConfig(kind);
  if (!config) {
    return "Catalogo no valido.";
  }

  const supportsName = config.columns.some((column) => column.key === "nombre");
  const codigo = String(draft.codigo || "").trim();
  const nombre = String(draft.nombre || "").trim();
  const catalogLabel = getCatalogSingularLabel(config.singular);

  if (!supportsName && !codigo) {
    return `Debes indicar el codigo de ${catalogLabel}.`;
  }

  if (supportsName && !nombre) {
    return `Debes indicar el nombre de ${catalogLabel}.`;
  }

  if (codigo && config.maxCodeLength && codigo.length > config.maxCodeLength) {
    return `El codigo de ${catalogLabel} no puede tener mas de ${config.maxCodeLength} caracteres.`;
  }

  if (supportsName && nombre && config.maxNameLength && nombre.length > config.maxNameLength) {
    return `El nombre de ${catalogLabel} no puede tener mas de ${config.maxNameLength} caracteres.`;
  }

  return "";
}

function buildCatalogManualPayload(kind, draft) {
  const config = getCatalogImportConfig(kind);
  const supportsStatus = config?.columns?.some((column) => column.key === "status");

  return {
    codigo: String(draft.codigo || "").trim() || undefined,
    nombre: String(draft.nombre || "").trim() || undefined,
    status: supportsStatus ? Number.parseInt(String(draft.status || "1"), 10) : undefined,
  };
}

function getCatalogSingularLabel(singular) {
  if (["categoria", "marca", "talla"].includes(String(singular || "").toLowerCase())) {
    return `la ${singular}`;
  }

  return `el ${singular}`;
}

function syncExistenceAutoRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  if (!state.token || state.currentView !== "existencia") {
    clearExistenceAutoRefresh();
    return;
  }

  if (existenceAutoRefreshHandle !== null) {
    return;
  }

  existenceAutoRefreshHandle = window.setInterval(async () => {
    if (!state.token || state.currentView !== "existencia") {
      clearExistenceAutoRefresh();
      return;
    }

    if (state.inventoryExistence.loading || state.inventoryExistence.refreshing) {
      return;
    }

    await loadInventoryExistence(state.inventoryExistence.pagination.page || 1, {
      background: true,
    });
  }, EXISTENCE_AUTO_REFRESH_MS);
}

function clearExistenceAutoRefresh() {
  if (existenceAutoRefreshHandle === null || typeof window === "undefined") {
    return;
  }

  window.clearInterval(existenceAutoRefreshHandle);
  existenceAutoRefreshHandle = null;
}

async function preloadAuthenticatedDesktopData() {
  if (!userCanAccessFullInventory()) {
    state.metadata = null;
    state.articles = [];
    state.inventoryExistence.items = [];
    state.inventoryExistence.lastUpdatedAt = "";
    state.inventoryExistence.pagination = {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    };
    state.pagination = {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    };
    return;
  }

  await Promise.all([
    loadCreationMetadata({ renderAfter: false }),
    loadArticles(1, { renderAfter: false }),
  ]);
}

function isCatalogImportView(view) {
  return ["categorias", "marcas", "tallas", "colores", "fabricantes"].includes(view);
}

function buildCatalogEntryDeleteKey(kind, code) {
  return `${String(kind || "").trim().toLowerCase()}:${String(code || "").trim().toUpperCase()}`;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeGroupCode(value) {
  const aliases = {
    ADMIN: "ADMI",
    ADMINISTRADOR: "ADMI",
    ADMI: "ADMI",
  };
  const normalized = String(value || "").trim().toUpperCase();
  return aliases[normalized] || normalized;
}

function getCurrentUserGroupCodes() {
  if (!Array.isArray(state.user?.grupos)) {
    return [];
  }

  return state.user.grupos.map((group) => normalizeGroupCode(group.codigo || group.nombre || ""));
}

function getCurrentUserPermissionCodes() {
  if (!Array.isArray(state.user?.permisos)) {
    return [];
  }

  return state.user.permisos
    .map((permission) => String(permission || "").trim().toUpperCase())
    .filter(Boolean);
}

function userCanAccessFullInventory() {
  return getCurrentUserGroupCodes().includes("ADMI");
}

function userCanCreateArticlesInCurrentInstance() {
  return Boolean(state.metadata?.contexto?.puedeCrearArticulos);
}

function userIsSystemOperator() {
  return getCurrentUserGroupCodes().includes("SISTEMA");
}

function userCanImportCatalogsFromExcel() {
  return getCurrentUserPermissionCodes().includes(CATALOG_IMPORT_EXCEL_PERMISSION_CODE);
}

function roleHasCatalogImportPermission(role) {
  return Array.isArray(role?.permisos)
    && role.permisos.some((permission) => String(permission?.codigo || "").toUpperCase() === CATALOG_IMPORT_EXCEL_PERMISSION_CODE);
}

function renderFlash() {
  if (!state.flash?.message) {
    return "";
  }

  return `
    <div class="flash flash-${escapeHtml(state.flash.type || "info")}">
      <span class="flash-message">${escapeHtml(state.flash.message)}</span>
      <button class="flash-dismiss" type="button" data-dismiss-flash aria-label="Cerrar alerta">
        &times;
      </button>
    </div>
  `;
}

function bindFlashEvents() {
  document.querySelectorAll("[data-dismiss-flash]").forEach((button) => {
    button.addEventListener("click", () => {
      clearFlash();
      render();
    });
  });
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
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  headers.set("Accept", "application/json");

  if (options.body !== undefined && !isFormData) {
    headers.set("Content-Type", "application/json");
  }

  if (options.auth !== false && state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
  }

  const response = await window.fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body:
      options.body !== undefined
        ? isFormData
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
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

function extractArticleConflictMessage(error) {
  const message = extractErrorMessage(error);
  if (!message) {
    return "Ya existe un conflicto con los datos del articulo.";
  }

  if (message.toLowerCase().includes("codigo de barra")) {
    return "Ya existe un articulo con ese codigo de barra.";
  }

  if (message.toLowerCase().includes("misma referencia") || message.toLowerCase().includes("referencia")) {
    return "Ya existe un articulo con esa referencia dentro de la misma marca.";
  }

  return message;
}

function setFlash(message, type = "info") {
  state.flash = { message, type };
}

function clearFlash() {
  state.flash = null;
}

function persistSession() {
  const persistent = shouldPersistSession();
  const targetStorage = persistent ? window.localStorage : window.sessionStorage;
  const staleStorage = persistent ? window.sessionStorage : window.localStorage;

  targetStorage.setItem(TOKEN_STORAGE_KEY, state.token);
  targetStorage.setItem(REMEMBER_SESSION_STORAGE_KEY, persistent ? "1" : "0");
  staleStorage.removeItem(TOKEN_STORAGE_KEY);
  staleStorage.removeItem(USER_STORAGE_KEY);
  staleStorage.removeItem(REMEMBER_SESSION_STORAGE_KEY);
  persistUser();
}

function persistUser() {
  getSessionStorage().setItem(USER_STORAGE_KEY, JSON.stringify(state.user));
}

function clearSession() {
  clearExistenceAutoRefresh();
  state.token = "";
  state.user = null;
  state.currentView = "desktop";
  state.navigation = {
    openMenu: "",
    openSubmenu: "",
    menuPinned: false,
  };
  state.articleLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.inventoryExistence = {
    loading: false,
    refreshing: false,
    items: [],
    lastUpdatedAt: "",
    pagination: {
      page: 1,
      limit: 25,
      total: 0,
      totalPages: 0,
    },
    search: {
      buscar: "",
      status: "",
      tipo: "",
    },
  };
  state.catalogImport = {
    uploadingKind: "",
    loadingKind: "",
    deletingEntryKey: "",
    itemsByKind: {},
    manualDraftsByKind: {},
    manualSubmittingKind: "",
  };
  state.roleAccess = {
    loading: false,
    savingRole: "",
    roles: [],
  };
  state.transfers = {
    loadingList: false,
    loadingMetadata: false,
    loadingDetail: false,
    saving: false,
    approving: false,
    deleting: false,
    items: [],
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "25",
    },
    selectedNumero: null,
    draft: createEmptyTransferDraft(),
  };
  state.devReturns = {
    loadingMetadata: false,
    loadingDetail: false,
    loadingDashboard: false,
    loadingInboundDetail: false,
    saving: false,
    exporting: false,
    approvingInbound: false,
    items: [],
    inboundItems: [],
    inboundDetail: null,
    metadata: null,
    search: {
      buscar: "",
      status: "",
      limit: "50",
    },
    selectedNumero: null,
    selectedInboundGlobalId: "",
    draft: createEmptyDevReturnDraft(),
  };
  state.devReturnRecords = {
    loading: false,
    loadingDetail: false,
    exporting: false,
    items: [],
    detail: null,
    selectedNumero: null,
  };
  state.devReturnInbound = {
    loading: false,
    loadingDetail: false,
    approving: false,
    items: [],
    detail: null,
    selectedNumero: null,
    selectedCodigoEnvia: "",
  };
  state.adjustmentLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.transferLookup = {
    open: false,
    loading: false,
    items: [],
  };
  state.devReturnLookup = {
    open: false,
    loading: false,
    items: [],
    mode: "drafts",
  };
  state.articleEditorTab = "general";
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
    mantenerSesion: false,
  };
  resetArticleForm();
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(USER_STORAGE_KEY);
  window.sessionStorage.removeItem(REMEMBER_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
  window.localStorage.removeItem(REMEMBER_SESSION_STORAGE_KEY);
}

function shouldPersistSession() {
  return Boolean(state.loginDraft?.mantenerSesion);
}

function readStoredJson(key) {
  const value = window.sessionStorage.getItem(key) || window.localStorage.getItem(key);
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

function readStoredToken() {
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

function readStoredUser() {
  return readStoredJson(USER_STORAGE_KEY);
}

function hasPersistentSession() {
  return Boolean(window.localStorage.getItem(TOKEN_STORAGE_KEY));
}

function getSessionStorage() {
  return shouldPersistSession() || hasPersistentSession() ? window.localStorage : window.sessionStorage;
}
