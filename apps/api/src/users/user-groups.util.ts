const LEGACY_GROUP_ALIASES: Record<string, string> = {
  ADMIN: "ADMI",
  ADMINISTRADOR: "ADMI",
  ADMI: "ADMI",
};

export function normalizeLegacyGroupCode(value: string) {
  const normalized = value.trim().toUpperCase();
  return LEGACY_GROUP_ALIASES[normalized] ?? normalized;
}