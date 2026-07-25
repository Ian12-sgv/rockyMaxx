// Extraido de apps/api/src/cajas/caja-close-report.util.ts (el patron de PDF vivo del
// repo, sin libreria externa: bytes %PDF-1.4 escritos a mano, Helvetica 10pt, paginado a
// 48 lineas/pagina). facturacion-invoice-pdf.util.ts y transfers/transfer-report.util.ts
// (este ultimo sin usar en ningun controller) tienen sus propias copias casi identicas;
// no se tocan aqui -- solo se centraliza la version que ya estaba viva y se reutiliza
// desde price-change-report.util.ts para no agregar una tercera copia.

export function buildPlainTextPdf(lines: string[]) {
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
