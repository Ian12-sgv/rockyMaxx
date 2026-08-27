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
const bodegaViewEnabledInput = document.getElementById("bodega-view-enabled");
const bodegaBaseUrlInput = document.getElementById("bodega-base-url");
const bodegaTokenInput = document.getElementById("bodega-token");
const bodegaFieldsRow = document.getElementById("bodega-fields-row");
const bodegaTokenRow = document.getElementById("bodega-token-row");

let currentState = null;
let saving = false;

function setFlash(message, type = "info") {
  flash.textContent = message;
  flash.className = `flash flash-${type}`;
}

function syncFormInteractivity() {
  const configurationLocked = false;
  const hasProfile = Boolean(String(profileSelect.value || "").trim());
  const mirrorUrl = String(mirrorUrlInput.value || "").trim();
  const bodegaViewEnabled = bodegaViewEnabledInput.checked;
  const bodegaBaseUrl = String(bodegaBaseUrlInput.value || "").trim();
  const bodegaToken = String(bodegaTokenInput.value || "").trim();

  profileSelect.disabled = configurationLocked || saving;
  mirrorEnabledInput.checked = true;
  mirrorEnabledInput.disabled = true;
  mirrorUrlInput.disabled = saving;

  bodegaViewEnabledInput.disabled = saving;
  bodegaBaseUrlInput.disabled = saving || !bodegaViewEnabled;
  bodegaTokenInput.disabled = saving || !bodegaViewEnabled;
  if (bodegaFieldsRow) bodegaFieldsRow.style.opacity = bodegaViewEnabled ? "1" : "0.5";
  if (bodegaTokenRow) bodegaTokenRow.style.opacity = bodegaViewEnabled ? "1" : "0.5";

  saveButton.hidden = false;
  saveButton.textContent = configurationLocked ? "Guardar configuracion" : "Guardar configuracion";
  saveButton.disabled =
    saving ||
    !hasProfile ||
    !mirrorUrl ||
    (bodegaViewEnabled && (!bodegaBaseUrl || !bodegaToken));
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
  const normalizedSelectedProfileId = String(selectedProfileId || "").trim();
  const options = (profiles || [])
    .map(
      (profile) => `
        <option value="${profile.id}" ${profile.id === normalizedSelectedProfileId ? "selected" : ""}>
          ${profile.label}
        </option>
      `,
    );

  if (!normalizedSelectedProfileId) {
    options.unshift('<option value="" selected>Selecciona una base de datos...</option>');
  }

  profileSelect.innerHTML = options.join("");
}

function renderState(state) {
  currentState = state;
  renderProfiles(state?.profiles || [], state?.selectedProfileId || "");

  const configurationLocked = false;
  const configurationSaved = Boolean(state?.configurationSaved);

  localUrlValue.textContent = state?.localUrl || "-";
  healthUrlValue.textContent = state?.healthUrl || "-";
  databaseValue.textContent = state?.health?.database?.database || state?.currentProfile?.databaseName || "-";
  schemaValue.textContent = state?.health?.database?.schema || "dbo";
  portValue.textContent = String(state?.apiPort || "-");
  hostValue.textContent = state?.apiHost || "-";
  mirrorEnabledInput.checked = Boolean(state?.mirrorSyncEnabled);
  mirrorUrlInput.value = state?.mirrorSyncRemoteApiUrl || "";
  bodegaViewEnabledInput.checked = Boolean(state?.bodegaViewEnabled);
  bodegaBaseUrlInput.value = state?.bodegaApiBaseUrl || "";
  bodegaTokenInput.value = state?.bodegaApiToken || "";
  renderUrls(state?.urls || []);

  if (configForm) {
    configForm.hidden = false;
  }

  if (lockedPanel) {
    lockedPanel.hidden = !configurationSaved;
  }

  if (introCopy) {
    introCopy.textContent = configurationSaved
      ? "La ultima base guardada se reutiliza automaticamente en cada arranque, pero puedes cambiarla cuando quieras. La replica espejo a VPS queda siempre activa."
      : "Selecciona la base de datos con la que quieres trabajar en esta PC y guarda la configuracion. La replica espejo quedara activa y el servicio recordara esa base en el proximo arranque.";
  }

  syncFormInteractivity();
}

