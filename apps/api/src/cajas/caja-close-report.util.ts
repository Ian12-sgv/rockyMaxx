import { buildPlainTextPdf } from "../shared/plain-text-pdf.util";

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
  displayUsd?: string;
  movimientos: number;
};

export type CashRegisterCloseReportPayload = {
  sucursalNombre: string;
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

export type CashRegisterGeneralCloseCostLine = {
  articulo: string;
  costoUnitarioUsd: string;
  cantidad: string;
  costoTotalUsd: string;
};

export type CashRegisterGeneralCloseReportPayload = {
  sucursalNombre: string;
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
  costoMercanciaUsd: string;
  gananciaNetaUsd: string;
  cajas: CashRegisterGeneralCloseCajaLine[];
  breakdown: CashRegisterCloseReportPaymentLine[];
  costosArticulos: CashRegisterGeneralCloseCostLine[];
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
    toAsciiLabel(report.sucursalNombre || REPORT_BRANCH_NAME),
    "",
    `${toAsciiLabel(report.fecha || "-")}`,
    "",
    `Venta: ${formatUsdInline(report.totalGeneralUsd)}`,
    "",
  ];

  appendPaymentBreakdownLines(lines, report.breakdown, "Sin pagos registrados en las cajas de este dia.");
  appendGeneralCloseInventoryCostLines(
    lines,
    report.costosArticulos,
    report.costoMercanciaUsd,
    report.gananciaNetaUsd,
  );
  return lines;
}

function buildCashRegisterCloseReportTitle(report: CashRegisterCloseReportPayload) {
  const numeroCaja = Number(report.numeroCaja || 0);
  const branchName = toAsciiLabel(report.sucursalNombre || REPORT_BRANCH_NAME);
  const serie = toAsciiLabel(report.serie || "");
  if (!serie) {
    return `${branchName} - CAJA ${String(numeroCaja)}`;
  }

  return `${branchName} - CAJA ${String(numeroCaja)} (${serie})`;
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

function appendGeneralCloseInventoryCostLines(
  lines: string[],
  costosArticulos: CashRegisterGeneralCloseCostLine[],
  costoMercanciaUsd: string,
  gananciaNetaUsd: string,
) {
  const renderedLines = (Array.isArray(costosArticulos) ? costosArticulos : [])
    .flatMap((item) => formatGeneralCloseInventoryCostLines(item))
    .filter(Boolean);

  if (renderedLines.length) {
    lines.push("", ...renderedLines);
  }

  lines.push(
    "",
    `Inversion: ${formatUsdInline(costoMercanciaUsd)}`,
    `Ganancia neta: ${formatUsdInline(gananciaNetaUsd)}`,
  );
}

function formatGeneralCloseInventoryCostLines(item: CashRegisterGeneralCloseCostLine) {
  const articulo = toAsciiLabel(item?.articulo || "") || "SIN CODIGO";
  const costoUnitarioUsd = normalizeMoneyNumber(item?.costoUnitarioUsd);
  const cantidad = normalizeMoneyNumber(item?.cantidad);
  const costoTotalUsd = normalizeMoneyNumber(item?.costoTotalUsd);

  if (costoUnitarioUsd <= 0 || cantidad <= 0 || costoTotalUsd <= 0) {
    return [];
  }

  const costoUnitarioTexto = formatUsdInline(costoUnitarioUsd);
  const cantidadTexto = formatQuantityInline(cantidad);
  const costoTotalTexto = formatUsdInline(costoTotalUsd);

  return [
    `Costo unitario ${articulo} = ${costoUnitarioTexto}`,
    `Costo ${articulo}: ${costoUnitarioTexto} x ${cantidadTexto} = ${costoTotalTexto}`,
  ];
}

function formatPaymentBreakdownLine(payment: CashRegisterCloseReportPaymentLine) {
  const label = normalizePaymentLabel(payment?.label);
  const ved = normalizeMoneyNumber(payment?.totalVed);
  const usd = normalizeMoneyNumber(payment?.totalUsd);
  const displayUsd = normalizeMoneyNumber(payment?.displayUsd ?? payment?.totalUsd);

  if (ved <= 0 && usd <= 0 && displayUsd <= 0) {
    return "";
  }

  const displayLabel = formatPaymentDisplayLabel(label);
  if (isUsdOnlyPayment(label, displayUsd > 0 ? displayUsd : usd)) {
    return `${displayLabel}: ${formatUsdInline(displayUsd > 0 ? displayUsd : usd)}`;
  }

  if (ved > 0 && displayUsd > 0) {
    return `${displayLabel}: ${formatLocalizedMoney(ved)} (${formatUsdInline(displayUsd)})`;
  }

  if (ved > 0) {
    return `${displayLabel}: ${formatLocalizedMoney(ved)}`;
  }

  return `${displayLabel}: ${formatUsdInline(displayUsd > 0 ? displayUsd : usd)}`;
}

function normalizePaymentLabel(value: unknown) {
  return toAsciiLabel(value || "").toUpperCase();
}

function formatPaymentDisplayLabel(label: string) {
  if (label.includes("PAGO MOVIL")) {
    return "Pago movil";
  }

  if (label.includes("USDT")) {
    return "USDT";
  }

  if (label.includes("DOLAR ELECTRONICO")) {
    return "Dolar electronico";
  }

  if (label.includes("BINANCE")) {
    return "BINANCE";
  }

  if (label.includes("EFECTIVO DOLAR") || label.includes("DOLAR FISICO") || label.includes("USD FISICO")) {
    return "$ fisico";
  }

  if (label.includes("TARJETA DE DEBITO") || label.includes("DEBITO")) {
    return "Debito";
  }

  if (label.includes("TARJETA DE CREDITO") || label.includes("CREDITO")) {
    return "Credito";
  }

  if (label.includes("PUNTO")) {
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

// buildPlainTextPdf/chunkLines/sanitizePdfText/escapePdfText se movieron a
// ../shared/plain-text-pdf.util.ts (reutilizado ahora tambien por price-changes).

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

function formatQuantityInline(value: unknown) {
  const normalized = normalizeMoneyNumber(value);
  if (!Number.isFinite(normalized)) {
    return "0";
  }

  if (Math.abs(normalized - Math.trunc(normalized)) < 0.000001) {
    return String(Math.trunc(normalized));
  }

  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalized);
}

