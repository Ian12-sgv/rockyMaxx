type CashRegisterPaymentSummaryEntry = {
  key: string;
  label: string;
  totalVed: string;
  totalUsd: string;
  movimientos: number;
};

type CashRegisterPaymentSummary = {
  version: 1;
  updatedAt: string;
  payments: CashRegisterPaymentSummaryEntry[];
};

type CashRegisterPaymentSummaryInput = {
  label: string;
  totalVed: string;
  totalUsd: string;
  movimientos?: number;
};

export type CashRegisterCloseReportPaymentLine = {
  label: string;
  totalVed: string;
  totalUsd: string;
  movimientos: number;
};

export type CashRegisterCloseReportPayload = {
  serie: string;
  numeroCaja: number;
  fecha: string;
  horaApertura: string;
  horaCierre: string;
  status: string;
  totalFacturas: number;
  totalMercanciaVed: string;
  totalDescuentoVed: string;
  totalImpuestoVed: string;
  totalGeneralVed: string;
  totalGeneralUsd: string;
  breakdown: CashRegisterCloseReportPaymentLine[];
  generatedAt: string;
};
export type CashRegisterGeneralCloseCajaLine = {
  serie: string;
  numeroCaja: number;
  status: string;
  facturaInicial: string;
  ultimaFactura: string;
  horaApertura: string;
  horaCierre: string;
};

export type CashRegisterGeneralCloseReportPayload = {
  fecha: string;
  totalCajas: number;
  cajasCerradas: number;
  cajasConVentas: number;
  cajasSoloApertura: number;
  totalFacturas: number;
  totalMercanciaVed: string;
  totalDescuentoVed: string;
  totalImpuestoVed: string;
  totalGeneralVed: string;
  totalGeneralUsd: string;
  cajas: CashRegisterGeneralCloseCajaLine[];
  breakdown: CashRegisterCloseReportPaymentLine[];
  generatedAt: string;
};

const ZERO_TEXT = "0.00";
const REPORT_BRANCH_NAME = "ROCKY MAXX CENTRO";

export function createEmptyCashRegisterPaymentSummary(): CashRegisterPaymentSummary {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    payments: [],
  };
}

export function parseCashRegisterPaymentSummary(raw: string | null | undefined): CashRegisterPaymentSummary {
  const source = String(raw || "").trim();
  if (!source) {
    return createEmptyCashRegisterPaymentSummary();
  }

  try {
    const parsed = JSON.parse(source);
    const payments = Array.isArray(parsed?.payments)
      ? parsed.payments
        .map((item: unknown) => {
          const paymentItem = item && typeof item === "object"
            ? item as Record<string, unknown>
            : {} as Record<string, unknown>;
          const label = toAsciiLabel(paymentItem.label || paymentItem.key || "");
          if (!label) {
            return null;
          }

          return {
            key: normalizePaymentSummaryKey(paymentItem.key || label),
            label,
            totalVed: normalizeMoneyString(paymentItem.totalVed),
            totalUsd: normalizeMoneyString(paymentItem.totalUsd),
            movimientos: normalizeInteger(paymentItem.movimientos, 0),
          };
        })
        .filter((item: CashRegisterPaymentSummaryEntry | null): item is CashRegisterPaymentSummaryEntry => item !== null)
      : [];

    return {
      version: 1,
      updatedAt: typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim()
        ? parsed.updatedAt.trim()
        : new Date().toISOString(),
      payments,
    };
  } catch {
    return createEmptyCashRegisterPaymentSummary();
  }
}

export function mergeCashRegisterPaymentSummary(
  current: CashRegisterPaymentSummary,
  inputs: CashRegisterPaymentSummaryInput[],
): CashRegisterPaymentSummary {
  const next = parseCashRegisterPaymentSummary(JSON.stringify(current));
  const paymentMap = new Map<string, CashRegisterPaymentSummaryEntry>(
    next.payments.map((item) => [item.key, { ...item }]),
  );

  for (const item of Array.isArray(inputs) ? inputs : []) {
    const label = toAsciiLabel(item?.label || "");
    if (!label) {
      continue;
    }

    const key = normalizePaymentSummaryKey(label);
    const currentEntry = paymentMap.get(key) || {
      key,
      label,
      totalVed: ZERO_TEXT,
      totalUsd: ZERO_TEXT,
      movimientos: 0,
    };

    currentEntry.label = label;
    currentEntry.totalVed = addMoneyStrings(currentEntry.totalVed, item?.totalVed);
    currentEntry.totalUsd = addMoneyStrings(currentEntry.totalUsd, item?.totalUsd);
    currentEntry.movimientos += normalizeInteger(item?.movimientos, 1);
    paymentMap.set(key, currentEntry);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    payments: [...paymentMap.values()].sort((left, right) => left.label.localeCompare(right.label, "es")),
  };
}

