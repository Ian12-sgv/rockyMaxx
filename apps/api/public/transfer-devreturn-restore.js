function hasDraftContent(draft, headerKeys, itemKeys) {
  if (!draft) return false;
  if (draft.numero) return true;
  if (headerKeys.some((key) => String(draft?.[key] || "").trim())) return true;
  return Array.isArray(draft.items)
    ? draft.items.some((item) =>
        itemKeys.some((key) => String(item?.[key] || "").trim()),
      )
    : false;
}

function mergeOperationalDraft(factory, draft, metadata, createLine) {
  if (!draft) return factory(metadata);
  return {
    ...factory(metadata),
    ...draft,
    items:
      Array.isArray(draft.items) && draft.items.length > 0
        ? draft.items
        : [createLine()],
  };
}

function normalizeOperationalLimit(value, fallback = 25) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function findExactInventoryOperationMatch(items, searchValue) {
  const normalized = String(searchValue || "").trim().toUpperCase();
  if (!normalized) return null;
  return (
    items.find(
      (item) =>
        String(item?.codigoBarra || "").trim().toUpperCase() === normalized,
    ) ||
    items.find(
      (item) =>
        String(item?.referencia || "").trim().toUpperCase() === normalized,
    ) ||
    null
  );
}

async function findInventoryItemForOperationalFlow(searchValue) {
  const normalized = String(searchValue || "").trim();
  if (!normalized) throw new Error("Debes indicar un codigo de barra o referencia.");
  const params = new URLSearchParams();
  params.set("buscar", normalized);
  params.set("limit", "25");
  const response = await apiFetch(`/inventory?${params.toString()}`);
  const items = Array.isArray(response.data) ? response.data : [];
  if (!items.length) throw new Error(`No se encontro un articulo para ${normalized}.`);
  const exactMatch = findExactInventoryOperationMatch(items, normalized);
  if (exactMatch) return exactMatch;
  if (items.length === 1) return items[0];
  throw new Error(`Hay varias coincidencias para ${normalized}. Usa el codigo de barra exacto.`);
}

function resolveInventoryTransferValue(article) {
  const costs = article?.inventario?.costos || {};
  for (const candidate of [costs.ultimo, costs.promedio, costs.inicial]) {
    const amount = Number(candidate || 0);
    if (Number.isFinite(amount) && amount > 0) return toInputValue(candidate);
  }
  return "0";
}

function resolveInventoryOperationalCost(article) {
  const costs = article?.inventario?.costos || {};
  for (const candidate of [costs.ultimo, costs.inicial, costs.promedio]) {
    const amount = Number(candidate || 0);
    if (Number.isFinite(amount) && amount > 0) return toInputValue(candidate);
  }
  return "0";
}

