const flash = document.getElementById("flash");
const postgresUserInput = document.getElementById("postgres-user");
const postgresPasswordInput = document.getElementById("postgres-password");
const remoteNodeSelect = document.getElementById("remote-node");
const localDbInput = document.getElementById("local-db");
const remoteBaseUrlInput = document.getElementById("remote-base-url");
const remoteUserInput = document.getElementById("remote-user");
const remotePasswordInput = document.getElementById("remote-password");
const postgresStatus = document.getElementById("postgres-status");
const postgresBin = document.getElementById("postgres-bin");
const pgadminStatus = document.getElementById("pgadmin-status");
const pgadminPath = document.getElementById("pgadmin-path");
const serviceStatus = document.getElementById("service-status");
const servicePath = document.getElementById("service-path");
const serviceNote = document.getElementById("service-note");

const installPostgresButton = document.getElementById("install-postgres");
const installPgadminButton = document.getElementById("install-pgadmin");
const installBothButton = document.getElementById("install-both");
const restoreButton = document.getElementById("restore-button");
const refreshButton = document.getElementById("refresh-button");

let currentState = null;
let busy = false;

function setFlash(message, type = "info") {
  flash.textContent = message;
  flash.className = `flash flash-${type}`;
}

function setBusy(nextBusy) {
  busy = nextBusy;
  installPostgresButton.disabled = nextBusy;
  installPgadminButton.disabled = nextBusy;
  installBothButton.disabled = nextBusy;
  restoreButton.disabled = nextBusy;
  refreshButton.disabled = nextBusy;
}

function createStatusChip(label, ok) {
  const className = ok ? "chip chip-ok" : "chip chip-warn";
  return `<span class="${className}">${label}</span>`;
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getSelectedRemoteNode() {
  if (!currentState) {
    return null;
  }

  return currentState.remoteNodes.find((node) => node.id === remoteNodeSelect.value) || null;
}

function fillRemoteNodeFields() {
  const node = getSelectedRemoteNode();
  if (!node) {
    return;
  }

  remoteBaseUrlInput.value = normalizeBaseUrl(node.baseUrl);
  if (!localDbInput.value.trim() || localDbInput.dataset.autoFilled !== "manual") {
    localDbInput.value = node.localDatabaseName;
    localDbInput.dataset.autoFilled = "auto";
  }
}

function renderRemoteNodes(nodes, selectedId) {
  remoteNodeSelect.innerHTML = "";
  for (const node of nodes) {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = `${node.label} (${node.remoteDatabaseName})`;
    if (node.id === selectedId) {
      option.selected = true;
    }
    remoteNodeSelect.appendChild(option);
  }
}

function hydrateState(state) {
  currentState = state;

  postgresUserInput.value = state.config.localPostgresUser;
  postgresPasswordInput.value = state.config.localPostgresPassword;
  remoteUserInput.value = state.config.remoteApiUser;
  remotePasswordInput.value = state.config.remoteApiPassword;

  renderRemoteNodes(state.remoteNodes, state.config.remoteNodeId);
  fillRemoteNodeFields();

  postgresStatus.innerHTML = createStatusChip(
    state.postgres.installed ? `Instalado ${state.postgres.version || ""}`.trim() : "No detectado",
    state.postgres.installed,
  );
  postgresBin.textContent = state.postgres.binDir || "-";

  pgadminStatus.innerHTML = createStatusChip(
    state.pgAdmin.installed ? "Instalado" : "No detectado",
    state.pgAdmin.installed,
  );
  pgadminPath.textContent = state.pgAdmin.path || "-";

  serviceStatus.innerHTML = createStatusChip(
    state.serviceRuntime.installed ? "Detectado" : "No detectado",
    state.serviceRuntime.installed,
  );
  servicePath.textContent = state.serviceRuntime.path || "-";
  serviceNote.textContent = state.serviceRuntime.installed
    ? "El runtime del servicio local ya existe. Si restauras una base, el instalador tambien actualizara sus perfiles .env."
    : "Si instalas Rocky Maxx Servicio Local despues, conviene dejar el usuario PostgreSQL en 'postgres' o volver a ejecutar este instalador para ajustar credenciales.";
}

function buildPayload() {
  return {
    localPostgresUser: postgresUserInput.value.trim(),
    localPostgresPassword: postgresPasswordInput.value.trim(),
    remoteNodeId: remoteNodeSelect.value,
    remoteBaseUrl: normalizeBaseUrl(remoteBaseUrlInput.value),
    remoteApiUser: remoteUserInput.value.trim(),
    remoteApiPassword: remotePasswordInput.value,
    localDatabaseName: localDbInput.value.trim(),
  };
}

async function reloadState(message, type = "success") {
  const state = await window.rockyInstaller.getState();
  hydrateState(state);
  if (message) {
    setFlash(message, type);
  }
}

remoteNodeSelect.addEventListener("change", () => {
  localDbInput.dataset.autoFilled = "auto";
  fillRemoteNodeFields();
});

localDbInput.addEventListener("input", () => {
  localDbInput.dataset.autoFilled = "manual";
});

installPostgresButton.addEventListener("click", async () => {
  setBusy(true);
  setFlash("Instalando PostgreSQL. Esto puede tardar varios minutos...", "info");
  try {
    const result = await window.rockyInstaller.installPostgres(buildPayload());
    await reloadState(result.message || "PostgreSQL instalado.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo instalar PostgreSQL.", "error");
  } finally {
    setBusy(false);
  }
});

installPgadminButton.addEventListener("click", async () => {
  setBusy(true);
  setFlash("Instalando pgAdmin...", "info");
  try {
    const result = await window.rockyInstaller.installPgAdmin();
    await reloadState(result.message || "pgAdmin instalado.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo instalar pgAdmin.", "error");
  } finally {
    setBusy(false);
  }
});

installBothButton.addEventListener("click", async () => {
  setBusy(true);
  setFlash("Instalando PostgreSQL y pgAdmin...", "info");
  try {
    const result = await window.rockyInstaller.installStack(buildPayload());
    await reloadState(result.message || "Instalacion completada.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo completar la instalacion.", "error");
  } finally {
    setBusy(false);
  }
});

restoreButton.addEventListener("click", async () => {
  setBusy(true);
  setFlash("Descargando el respaldo desde el VPS y restaurando en local...", "info");
  try {
    const result = await window.rockyInstaller.restoreFromVps(buildPayload());
    await reloadState(result.message || "Restauracion completada.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo restaurar la base desde el VPS.", "error");
  } finally {
    setBusy(false);
  }
});

refreshButton.addEventListener("click", async () => {
  setBusy(true);
  setFlash("Actualizando estado del instalador...", "info");
  try {
    await reloadState("Estado actualizado.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo actualizar el estado.", "error");
  } finally {
    setBusy(false);
  }
});

reloadState().catch((error) => {
  setFlash(error?.message || "No se pudo cargar el estado inicial del instalador.", "error");
});
