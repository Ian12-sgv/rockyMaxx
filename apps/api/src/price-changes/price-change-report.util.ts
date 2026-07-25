import { buildPlainTextPdf } from "../shared/plain-text-pdf.util";

// Mismo patron vivo que apps/api/src/cajas/caja-close-report.util.ts (buildPlainTextPdf,
// ahora compartido via ../shared/plain-text-pdf.util.ts): construir un array de lineas de
// texto y dejar que buildPlainTextPdf pagine/escriba los bytes %PDF-1.4. No se usa
// transfer-report.util.ts como referencia de cableado (esta desconectado de cualquier
// controller), solo se tomo su idea de secciones "encabezado + resumen + DETALLE".

const REPORT_SYSTEM_NAME = "Rocky Maxx";
const REPORT_DETAIL_CAP_PER_STATUS = 200;

// Estados terminales/no-error: nunca se recortan por el cap y no cuentan como "error" en
// la seccion 4. El resto (NOT_FOUND/INVALID_BARCODE/DUPLICATE_*/ERROR) son errores.
const NON_ERROR_ITEM_STATUSES = new Set(["PENDING", "APPLIED"]);

const STORE_STATUS_MESSAGES: Record<string, string> = {
  PENDING_SEND: "Aun no enviado al VPS/remoto.",
  SENT_TO_VPS: "Enviado al VPS/remoto.",
  FAILED_NETWORK: "No se logro enviar el cambio por fallo en la red.",
  WAITING_STORE_REFRESH: "Enviado al VPS, pendiente por refresco local.",
  RECEIVED_BY_STORE: "Recibido por la tienda, pendiente de aplicar.",
  APPLYING: "Aplicando en la tienda...",
  APPLIED: "Aplicado correctamente.",
  PARTIAL_APPLIED: "Aplicado parcialmente.",
  FAILED_APPLY: "No se logro aplicar en la tienda.",
};

const ITEM_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendiente",
  APPLIED: "Aplicado",
  NOT_FOUND: "No encontrado en destino",
  INVALID_BARCODE: "Codigo de barra invalido",
  DUPLICATE_SOURCE_BARCODE: "Duplicado en origen",
  DUPLICATE_TARGET_BARCODE: "Duplicado en destino",
  ERROR: "Error",
};

export type PriceChangeReportCosts = {
  costoInicial: string;
  costoPromedio: string;
  ultimoCosto: string;
  costoDolar: string;
};

export type PriceChangeReportItemLine = {
  codigoBarra: string;
  status: string;
  errorMessage: string | null;
  sentCosts: PriceChangeReportCosts;
  appliedCosts: PriceChangeReportCosts | null;
};

export type PriceChangeReportStoreLine = {
  destinationNodeId: string;
  destinationCode: string | null;
  destinationName: string | null;
  status: string;
  lastError: string | null;
  attempts: number;
  sentAt: Date | null;
  appliedAt: Date | null;
  totals: {
    totalItems: number;
    appliedCount: number;
    notFoundCount: number;
    invalidBarcodeCount: number;
    duplicateSourceBarcodeCount: number;
    duplicateTargetBarcodeCount: number;
    errorCount: number;
  };
  items: PriceChangeReportItemLine[];
};

export type PriceChangeReportData = {
  batchId: string;
  mode: string;
  status: string;
  sourceNodeId: string;
  sourceNodeName: string | null;
  sourceNodeCode: string | null;
  requestedBy: string;
  observacion: string | null;
  createdAt: Date;
  updatedAt: Date;
  totalItems: number;
  totalStores: number;
  stores: PriceChangeReportStoreLine[];
  generatedAt: Date;
  generatedByNodeId: string;
};

export function buildPriceChangeBatchReportPdf(data: PriceChangeReportData) {
  return buildPlainTextPdf(buildPriceChangeBatchReportLines(data));
}

export function buildPriceChangeBatchReportFileName(batchId: string) {
  return `cambio-precio-${batchId}.pdf`;
}

function buildPriceChangeBatchReportLines(data: PriceChangeReportData): string[] {
  const lines: string[] = [];

  appendHeaderLines(lines, data);
  lines.push("");
  appendStoreSummaryLines(lines, data);
  lines.push("");
  appendItemDetailLines(lines, data);
  lines.push("");
  appendErrorSectionLines(lines, data);
  lines.push("");
  appendFooterLines(lines, data);

  return lines;
}

