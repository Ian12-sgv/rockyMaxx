import "reflect-metadata";

import assert from "node:assert/strict";

import { PrismaClient } from "@prisma/client";

import { CajasService } from "../src/cajas/cajas.service";
import { MirrorSyncService } from "../src/mirror-sync/mirror-sync.service";

// Focused local-only tests for the CAJAS mirror-sync fix (FK_VENTAS_CAJAS incident).
// Run with: npm run test:mirror-sync-cajas --workspace=@sistema-arabe/api
// Requires a reachable local DATABASE_URL. Never touches the VPS. All fixtures use the
// ZZTST prefix / 9999xx id range and are deleted in the finally block below.

class FakeConfigService {
  constructor(private readonly values: Record<string, string>) {}

  get<T>(key: string, fallback?: T): T {
    if (key in this.values) {
      return this.values[key] as unknown as T;
    }
    return fallback as T;
  }
}

const prisma = new PrismaClient();
const configService = new FakeConfigService({
  MIRROR_SYNC_ENABLED: "true",
  DATABASE_URL: process.env.DATABASE_URL || "",
});
const mirrorSyncService = new MirrorSyncService(prisma as any, configService as any);
const cajasService = new CajasService(prisma as any, mirrorSyncService as any);

const SERIE_A = "ZZTST01";
const SERIE_B = "ZZTST02";
const SERIE_C = "ZZTST03";
const SERIE_D = "ZZTST04";
// IMPRESORAFISCAL.ID / CAJAS.IdImpresoraFiscal are legacy numeric(2,0) columns (max 99).
const IMPRESORA_A = 97;
const IMPRESORA_B = 98;
const USUARIO = "sistema";
const VENDEDOR = "2";
const CLIENTE = "1";
const CODIGO_BARRA = "005-1077C";

type TestFn = () => Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];
function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

function buildCajaPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    serie: SERIE_A,
    numero: 1,
    fondoCaja: "0",
    tipoListaPrecio: 1,
    tipoVenta: 0,
    tipoReporte: 0,
    ultimaFactura: "0",
    ultimaDevolucion: "0",
    permiteDescuento: 1,
    permiteFacturasExentas: 1,
    permiteAlternarListas: 0,
    cambiarPrecios: 0,
    requerirAutorizacion: 0,
    idImpresoraFiscal: IMPRESORA_A,
    nombreImpresora: "NO APLICA",
    numeroCopias: 1,
    incluirIGTF: false,
    ...overrides,
  };
}

function buildImpresoraPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: IMPRESORA_A,
    nombreImpresora: "IMPRESORA TEST",
    status: 1,
    idProcesoImpresion: 0,
    montoMaximoDiario: "99000000",
    incluyeIGTF: false,
    ...overrides,
  };
}

function buildCajaUpsertEnvelope(globalId: string, cajaOverrides = {}, impresoraOverrides = {}) {
  const caja = buildCajaPayload(cajaOverrides);
  return {
    schemaVersion: 1,
    globalId,
    sourceDatabase: "test",
    entityType: "CAJAS",
    entityKey: String(caja.serie),
    eventType: "CAJA_UPSERT",
    caja,
    impresoraFiscal: buildImpresoraPayload(impresoraOverrides),
  };
}

function buildSalePayload(serie: string, numeroFactura: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    numeroFactura,
    serie,
    fecha: new Date().toISOString(),
    vendedor: VENDEDOR,
    cliente: CLIENTE,
    tipoVenta: 0,
    formaPago: 1,
    diasCredito: 0,
    totalMercancia: "10.00",
    totalDescuento: "0.00",
    totalImpuesto: "1.60",
    totalCosto: "5.00",
    interContable: 0,
    usuario: USUARIO,
    status: 1,
    numeroOrden: numeroFactura,
    totalPago: "11.60",
    totalDolares: null,
    tasaCambio: null,
    estacion: null,
    totalDolaresE: null,
    tasaIGTF: null,
    montoIGTF: null,
    baseImponibleIGTF: null,
    ...overrides,
  };
}

function buildSaleLine(serie: string, numeroFactura: string) {
  return {
    numeroFactura,
    serie,
    hora: new Date().toISOString(),
    tipoLista: "D",
    codigoBarra: CODIGO_BARRA,
    precio: "10.00",
    precioLista: "10.00",
    costo: "5.00",
    impuesto: "1.60",
    porcentajeImpuesto: "16",
    cantidad: "1",
    cantidadDevuelta: "0",
    item: 1,
    porcentajeDescuento: "0",
    precioDetal: "10.00",
    regla: "",
    idRegla: 0,
  };
}

