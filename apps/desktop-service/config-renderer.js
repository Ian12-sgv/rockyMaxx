const flash = document.getElementById("flash");
const profileSelect = document.getElementById("database-profile");
const saveButton = document.getElementById("save-button");
const refreshButton = document.getElementById("refresh-button");
const localUrlValue = document.getElementById("local-url");
const healthUrlValue = document.getElementById("health-url");
const databaseValue = document.getElementById("database-name");
const schemaValue = document.getElementById("schema-name");
const portValue = document.getElementById("port-value");
const hostValue = document.getElementById("host-value");
const urlsList = document.getElementById("urls-list");
const mirrorEnabledInput = document.getElementById("mirror-enabled");
const mirrorUrlInput = document.getElementById("mirror-url");

let currentState = null;
let saving = false;

function setFlash(message, type = "info") {
  flash.textContent = message;
  flash.className = `flash flash-${type}`;
}

function renderUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) {
    urlsList.innerHTML = `<div class="url-chip">No se detectaron IPs LAN disponibles.</div>`;
    return;
  }

  urlsList.innerHTML = urls
    .map((url) => `<div class="url-chip">${url}</div>`)
    .join("");
}

function renderProfiles(profiles, selectedProfileId) {
  profileSelect.innerHTML = (profiles || [])
    .map(
      (profile) => `
        <option value="${profile.id}" ${profile.id === selectedProfileId ? "selected" : ""}>
          ${profile.label}
        </option>
      `,
    )
    .join("");
}

function renderState(state) {
  currentState = state;
  renderProfiles(state?.profiles || [], state?.selectedProfileId || "");

  localUrlValue.textContent = state?.localUrl || "-";
  healthUrlValue.textContent = state?.healthUrl || "-";
  databaseValue.textContent = state?.health?.database?.database || state?.currentProfile?.databaseName || "-";
  schemaValue.textContent = state?.health?.database?.schema || "dbo";
  portValue.textContent = String(state?.apiPort || "-");
  hostValue.textContent = state?.apiHost || "-";
  mirrorEnabledInput.checked = Boolean(state?.mirrorSyncEnabled);
  mirrorUrlInput.value = state?.mirrorSyncRemoteApiUrl || "";
  renderUrls(state?.urls || []);

  saveButton.disabled = saving || !profileSelect.value;
  refreshButton.disabled = saving;
}

async function hydrate() {
  setFlash("Cargando configuracion del servicio local...", "info");
  const state = await window.rockyService.getState();
  renderState(state);
  setFlash("Selecciona la base de datos y guarda la configuracion para reutilizarla en el proximo arranque.", "info");
}

saveButton.addEventListener("click", async () => {
  const profileId = String(profileSelect.value || "").trim();
  if (!profileId) {
    setFlash("Debes seleccionar una base de datos.", "error");
    return;
  }

  saving = true;
  renderState(currentState || {});
  setFlash("Guardando configuracion y reiniciando el backend local...", "info");

  try {
    const state = await window.rockyService.saveConfig({
      profileId,
      mirrorSyncEnabled: Boolean(mirrorEnabledInput.checked),
      mirrorSyncRemoteApiUrl: String(mirrorUrlInput.value || "").trim(),
    });
    renderState(state);
    setFlash("Configuracion guardada. El backend ya esta trabajando con la base seleccionada.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo guardar la configuracion.", "error");
  } finally {
    saving = false;
    renderState(currentState || {});
  }
});

refreshButton.addEventListener("click", async () => {
  setFlash("Actualizando estado del backend local...", "info");

  try {
    const state = await window.rockyService.refreshState();
    renderState(state);
    setFlash("Estado actualizado.", "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo actualizar el estado.", "error");
  }
});

window.rockyService.onState((state) => {
  if (!state) {
    return;
  }

  renderState(state);
  if (state.errorMessage) {
    setFlash(state.errorMessage, "error");
  }
});

hydrate().catch((error) => {
  setFlash(error?.message || "No se pudo cargar la configuracion del servicio local.", "error");
});