// 1. Encabezado
function appendHeaderLines(lines: string[], data: PriceChangeReportData) {
  lines.push("CAMBIO DE PRECIO");
  lines.push(`BatchId: ${data.batchId}`);
  lines.push(`Estado: ${data.status}`);
  lines.push(`Modo: ${data.mode}`);
  lines.push(`Origen: ${data.sourceNodeId}${formatNodeSuffix(data.sourceNodeCode, data.sourceNodeName)}`);
  lines.push(`Usuario: ${data.requestedBy}`);
  lines.push(`Fecha creacion: ${formatReportDate(data.createdAt)}`);

  const earliestSentAt = pickEarliestDate(data.stores.map((store) => store.sentAt));
  if (earliestSentAt) {
    lines.push(`Fecha envio: ${formatReportDate(earliestSentAt)}`);
  }

  const latestAppliedAt = pickLatestDate(data.stores.map((store) => store.appliedAt));
  if (latestAppliedAt) {
    lines.push(`Fecha aplicacion/consolidacion: ${formatReportDate(latestAppliedAt)}`);
  }

  if (data.observacion) {
    lines.push(`Observacion: ${data.observacion}`);
  }

  lines.push(`Total articulos: ${data.totalItems}  |  Total tiendas destino: ${data.totalStores}`);
}

// 2. Resumen por tiendas destino
function appendStoreSummaryLines(lines: string[], data: PriceChangeReportData) {
  lines.push("RESUMEN POR TIENDA");

  if (data.stores.length === 0) {
    lines.push("Sin tiendas destino registradas.");
    return;
  }

  for (const store of data.stores) {
    lines.push("");
    lines.push(`- ${store.destinationNodeId}${formatNodeSuffix(store.destinationCode, store.destinationName)}`);
    lines.push(`  Estado: ${store.status} - ${describeStoreStatus(store)}`);
    lines.push(
      `  Items: total=${store.totals.totalItems} aplicados=${store.totals.appliedCount} ` +
        `no-encontrados=${store.totals.notFoundCount} invalidos=${store.totals.invalidBarcodeCount} ` +
        `dup-origen=${store.totals.duplicateSourceBarcodeCount} dup-destino=${store.totals.duplicateTargetBarcodeCount} ` +
        `errores=${store.totals.errorCount}`,
    );
    if (store.sentAt) {
      lines.push(`  Enviado: ${formatReportDate(store.sentAt)}`);
    }
    if (store.appliedAt) {
      lines.push(`  Aplicado/consolidado: ${formatReportDate(store.appliedAt)}`);
    }
  }
}

function describeStoreStatus(store: PriceChangeReportStoreLine) {
  const message = STORE_STATUS_MESSAGES[store.status] ?? store.status;
  if (store.status === "FAILED_NETWORK" && store.lastError) {
    return `${message} (${store.lastError})`;
  }
  return message;
}

// 3. Detalle por articulo, agrupado por tienda destino
function appendItemDetailLines(lines: string[], data: PriceChangeReportData) {
  lines.push("DETALLE POR ARTICULO");

  if (data.stores.length === 0) {
    lines.push("Sin tiendas destino registradas.");
    return;
  }

  for (const store of data.stores) {
    lines.push("");
    lines.push(`-- ${store.destinationNodeId}${formatNodeSuffix(store.destinationCode, store.destinationName)} --`);

    if (store.items.length === 0) {
      lines.push("  Sin articulos en este batch.");
      continue;
    }

    // Errores (NOT_FOUND/INVALID_BARCODE/DUPLICATE_*/ERROR): siempre completos, sin cap.
    const errorItems = store.items.filter((item) => !NON_ERROR_ITEM_STATUSES.has(item.status));
    // PENDING/APPLIED: se limitan con REPORT_DETAIL_CAP_PER_STATUS para no generar un PDF
    // de miles de paginas en FULL_INVENTORY; el resumen (seccion 2) ya trae el conteo real.
    const appliedItems = store.items.filter((item) => item.status === "APPLIED");
    const pendingItems = store.items.filter((item) => item.status === "PENDING");

    for (const item of errorItems) {
      appendItemLine(lines, item);
    }

    appendCappedItemGroup(lines, appliedItems, "aplicados");
    appendCappedItemGroup(lines, pendingItems, "pendientes");
  }
}