export function serializeCashRegisterPaymentSummary(summary: CashRegisterPaymentSummary) {
  return JSON.stringify({
    version: 1,
    updatedAt: summary.updatedAt,
    payments: summary.payments.map((item) => ({
      key: item.key,
      label: item.label,
      totalVed: normalizeMoneyString(item.totalVed),
      totalUsd: normalizeMoneyString(item.totalUsd),
      movimientos: normalizeInteger(item.movimientos, 0),
    })),
  });
}

export function buildCashRegisterCloseReportPdf(report: CashRegisterCloseReportPayload) {
  const lines = buildCashRegisterCloseReportLines(report);
  return buildPlainTextPdf(lines);
}
export function buildCashRegisterGeneralCloseReportPdf(report: CashRegisterGeneralCloseReportPayload) {
  const lines = buildCashRegisterGeneralCloseReportLines(report);
  return buildPlainTextPdf(lines);
}

function buildCashRegisterCloseReportLines(report: CashRegisterCloseReportPayload) {
  const lines = [
    buildCashRegisterCloseReportTitle(report),
    "",
    `${toAsciiLabel(report.fecha || "-")}`,
    "",
    `Venta: ${formatUsdInline(report.totalGeneralUsd)}`,
    "",
  ];

  appendPaymentBreakdownLines(lines, report.breakdown, "Sin pagos registrados en esta caja.");
  return lines;
}
function buildCashRegisterGeneralCloseReportLines(report: CashRegisterGeneralCloseReportPayload) {
  const lines = [
    REPORT_BRANCH_NAME,
    "",
    `${toAsciiLabel(report.fecha || "-")}`,
    "",
    `Venta: ${formatUsdInline(report.totalGeneralUsd)}`,
    "",
  ];

  appendPaymentBreakdownLines(lines, report.breakdown, "Sin pagos registrados en las cajas de este dia.");
  return lines;
}

function buildCashRegisterCloseReportTitle(report: CashRegisterCloseReportPayload) {
  const numeroCaja = Number(report.numeroCaja || 0);
  const serie = toAsciiLabel(report.serie || "");
  if (!serie) {
    return `${REPORT_BRANCH_NAME} - CAJA ${String(numeroCaja)}`;
  }

  return `${REPORT_BRANCH_NAME} - CAJA ${String(numeroCaja)} (${serie})`;
}

function appendPaymentBreakdownLines(
  lines: string[],
  breakdown: CashRegisterCloseReportPaymentLine[],
  emptyMessage: string,
) {
  const renderedLines = (Array.isArray(breakdown) ? breakdown : [])
    .map((payment) => formatPaymentBreakdownLine(payment))
    .filter(Boolean);

  if (!renderedLines.length) {
    lines.push(emptyMessage);
    return;
  }

  lines.push(...renderedLines);
}

function formatPaymentBreakdownLine(payment: CashRegisterCloseReportPaymentLine) {
  const label = normalizePaymentLabel(payment?.label);
  const ved = normalizeMoneyNumber(payment?.totalVed);
  const usd = normalizeMoneyNumber(payment?.totalUsd);

  if (ved <= 0 && usd <= 0) {
    return "";
  }

  const displayLabel = formatPaymentDisplayLabel(label);
  if (isUsdOnlyPayment(label, usd)) {
    return `${displayLabel}: ${formatUsdInline(usd)}`;
  }

  if (ved > 0 && usd > 0) {
    return `${displayLabel}: ${formatLocalizedMoney(ved)} (${formatUsdInline(usd)})`;
  }

  if (ved > 0) {
    return `${displayLabel}: ${formatLocalizedMoney(ved)}`;
  }

  return `${displayLabel}: ${formatUsdInline(usd)}`;
}

