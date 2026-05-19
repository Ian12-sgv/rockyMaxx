const serverUrlInput = document.getElementById("server-url");
const flash = document.getElementById("flash");
const checkButton = document.getElementById("check-button");
const saveButton = document.getElementById("save-button");
const openButton = document.getElementById("open-button");
const statusCard = document.getElementById("status-card");
const statusTitle = document.getElementById("status-title");
const statusText = document.getElementById("status-text");

let currentServerUrl = "";

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
    setFlash(result.message || "No se pudo conectar al servidor.", "error");
    return;
  }

  setFlash("Servidor encontrado correctamente.", "success");
  const databaseName = result.payload?.database?.database || "Sin datos";
  const port = result.payload?.port || "3000";
  setStatus("Servidor listo", `Base: ${databaseName}. Puerto: ${port}.`);
});

saveButton.addEventListener("click", async () => {
  const serverUrl = normalizeUrl(serverUrlInput.value);
  if (!serverUrl) {
    setFlash("Debes escribir la URL del servidor local.", "error");
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

  setFlash("Abriendo Rocky Maxx...", "info");

  try {
    const result = await window.rockyClient.openServer(serverUrl);
    const databaseName = result.payload?.database?.database || "Sin datos";
    setStatus("Servidor listo", `Base: ${databaseName}.`);
  } catch (error) {
    setFlash(error?.message || "No se pudo abrir el servidor.", "error");
  }
});

hydrate().catch((error) => {
  setFlash(error?.message || "No se pudo cargar la configuración del cliente.", "error");
});