function appendCappedItemGroup(lines: string[], items: PriceChangeReportItemLine[], groupLabel: string) {
  if (items.length === 0) {
    return;
  }

  const visible = items.slice(0, REPORT_DETAIL_CAP_PER_STATUS);
  for (const item of visible) {
    appendItemLine(lines, item);
  }

  const remaining = items.length - visible.length;
  if (remaining > 0) {
    lines.push(`  ... y ${remaining} ${groupLabel} mas (ver conteo en el resumen por tienda).`);
  }
}

function appendItemLine(lines: string[], item: PriceChangeReportItemLine) {
  const statusLabel = ITEM_STATUS_LABELS[item.status] ?? item.status;
  const reasonSuffix = item.errorMessage ? ` (${item.errorMessage})` : "";
  lines.push(`  [${item.codigoBarra}] ${statusLabel}${reasonSuffix}`);

  const sent = item.sentCosts;
  lines.push(
    `    Costo enviado: detal=${sent.costoInicial} promedio=${sent.costoPromedio} ultimo=${sent.ultimoCosto} dolar=${sent.costoDolar}`,
  );

  if (item.appliedCosts) {
    const applied = item.appliedCosts;
    lines.push(
      `    Costo aplicado: detal=${applied.costoInicial} promedio=${applied.costoPromedio} ultimo=${applied.ultimoCosto} dolar=${applied.costoDolar}`,
    );
  }
}

// 4. Seccion de errores (recap agrupado por tipo, siempre completo, nunca truncado)
function appendErrorSectionLines(lines: string[], data: PriceChangeReportData) {
  lines.push("ERRORES");

  const totalErrors = data.stores.reduce((sum, store) => sum + countStoreErrors(store), 0);
  if (totalErrors === 0) {
    lines.push("Sin errores registrados.");
    return;
  }

  for (const store of data.stores) {
    if (countStoreErrors(store) === 0) {
      continue;
    }

    lines.push("");
    lines.push(`-- ${store.destinationNodeId}${formatNodeSuffix(store.destinationCode, store.destinationName)} --`);

    if (store.status === "FAILED_NETWORK") {
      lines.push(`  Fallo de red: ${store.lastError ?? STORE_STATUS_MESSAGES.FAILED_NETWORK}`);
    }

    for (const errorStatus of ["NOT_FOUND", "INVALID_BARCODE", "DUPLICATE_SOURCE_BARCODE", "DUPLICATE_TARGET_BARCODE", "ERROR"]) {
      const codes = store.items.filter((item) => item.status === errorStatus).map((item) => item.codigoBarra);
      if (codes.length === 0) {
        continue;
      }
      lines.push(`  ${ITEM_STATUS_LABELS[errorStatus]} (${codes.length}): ${codes.join(", ")}`);
    }
  }
}

function countStoreErrors(store: PriceChangeReportStoreLine) {
  const itemErrors = store.items.filter((item) => !NON_ERROR_ITEM_STATUSES.has(item.status)).length;
  const networkError = store.status === "FAILED_NETWORK" ? 1 : 0;
  return itemErrors + networkError;
}

// 5. Pie / metadata
function appendFooterLines(lines: string[], data: PriceChangeReportData) {
  lines.push(`Generado: ${formatReportDate(data.generatedAt)}`);
  lines.push(`Sistema: ${REPORT_SYSTEM_NAME}`);
  lines.push(`Nodo de generacion: ${data.generatedByNodeId}`);
}

function formatNodeSuffix(code: string | null, name: string | null) {
  const label = [code, name].filter((value) => value && value.trim()).join(" - ");
  return label ? ` (${label})` : "";
}

function pickEarliestDate(dates: Array<Date | null>) {
  const valid = dates.filter((date): date is Date => date !== null);
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((earliest, date) => (date < earliest ? date : earliest));
}

function pickLatestDate(dates: Array<Date | null>) {
  const valid = dates.filter((date): date is Date => date !== null);
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((latest, date) => (date > latest ? date : latest));
}

// Formato simple y consistente (UTC, sin depender de zona horaria/locale): YYYY-MM-DD HH:mm.
function formatReportDate(date: Date | null) {
  if (!date) {
    return "-";
  }
  return date.toISOString().replace("T", " ").slice(0, 16);
}