function buildSaleUpsertEnvelope(options: {
  globalId: string;
  serie: string;
  numeroFactura: string;
  caja?: ReturnType<typeof buildCajaPayload> | null;
  impresoraFiscal?: ReturnType<typeof buildImpresoraPayload> | null;
}) {
  const envelope: Record<string, unknown> = {
    schemaVersion: 1,
    globalId: options.globalId,
    sourceDatabase: "test",
    entityType: "VENTAS",
    entityKey: `${options.serie}:${options.numeroFactura}`,
    eventType: "SALE_UPSERT",
    sale: buildSalePayload(options.serie, options.numeroFactura),
    movVentas: [buildSaleLine(options.serie, options.numeroFactura)],
  };

  if (options.caja !== undefined) {
    envelope.caja = options.caja;
  }
  if (options.impresoraFiscal !== undefined) {
    envelope.impresoraFiscal = options.impresoraFiscal;
  }

  return envelope;
}

async function getInboxRow(globalId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select "Status", "Attempts", "LastError" from dbo."MIRROR_SYNC_INBOX" where "GlobalId" = $1`,
    globalId,
  );
  return rows[0] ?? null;
}

async function countOutboxPending(entityType: string, entityKey: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `select count(*)::int as total from dbo."MIRROR_SYNC_OUTBOX" where "EntityType" = $1 and "EntityKey" = $2 and "Status" = 'PENDING'`,
    entityType,
    entityKey,
  );
  return Number(rows[0]?.total ?? 0);
}

test("A1: CAJA_UPSERT aplica IMPRESORAFISCAL antes que CAJAS (sin FK error)", async () => {
  const globalId = "ZZTST-CAJA-A1";
  const result = await mirrorSyncService.importMirrorPayload(buildCajaUpsertEnvelope(globalId));
  assert.equal(result.status, "APPLIED");

  const caja = await prisma.cajas.findUnique({ where: { Serie: SERIE_A } });
  assert.ok(caja, "la caja debe existir tras el CAJA_UPSERT");
  assert.equal(caja!.IdImpresoraFiscal, IMPRESORA_A);

  const impresora = await prisma.impresoraFiscal.findUnique({ where: { ID: IMPRESORA_A } });
  assert.ok(impresora, "la impresora fiscal debe existir tras el CAJA_UPSERT");
});

test("A2: reintentar el mismo envelope (mismo GlobalId) no duplica ni reaplica", async () => {
  const globalId = "ZZTST-CAJA-A1"; // same as A1 on purpose
  const result = await mirrorSyncService.importMirrorPayload(buildCajaUpsertEnvelope(globalId));
  assert.equal(result.imported, false);
  assert.equal(result.status, "APPLIED");

  const inboxRows = await prisma.$queryRawUnsafe<any[]>(
    `select count(*)::int as total from dbo."MIRROR_SYNC_INBOX" where "GlobalId" = $1`,
    globalId,
  );
  assert.equal(Number(inboxRows[0]?.total ?? 0), 1, "debe existir una unica fila de inbox para ese GlobalId");
});

test("A3: actualizar una caja existente actualiza sus campos permitidos", async () => {
  const globalId = "ZZTST-CAJA-A3";
  const result = await mirrorSyncService.importMirrorPayload(
    buildCajaUpsertEnvelope(globalId, { numero: 42, fondoCaja: "123.45" }),
  );
  assert.equal(result.status, "APPLIED");

  const caja = await prisma.cajas.findUnique({ where: { Serie: SERIE_A } });
  assert.equal(caja!.Numero, 42);
  assert.equal(caja!.FondoCaja.toString(), "123.45");
});

test("B1: SALE_UPSERT con caja inexistente en destino pero incluida en el envelope se aplica", async () => {
  const numeroFactura = "999900000001";
  const globalId = "ZZTST-SALE-B1";

  const existingCaja = await prisma.cajas.findUnique({ where: { Serie: SERIE_B } });
  assert.equal(existingCaja, null, "precondicion: SERIE_B no debe existir aun en destino");

  const envelope = buildSaleUpsertEnvelope({
    globalId,
    serie: SERIE_B,
    numeroFactura,
    caja: buildCajaPayload({ serie: SERIE_B, idImpresoraFiscal: IMPRESORA_A }),
    impresoraFiscal: buildImpresoraPayload(),
  });

  const result = await mirrorSyncService.importMirrorPayload(envelope);
  assert.equal(result.status, "APPLIED");

  const caja = await prisma.cajas.findUnique({ where: { Serie: SERIE_B } });
  assert.ok(caja, "la caja embebida debe haberse creado");

  const venta = await prisma.ventas.findUnique({
    where: { NumeroFactura_Serie: { NumeroFactura: BigInt(numeroFactura), Serie: SERIE_B } },
  });
  assert.ok(venta, "la venta debe haberse aplicado");
  assert.equal(venta!.Serie, SERIE_B);
});

test("B2/C1: envelope legacy sin caja deja ERROR durable si la caja falta (no se pierde)", async () => {
  const numeroFactura = "999900000002";
  const globalId = "ZZTST-SALE-C1";

  const missingCaja = await prisma.cajas.findUnique({ where: { Serie: SERIE_C } });
  assert.equal(missingCaja, null, "precondicion: SERIE_C no debe existir aun");

  const envelope = buildSaleUpsertEnvelope({ globalId, serie: SERIE_C, numeroFactura });
  // legacy envelope: no "caja"/"impresoraFiscal" keys at all

  await assert.rejects(() => mirrorSyncService.importMirrorPayload(envelope));

  const inboxRow = await getInboxRow(globalId);
  assert.ok(inboxRow, "la fila de inbox debe sobrevivir al rollback de la transaccion de apply");
  assert.equal(inboxRow.Status, "ERROR");
  assert.ok(Number(inboxRow.Attempts) >= 1);
  assert.ok(inboxRow.LastError, "LastError debe quedar registrado");

  const venta = await prisma.ventas.findUnique({
    where: { NumeroFactura_Serie: { NumeroFactura: BigInt(numeroFactura), Serie: SERIE_C } },
  });
  assert.equal(venta, null, "la venta no debe haberse aplicado sin su caja");
});

test("C2: reintentar tras resolver la dependencia transiciona a APPLIED", async () => {
  const numeroFactura = "999900000002"; // same as C1
  const globalId = "ZZTST-SALE-C1"; // same globalId as C1, retried

  // Resolve the missing dependency out-of-band, like the bootstrap endpoint would.
  await mirrorSyncService.importMirrorPayload(
    buildCajaUpsertEnvelope("ZZTST-CAJA-C2", { serie: SERIE_C }),
  );

  const envelope = buildSaleUpsertEnvelope({ globalId, serie: SERIE_C, numeroFactura });
  const result = await mirrorSyncService.importMirrorPayload(envelope);
  assert.equal(result.status, "APPLIED");

  const inboxRow = await getInboxRow(globalId);
  assert.equal(inboxRow.Status, "APPLIED");

  const venta = await prisma.ventas.findUnique({
    where: { NumeroFactura_Serie: { NumeroFactura: BigInt(numeroFactura), Serie: SERIE_C } },
  });
  assert.ok(venta, "la venta debe quedar aplicada tras resolver la caja");
});

test("D1/D2: backfill encola CAJA_UPSERT para cajas existentes y es idempotente", async () => {
  const before = await countOutboxPending("CAJAS", SERIE_A);

  const first = await mirrorSyncService.backfillCajaUpserts();
  assert.equal(first.enabled, true);
  assert.ok(first.found >= 1);
  assert.ok(first.queued >= 1);

  const afterFirst = await countOutboxPending("CAJAS", SERIE_A);
  assert.equal(afterFirst, 1, "debe haber una unica fila PENDING para SERIE_A tras el primer backfill");

  const second = await mirrorSyncService.backfillCajaUpserts();
  assert.equal(second.found, first.found);

  const afterSecond = await countOutboxPending("CAJAS", SERIE_A);
  assert.equal(afterSecond, 1, "ejecutar el backfill dos veces no debe duplicar la fila PENDING");
  void before;
});

test("E1: CajasService.create encola CAJA_UPSERT (solo en mutaciones explicitas de config)", async () => {
  const before = await countOutboxPending("CAJAS", SERIE_D);
  assert.equal(before, 0);

  await cajasService.create({
    serie: SERIE_D,
    fecha: new Date(),
    numeroCaja: 999,
  } as any);

  const after = await countOutboxPending("CAJAS", SERIE_D);
  assert.equal(after, 1, "CajasService.create debe encolar exactamente un CAJA_UPSERT PENDING");
});

async function cleanup() {
  const series = [SERIE_A, SERIE_B, SERIE_C, SERIE_D];
  const numerosFactura = ["999900000001", "999900000002"];

  await prisma.$executeRawUnsafe(
    `delete from dbo."MOVVENTAS" where "NumeroFactura" = any($1::bigint[])`,
    numerosFactura.map((n) => BigInt(n)),
  );
  await prisma.$executeRawUnsafe(
    `delete from dbo."VENTAS" where "NumeroFactura" = any($1::bigint[])`,
    numerosFactura.map((n) => BigInt(n)),
  );
  await prisma.$executeRawUnsafe(`delete from dbo."DIARIOCAJA" where "Serie" = any($1::text[])`, series);
  await prisma.$executeRawUnsafe(`delete from dbo."CAJAS" where "Serie" = any($1::text[])`, series);
  await prisma.$executeRawUnsafe(
    `delete from dbo."IMPRESORAFISCAL" where "ID" = any($1::int[])`,
    [IMPRESORA_A, IMPRESORA_B],
  );
  await prisma.$executeRawUnsafe(
    `delete from dbo."MIRROR_SYNC_OUTBOX" where "GlobalId" like 'ZZTST-%' or "EntityKey" = any($1::text[])`,
    series,
  );
  await prisma.$executeRawUnsafe(`delete from dbo."MIRROR_SYNC_INBOX" where "GlobalId" like 'ZZTST-%'`);
}

async function main() {
  await cleanup();

  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`OK   ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }

  await cleanup();
  await prisma.$disconnect();

  if (failures > 0) {
    console.error(`\n${failures} test(s) fallaron.`);
    process.exit(1);
  }

  console.log(`\nTodos los tests (${tests.length}) pasaron.`);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
  process.exit(1);
});
