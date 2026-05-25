const flash = document.getElementById("flash");
const profileSelect = document.getElementById("database-profile");
const saveButton = document.getElementById("save-button");
const refreshButton = document.getElementById("refresh-button");
const introCopy = document.getElementById("intro-copy");
const configForm = document.getElementById("config-form");
const lockedPanel = document.getElementById("locked-panel");
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

function syncFormInteractivity() {
  const configurationLocked = Boolean(currentState?.configurationLocked);
  const hasProfile = Boolean(String(profileSelect.value || "").trim());
  const mirrorUrl = String(mirrorUrlInput.value || "").trim();

  profileSelect.disabled = configurationLocked || saving;
  mirrorEnabledInput.checked = true;
  mirrorEnabledInput.disabled = true;
  mirrorUrlInput.disabled = saving;
  saveButton.hidden = false;
  saveButton.textContent = configurationLocked ? "Guardar configuracion" : "Guardar configuracion";
  saveButton.disabled = saving || !hasProfile || !mirrorUrl;
  refreshButton.disabled = saving;
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

  const configurationLocked = Boolean(state?.configurationLocked);

  localUrlValue.textContent = state?.localUrl || "-";
  healthUrlValue.textContent = state?.healthUrl || "-";
  databaseValue.textContent = state?.health?.database?.database || state?.currentProfile?.databaseName || "-";
  schemaValue.textContent = state?.health?.database?.schema || "dbo";
  portValue.textContent = String(state?.apiPort || "-");
  hostValue.textContent = state?.apiHost || "-";
  mirrorEnabledInput.checked = Boolean(state?.mirrorSyncEnabled);
  mirrorUrlInput.value = state?.mirrorSyncRemoteApiUrl || "";
  renderUrls(state?.urls || []);

  if (configForm) {
    configForm.hidden = false;
  }

  if (lockedPanel) {
    lockedPanel.hidden = !configurationLocked;
  }

  if (introCopy) {
    introCopy.textContent = configurationLocked
      ? "La base local de esta instalacion ya quedo fijada y se reutiliza automaticamente en cada arranque. La replica espejo a VPS queda siempre activa."
      : "Selecciona la base de datos con la que quieres trabajar en esta PC y guarda la configuracion. La proxima vez que levantes el back, el servicio recordara esa base automaticamente y dejara el espejo activo.";
  }

  syncFormInteractivity();
}

async function hydrate() {
  setFlash("Cargando configuracion del servicio local...", "info");
  const state = await window.rockyService.getState();
  renderState(state);
  setFlash(
    state?.configurationLocked
      ? "La base local ya esta guardada. Si necesitas cambiar el VPS o activar el espejo, puedes hacerlo desde aqui sin reinstalar."
      : "Selecciona la base de datos y guarda la configuracion para reutilizarla en el proximo arranque.",
    "info",
  );
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
      mirrorSyncEnabled: true,
      mirrorSyncRemoteApiUrl: String(mirrorUrlInput.value || "").trim(),
    });
    renderState(state);
    setFlash(
      "Configuracion guardada. El backend ya esta trabajando con la base seleccionada y la replica espejo quedo activa.",
      "success",
    );
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

profileSelect.addEventListener("change", () => {
  syncFormInteractivity();
});

mirrorUrlInput.addEventListener("input", () => {
  syncFormInteractivity();
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
