type ImpresoraFiscalRow = {
  ID: string | number | bigint;
  NombreImpresora: string | null;
  Status: number | null;
  IdProcesoImpresion: string | number | bigint | null;
  MontoMaximoDiario: string | number | null;
  IncluyeIGTF: boolean | null;
};

function toNumber(value: string | number | bigint | null | undefined, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(normalized) ? normalized : fallback;
}

export function toImpresoraView(item: ImpresoraFiscalRow) {
  return {
    id: toNumber(item.ID),
    nombreImpresora: String(item.NombreImpresora || "").trim(),
    status: Number(item.Status ?? 0) === 1 ? 1 : 0,
    idProcesoImpresion: toNumber(item.IdProcesoImpresion),
    montoMaximoDiario: String(item.MontoMaximoDiario ?? "0").trim(),
    incluyeIGTF: Boolean(item.IncluyeIGTF),
  };
}
