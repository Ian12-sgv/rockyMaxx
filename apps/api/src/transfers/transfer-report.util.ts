export type TransferReportLine = {
  item: number;
  codigoBarra: string;
  referencia: string;
  nombre: string;
  cantidad: string;
  valorUnitario: string;
  subtotal: string;
};

export type TransferReportPayload = {
  title: string;
  numero: number;
  fecha: string;
  fechaAprobacion: string;
  status: string;
  envia: string;
  recibe: string;
  documentoOrigen: string;
  usuario: string;
  tipoDespacho: string;
  observacion: string;
  totalItems: number;
  totalCantidad: string;
  totalValor: string;
  generatedAt: string;
  lines: TransferReportLine[];
};

export function buildTransferReportPdf(report: TransferReportPayload) {
  const lines = buildTransferReportLines(report);
  return buildPlainTextPdf(lines);
}

function buildTransferReportLines(report: TransferReportPayload) {
  const lines = [
    sanitizePdfText(report.title || 'TRANSFERENCIA APROBADA'),
    '',
    `Numero: ${String(report.numero || 0)}`,
    `Fecha: ${sanitizePdfText(report.fecha || '-')}`,
  ];

  if (String(report.fechaAprobacion || '').trim()) {
    lines.push(`Fecha aprobacion: ${sanitizePdfText(report.fechaAprobacion)}`);
  }

  lines.push(
    `Status: ${sanitizePdfText(report.status || '-')}`,
    `Envia: ${sanitizePdfText(report.envia || '-')}`,
    `Recibe: ${sanitizePdfText(report.recibe || '-')}`,
  );

  if (String(report.documentoOrigen || '').trim()) {
    lines.push(`Documento origen: ${sanitizePdfText(report.documentoOrigen)}`);
  }

  if (String(report.usuario || '').trim()) {
    lines.push(`Usuario: ${sanitizePdfText(report.usuario)}`);
  }

  if (String(report.tipoDespacho || '').trim()) {
    lines.push(`Tipo despacho: ${sanitizePdfText(report.tipoDespacho)}`);
  }

  if (String(report.observacion || '').trim()) {
    lines.push(`Observacion: ${sanitizePdfText(report.observacion)}`);
  }

  lines.push(
    `Total items: ${String(report.totalItems || 0)}`,
    `Total cantidad: ${formatLocalizedAmount(report.totalCantidad)}`,
    `Total valor: Bs ${formatLocalizedAmount(report.totalValor)}`,
    '',
    'DETALLE',
    '',
  );

  const detailLines = (Array.isArray(report.lines) ? report.lines : []).flatMap((line) => {
    const quantity = formatLocalizedAmount(line.cantidad);
    const unitValue = formatLocalizedAmount(line.valorUnitario);
    const subtotal = formatLocalizedAmount(line.subtotal);
    const detail = [
      `[${String(line.item || 0)}] ${sanitizePdfText(line.codigoBarra || '-')}`,
      `Ref: ${sanitizePdfText(line.referencia || '-')}`,
      `Art: ${sanitizePdfText(line.nombre || '-')}`,
      `Cant: ${quantity} | Valor: Bs ${unitValue} | Subtotal: Bs ${subtotal}`,
      '',
    ];

    return detail;
  });

  if (detailLines.length === 0) {
    lines.push('Sin renglones para esta transferencia.');
  } else {
    lines.push(...detailLines);
  }

  lines.push(`Generado: ${sanitizePdfText(report.generatedAt || '-')}`);
  return lines;
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
  let pdf = '%PDF-1.4\n';

  const catalogObjectId = 1;
  const pagesObjectId = 2;
  const fontObjectId = 3;
  const firstPageObjectId = 4;
  const firstContentObjectId = firstPageObjectId + pages.length;

  const pageObjectIds = pages.map((_, index) => firstPageObjectId + index);
  const contentObjectIds = pages.map((_, index) => firstContentObjectId + index);

  objects[catalogObjectId] = `<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`;
  objects[pagesObjectId] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] >>`;
  objects[fontObjectId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((pageLines, index) => {
    const content = [
      'BT',
      '/F1 10 Tf',
      `${lineHeight} TL`,
      `${marginLeft} ${marginTop} Td`,
      ...pageLines.flatMap((line, lineIndex) => lineIndex === 0 ? [`(${escapePdfText(line)}) Tj`] : ['T*', `(${escapePdfText(line)}) Tj`]),
      'ET',
    ].join('\n');
    const contentLength = Buffer.byteLength(content, 'utf8');
    const contentObjectId = contentObjectIds[index];
    const pageObjectId = pageObjectIds[index];

    objects[contentObjectId] = `<< /Length ${contentLength} >>\nstream\n${content}\nendstream`;
    objects[pageObjectId] = `<< /Type /Page /Parent ${pagesObjectId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
  });

  for (let index = 1; index < objects.length; index += 1) {
    const entry = `${index} 0 obj\n${objects[index]}\nendobj\n`;
    offsets[index] = Buffer.byteLength(pdf, 'utf8');
    pdf += entry;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
}

function chunkLines(lines: string[], size: number) {
  if (!lines.length) {
    return [['Sin informacion disponible.']];
  }

  const result: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    result.push(lines.slice(index, index + size));
  }
  return result;
}

function sanitizePdfText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^ -~]+/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '-';
}

function escapePdfText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function normalizeAmount(value: unknown) {
  const normalized = Number.parseFloat(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(normalized) ? normalized : 0;
}

function formatLocalizedAmount(value: unknown) {
  return new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(normalizeAmount(value));
}