const serverUrlInput = document.getElementById("server-url");
const flash = document.getElementById("flash");
const checkButton = document.getElementById("check-button");
const saveButton = document.getElementById("save-button");
const openButton = document.getElementById("open-button");
const statusCard = document.getElementById("status-card");
const statusTitle = document.getElementById("status-title");
const statusText = document.getElementById("status-text");

let currentServerUrl = "";
let verifiedServerUrl = "";

function setConnectionActionsEnabled(enabled) {
  saveButton.disabled = !enabled;
  openButton.disabled = !enabled;
}

function invalidateConnectionVerification() {
  verifiedServerUrl = "";
  setConnectionActionsEnabled(false);
  statusCard.hidden = true;
}

function setFlash(message, type = "info") {
  flash.textContent = message;
  flash.className = `flash flash-${type}`;
}

function setStatus(title, message) {
  statusCard.hidden = false;
  statusTitle.textContent = title;
  statusText.textContent = message;
}

function normalizeUrl(value) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\/+$/, "");
  if (normalized.toLowerCase().endsWith("/api")) {
    normalized = normalized.slice(0, -4);
  }

  return normalized;
}

async function hydrate() {
  const config = await window.rockyClient.getConfig();
  currentServerUrl = normalizeUrl(config?.serverUrl || "");
  serverUrlInput.value = currentServerUrl;
  invalidateConnectionVerification();
  if (config?.appDisplayName) {
    document.title = `Configurar ${config.appDisplayName}`;
  }
}

window.rockyClient.onState((payload) => {
  currentServerUrl = normalizeUrl(payload?.serverUrl || currentServerUrl);
  serverUrlInput.value = currentServerUrl;
  if (payload?.errorMessage) {
    setFlash(payload.errorMessage, "error");
  }
});

checkButton.addEventListener("click", async () => {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  if (!serverUrl) {
    setFlash("Debes escribir la URL del servidor local.", "error");
    return;
  }

  setFlash("Probando conexión con el servidor...", "info");
  statusCard.hidden = true;

  const result = await window.rockyClient.checkServer(serverUrl);
  if (!result.ok) {
    invalidateConnectionVerification();
    setFlash(result.message || "No se pudo conectar al servidor.", "error");
    return;
  }

  currentServerUrl = normalizeUrl(result.serverUrl || serverUrl);
  verifiedServerUrl = currentServerUrl;
  serverUrlInput.value = currentServerUrl;
  setConnectionActionsEnabled(true);
  setFlash("Servidor encontrado correctamente.", "success");
  const databaseName = result.payload?.database?.database || "Sin datos";
  const port = result.payload?.port || "3000";
  setStatus("Servidor listo", `Base: ${databaseName}. Puerto: ${port}. URL activa: ${currentServerUrl}.`);
});

saveButton.addEventListener("click", async () => {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  if (!serverUrl) {
    setFlash("Debes escribir la URL del servidor local.", "error");
    return;
  }

  if (serverUrl !== verifiedServerUrl) {
    setFlash("Debes probar la conexion antes de guardar.", "error");
    return;
  }

  await window.rockyClient.saveConfig(serverUrl);
  currentServerUrl = serverUrl;
  setFlash("Configuración guardada.", "success");
});

openButton.addEventListener("click", async () => {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  if (!serverUrl) {
    setFlash("Debes escribir la URL del servidor local.", "error");
    return;
  }

  if (serverUrl !== verifiedServerUrl) {
    setFlash("Debes probar la conexion antes de abrir Rocky Maxx.", "error");
    return;
  }

  setFlash("Abriendo Rocky Maxx...", "info");

  try {
    const result = await window.rockyClient.openServer(serverUrl);
    currentServerUrl = normalizeUrl(result.serverUrl || serverUrl);
    serverUrlInput.value = currentServerUrl;
    const databaseName = result.payload?.database?.database || "Sin datos";
    setStatus("Servidor listo", `Base: ${databaseName}. URL activa: ${currentServerUrl}.`);
  } catch (error) {
    setFlash(error?.message || "No se pudo abrir el servidor.", "error");
  }
});

serverUrlInput.addEventListener("input", () => {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  if (serverUrl !== verifiedServerUrl) {
    invalidateConnectionVerification();
  }
});

hydrate().catch((error) => {
  setFlash(error?.message || "No se pudo cargar la configuración del cliente.", "error");
});
