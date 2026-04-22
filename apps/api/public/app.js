const API_BASE = "/api";
const TOKEN_STORAGE_KEY = "rocky.maxx.access-token";
const USER_STORAGE_KEY = "rocky.maxx.user";
const CATALOG_IMPORT_EXCEL_PERMISSION_CODE = "CATALOG_IMPORT_EXCEL";

const state = {
  booting: true,
  token: window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || "",
  user: readStoredJson(USER_STORAGE_KEY),
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
    app.innerHTML = renderBootScreen();
    return;
  }

  if (!state.token || !state.user) {
    app.innerHTML = renderLoginView();
    bindLoginEvents();
    bindFlashEvents();
    return;
  }

  app.innerHTML = renderShellView();
  bindShellEvents();
  bindFlashEvents();
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
                <input type="checkbox" name="mantenerSesion" />
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
              ${renderDesktopMenu("procesos", "Procesos", `
                ${renderDesktopMenuLink("reportes", "Movimientos")}
              `)}
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

  if (state.currentView === "desktop") {
    return renderDesktopDashboardV2();
  }

  if (state.currentView === "roles") {
    return renderRoleAccessWorkspace();
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
        <span>Usuario ${escapeHtml((state.user?.codUsuario || "admin").toUpperCase())} | Version 1.0.1</span>
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
        <p>Edita la informacion, variantes y precios del producto.</p>
      </div>
      <div class="article-commandbar-actions">
        <button class="article-command-button" type="button" data-toolbar-new ${state.submittingForm ? "disabled" : ""}>
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
          ${state.submittingForm ? "disabled" : ""}
        >
          ${state.submittingForm ? "Guardando..." : "Guardar"}
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

      state.navigation.openMenu = "archivos";
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

      if (nextView === "roles") {
        await loadRoleAccess();
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
      resetArticleForm();
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

  document.querySelector(".desktop-shell")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-catalog-combobox]")) {
      return;
    }

    closeCatalogComboboxes();
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

    await preloadAuthenticatedDesktopData();

    state.currentView = "desktop";
    state.navigation = {
      openMenu: "",
      openSubmenu: "",
      menuPinned: false,
    };
    state.articleEditorTab = "general";
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

async function preloadAuthenticatedDesktopData() {
  if (!userCanAccessFullInventory()) {
    state.metadata = null;
    state.articles = [];
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
  window.sessionStorage.setItem(TOKEN_STORAGE_KEY, state.token);
  persistUser();
}

function persistUser() {
  window.sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(state.user));
}

function clearSession() {
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
  };
  resetArticleForm();
  window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(USER_STORAGE_KEY);
}

function readStoredJson(key) {
  const value = window.sessionStorage.getItem(key);
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

function capitalize(value) {
  const normalized = String(value || "");
  if (!normalized) {
    return "";
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
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

function toDateInputValue(value) {
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

  return `${year}-${month}-${day}`;
}

function toApiDateTime(value, boundary = "start") {
  if (!value) {
    return undefined;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  let date;

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const hours = boundary === "end" ? 23 : 0;
    const minutes = boundary === "end" ? 59 : 0;
    const seconds = boundary === "end" ? 59 : 0;
    const milliseconds = boundary === "end" ? 999 : 0;
    date = new Date(Number(year), Number(month) - 1, Number(day), hours, minutes, seconds, milliseconds);
  } else {
    date = new Date(value);
  }

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
