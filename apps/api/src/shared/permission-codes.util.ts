export const CATALOG_IMPORT_EXCEL_PERMISSION_CODE = "CATALOG_IMPORT_EXCEL";
export const CATALOG_IMPORT_EXCEL_PERMISSION_NAME = "Importar catalogos por Excel";

export function normalizePermissionCodeValue(value: string) {
  return String(value || "").trim().toUpperCase();
}
