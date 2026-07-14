export type FacturacionInvoicePdfLine = {
  codigoBarra: string;
  nombre: string;
  cantidad: string;
  precio: string;
  subtotal: string;
  descuentoPorcentaje: string;
};

export type FacturacionInvoicePdfPayment = {
  label: string;
  totalVed: string;
  totalUsd: string;
};

export type FacturacionInvoicePdfPayload = {
  numeroFactura: string;
  serie: string;
  fecha: Date | string;
  companyName: string;
  companyDescription: string;
  companyAddress: string;
  companyTaxIdLabel: string;
  companyTaxId: string;
  cliente: string;
  clienteNombre: string;
  clienteTelefono: string;
  clienteDireccion: string;
  vendedor: string;
  vendedorNombre: string;
  numeroCaja: number;
  nombreUsuario: string;
  totalMercancia: string;
  totalDescuento: string;
  totalVenta: string;
  totalDolares: string;
  totalUnidades: string;
  lineas: FacturacionInvoicePdfLine[];
  pagos: FacturacionInvoicePdfPayment[];
};

export function buildFacturacionInvoicePdf(payload: FacturacionInvoicePdfPayload) {
  const date = new Date(payload.fecha);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const dateLabel = new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(safeDate);
  const timeLabel = new Intl.DateTimeFormat("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(safeDate);
  const seller = payload.vendedor
    ? `${payload.vendedorNombre || "-"} (${payload.vendedor})`
    : payload.vendedorNombre || "-";
  const lines = [
    payload.companyName || "ROCKY MAXX",
    payload.companyDescription || "",
    payload.companyAddress || "",
    payload.companyTaxId ? `${payload.companyTaxIdLabel || "RIF"}: ${payload.companyTaxId}` : "",
    "FACTURA",
    "",
    `Documento: ${payload.numeroFactura || "-"}`,
    `Cliente: ${payload.clienteNombre || "-"}`,
    `Rif: ${payload.cliente || "-"}`,
    `Telefono: ${payload.clienteTelefono || "-"}`,
    `Dir.: ${payload.clienteDireccion || "-"}`,
    `Cajero: ${payload.nombreUsuario || "-"}    Caja: ${payload.numeroCaja || 0}`,
    `Vendedor: ${seller}`,
    `Factura: ${payload.numeroFactura || "-"}    Hora: ${timeLabel}`,
    `Fecha: ${dateLabel}`,
    "------------------------------------------------------------",
    "",
  ].filter((line) => line !== "");

  for (const item of payload.lineas || []) {
    const quantity = normalizeNumber(item.cantidad);
    const itemLabel = quantity > 1
      ? `${formatNumber(quantity)} x ${item.nombre || item.codigoBarra || "ARTICULO"}`
      : item.nombre || item.codigoBarra || "ARTICULO";
    lines.push(`${itemLabel}    Bs ${formatNumber(item.subtotal)}`);
    const discount = normalizeNumber(item.descuentoPorcentaje);
    if (discount > 0) {
      lines.push(`DESC ${formatNumber(discount)}%`);
    }
  }

  lines.push(
    "",
    `Valor mercancia: ${formatNumber(payload.totalMercancia)} BsS`,
    `Descuento: ${formatNumber(payload.totalDescuento)} BsS`,
    `Subtotal: ${formatNumber(payload.totalVenta)} BsS`,
    `Total unidades: ${formatNumber(payload.totalUnidades)}`,
    `Total USD: ${formatNumber(payload.totalDolares)} $`,
    `TOTAL: ${formatNumber(payload.totalVenta)} BsS`,
  );

  if (payload.pagos?.length) {
    lines.push("", "Pagos");
    for (const payment of payload.pagos) {
      lines.push(`${payment.label || "PAGO"}: ${formatNumber(payment.totalVed)} BsS`);
    }
  }

  lines.push("", "Gracias por su compra");
  return buildPlainTextPdf(lines);
}

function normalizeNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat("es-VE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalizeNumber(value));
}

function buildPlainTextPdf(lines: string[]) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginLeft = 42;
  const marginTop = 760;
  const lineHeight = 14;
  const linesPerPage = 48;
  const pages = chunkLines(lines.map(sanitizePdfText), linesPerPage);
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
      ...pageLines.flatMap((line, lineIndex) => lineIndex === 0
        ? [`(${escapePdfText(line)}) Tj`]
        : ["T*", `(${escapePdfText(line)}) Tj`]),
      "ET",
    ].join("\n");
    const contentObjectId = contentObjectIds[index];
    const pageObjectId = pageObjectIds[index];
    objects[contentObjectId] = `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
  });

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf, "utf8");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function chunkLines(lines: string[], size: number) {
  const result: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    result.push(lines.slice(index, index + size));
  }
  return result.length ? result : [["Sin informacion disponible."]];
}

function sanitizePdfText(value: unknown) {
  return String(value || "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "-";
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