async function loadTransfersMetadata(options = {}) {
  const { renderAfter = true, preserveDraft = true } = options;
  state.transfers.loadingMetadata = true;
  if (renderAfter) render();
  try {
    const metadata = await apiFetch("/transfers/metadata");
    state.transfers.metadata = metadata;
    if (
      preserveDraft &&
      hasDraftContent(state.transfers.draft, ["documentoOrigen", "observacion"], ["codigoBarra", "referencia", "cantidad"])
    ) {
      state.transfers.draft = mergeOperationalDraft(
        createEmptyTransferDraft,
        state.transfers.draft,
        metadata,
        createEmptyTransferLineDraft,
      );
    } else {
      resetTransferDraft();
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la metadata de transferencias: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingMetadata = false;
    if (renderAfter) render();
  }
}

async function loadTransfersModule(options = {}) {
  const { renderAfter = true } = options;
  await Promise.all([
    loadTransfersMetadata({ renderAfter: false }),
    loadTransfers({ renderAfter: false }),
  ]);
  if (renderAfter) render();
}

async function loadTransfers(options = {}) {
  const { renderAfter = true } = options;
  state.transfers.loadingList = true;
  if (renderAfter) render();
  try {
    if (!state.transfers.metadata) await loadTransfersMetadata({ renderAfter: false });
    const search = state.transfers.search || createEmptyTransferSearch();
    const params = new URLSearchParams();
    const buscar = String(search.buscar || "").trim();
    const status = String(search.status || "").trim();
    if (buscar) params.set("buscar", buscar);
    if (status !== "") params.set("status", status);
    params.set("limit", String(normalizeOperationalLimit(search.limit, 25)));
    const endpoint = state.currentView === "cargar-transferencia" ? "/transfers/inbound" : "/transfers";
    const response = await apiFetch(`${endpoint}?${params.toString()}`);
    state.transfers.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar las transferencias: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingList = false;
    if (renderAfter) render();
  }
}

async function loadTransferForEdit(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.transfers.loadingDetail = true;
  clearFlash();
  render();
  try {
    if (!state.transfers.metadata) await loadTransfersMetadata({ renderAfter: false });
    const response = await apiFetch(`/transfers/${encodeURIComponent(String(normalizedNumero))}`);
    state.transfers.selectedNumero = normalizedNumero;
    state.transfers.receiptNumero = null;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la transferencia ${normalizedNumero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingDetail = false;
    render();
  }
}
async function loadTransferForReceipt(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.transfers.loadingDetail = true;
  clearFlash();
  render();
  try {
    if (!state.transfers.metadata) await loadTransfersMetadata({ renderAfter: false });
    const response = await apiFetch(`/transfers/inbound/${encodeURIComponent(String(normalizedNumero))}`);
    state.transfers.selectedNumero = normalizedNumero;
    state.transfers.receiptNumero = normalizedNumero;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la transferencia recibida ${normalizedNumero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.transfers.loadingDetail = false;
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
    if (!state.transfers.metadata) {
      await loadTransfersMetadata({ renderAfter: false });
    }
    const payload = buildTransferPayload(draft);
    const response = draft.numero
      ? await apiFetch(`/transfers/${encodeURIComponent(String(draft.numero))}`, { method: "PATCH", body: payload })
      : await apiFetch("/transfers", { method: "POST", body: payload });
    const transferencia = response.transferencia || null;
    state.transfers.selectedNumero = Number.parseInt(String(transferencia?.numero || draft.numero || ""), 10) || null;
    state.transfers.receiptNumero = null;
    state.transfers.draft = transferToDraft(transferencia, state.transfers.metadata);
    await Promise.all([
      loadTransfers({ renderAfter: false }),
      loadTransfersMetadata({ renderAfter: false, preserveDraft: true }),
    ]);
    state.transfers.draft = transferToDraft(transferencia, state.transfers.metadata);
    setFlash(
      draft.numero
        ? `Transferencia ${transferencia?.numero || draft.numero} actualizada correctamente.`
        : `Transferencia ${transferencia?.numero || ""} guardada correctamente.`
      , "success",
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
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.transfers.approving = true;
  clearFlash();
  render();
  try {
    await approveTransferWithPayload(normalizedNumero);
  } catch (error) {
    console.error(error);
    if (isTransferDuplicateBarcodeError(error)) {
      await resolveDuplicateBarcodesAndApprove(normalizedNumero, error);
      return;
    }
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.approving = false;
    render();
  }
}

async function approveTransferWithPayload(numero, payload = {}) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  if (!state.transfers.metadata) {
    await loadTransfersMetadata({ renderAfter: false });
  }
  const response = await apiFetch(`/transfers/${encodeURIComponent(String(normalizedNumero))}/approve`, {
    method: "POST",
    body: payload,
  });
  state.transfers.selectedNumero = normalizedNumero;
  if (state.currentView === "cargar-transferencia") {
    state.transfers.receiptNumero = normalizedNumero;
  } else {
    state.transfers.receiptNumero = null;
  }
  state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
  await loadTransfers({ renderAfter: false });
  setFlash(`Transferencia ${normalizedNumero} aprobada correctamente.`, "success");
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
      `El codigo de barra ${codigoBarra}${nombre} ya existe en inventario.

Aceptar: modificar el articulo existente con los atributos de la transferencia.
Cancelar: crear un articulo nuevo con otro codigo de barra.`,
    );
    if (shouldModifyExisting) {
      duplicateResolutions.push({ codigoBarra, action: "modify-existing" });
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

async function loadInboundTransfer(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.transfers.approving = true;
  clearFlash();
  render();
  try {
    if (!state.transfers.metadata) {
      await loadTransfersMetadata({ renderAfter: false });
    }
    const response = await apiFetch(`/transfers/inbound/${encodeURIComponent(String(normalizedNumero))}/load`, { method: "POST", body: {} });
    state.transfers.selectedNumero = normalizedNumero;
    state.transfers.receiptNumero = normalizedNumero;
    state.transfers.draft = transferToDraft(response.transferencia, state.transfers.metadata);
    await loadTransfers({ renderAfter: false });
    setFlash(
      response.alreadyLoaded
        ? `Transferencia ${normalizedNumero} ya estaba cargada en inventario.`
        : response.message || `Transferencia ${normalizedNumero} cargada correctamente en inventario.`
      , "success",
    );
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.approving = false;
    render();
  }
}

async function deleteTransfer(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  const confirmed = window.confirm(
    `Se eliminara la transferencia pendiente ${normalizedNumero} y se devolvera al inventario lo descontado. Deseas continuar?`,
  );
  if (!confirmed) return;
  state.transfers.deleting = true;
  clearFlash();
  render();
  try {
    await apiFetch(`/transfers/${encodeURIComponent(String(normalizedNumero))}`, { method: "DELETE" });
    resetTransferDraft();
    await Promise.all([
      loadTransfers({ renderAfter: false }),
      loadTransfersMetadata({ renderAfter: false }),
    ]);
    setFlash(`Transferencia ${normalizedNumero} eliminada correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.transfers.deleting = false;
    render();
  }
}

async function openDevReturnLookupModal(options = {}) {
  const mode = String(options.mode || "drafts") === "records" ? "records" : "drafts";
  if (mode === "drafts") captureDevReturnDraft();
  state.devReturnLookup.open = true;
  state.devReturnLookup.loading = true;
  state.devReturnLookup.items = [];
  state.devReturnLookup.mode = mode;
  render();
  try {
    const endpoint = mode === "records" ? "/dev-returns/returns?limit=100" : "/dev-returns/drafts?limit=100";
    const response = await apiFetch(endpoint);
    state.devReturnLookup.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el catalogo de ${mode === "records" ? "devoluciones" : "borradores"}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnLookup.loading = false;
    render();
  }
}

function closeDevReturnLookupModal() {
  state.devReturnLookup.open = false;
  state.devReturnLookup.loading = false;
  state.devReturnLookup.items = [];
}
async function loadDevReturnsModule(options = {}) {
  const { renderAfter = true, preserveDraft = true } = options;
  state.devReturns.loadingMetadata = true;
  state.devReturns.loadingDashboard = true;
  if (renderAfter) render();
  try {
    await pullDevReturnsFromRemoteForDraft({ force: true, limit: 100, skipReload: true });
    const [metadata, draftsResponse, inboundResponse] = await Promise.all([
      apiFetch("/dev-returns/metadata"),
      apiFetch("/dev-returns/drafts?limit=12"),
      apiFetch("/dev-returns/drafts/inbound?limit=12"),
    ]);
    state.devReturns.metadata = metadata;
    state.devReturns.items = Array.isArray(draftsResponse.items) ? draftsResponse.items : [];
    state.devReturns.inboundItems = Array.isArray(inboundResponse.items) ? inboundResponse.items : [];
    if (
      preserveDraft &&
      hasDraftContent(state.devReturns.draft, ["observacion"], ["codigoBarra", "referencia", "nombre", "cantidad"])
    ) {
      state.devReturns.draft = mergeOperationalDraft(
        createEmptyDevReturnDraft,
        state.devReturns.draft,
        metadata,
        createEmptyDevReturnLineDraft,
      );
    } else {
      resetDevReturnDraft();
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudieron cargar las bandejas de devoluciones: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingMetadata = false;
    state.devReturns.loadingDashboard = false;
    if (renderAfter) render();
  }
}

async function loadDevReturnDraftForEdit(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.devReturns.loadingDetail = true;
  clearFlash();
  render();
  try {
    if (!state.devReturns.metadata) await loadDevReturnsModule({ renderAfter: false, preserveDraft: false });
    const response = await apiFetch(`/dev-returns/drafts/${encodeURIComponent(String(normalizedNumero))}`);
    state.devReturns.selectedNumero = normalizedNumero;
    state.devReturns.draft = devReturnToDraft(response.borrador, state.devReturns.metadata);
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el borrador ${normalizedNumero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturns.loadingDetail = false;
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
      ? await apiFetch(`/dev-returns/drafts/${encodeURIComponent(String(draft.numero))}`, { method: "PATCH", body: payload })
      : await apiFetch("/dev-returns/drafts", { method: "POST", body: payload });
    const borrador = response.borrador || null;
    state.devReturns.selectedNumero = Number.parseInt(String(borrador?.numero || draft.numero || ""), 10) || null;
    state.devReturns.draft = devReturnToDraft(borrador, state.devReturns.metadata);
    await loadDevReturnsModule({ renderAfter: false, preserveDraft: true });
    state.devReturns.draft = devReturnToDraft(borrador, state.devReturns.metadata);
    setFlash(
      draft.numero
        ? `Borrador ${borrador?.numero || draft.numero} actualizado correctamente.`
        : `Borrador ${borrador?.numero || ""} guardado correctamente.`,
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
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.devReturns.exporting = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/dev-returns/drafts/${encodeURIComponent(String(normalizedNumero))}/export`, { method: "POST", body: {} });
    const borrador = response.borrador || null;
    state.devReturns.selectedNumero = normalizedNumero;
    state.devReturns.draft = devReturnToDraft(borrador, state.devReturns.metadata);
    await loadDevReturnsModule({ renderAfter: false, preserveDraft: true });
    state.devReturns.draft = devReturnToDraft(borrador, state.devReturns.metadata);
    setFlash(`Borrador ${normalizedNumero} exportado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturns.exporting = false;
    render();
  }
}

async function loadInboundDevReturnDraftDetail(globalId) {
  const normalizedGlobalId = String(globalId || "").trim();
  if (!normalizedGlobalId) return;
  state.devReturns.loadingInboundDetail = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/dev-returns/drafts/inbound/${encodeURIComponent(normalizedGlobalId)}`);
    state.devReturns.selectedInboundGlobalId = normalizedGlobalId;
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
  const normalizedGlobalId = String(globalId || "").trim();
  if (!normalizedGlobalId) return;
  state.devReturns.approvingInbound = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/dev-returns/drafts/inbound/${encodeURIComponent(normalizedGlobalId)}/approve`, { method: "POST", body: {} });
    state.devReturns.selectedInboundGlobalId = normalizedGlobalId;
    state.devReturns.inboundDetail = response.borrador || null;
    await loadDevReturnsModule({ renderAfter: false, preserveDraft: true });
    await loadDevReturnRecords({ renderAfter: false });
    setFlash(
      response.returnNumero
        ? `Borrador aprobado correctamente. Se genero la devolucion ${response.returnNumero}.`
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
async function loadDevReturnRecords(options = {}) {
  const { renderAfter = true } = options;
  state.devReturnRecords.loading = true;
  if (renderAfter) render();
  try {
    const response = await apiFetch("/dev-returns/returns?limit=100");
    state.devReturnRecords.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar el registro de devoluciones: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnRecords.loading = false;
    if (renderAfter) render();
  }
}

async function loadDevReturnRecordDetail(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.devReturnRecords.loadingDetail = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/dev-returns/returns/${encodeURIComponent(String(normalizedNumero))}`);
    state.devReturnRecords.selectedNumero = normalizedNumero;
    state.devReturnRecords.detail = response.devolucion || null;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la devolucion ${normalizedNumero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnRecords.loadingDetail = false;
    render();
  }
}

async function exportDevReturnRecord(numero) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.devReturnRecords.exporting = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/dev-returns/returns/${encodeURIComponent(String(normalizedNumero))}/export`, { method: "POST", body: {} });
    state.devReturnRecords.selectedNumero = normalizedNumero;
    state.devReturnRecords.detail = response.devolucion || null;
    await loadDevReturnRecords({ renderAfter: false });
    setFlash(`Devolucion ${normalizedNumero} exportada correctamente.`, "success");
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
  if (renderAfter) render();
  try {
    await pullDevReturnsFromRemoteForDraft({ force: true, limit: 100, skipReload: true });
    const response = await apiFetch("/dev-returns/inbound?limit=25");
    state.devReturnInbound.items = Array.isArray(response.items) ? response.items : [];
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la bandeja de devoluciones recibidas: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnInbound.loading = false;
    if (renderAfter) render();
  }
}

async function loadInboundDevReturnDetail(numero, codigoEnvia) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  const normalizedCodigoEnvia = String(codigoEnvia || "").trim().toUpperCase();
  if (!normalizedNumero) return;
  state.devReturnInbound.loadingDetail = true;
  clearFlash();
  render();
  try {
    const params = new URLSearchParams();
    if (normalizedCodigoEnvia) params.set("codigoEnvia", normalizedCodigoEnvia);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const response = await apiFetch(`/dev-returns/inbound/${encodeURIComponent(String(normalizedNumero))}${suffix}`);
    state.devReturnInbound.selectedNumero = normalizedNumero;
    state.devReturnInbound.selectedCodigoEnvia = normalizedCodigoEnvia;
    state.devReturnInbound.detail = response.devolucion || null;
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la devolucion recibida ${normalizedNumero}: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.devReturnInbound.loadingDetail = false;
    render();
  }
}

async function approveInboundDevReturn(numero, codigoEnvia) {
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  const normalizedCodigoEnvia = String(codigoEnvia || "").trim().toUpperCase();
  if (!normalizedNumero) return;
  state.devReturnInbound.approving = true;
  clearFlash();
  render();
  try {
    const params = new URLSearchParams();
    if (normalizedCodigoEnvia) params.set("codigoEnvia", normalizedCodigoEnvia);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const response = await apiFetch(`/dev-returns/inbound/${encodeURIComponent(String(normalizedNumero))}/approve${suffix}`, { method: "POST", body: {} });
    state.devReturnInbound.selectedNumero = normalizedNumero;
    state.devReturnInbound.selectedCodigoEnvia = normalizedCodigoEnvia;
    state.devReturnInbound.detail = response.devolucion || null;
    await loadInboundDevReturns({ renderAfter: false });
    setFlash(`Devolucion ${normalizedNumero} aprobada correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.devReturnInbound.approving = false;
    render();
  }
}

async function pullDevReturnsFromRemoteForDraft(options = {}) {
  if (!state.token || devReturnRemotePullInFlight) {
    return null;
  }
  const now = Date.now();
  const force = Boolean(options.force);
  const skipReload = Boolean(options.skipReload);
  const limit = Number.parseInt(String(options.limit || "100"), 10);
  if (!force && now - devReturnRemotePullLastAt < 5000) {
    return null;
  }
  devReturnRemotePullInFlight = true;
  devReturnRemotePullLastAt = now;
  try {
    const response = await apiFetch("/dev-returns/sync/pull", {
      method: "POST",
      body: {
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 100,
      },
    });
    if (!skipReload) {
      await loadDevReturnsModule({ renderAfter: false, preserveDraft: true });
    }
    return response;
  } catch (error) {
    console.error(error);
    if (!skipReload) {
      setFlash(`No se pudo sincronizar las devoluciones remotas: ${extractErrorMessage(error)}`, "error");
      render();
    }
    return null;
  } finally {
    devReturnRemotePullInFlight = false;
  }
}

async function fillDevReturnLineFromInventory(index, searchValue) {
  const normalizedIndex = Number.parseInt(String(index || "-1"), 10);
  if (normalizedIndex < 0) return;
  captureDevReturnDraft();
  try {
    const article = await findInventoryItemForOperationalFlow(searchValue);
    const draft = state.devReturns.draft || createEmptyDevReturnDraft(state.devReturns.metadata);
    const items = Array.isArray(draft.items) && draft.items.length > 0 ? [...draft.items] : [createEmptyDevReturnLineDraft()];
    const currentLine = items[normalizedIndex] || createEmptyDevReturnLineDraft();
    items[normalizedIndex] = {
      ...currentLine,
      codigoBarra: article.codigoBarra || currentLine.codigoBarra,
      referencia: article.referencia || currentLine.referencia,
      nombre: article.general?.nombre || article.nombre || currentLine.nombre,
      costo: resolveInventoryOperationalCost(article),
      cantidad: toInputValue(currentLine.cantidad || "1"),
      numeroCaja: toInputValue(currentLine.numeroCaja || "0"),
    };
    state.devReturns.draft = { ...draft, items };
    clearFlash();
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    render();
  }
}
async function loadAdjustmentsMetadata(options = {}) {
  const { renderAfter = true, preserveDraft = true } = options;
  state.adjustments.loadingMetadata = true;
  if (renderAfter) render();
  try {
    const metadata = await apiFetch("/adjustments/metadata");
    state.adjustments.metadata = metadata;
    if (
      preserveDraft &&
      hasDraftContent(state.adjustments.draft, ["observacion"], ["codigoBarra", "referencia", "nombre", "cantidad"])
    ) {
      state.adjustments.draft = mergeOperationalDraft(
        createEmptyAdjustmentDraft,
        state.adjustments.draft,
        metadata,
        createEmptyAdjustmentLineDraft,
      );
    } else {
      resetAdjustmentDraft();
    }
  } catch (error) {
    console.error(error);
    setFlash(`No se pudo cargar la metadata de ajustes: ${extractErrorMessage(error)}`, "error");
  } finally {
    state.adjustments.loadingMetadata = false;
    if (renderAfter) render();
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
      ? await apiFetch(`/adjustments/${encodeURIComponent(String(draft.numero))}`, { method: "PATCH", body: payload })
      : await apiFetch("/adjustments", { method: "POST", body: payload });
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
  const normalizedNumero = Number.parseInt(String(numero || ""), 10);
  if (!normalizedNumero) return;
  state.adjustments.approving = true;
  clearFlash();
  render();
  try {
    const response = await apiFetch(`/adjustments/${encodeURIComponent(String(normalizedNumero))}/approve`, { method: "POST", body: {} });
    state.adjustments.draft = adjustmentToDraft(response.ajuste, state.adjustments.metadata);
    setFlash(`Ajuste ${normalizedNumero} aprobado correctamente.`, "success");
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    state.adjustments.approving = false;
    render();
  }
}

async function fillAdjustmentLineFromInventory(index, searchValue) {
  const normalizedIndex = Number.parseInt(String(index || "-1"), 10);
  if (normalizedIndex < 0) return;
  captureAdjustmentDraft();
  try {
    const article = await findInventoryItemForOperationalFlow(searchValue);
    const draft = state.adjustments.draft || createEmptyAdjustmentDraft(state.adjustments.metadata);
    const items = Array.isArray(draft.items) && draft.items.length > 0 ? [...draft.items] : [createEmptyAdjustmentLineDraft()];
    const currentLine = items[normalizedIndex] || createEmptyAdjustmentLineDraft();
    items[normalizedIndex] = {
      ...currentLine,
      codigoBarra: article.codigoBarra || currentLine.codigoBarra,
      referencia: article.referencia || currentLine.referencia,
      nombre: article.general?.nombre || article.nombre || currentLine.nombre,
      costo: resolveInventoryOperationalCost(article),
      existenciaActual: toInputValue(article.inventario?.existenciaActual),
      cantidad: toInputValue(currentLine.cantidad || "1"),
    };
    state.adjustments.draft = { ...draft, items };
    clearFlash();
  } catch (error) {
    console.error(error);
    setFlash(extractErrorMessage(error), "error");
  } finally {
    render();
  }
}