function getRemoteMirrorFlash(state) {
  const remoteStatus = state?.remoteMirrorStatus;
  if (!remoteStatus?.message) {
    return null;
  }

  return {
    message: remoteStatus.message,
    type: remoteStatus.code === "active" ? "success" : "error",
  };
}

async function hydrate() {
  setFlash("Cargando configuracion del servicio local...", "info");
  const state = await window.rockyService.getState();
  renderState(state);
  if (state?.errorMessage) {
    setFlash(state.errorMessage, "error");
    return;
  }

  setFlash(
    state?.configurationSaved
      ? "La base local ya esta guardada. Puedes cambiarla cuando quieras y guardar de nuevo sin reinstalar."
      : "Selecciona la base de datos y guarda la configuracion para reutilizarla en el proximo arranque.",
    "info",
  );
}

saveButton.addEventListener("click", async () => {
  const profileId = String(profileSelect.value || "").trim();
  const mirrorSyncRemoteApiUrl = String(mirrorUrlInput.value || "").trim();
  const bodegaViewEnabled = bodegaViewEnabledInput.checked;
  const bodegaApiBaseUrl = String(bodegaBaseUrlInput.value || "").trim();
  const bodegaApiToken = String(bodegaTokenInput.value || "").trim();

  if (!profileId) {
    setFlash("Debes seleccionar una base de datos.", "error");
    return;
  }

  if (!mirrorSyncRemoteApiUrl) {
    setFlash("Debes indicar la URL del VPS.", "error");
    return;
  }

  if (bodegaViewEnabled && (!bodegaApiBaseUrl || !bodegaApiToken)) {
    setFlash("Para conectar a bodega de datos debes indicar la URL base y el token.", "error");
    return;
  }

  saving = true;
  renderState(currentState || {});
  setFlash("Guardando configuracion y reiniciando el backend local...", "info");

  try {
    const state = await window.rockyService.saveConfig({
      profileId,
      mirrorSyncEnabled: true,
      mirrorSyncRemoteApiUrl,
      bodegaViewEnabled,
      bodegaApiBaseUrl,
      bodegaApiToken,
    });
    renderState(state);
    const mirrorFlash = getRemoteMirrorFlash(state);
    setFlash(
      mirrorFlash?.message ||
        "Configuracion guardada. El backend ya esta trabajando con la base seleccionada y la replica espejo quedo activa.",
      mirrorFlash?.type || "success",
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
    if (state?.errorMessage) {
      setFlash(state.errorMessage, "error");
      return;
    }

    const mirrorFlash = getRemoteMirrorFlash(state);
    setFlash(mirrorFlash?.message || "Estado actualizado.", mirrorFlash?.type || "success");
  } catch (error) {
    setFlash(error?.message || "No se pudo actualizar el estado.", "error");
  }
});

profileSelect.addEventListener("change", () => {
  const selectedProfile = (currentState?.profiles || []).find(
    (profile) => profile.id === String(profileSelect.value || "").trim(),
  );

  if (selectedProfile?.defaultMirrorSyncRemoteApiUrl) {
    mirrorUrlInput.value = selectedProfile.defaultMirrorSyncRemoteApiUrl;
  }

  if (selectedProfile?.defaultBodegaApiBaseUrl && !String(bodegaBaseUrlInput.value || "").trim()) {
    bodegaBaseUrlInput.value = selectedProfile.defaultBodegaApiBaseUrl;
  }

  if (selectedProfile?.defaultBodegaApiToken && !String(bodegaTokenInput.value || "").trim()) {
    bodegaTokenInput.value = selectedProfile.defaultBodegaApiToken;
  }

  syncFormInteractivity();
});

mirrorUrlInput.addEventListener("input", () => {
  syncFormInteractivity();
});

bodegaViewEnabledInput.addEventListener("change", () => {
  syncFormInteractivity();
});

bodegaBaseUrlInput.addEventListener("input", () => {
  syncFormInteractivity();
});

bodegaTokenInput.addEventListener("input", () => {
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