function normalizePaymentLabel(value: unknown) {
  return toAsciiLabel(value || "").toUpperCase();
}

function formatPaymentDisplayLabel(label: string) {
  if (label.includes("PAGO MOVIL")) {
    return "Pago movil";
  }

  if (label.includes("BINANCE")) {
    return "BINANCE";
  }

  if (label.includes("EFECTIVO DOLAR") || label.includes("DOLAR FISICO") || label.includes("USD FISICO")) {
    return "$ fisico";
  }

  if (label.includes("TARJETA") || label.includes("DEBITO") || label.includes("CREDITO") || label.includes("PUNTO")) {
    return "Punto";
  }

  if (label.includes("EFECTIVO")) {
    return "Efectivo";
  }

  return toTitleLabel(label);
}

function isUsdOnlyPayment(label: string, usd: number) {
  if (usd <= 0) {
    return false;
  }

  return [
    "DOLAR",
    "USD",
    "USDT",
    "BINANCE",
    "ZELLE",
    "CRIPTO",
    "CRYPTO",
  ].some((item) => label.includes(item));
}

function toTitleLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .split(/s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildPlainTextPdf(lines: string[]) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 42;
  const marginTop = 760;
  const lineHeight = 14;
  const linesPerPage = 48;
  const pages = chunkLines(lines.map((item) => sanitizePdfText(item)), linesPerPage);

  const objects: string[] = [];
  const offsets: number[] = [0];
  let pdf = "%PDF-1.4\n";

  const catalogObjectId = 1;
  const pagesObjectId = 2;
  const fontObjectId = 3;
  const firstPageObjectId = 4;
  const firstContentObjectId = firstPageObjectId + pages.length;

  const pageObjectIds = pages.map((_, index) => firstPageObjectId + index);
  const contentObjectIds = pages.map((_, index) => firstContentObjectId + index);

  objects[catalogObjectId] = `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`;
  objects[pagesObjectId] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((pageLines, index) => {
    const content = [
      "BT",
      "/F1 10 Tf",
      `${lineHeight} TL`,
      `${marginLeft} ${marginTop} Td`,
      ...pageLines.flatMap((line, lineIndex) => lineIndex === 0 ? [`(${escapePdfText(line)}) Tj`] : ["T*", `(${escapePdfText(line)}) Tj`]),
      "ET",
    ].join("\n");
    const contentLength = Buffer.byteLength(content, "utf8");
    const contentObjectId = contentObjectIds[index];
    const pageObjectId = pageObjectIds[index];

    objects[contentObjectId] = `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
  });

  for (let index = 1; index < objects.length; index += 1) {
    const entry = `${index} 0 obj\n${objects[index]}\nendobj\n`;
    offsets[index] = Buffer.byteLength(pdf, "utf8");
    pdf += entry;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

function chunkLines(lines: string[], size: number) {
  if (!lines.length) {
    return [["Sin informacion disponible."]];
  }

  const result: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    result.push(lines.slice(index, index + size));
  }
  return result;
}

function sanitizePdfText(value: string) {
  return String(value || "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    || "-";
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function normalizePaymentSummaryKey(value: unknown) {
  return toAsciiLabel(value || "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "OTRO";
}

function toAsciiLabel(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^ -~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMoneyString(value: unknown) {
  const normalized = Number.parseFloat(String(value ?? 0).replace(",", "."));
  if (!Number.isFinite(normalized)) {
    return ZERO_TEXT;
  }

  return normalized.toFixed(2);
}

function normalizeInteger(value: unknown, fallback: number) {
  const normalized = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function addMoneyStrings(left: unknown, right: unknown) {
  const total = Number.parseFloat(normalizeMoneyString(left)) + Number.parseFloat(normalizeMoneyString(right));
  return Number.isFinite(total) ? total.toFixed(2) : ZERO_TEXT;
}

function normalizeMoneyNumber(value: unknown) {
  const normalized = Number.parseFloat(normalizeMoneyString(value));
  return Number.isFinite(normalized) ? normalized : 0;
}

function formatLocalizedMoney(value: unknown) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalizeMoneyNumber(value));
}

function formatUsdInline(value: unknown) {
  return `${formatLocalizedMoney(value)}$`;
}
