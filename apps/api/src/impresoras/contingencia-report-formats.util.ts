import { existsSync, readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

export type ContingenciaReportFormat = {
  id: number;
  fileName: string;
  label: string;
};

const CONTINGENCIA_REPORT_DIRECTORY = "fomato de factura";
const DEFAULT_REPORT_FILES = [
  "crpFacturaGRD.rpt",
  "crpFacturaPEQ.rpt",
  "crpFacturaPEQ (1).rpt",
  "crpFacturaPEQ (2).rpt",
];
const REPORT_PRIORITY = new Map(DEFAULT_REPORT_FILES.map((fileName, index) => [fileName.toLowerCase(), index]));

function normalizeReportFileName(fileName: string | null | undefined) {
  return String(fileName || "").trim();
}

function sortReportFiles(left: string, right: string) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  const leftPriority = REPORT_PRIORITY.get(normalizedLeft);
  const rightPriority = REPORT_PRIORITY.get(normalizedRight);

  if (typeof leftPriority === "number" && typeof rightPriority === "number" && leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  if (typeof leftPriority === "number") {
    return -1;
  }

  if (typeof rightPriority === "number") {
    return 1;
  }

  return left.localeCompare(right, "es", { numeric: true, sensitivity: "base" });
}

function buildReportFormats(fileNames: string[]): ContingenciaReportFormat[] {
  const uniqueNames = [...new Set(fileNames.map((fileName) => normalizeReportFileName(fileName)).filter(Boolean))].sort(sortReportFiles);

  return uniqueNames.map((fileName, index) => ({
    id: index + 1,
    fileName,
    label: fileName,
  }));
}

function getCandidateDirectories() {
  return [
    resolve(process.cwd(), CONTINGENCIA_REPORT_DIRECTORY),
    resolve(__dirname, "..", "..", "..", "..", CONTINGENCIA_REPORT_DIRECTORY),
    resolve(__dirname, "..", "..", "..", "..", "..", CONTINGENCIA_REPORT_DIRECTORY),
  ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
}

export function getContingenciaReportFormats(): ContingenciaReportFormat[] {
  for (const directoryPath of getCandidateDirectories()) {
    if (!existsSync(directoryPath)) {
      continue;
    }

    try {
      const files = readdirSync(directoryPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".rpt")
        .map((entry) => entry.name);

      if (files.length > 0) {
        return buildReportFormats(files);
      }
    } catch {
      // Si la carpeta existe pero no se puede leer, se sigue con los formatos por defecto.
    }
  }

  return buildReportFormats(DEFAULT_REPORT_FILES);
}

export function findContingenciaReportFormatById(id: string | number | bigint | null | undefined) {
  const numericId = Number.parseInt(String(id ?? "").trim(), 10);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return null;
  }

  return getContingenciaReportFormats().find((item) => item.id === numericId) || null;
}
