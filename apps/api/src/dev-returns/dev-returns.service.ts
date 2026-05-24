import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, type Inventario } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { UserView } from "../users/user-view.util";
import { ApproveDevReturnDto } from "./dto/approve-dev-return.dto";
import { CreateDevDraftDto, CreateDevDraftLineDto } from "./dto/create-dev-draft.dto";
import { FindDevDraftsDto } from "./dto/find-dev-drafts.dto";

const ZERO = new Prisma.Decimal(0);
const DEFAULT_WAREHOUSE_CODE = "ORIGEN";
const DEFAULT_RETURN_LOT = "DEV_AUTO";
const DEFAULT_RETURN_LOT_DESCRIPTION = "Lote automatico para devoluciones";
const DEV_RETURN_SYNC_SCHEMA_VERSION = 1;
const DEV_RETURN_SYNC_STATUS_PENDING = "PENDING";
const DEV_RETURN_SYNC_STATUS_SENT = "SENT";
const DEV_RETURN_SYNC_STATUS_RECEIVED = "RECEIVED";
const DEV_RETURN_SYNC_STATUS_APPROVED = "APPROVED";
const DEV_RETURN_SYNC_STATUS_APPLIED = "APPLIED";
const DEV_RETURN_SYNC_STATUS_ERROR = "ERROR";
const DEV_RETURN_EVENT_DRAFT_EXPORTED = "DEV_DRAFT_EXPORTED";
const DEV_RETURN_EVENT_DRAFT_APPROVED = "DEV_DRAFT_APPROVED";
const DEV_RETURN_EVENT_RETURN_REGISTERED = "DEV_RETURN_REGISTERED";
const DEV_RETURN_EVENT_RETURN_APPLIED = "DEV_RETURN_APPLIED";

type DevReturnTransactionClient = Prisma.TransactionClient;
const devDraftInclude = Prisma.validator<Prisma.DevBorradorInclude>()({
  movimientos: {
    orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
    include: {
      inventarioRef: {
        include: {
          marcaRef: true,
          tallaRef: true,
          colorRef: true,
          fabricanteRef: true,
          categoriaRef: true,
          impuestoRef: true,
        },
      },
    },
  },
  usuarioRef: true,
});
const devReturnInclude = Prisma.validator<Prisma.DevTransferenciasInclude>()({
  lote: true,
  sucursalRecibe: true,
  movDevTransferencias: {
    orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
    include: {
      inventarioRef: {
        include: {
          marcaRef: true,
          tallaRef: true,
          colorRef: true,
          fabricanteRef: true,
          categoriaRef: true,
          impuestoRef: true,
        },
      },
    },
  },
});
const inboundReturnInclude = Prisma.validator<Prisma.IDevTransferenciasInclude>()({
  lote: true,
  sucursalEnvia: true,
  iMovDevTransferencias: {
    orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
    include: {
      inventarioRef: {
        include: {
          marcaRef: true,
          tallaRef: true,
          colorRef: true,
          fabricanteRef: true,
          categoriaRef: true,
          impuestoRef: true,
        },
      },
    },
  },
});

type DevDraftWithRelations = Prisma.DevBorradorGetPayload<{ include: typeof devDraftInclude }>;
type DevReturnWithRelations = Prisma.DevTransferenciasGetPayload<{ include: typeof devReturnInclude }>;
type InboundDevReturnWithRelations = Prisma.IDevTransferenciasGetPayload<{ include: typeof inboundReturnInclude }>;

type NormalizedDevDraftLine = {
  item: number;
  codigoBarra: string;
  cantidad: Prisma.Decimal;
  numeroCaja: number;
  costo: Prisma.Decimal;
  articulo: DevDraftWithRelations["movimientos"][number]["inventarioRef"];
};

type SyncNodeRow = {
  NodeId: string;
  SucursalCodigo: string;
  Nombre: string | null;
  Tipo: string | null;
  ApiUrl: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
  LastSeenAt: Date | null;
};

type DevReturnSyncOutboxRow = {
  GlobalId: string;
  NumeroOrigen: bigint;
  CodigoEnvia: string;
  CodigoRecibe: string;
  SourceNodeId: string;
  DestinationNodeId: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  CreatedAt: Date;
  SentAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type DevReturnSyncInboxRow = {
  GlobalId: string;
  NumeroOrigen: bigint;
  CodigoEnvia: string;
  CodigoRecibe: string;
  SourceNodeId: string;
  DestinationNodeId: string;
  EventType: string;
  Payload: unknown;
  Status: string;
  ReceivedAt: Date;
  AppliedAt: Date | null;
  Attempts: number;
  LastError: string | null;
};

type ReturnExportInfo = {
  exportada: boolean;
  bloqueada: boolean;
  globalId: string | null;
  status: string | null;
  statusNombre: string | null;
  sentAt: Date | null;
  lastError: string | null;
};

type SyncCatalogPayload = {
  codigo: string | number;
  nombre?: string | null;
  status?: number | null;
  porcentajeImpuesto?: string | null;
};

type SyncInventoryPayload = {
  codigoBarra: string;
  referencia: string;
  codigoMarca: string;
  nombre: string;
  talla: string;
  codigoColor: string;
  fabricante: string;
  categoria: string;
  nota: string | null;
  tipoImpuesto: number;
  precioDetal: string;
  precioMayor: string;
  precioAfiliado: string;
  precioPromocion: string;
  promocion: boolean;
  fechaInicial: string;
  fechaFinal: string;
  costoInicial: string;
  costoPromedio: string;
  ultimoCosto: string;
  costoDolar: string;
  existenciaInicial: string;
  puntoReorden: string;
  tipo: number;
  status: number;
  serializado: number;
  codigoBarraAnt: string;
  catalogs: {
    marca: SyncCatalogPayload;
    talla: SyncCatalogPayload;
    color: SyncCatalogPayload;
    fabricante: SyncCatalogPayload;
    categoria: SyncCatalogPayload;
    impuesto: SyncCatalogPayload;
  };
};

type SyncDraftLinePayload = {
  item: number;
  codigoBarra: string;
  cantidad: string;
  numeroCaja: number;
  costo: string;
  articulo: SyncInventoryPayload;
};

type DraftExportPayload = {
  schemaVersion: number;
  eventType: typeof DEV_RETURN_EVENT_DRAFT_EXPORTED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  draft: {
    numero: string;
    fecha: string;
    codigoOrigen: string;
    codigoDestino: string;
    observacion: string;
    status: number;
    usuario: string | null;
  };
  items: SyncDraftLinePayload[];
};

type DraftApprovedPayload = {
  schemaVersion: number;
  eventType: typeof DEV_RETURN_EVENT_DRAFT_APPROVED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  draftGlobalId: string;
  draft: DraftExportPayload["draft"];
  approvedAt: string;
  approver: string | null;
};

type ReturnRegisteredPayload = {
  schemaVersion: number;
  eventType: typeof DEV_RETURN_EVENT_RETURN_REGISTERED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  draftGlobalId: string;
  devolucion: {
    numero: number;
    fecha: string;
    fechaEmision: string;
    codigoEnvia: string;
    codigoRecibe: string;
    documentoOrigen: string;
    totalValor: string;
    observacion: string;
    status: number;
    usuario: string | null;
    interContable: number | null;
    idLote: number;
    lote: {
      id: number;
      lote: string;
      descripcion: string | null;
      estado: number | null;
    };
  };
  items: SyncDraftLinePayload[];
};

type ReturnAppliedPayload = {
  schemaVersion: number;
  eventType: typeof DEV_RETURN_EVENT_RETURN_APPLIED;
  globalId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  draftGlobalId: string;
  devolucion: {
    numero: number;
    codigoEnvia: string;
    codigoRecibe: string;
  };
  approvedAt: string;
  approver: string | null;
};

type DevReturnSyncPayload =
  | DraftExportPayload
  | DraftApprovedPayload
  | ReturnRegisteredPayload
  | ReturnAppliedPayload;

type InstanceContext = {
  databaseName: string;
  sucursalCodigo: string;
  nodeId: string;
  nombre: string;
  tipo: string;
  apiUrl: string;
};

@Injectable()
export class DevReturnsService {
  private readonly logger = new Logger(DevReturnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async getMetadata() {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const current = this.getCurrentInstanceContext();
    const bodegas = await this.loadWarehouseLocations(this.prisma, {
      excludeCodes: [current.sucursalCodigo],
    });
    const [sentCount, receivedCount] = await Promise.all([
      this.prisma.devBorrador.count({
        where: { Status: { gt: 0 } },
      }),
      this.countInboundDrafts(),
    ]);

    return {
      defaults: {
        fecha: new Date(),
        status: 0,
        codigoDestino: bodegas[0]?.codigo ?? "",
        codigoOrigen: current.sucursalCodigo,
      },
      contexto: {
        sucursalCodigo: current.sucursalCodigo,
        nodeId: current.nodeId,
        nombre: current.nombre,
        apiUrl: current.apiUrl,
      },
      bandejas: {
        enviados: sentCount,
        recibidos: receivedCount,
      },
      destinos: bodegas,
    };
  }

  async searchDrafts(findDevDraftsDto: FindDevDraftsDto) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const limit = findDevDraftsDto.limit ?? 25;
    const buscar = String(findDevDraftsDto.buscar || "").trim();
    const current = this.getCurrentInstanceContext();

    const items = await this.prisma.devBorrador.findMany({
      where: {
        ...(findDevDraftsDto.status === undefined ? {} : { Status: findDevDraftsDto.status }),
        ...(buscar
          ? {
              OR: [
                Number.isInteger(Number(buscar)) ? { Numero: BigInt(buscar) } : {},
                { Observacion: { contains: buscar, mode: "insensitive" } },
                { Usuario: { contains: buscar, mode: "insensitive" } },
                { CodigoDestino: { contains: buscar, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: devDraftInclude,
      orderBy: { Numero: "desc" },
      take: limit,
    });
    const destinos = await this.loadLocationsByCode(
      this.prisma,
      items.map((item) => item.CodigoDestino).filter((value): value is string => Boolean(value)),
    );

    return {
      items: items.map((item) =>
        this.toDraftView(item, {
          origenCodigo: current.sucursalCodigo,
          globalId: this.buildDraftGlobalId(current.nodeId, item.Numero),
          destinoInfo: item.CodigoDestino ? destinos.get(item.CodigoDestino) : null,
        }),
      ),
    };
  }

  async searchInboundDrafts(findDevDraftsDto: FindDevDraftsDto) {
    await this.ensureDevReturnSyncSchema();
    const limit = findDevDraftsDto.limit ?? 25;
    const rows = await this.prisma.$queryRawUnsafe<DevReturnSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_INBOX"
        where "EventType" = $1
        order by "ReceivedAt" desc
        limit $2
      `,
      DEV_RETURN_EVENT_DRAFT_EXPORTED,
      limit,
    );

    return {
      items: rows.map((row) => this.toInboundDraftView(row)),
    };
  }

  async findDraft(numero: bigint) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const current = this.getCurrentInstanceContext();
    const borrador = await this.findDraftOrThrow(this.prisma, numero);
    const destinos = await this.loadLocationsByCode(
      this.prisma,
      borrador.CodigoDestino ? [borrador.CodigoDestino] : [],
    );

    return {
      borrador: this.toDraftView(borrador, {
        origenCodigo: current.sucursalCodigo,
        globalId: this.buildDraftGlobalId(current.nodeId, borrador.Numero),
        destinoInfo: borrador.CodigoDestino ? destinos.get(borrador.CodigoDestino) : null,
      }),
    };
  }

  async findInboundDraft(globalId: string) {
    await this.ensureDevReturnSyncSchema();
    const row = await this.getDevReturnSyncInboxRow(this.prisma, this.normalizeGlobalId(globalId));
    if (!row || row.EventType !== DEV_RETURN_EVENT_DRAFT_EXPORTED) {
      throw new NotFoundException("El borrador recibido no existe.");
    }

    return {
      borrador: this.toInboundDraftView(row),
    };
  }

  async createDraft(createDevDraftDto: CreateDevDraftDto, user: UserView) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const borrador = await this.prisma.$transaction(
      async (tx) => {
        const numero = await this.getNextDraftNumber(tx);
        const fecha = createDevDraftDto.fecha ?? new Date();
        const lines = await this.normalizeDraftLines(tx, createDevDraftDto.items || []);
        const codigoDestino = await this.resolveDraftDestination(tx, createDevDraftDto.codigoDestino);

        if (lines.length === 0) {
          throw new BadRequestException("El borrador de devolucion debe tener al menos un renglon.");
        }

        await tx.devBorrador.create({
          data: {
            Numero: numero,
            Fecha: fecha,
            CodigoDestino: codigoDestino,
            Observacion: String(createDevDraftDto.observacion || "").trim(),
            Usuario: user.codUsuario,
            Status: 0,
          },
        });

        await tx.movDevBorrador.createMany({
          data: lines.map((line) => ({
            Numero: numero,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            Costo: line.costo,
          })),
        });

        return this.findDraftOrThrow(tx, numero);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const current = this.getCurrentInstanceContext();
    const destinos = await this.loadLocationsByCode(
      this.prisma,
      borrador.CodigoDestino ? [borrador.CodigoDestino] : [],
    );

    return {
      borrador: this.toDraftView(borrador, {
        origenCodigo: current.sucursalCodigo,
        globalId: this.buildDraftGlobalId(current.nodeId, borrador.Numero),
        destinoInfo: borrador.CodigoDestino ? destinos.get(borrador.CodigoDestino) : null,
      }),
    };
  }

  async updateDraft(numero: bigint, createDevDraftDto: CreateDevDraftDto) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const borrador = await this.prisma.$transaction(
      async (tx) => {
        const existing = await this.findDraftOrThrow(tx, numero);

        if (existing.Status !== 0) {
          throw new ConflictException("Solo se pueden editar borradores guardados.");
        }

        const fecha = createDevDraftDto.fecha ?? existing.Fecha;
        const lines = await this.normalizeDraftLines(tx, createDevDraftDto.items || []);
        const codigoDestino = await this.resolveDraftDestination(tx, createDevDraftDto.codigoDestino);

        if (lines.length === 0) {
          throw new BadRequestException("El borrador de devolucion debe tener al menos un renglon.");
        }

        await tx.devBorrador.update({
          where: { Numero: existing.Numero },
          data: {
            Fecha: fecha,
            CodigoDestino: codigoDestino,
            Observacion: String(createDevDraftDto.observacion || "").trim(),
          },
        });

        await tx.movDevBorrador.deleteMany({
          where: { Numero: existing.Numero },
        });

        await tx.movDevBorrador.createMany({
          data: lines.map((line) => ({
            Numero: existing.Numero,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            Costo: line.costo,
          })),
        });

        return this.findDraftOrThrow(tx, numero);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const current = this.getCurrentInstanceContext();
    const destinos = await this.loadLocationsByCode(
      this.prisma,
      borrador.CodigoDestino ? [borrador.CodigoDestino] : [],
    );

    return {
      borrador: this.toDraftView(borrador, {
        origenCodigo: current.sucursalCodigo,
        globalId: this.buildDraftGlobalId(current.nodeId, borrador.Numero),
        destinoInfo: borrador.CodigoDestino ? destinos.get(borrador.CodigoDestino) : null,
      }),
    };
  }

  async exportDraft(numero: bigint) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const current = this.getCurrentInstanceContext();
        const existing = await this.findDraftOrThrow(tx, numero);

        if (existing.Status !== 0) {
          throw new ConflictException("Solo se pueden exportar borradores guardados.");
        }

        const codigoDestino = await this.resolveDraftDestination(tx, existing.CodigoDestino);
        await this.ensureLocations(tx, [current.sucursalCodigo, codigoDestino]);

        await tx.devBorrador.update({
          where: { Numero: existing.Numero },
          data: { Status: 1 },
        });

        const refreshed = await this.findDraftOrThrow(tx, numero);
        const sourceNodeId = await this.resolveSyncNodeId(tx, current.sucursalCodigo);
        const destinationNodeId = await this.resolveSyncNodeId(tx, codigoDestino);
        const payload = this.buildDraftExportPayload(refreshed, {
          codigoOrigen: current.sucursalCodigo,
          sourceNodeId,
          destinationNodeId,
        });

        await this.recordSyncOutbox(tx, {
          globalId: payload.globalId,
          numeroOrigen: existing.Numero,
          codigoEnvia: current.sucursalCodigo,
          codigoRecibe: codigoDestino,
          sourceNodeId,
          destinationNodeId,
          eventType: DEV_RETURN_EVENT_DRAFT_EXPORTED,
          payload,
        });

        return {
          draft: refreshed,
          payloadGlobalId: payload.globalId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const destinos = await this.loadLocationsByCode(
      this.prisma,
      result.draft.CodigoDestino ? [result.draft.CodigoDestino] : [],
    );
    const current = this.getCurrentInstanceContext();
    const sync = await this.pushPendingSyncForGlobalId(result.payloadGlobalId);

    return {
      borrador: this.toDraftView(result.draft, {
        origenCodigo: current.sucursalCodigo,
        globalId: result.payloadGlobalId,
        destinoInfo: result.draft.CodigoDestino ? destinos.get(result.draft.CodigoDestino) : null,
      }),
      sync,
    };
  }

  async approveInboundDraft(globalId: string, user: UserView) {
    await this.ensureDevReturnSyncSchema();
    const normalizedGlobalId = this.normalizeGlobalId(globalId);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const row = await this.getDevReturnSyncInboxRow(tx, normalizedGlobalId);
        if (!row || row.EventType !== DEV_RETURN_EVENT_DRAFT_EXPORTED) {
          throw new NotFoundException("El borrador recibido no existe.");
        }

        const payload = this.normalizeDraftExportPayload(this.parseRawJson(row.Payload));
        if (row.Status === DEV_RETURN_SYNC_STATUS_APPROVED || row.Status === DEV_RETURN_SYNC_STATUS_APPLIED) {
          return {
            row: await this.getDevReturnSyncInboxRowOrThrow(tx, normalizedGlobalId),
            ackGlobalId: null,
          };
        }

        await this.updateSyncInboxStatus(
          tx,
          normalizedGlobalId,
          DEV_RETURN_SYNC_STATUS_APPROVED,
          null,
        );

        const ackPayload = this.buildDraftApprovedPayload(payload, user);
        await this.recordSyncOutbox(tx, {
          globalId: ackPayload.globalId,
          numeroOrigen: BigInt(payload.draft.numero),
          codigoEnvia: payload.draft.codigoDestino,
          codigoRecibe: payload.draft.codigoOrigen,
          sourceNodeId: ackPayload.sourceNodeId,
          destinationNodeId: ackPayload.destinationNodeId,
          eventType: DEV_RETURN_EVENT_DRAFT_APPROVED,
          payload: ackPayload,
        });

        return {
          row: await this.getDevReturnSyncInboxRowOrThrow(tx, normalizedGlobalId),
          ackGlobalId: ackPayload.globalId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const sync = result.ackGlobalId ? await this.pushPendingSyncForGlobalId(result.ackGlobalId) : null;

    return {
      borrador: this.toInboundDraftView(result.row),
      sync,
    };
  }

  async approveInboundDraftByNumero(numero: bigint, user: UserView) {
    await this.ensureDevReturnSyncSchema();
    const row = await this.getInboundDraftByNumero(this.prisma, numero);
    if (!row) {
      throw new NotFoundException("El borrador recibido no existe.");
    }

    return this.approveInboundDraft(row.GlobalId, user);
  }

  async searchReturns(findDevDraftsDto: FindDevDraftsDto) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const limit = findDevDraftsDto.limit ?? 25;
    const buscar = String(findDevDraftsDto.buscar || "").trim();

    const items = await this.prisma.devTransferencias.findMany({
      where: {
        ...(findDevDraftsDto.status === undefined ? {} : { Status: findDevDraftsDto.status }),
        ...(buscar
          ? {
              OR: [
                Number.isInteger(Number(buscar)) ? { Numero: Number(buscar) } : {},
                { CodigoEnvia: { contains: buscar, mode: "insensitive" } },
                { CodigoRecibe: { contains: buscar, mode: "insensitive" } },
                { Observacion: { contains: buscar, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        sucursalRecibe: true,
        movDevTransferencias: {
          orderBy: [{ Item: "asc" }],
        },
      },
      orderBy: { Numero: "desc" },
      take: limit,
    });
    const origenes = await this.loadLocationsByCode(this.prisma, items.map((item) => item.CodigoEnvia));
    const exportRows = await this.loadReturnExportRows(this.prisma, items.map((item) => item.Numero));

    return {
      items: items.map((item) =>
        this.toReturnListItemView(
          item,
          origenes.get(item.CodigoEnvia),
          exportRows.get(item.Numero),
        ),
      ),
    };
  }

  async findReturn(numero: number) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const devolucion = await this.findReturnOrThrow(this.prisma, numero);
    const exportRow = await this.findReturnExportRow(this.prisma, numero);

    return {
      devolucion: this.toReturnDetailView(devolucion, exportRow),
    };
  }

  async exportReturn(numero: number) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const devolucion = await this.findReturnOrThrow(tx, numero);
        const sourceNodeId = await this.resolveSyncNodeId(tx, devolucion.CodigoEnvia);
        const destinationNodeId = await this.resolveSyncNodeId(tx, devolucion.CodigoRecibe);
        const draftGlobalId = this.buildDraftGlobalId(sourceNodeId, BigInt(devolucion.Numero));
        const returnGlobalId = this.buildEventGlobalId(draftGlobalId, "RETURN");
        const existingExport = await this.getSyncOutboxRow(tx, returnGlobalId);
        if (existingExport) {
          throw new ConflictException("La devolucion ya fue exportada previamente.");
        }
        const payload = this.buildReturnRegisteredPayload(devolucion, draftGlobalId, {
          sourceNodeId,
          destinationNodeId,
        });

        await this.recordSyncOutbox(tx, {
          globalId: payload.globalId,
          numeroOrigen: BigInt(devolucion.Numero),
          codigoEnvia: devolucion.CodigoEnvia,
          codigoRecibe: devolucion.CodigoRecibe,
          sourceNodeId,
          destinationNodeId,
          eventType: DEV_RETURN_EVENT_RETURN_REGISTERED,
          payload,
        });

        return {
          devolucion,
          payloadGlobalId: payload.globalId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const sync = await this.pushPendingSyncForGlobalId(result.payloadGlobalId);

    return {
      devolucion: this.toReturnDetailView(
        result.devolucion,
        await this.findReturnExportRow(this.prisma, numero),
      ),
      sync,
    };
  }

  async searchInboundReturns(findDevDraftsDto: FindDevDraftsDto) {
    await this.ensureDevReturnSyncSchema();
    const limit = findDevDraftsDto.limit ?? 25;
    const buscar = String(findDevDraftsDto.buscar || "").trim();

    const items = await this.prisma.iDevTransferencias.findMany({
      where: {
        ...(findDevDraftsDto.status === undefined ? {} : { Status: findDevDraftsDto.status }),
        ...(buscar
          ? {
              OR: [
                Number.isInteger(Number(buscar)) ? { Numero: Number(buscar) } : {},
                { CodigoEnvia: { contains: buscar, mode: "insensitive" } },
                { CodigoRecibe: { contains: buscar, mode: "insensitive" } },
                { Observacion: { contains: buscar, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        sucursalEnvia: true,
        iMovDevTransferencias: {
          orderBy: [{ Item: "asc" }],
        },
      },
      orderBy: [{ Numero: "desc" }, { CodigoEnvia: "asc" }],
      take: limit,
    });

    return {
      items: items.map((item) => this.toInboundReturnListItemView(item)),
    };
  }

  async findInboundReturn(numero: number, codigoEnvia?: string) {
    await this.ensureDevReturnSyncSchema();
    const devolucion = await this.findInboundReturnOrThrow(this.prisma, numero, codigoEnvia);

    return {
      devolucion: this.toInboundReturnDetailView(devolucion),
    };
  }

  async approveInboundReturn(numero: number, codigoEnvia: string | undefined, user: UserView) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const existing = await this.findInboundReturnOrThrow(tx, numero, codigoEnvia);
        if (existing.Status === 1) {
          throw new ConflictException("La devolucion ya fue aprobada por el destino.");
        }

        await this.applyInventoryDelta(tx, this.aggregateInboundReturnQuantities(existing.iMovDevTransferencias));
        await this.mirrorSyncService.enqueueInventorySnapshotsTx(
          tx,
          existing.iMovDevTransferencias.map((line) => line.CodigoBarra),
        );

        await tx.iDevTransferencias.update({
          where: {
            Numero_CodigoEnvia: {
              Numero: existing.Numero,
              CodigoEnvia: existing.CodigoEnvia,
            },
          },
          data: {
            Status: 1,
            Usuario: user.codUsuario,
          },
        });

        const syncRow = await this.getInboundReturnSyncRow(tx, existing.Numero, existing.CodigoEnvia, existing.CodigoRecibe);
        if (!syncRow) {
          throw new NotFoundException("No existe paquete de sincronizacion para esta devolucion.");
        }

        const payload = this.normalizeReturnRegisteredPayload(this.parseRawJson(syncRow.Payload));
        await this.updateSyncInboxStatus(
          tx,
          syncRow.GlobalId,
          DEV_RETURN_SYNC_STATUS_APPLIED,
          null,
        );

        const ackPayload = this.buildReturnAppliedPayload(payload, user);
        await this.recordSyncOutbox(tx, {
          globalId: ackPayload.globalId,
          numeroOrigen: BigInt(existing.Numero),
          codigoEnvia: existing.CodigoRecibe,
          codigoRecibe: existing.CodigoEnvia,
          sourceNodeId: ackPayload.sourceNodeId,
          destinationNodeId: ackPayload.destinationNodeId,
          eventType: DEV_RETURN_EVENT_RETURN_APPLIED,
          payload: ackPayload,
        });

        return {
          devolucion: await this.findInboundReturnOrThrow(tx, numero, existing.CodigoEnvia),
          ackGlobalId: ackPayload.globalId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const [sync, mirrorSync] = await Promise.all([
      this.pushPendingSyncForGlobalId(result.ackGlobalId),
      this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }),
    ]);

    return {
      devolucion: this.toInboundReturnDetailView(result.devolucion),
      sync,
      mirrorSync,
    };
  }

  async importSyncPackage(body: Record<string, unknown>) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const eventType = String(body?.eventType || "").trim().toUpperCase();

    if (eventType === DEV_RETURN_EVENT_DRAFT_EXPORTED) {
      const payload = this.normalizeDraftExportPayload(body);
      return this.importDraftExportPayload(payload);
    }

    if (eventType === DEV_RETURN_EVENT_DRAFT_APPROVED) {
      const payload = this.normalizeDraftApprovedPayload(body);
      return this.importDraftApprovedPayload(payload);
    }

    if (eventType === DEV_RETURN_EVENT_RETURN_REGISTERED) {
      const payload = this.normalizeReturnRegisteredPayload(body);
      return this.importReturnRegisteredPayload(payload);
    }

    if (eventType === DEV_RETURN_EVENT_RETURN_APPLIED) {
      const payload = this.normalizeReturnAppliedPayload(body);
      return this.importReturnAppliedPayload(payload);
    }

    throw new BadRequestException("Tipo de evento de devolucion no soportado.");
  }

  async approveReturnAtOrigin(numero: bigint, approveDevReturnDto: ApproveDevReturnDto, user: UserView) {
    await this.ensureDraftSchema();
    await this.ensureDevReturnSyncSchema();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const draft = await this.findDraftOrThrow(tx, numero);
        if (draft.Status !== 1 && draft.Status !== 2) {
          throw new ConflictException("El borrador debe estar exportado o aprobado para registrarlo.");
        }

        await this.ensureReturnReferences(tx, approveDevReturnDto);
        const returnDoc = await this.registerReturnFromDraft(tx, draft, {
          codigoEnvia: approveDevReturnDto.codigoEnvia,
          codigoRecibe: approveDevReturnDto.codigoRecibe,
          documentoOrigen: this.buildReturnDocumentOrigin(approveDevReturnDto.codigoOrigen, draft.Numero),
          fechaEmision: approveDevReturnDto.fechaEmision ?? new Date(),
          interContable: approveDevReturnDto.interContable ?? 0,
          idLote: approveDevReturnDto.idLote,
          userCode: user.codUsuario,
          nextDraftStatus: 3,
        });

        const sourceNodeId = await this.resolveSyncNodeId(tx, approveDevReturnDto.codigoEnvia);
        const destinationNodeId = await this.resolveSyncNodeId(tx, approveDevReturnDto.codigoRecibe);
        const draftGlobalId = this.buildDraftGlobalId(sourceNodeId, draft.Numero);
        const payload = this.buildReturnRegisteredPayload(returnDoc, draftGlobalId, {
          sourceNodeId,
          destinationNodeId,
        });

        await this.recordSyncOutbox(tx, {
          globalId: payload.globalId,
          numeroOrigen: BigInt(returnDoc.Numero),
          codigoEnvia: returnDoc.CodigoEnvia,
          codigoRecibe: returnDoc.CodigoRecibe,
          sourceNodeId,
          destinationNodeId,
          eventType: DEV_RETURN_EVENT_RETURN_REGISTERED,
          payload,
        });

        return {
          devolucion: returnDoc,
          payloadGlobalId: payload.globalId,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const [sync, mirrorSync] = await Promise.all([
      this.pushPendingSyncForGlobalId(result.payloadGlobalId),
      this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }),
    ]);

    return {
      devolucion: this.toReturnDetailView(result.devolucion),
      sync,
      mirrorSync,
    };
  }

  private async importDraftExportPayload(payload: DraftExportPayload) {
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existingInbox = await this.getDevReturnSyncInboxRow(tx, payload.globalId);
          if (existingInbox?.Status === DEV_RETURN_SYNC_STATUS_APPROVED || existingInbox?.Status === DEV_RETURN_SYNC_STATUS_APPLIED) {
            return {
              imported: false,
              status: existingInbox.Status,
              globalId: payload.globalId,
              message: "El borrador ya habia sido aprobado en esta base.",
            };
          }

          await this.ensureLocations(tx, [payload.draft.codigoOrigen, payload.draft.codigoDestino]);
          await this.upsertSyncInbox(tx, payload, DEV_RETURN_SYNC_STATUS_RECEIVED);

          return {
            imported: true,
            status: DEV_RETURN_SYNC_STATUS_RECEIVED,
            globalId: payload.globalId,
            numero: payload.draft.numero,
            codigoEnvia: payload.draft.codigoOrigen,
            codigoRecibe: payload.draft.codigoDestino,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return result;
    } catch (error) {
      await this.markSyncInboxError(payload, this.extractSyncErrorMessage(error));
      throw error;
    }
  }

  private async importDraftApprovedPayload(payload: DraftApprovedPayload) {
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await this.upsertSyncInbox(tx, payload, DEV_RETURN_SYNC_STATUS_RECEIVED);
          const draft = await this.findDraftOrThrow(tx, BigInt(payload.draft.numero));

          if (draft.Status >= 3) {
            await this.updateSyncInboxStatus(tx, payload.globalId, DEV_RETURN_SYNC_STATUS_APPLIED, null);
            return {
              imported: false,
              status: DEV_RETURN_SYNC_STATUS_APPLIED,
              globalId: payload.globalId,
              numero: payload.draft.numero,
              message: "La devolucion ya estaba registrada en el origen.",
              pendingGlobalId: null,
            };
          }

          await tx.devBorrador.update({
            where: { Numero: draft.Numero },
            data: { Status: 2 },
          });

          const localLotUserCode = await this.resolveExistingLocalUserCode(
            tx,
            draft.Usuario,
            payload.approver,
            "admin",
          );
          const lotId = await this.ensureDefaultReturnLot(tx, localLotUserCode);
          const returnUserCode = this.normalizeOptionalCode(draft.Usuario)
            || localLotUserCode
            || this.normalizeOptionalCode(payload.approver)
            || "sistema";
          const returnDoc = await this.registerReturnFromDraft(tx, draft, {
            codigoEnvia: payload.draft.codigoOrigen,
            codigoRecibe: payload.draft.codigoDestino,
            documentoOrigen: this.buildReturnDocumentOrigin(payload.draftGlobalId, draft.Numero),
            fechaEmision: new Date(payload.approvedAt),
            interContable: 0,
            idLote: lotId,
            userCode: returnUserCode,
            nextDraftStatus: 3,
          });

          const returnPayload = this.buildReturnRegisteredPayload(returnDoc, payload.draftGlobalId, {
            sourceNodeId: payload.destinationNodeId,
            destinationNodeId: payload.sourceNodeId,
          });
          await this.recordSyncOutbox(tx, {
            globalId: returnPayload.globalId,
            numeroOrigen: BigInt(returnDoc.Numero),
            codigoEnvia: returnDoc.CodigoEnvia,
            codigoRecibe: returnDoc.CodigoRecibe,
            sourceNodeId: returnPayload.sourceNodeId,
            destinationNodeId: returnPayload.destinationNodeId,
            eventType: DEV_RETURN_EVENT_RETURN_REGISTERED,
            payload: returnPayload,
          });

          await this.updateSyncInboxStatus(tx, payload.globalId, DEV_RETURN_SYNC_STATUS_APPLIED, null);

          return {
            imported: true,
            status: DEV_RETURN_SYNC_STATUS_APPLIED,
            globalId: payload.globalId,
            numero: payload.draft.numero,
            pendingGlobalId: returnPayload.globalId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.pendingGlobalId) {
        await Promise.all([
          this.pushPendingSyncForGlobalId(result.pendingGlobalId),
          this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 }),
        ]);
      }

      return result;
    } catch (error) {
      await this.markSyncInboxError(payload, this.extractSyncErrorMessage(error));
      throw error;
    }
  }

  private async importReturnRegisteredPayload(payload: ReturnRegisteredPayload) {
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existingInbox = await this.getDevReturnSyncInboxRow(tx, payload.globalId);
          if (existingInbox?.Status === DEV_RETURN_SYNC_STATUS_APPLIED) {
            return {
              imported: false,
              status: DEV_RETURN_SYNC_STATUS_APPLIED,
              globalId: payload.globalId,
              message: "La devolucion ya habia sido aplicada en esta base.",
            };
          }

          await this.upsertSyncInbox(tx, payload, DEV_RETURN_SYNC_STATUS_RECEIVED);
          const existingInbound = await tx.iDevTransferencias.findUnique({
            where: {
              Numero_CodigoEnvia: {
                Numero: payload.devolucion.numero,
                CodigoEnvia: payload.devolucion.codigoEnvia,
              },
            },
          });

          if (existingInbound) {
            return {
              imported: false,
              status: existingInbox?.Status ?? DEV_RETURN_SYNC_STATUS_RECEIVED,
              globalId: payload.globalId,
              message: "La devolucion ya existia como carga en esta base.",
            };
          }

          await this.ensureLocations(tx, [payload.devolucion.codigoEnvia, payload.devolucion.codigoRecibe]);
          await this.ensureSyncedLot(tx, payload);
          for (const line of payload.items) {
            await this.ensureSyncedInventoryDetails(tx, line.articulo);
          }

          await tx.iDevTransferencias.create({
            data: {
              Numero: payload.devolucion.numero,
              CodigoEnvia: payload.devolucion.codigoEnvia,
              CodigoRecibe: payload.devolucion.codigoRecibe,
              Fecha: new Date(payload.devolucion.fecha),
              FechaEmision: new Date(payload.devolucion.fechaEmision),
              TotalValor: this.parseNonNegativeDecimal(payload.devolucion.totalValor, "Total invalido."),
              Observacion: payload.devolucion.observacion,
              Status: 0,
              Usuario: payload.devolucion.usuario || null,
              InterContable: payload.devolucion.interContable ?? 0,
              IDLote: payload.devolucion.idLote,
            },
          });

          await tx.iMovDevTransferencias.createMany({
            data: payload.items.map((line) => ({
              Numero: payload.devolucion.numero,
              CodigoEnvia: payload.devolucion.codigoEnvia,
              Item: line.item,
              Fecha: new Date(payload.devolucion.fecha),
              CodigoBarra: line.codigoBarra,
              Cantidad: this.parsePositiveDecimal(line.cantidad, "Cantidad invalida."),
              Valor: this.parseNonNegativeDecimal(line.costo, "Costo invalido."),
              NumeroCaja: line.numeroCaja,
              UltimoCosto: this.parseNonNegativeDecimal(line.articulo.ultimoCosto, "Ultimo costo invalido."),
              CostoInicial: this.parseNonNegativeDecimal(line.articulo.costoInicial, "Costo inicial invalido."),
              CostoDolar: this.parseNonNegativeDecimal(line.articulo.costoDolar, "Costo dolar invalido."),
            })),
          });

          return {
            imported: true,
            status: DEV_RETURN_SYNC_STATUS_RECEIVED,
            globalId: payload.globalId,
            numero: payload.devolucion.numero,
            codigoEnvia: payload.devolucion.codigoEnvia,
            codigoRecibe: payload.devolucion.codigoRecibe,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return result;
    } catch (error) {
      await this.markSyncInboxError(payload, this.extractSyncErrorMessage(error));
      throw error;
    }
  }

  private async importReturnAppliedPayload(payload: ReturnAppliedPayload) {
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await this.upsertSyncInbox(tx, payload, DEV_RETURN_SYNC_STATUS_APPLIED);

          await tx.devTransferencias.updateMany({
            where: {
              Numero: payload.devolucion.numero,
              CodigoEnvia: payload.devolucion.codigoEnvia,
              CodigoRecibe: payload.devolucion.codigoRecibe,
            },
            data: {
              Status: 1,
            },
          });

          await tx.devBorrador.updateMany({
            where: {
              Numero: BigInt(payload.devolucion.numero),
            },
            data: {
              Status: 4,
            },
          });

          return {
            imported: true,
            status: DEV_RETURN_SYNC_STATUS_APPLIED,
            globalId: payload.globalId,
            numero: payload.devolucion.numero,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return result;
    } catch (error) {
      await this.markSyncInboxError(payload, this.extractSyncErrorMessage(error));
      throw error;
    }
  }

  private async countInboundDrafts() {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ total: bigint }>>(
      `
        select count(*)::bigint as total
        from dbo."DEV_RETURN_SYNC_INBOX"
        where "EventType" = $1
      `,
      DEV_RETURN_EVENT_DRAFT_EXPORTED,
    );

    return Number(rows[0]?.total ?? BigInt(0));
  }

  private async findDraftOrThrow(
    client: PrismaService | DevReturnTransactionClient,
    numero: bigint,
  ): Promise<DevDraftWithRelations> {
    const draft = await client.devBorrador.findUnique({
      where: { Numero: numero },
      include: devDraftInclude,
    });

    if (!draft) {
      throw new NotFoundException("El borrador de devolucion no existe.");
    }

    return draft;
  }

  private async findReturnOrThrow(
    client: PrismaService | DevReturnTransactionClient,
    numero: number,
  ): Promise<DevReturnWithRelations> {
    const devolucion = await client.devTransferencias.findUnique({
      where: { Numero: numero },
      include: devReturnInclude,
    });

    if (!devolucion) {
      throw new NotFoundException("La devolucion no existe.");
    }

    return devolucion;
  }

  private async findInboundReturnOrThrow(
    client: PrismaService | DevReturnTransactionClient,
    numero: number,
    codigoEnvia?: string,
  ): Promise<InboundDevReturnWithRelations> {
    const normalizedCodigoEnvia = this.normalizeOptionalCode(codigoEnvia);
    if (normalizedCodigoEnvia) {
      const found = await client.iDevTransferencias.findUnique({
        where: {
          Numero_CodigoEnvia: {
            Numero: numero,
            CodigoEnvia: normalizedCodigoEnvia,
          },
        },
        include: inboundReturnInclude,
      });

      if (!found) {
        throw new NotFoundException("La devolucion recibida no existe.");
      }

      return found;
    }

    const items = await client.iDevTransferencias.findMany({
      where: { Numero: numero },
      include: inboundReturnInclude,
      take: 2,
    });

    if (!items.length) {
      throw new NotFoundException("La devolucion recibida no existe.");
    }

    if (items.length > 1) {
      throw new ConflictException("Debes indicar la sucursal origen para esta devolucion.");
    }

    return items[0];
  }

  private async getNextDraftNumber(tx: DevReturnTransactionClient) {
    const result = await tx.devBorrador.aggregate({
      _max: { Numero: true },
    });

    return (result._max.Numero ?? BigInt(0)) + BigInt(1);
  }

  private async ensureDraftSchema() {
    await this.prisma.$executeRawUnsafe(`
      alter table dbo."DEVBORRADOR"
      add column if not exists "CodigoDestino" varchar(15)
    `);
  }

  private async ensureDevReturnSyncSchema(client: PrismaService | DevReturnTransactionClient = this.prisma) {
    await client.$executeRawUnsafe(`
      create table if not exists dbo."SYNC_NODES" (
        "NodeId" text primary key,
        "SucursalCodigo" varchar(15) not null,
        "Nombre" varchar(80),
        "Tipo" varchar(20),
        "CreatedAt" timestamptz not null default now(),
        "UpdatedAt" timestamptz not null default now(),
        "LastSeenAt" timestamptz
      )
    `);

    await client.$executeRawUnsafe(`
      create unique index if not exists "UX_SYNC_NODES_SucursalCodigo"
      on dbo."SYNC_NODES" ("SucursalCodigo")
    `);

    await client.$executeRawUnsafe(`
      alter table dbo."SYNC_NODES"
      add column if not exists "ApiUrl" varchar(200)
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."DEV_RETURN_SYNC_OUTBOX" (
        "GlobalId" text primary key,
        "NumeroOrigen" bigint not null,
        "CodigoEnvia" varchar(15) not null,
        "CodigoRecibe" varchar(15) not null,
        "SourceNodeId" text not null,
        "DestinationNodeId" text not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'PENDING',
        "CreatedAt" timestamptz not null default now(),
        "SentAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_DEV_RETURN_SYNC_OUTBOX_Status"
      on dbo."DEV_RETURN_SYNC_OUTBOX" ("Status", "CreatedAt")
    `);

    await client.$executeRawUnsafe(`
      create table if not exists dbo."DEV_RETURN_SYNC_INBOX" (
        "GlobalId" text primary key,
        "NumeroOrigen" bigint not null,
        "CodigoEnvia" varchar(15) not null,
        "CodigoRecibe" varchar(15) not null,
        "SourceNodeId" text not null,
        "DestinationNodeId" text not null,
        "EventType" varchar(40) not null,
        "Payload" jsonb not null,
        "Status" varchar(20) not null default 'RECEIVED',
        "ReceivedAt" timestamptz not null default now(),
        "AppliedAt" timestamptz,
        "Attempts" integer not null default 0,
        "LastError" text
      )
    `);

    await client.$executeRawUnsafe(`
      create index if not exists "IX_DEV_RETURN_SYNC_INBOX_Status"
      on dbo."DEV_RETURN_SYNC_INBOX" ("Status", "ReceivedAt")
    `);

    await this.ensureLocalSyncNodeRegistration(client);
  }

  private async normalizeDraftLines(tx: DevReturnTransactionClient, items: CreateDevDraftLineDto[]) {
    const meaningfulItems = items.filter((item) => String(item.codigoBarra || "").trim());
    const codes = [...new Set(meaningfulItems.map((item) => item.codigoBarra))];
    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
      include: {
        marcaRef: true,
        tallaRef: true,
        colorRef: true,
        fabricanteRef: true,
        categoriaRef: true,
        impuestoRef: true,
      },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));

    return meaningfulItems.map((item, index): NormalizedDevDraftLine => {
      const articulo = articlesByCode.get(item.codigoBarra);
      if (!articulo) {
        throw new NotFoundException(`No se encontro el articulo ${item.codigoBarra} en inventario.`);
      }

      const cantidad = new Prisma.Decimal(item.cantidad || "0");
      if (cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`La cantidad del articulo ${item.codigoBarra} debe ser mayor a cero.`);
      }

      return {
        item: index + 1,
        codigoBarra: item.codigoBarra,
        cantidad,
        numeroCaja: item.numeroCaja ?? 0,
        costo: new Prisma.Decimal(item.costo || articulo.UltimoCosto || articulo.CostoInicial || ZERO),
        articulo,
      };
    });
  }

  private async ensureReturnReferences(tx: DevReturnTransactionClient, dto: ApproveDevReturnDto) {
    if (dto.codigoEnvia === dto.codigoRecibe) {
      throw new BadRequestException("El origen y el destino no pueden ser iguales.");
    }

    const [origin, destination, lote] = await Promise.all([
      tx.sucursales.findUnique({ where: { Codigo: dto.codigoEnvia } }),
      tx.sucursales.findUnique({ where: { Codigo: dto.codigoRecibe } }),
      tx.lotes.findUnique({ where: { ID: dto.idLote } }),
    ]);

    if (!origin) {
      throw new BadRequestException("La sucursal que envia no existe.");
    }
    if (!destination) {
      throw new BadRequestException("La sucursal que recibe no existe.");
    }
    if (!lote) {
      throw new BadRequestException("El lote indicado no existe.");
    }
  }

  private async resolveDraftDestination(
    tx: DevReturnTransactionClient,
    codigoDestino: string | null | undefined,
  ) {
    const normalizedCode = this.normalizeRequiredCode(
      codigoDestino,
      "Debes indicar el destino del borrador.",
    );
    const current = this.getCurrentInstanceContext();
    if (normalizedCode === current.sucursalCodigo) {
      throw new BadRequestException("El destino del borrador no puede ser la misma sucursal origen.");
    }

    const destination = await tx.sucursales.findUnique({
      where: { Codigo: normalizedCode },
    });

    if (!destination) {
      throw new BadRequestException("La bodega destino no existe.");
    }

    if (!this.isWarehouseCode(destination.Codigo)) {
      throw new BadRequestException("El destino del borrador solo puede ser una bodega.");
    }

    return destination.Codigo;
  }

  private async loadWarehouseLocations(
    client: PrismaService | DevReturnTransactionClient,
    options: { excludeCodes?: string[] } = {},
  ) {
    const locations = await client.sucursales.findMany({
      where: { Status: 1 },
      orderBy: [{ Codigo: "asc" }],
    });
    const excluded = new Set(
      (options.excludeCodes || [])
        .map((item) => String(item || "").trim().toUpperCase())
        .filter(Boolean),
    );

    return locations
      .filter((item) => this.isWarehouseCode(item.Codigo))
      .filter((item) => !excluded.has(item.Codigo))
      .map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre,
        status: item.Status,
      }));
  }

  private async loadLocationsByCode(
    client: PrismaService | DevReturnTransactionClient,
    codes: string[],
  ) {
    const uniqueCodes = [...new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))];
    if (!uniqueCodes.length) {
      return new Map<string, { codigo: string; nombre: string | null; status: number | null }>();
    }

    const locations = await client.sucursales.findMany({
      where: {
        Codigo: { in: uniqueCodes },
      },
    });

    return new Map(
      locations.map((item) => [
        item.Codigo,
        {
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        },
      ]),
    );
  }

  private isWarehouseCode(code: string | null | undefined) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    return normalizedCode === DEFAULT_WAREHOUSE_CODE || !/^\d+$/.test(normalizedCode);
  }

  private calculateDraftTotal(lines: Array<{ Cantidad: Prisma.Decimal; Costo: Prisma.Decimal }>) {
    return lines.reduce((total, line) => total.plus(line.Cantidad.mul(line.Costo)), ZERO);
  }

  private aggregateDraftQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const positive = new Map<string, Prisma.Decimal>();
    const negated = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = positive.get(line.CodigoBarra) ?? ZERO;
      positive.set(line.CodigoBarra, current.plus(line.Cantidad));
      negated.set(line.CodigoBarra, (negated.get(line.CodigoBarra) ?? ZERO).minus(line.Cantidad));
    }

    return { positive, negated };
  }

  private aggregateInboundReturnQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const values = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      values.set(line.CodigoBarra, (values.get(line.CodigoBarra) ?? ZERO).plus(line.Cantidad));
    }

    return values;
  }

  private async applyInventoryDelta(tx: DevReturnTransactionClient, values: Map<string, Prisma.Decimal>) {
    const codes = Array.from(values.keys());
    if (codes.length === 0) {
      return;
    }

    const articles = await tx.inventario.findMany({
      where: { CodigoBarra: { in: codes } },
    });
    const articlesByCode = new Map(articles.map((article) => [article.CodigoBarra, article]));
    const now = new Date();

    for (const [codigoBarra, delta] of values.entries()) {
      const article = articlesByCode.get(codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      const nextExistence = article.Existencia.plus(delta);
      if (nextExistence.lessThan(0)) {
        throw new BadRequestException(
          `El articulo ${codigoBarra} no tiene existencia suficiente. Disponible: ${article.Existencia.toString()}, solicitado: ${delta.abs().toString()}.`,
        );
      }

      await tx.inventario.update({
        where: { CodigoBarra: codigoBarra },
        data: {
          Existencia: nextExistence,
          UltimaActualizacion: now,
          FechaPrimerMovimiento: article.FechaPrimerMovimiento ?? now,
        },
      });
    }
  }

  private toDraftView(
    item: DevDraftWithRelations,
    options: {
      origenCodigo: string;
      globalId: string;
      destinoInfo?: { codigo: string; nombre: string | null; status: number | null } | null;
    },
  ) {
    return {
      globalId: options.globalId,
      numero: item.Numero.toString(),
      fecha: item.Fecha,
      codigoOrigen: options.origenCodigo,
      codigoDestino: item.CodigoDestino ?? "",
      codigoDestinoInfo: options.destinoInfo
        ? {
            codigo: options.destinoInfo.codigo,
            nombre: options.destinoInfo.nombre,
            status: options.destinoInfo.status,
          }
        : null,
      observacion: item.Observacion,
      usuario: item.Usuario,
      usuarioNombre: item.usuarioRef?.NombreUsuario ?? null,
      status: item.Status,
      statusNombre: this.toDraftStatusName(item.Status),
      totalValor: this.calculateDraftTotal(item.movimientos).toString(),
      items: item.movimientos.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        numeroCaja: line.NumeroCaja,
        costo: line.Costo.toString(),
        articulo: {
          codigoBarra: line.inventarioRef.CodigoBarra,
          nombre: line.inventarioRef.Nombre,
          referencia: line.inventarioRef.Referencia,
          existenciaActual: line.inventarioRef.Existencia.toString(),
        },
      })),
    };
  }

  private toInboundDraftView(row: DevReturnSyncInboxRow) {
    const payload = this.normalizeDraftExportPayload(this.parseRawJson(row.Payload));

    return {
      globalId: row.GlobalId,
      numero: payload.draft.numero,
      fecha: payload.draft.fecha,
      codigoOrigen: payload.draft.codigoOrigen,
      codigoDestino: payload.draft.codigoDestino,
      observacion: payload.draft.observacion,
      usuario: payload.draft.usuario,
      status: row.Status,
      statusNombre: this.toInboundDraftStatusName(row.Status),
      recibido: row.ReceivedAt,
      aprobado: row.AppliedAt,
      ultimoError: row.LastError,
      totalValor: payload.items.reduce(
        (total, item) =>
          total.plus(
            this.parsePositiveDecimal(item.cantidad, "Cantidad invalida.").mul(
              this.parseNonNegativeDecimal(item.costo, "Costo invalido."),
            ),
          ),
        ZERO,
      ).toString(),
      items: payload.items.map((line) => ({
        item: line.item,
        codigoBarra: line.codigoBarra,
        cantidad: line.cantidad,
        numeroCaja: line.numeroCaja,
        costo: line.costo,
        articulo: {
          codigoBarra: line.articulo.codigoBarra,
          referencia: line.articulo.referencia,
          nombre: line.articulo.nombre,
        },
      })),
    };
  }

  private toDraftStatusName(status: number) {
    if (status === 1) {
      return "exportada";
    }

    if (status === 2) {
      return "aprobada";
    }

    if (status === 3) {
      return "registrada";
    }

    if (status === 4) {
      return "completada";
    }

    return "guardada";
  }

  private toInboundDraftStatusName(status: string) {
    const normalizedStatus = String(status || "").trim().toUpperCase();
    if (normalizedStatus === DEV_RETURN_SYNC_STATUS_APPROVED) {
      return "aprobado";
    }
    if (normalizedStatus === DEV_RETURN_SYNC_STATUS_APPLIED) {
      return "aplicado";
    }
    if (normalizedStatus === DEV_RETURN_SYNC_STATUS_ERROR) {
      return "error";
    }

    return "recibido";
  }

  private toReturnListItemView(
    item: Prisma.DevTransferenciasGetPayload<{
      include: {
        sucursalRecibe: true;
        movDevTransferencias: true;
      };
    }>,
    origenInfo?: { codigo: string; nombre: string | null; status: number | null },
    exportRow?: DevReturnSyncOutboxRow | null,
  ) {
    const totalCantidad = item.movDevTransferencias.reduce(
      (total, line) => total.plus(line.Cantidad),
      ZERO,
    );

    return {
      numero: item.Numero,
      fecha: item.Fecha,
      codigoEnvia: item.CodigoEnvia,
      codigoEnviaInfo: origenInfo
        ? {
            codigo: origenInfo.codigo,
            nombre: origenInfo.nombre,
            status: origenInfo.status,
          }
        : null,
      codigoRecibe: item.CodigoRecibe,
      codigoRecibeInfo: item.sucursalRecibe
        ? {
            codigo: item.sucursalRecibe.Codigo,
            nombre: item.sucursalRecibe.Nombre,
            status: item.sucursalRecibe.Status,
          }
        : null,
      observacion: item.Observacion,
      status: item.Status,
      statusNombre: item.Status === 1 ? "recibida" : "registrada",
      totalValor: item.TotalValor.toString(),
      totalCantidad: totalCantidad.toString(),
      fechaEmision: item.FechaEmision,
      exportacion: this.toReturnExportInfo(exportRow),
    };
  }

  private toReturnDetailView(item: DevReturnWithRelations, exportRow?: DevReturnSyncOutboxRow | null) {
    return {
      numero: item.Numero,
      fecha: item.Fecha,
      codigoEnvia: item.CodigoEnvia,
      codigoRecibe: item.CodigoRecibe,
      codigoRecibeInfo: item.sucursalRecibe
        ? {
            codigo: item.sucursalRecibe.Codigo,
            nombre: item.sucursalRecibe.Nombre,
            status: item.sucursalRecibe.Status,
          }
        : null,
      codigoOrigen: item.DocumentoOrigen,
      totalValor: item.TotalValor.toString(),
      observacion: item.Observacion,
      status: item.Status,
      statusNombre: item.Status === 1 ? "recibida" : "registrada",
      usuario: item.Usuario,
      fechaEmision: item.FechaEmision,
      interContable: item.InterContable,
      idLote: item.IDLote,
      lote: item.lote
        ? {
            id: item.lote.ID,
            lote: item.lote.Lote,
            descripcion: item.lote.Descripcion,
            estado: item.lote.Estado,
          }
        : null,
      exportacion: this.toReturnExportInfo(exportRow),
      items: item.movDevTransferencias.map((line) => ({
        item: line.Item,
        fecha: line.Fecha,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        numeroCaja: line.NumeroCaja,
        articulo: {
          codigoBarra: line.inventarioRef.CodigoBarra,
          referencia: line.inventarioRef.Referencia,
          nombre: line.inventarioRef.Nombre,
        },
      })),
    };
  }

  private toReturnExportInfo(row?: DevReturnSyncOutboxRow | null): ReturnExportInfo {
    if (!row) {
      return {
        exportada: false,
        bloqueada: false,
        globalId: null,
        status: null,
        statusNombre: null,
        sentAt: null,
        lastError: null,
      };
    }

    const normalizedStatus = String(row.Status || "").trim().toUpperCase();
    const labels: Record<string, string> = {
      PENDING: "pendiente",
      SENT: "exportada",
      RECEIVED: "recibida",
      APPROVED: "aprobada",
      APPLIED: "aplicada",
      ERROR: "error",
    };

    return {
      exportada: true,
      bloqueada: true,
      globalId: row.GlobalId,
      status: normalizedStatus || null,
      statusNombre: labels[normalizedStatus] || normalizedStatus.toLowerCase() || null,
      sentAt: row.SentAt ?? null,
      lastError: row.LastError ?? null,
    };
  }

  private toInboundReturnListItemView(
    item: Prisma.IDevTransferenciasGetPayload<{
      include: {
        sucursalEnvia: true;
        iMovDevTransferencias: true;
      };
    }>,
  ) {
    const totalCantidad = item.iMovDevTransferencias.reduce(
      (total, line) => total.plus(line.Cantidad),
      ZERO,
    );

    return {
      numero: item.Numero,
      fecha: item.Fecha,
      codigoEnvia: item.CodigoEnvia,
      codigoEnviaInfo: item.sucursalEnvia
        ? {
            codigo: item.sucursalEnvia.Codigo,
            nombre: item.sucursalEnvia.Nombre,
            status: item.sucursalEnvia.Status,
          }
        : null,
      codigoRecibe: item.CodigoRecibe,
      observacion: item.Observacion,
      status: item.Status,
      statusNombre: item.Status === 1 ? "aprobada" : "pendiente",
      totalValor: item.TotalValor.toString(),
      totalCantidad: totalCantidad.toString(),
      fechaEmision: item.FechaEmision,
    };
  }

  private toInboundReturnDetailView(item: InboundDevReturnWithRelations) {
    return {
      numero: item.Numero,
      fecha: item.Fecha,
      codigoEnvia: item.CodigoEnvia,
      codigoRecibe: item.CodigoRecibe,
      totalValor: item.TotalValor.toString(),
      observacion: item.Observacion,
      status: item.Status,
      statusNombre: item.Status === 1 ? "aprobada" : "pendiente",
      usuario: item.Usuario,
      fechaEmision: item.FechaEmision,
      interContable: item.InterContable,
      idLote: item.IDLote,
      lote: item.lote
        ? {
            id: item.lote.ID,
            lote: item.lote.Lote,
            descripcion: item.lote.Descripcion,
            estado: item.lote.Estado,
          }
        : null,
      items: item.iMovDevTransferencias.map((line) => ({
        item: line.Item,
        fecha: line.Fecha,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        valor: line.Valor.toString(),
        numeroCaja: line.NumeroCaja,
        articulo: {
          codigoBarra: line.inventarioRef.CodigoBarra,
          referencia: line.inventarioRef.Referencia,
          nombre: line.inventarioRef.Nombre,
          existenciaActual: line.inventarioRef.Existencia.toString(),
        },
      })),
    };
  }

  private getCurrentInstanceContext(): InstanceContext {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const apiPort = Number(this.configService.get<string>("API_PORT", "3000") || "3000") || 3000;
    const databaseNameMatch = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    const databaseName = databaseNameMatch?.[1] ?? "";
    const storeMatch = databaseName.match(/rocky_tienda_(\d+)/i);
    const warehouseMatch = databaseName.match(/rocky_bodega_(\d+)/i);

    if (storeMatch) {
      const code = storeMatch[1].padStart(3, "0");
      return {
        databaseName,
        sucursalCodigo: code,
        nodeId: `TIENDA${code}`,
        nombre: `Tienda ${code}`,
        tipo: "TIENDA",
        apiUrl: `http://localhost:${apiPort}`,
      };
    }

    if (warehouseMatch) {
      const code = warehouseMatch[1].padStart(3, "0");
      return {
        databaseName,
        sucursalCodigo: `B${code}`,
        nodeId: `BODEGA${code}`,
        nombre: `Bodega ${code}`,
        tipo: "BODEGA",
        apiUrl: `http://localhost:${apiPort}`,
      };
    }

    return {
      databaseName,
      sucursalCodigo: DEFAULT_WAREHOUSE_CODE,
      nodeId: DEFAULT_WAREHOUSE_CODE,
      nombre: DEFAULT_WAREHOUSE_CODE,
      tipo: "BODEGA",
      apiUrl: `http://localhost:${apiPort}`,
    };
  }

  private async ensureLocalSyncNodeRegistration(client: PrismaService | DevReturnTransactionClient) {
    const current = this.getCurrentInstanceContext();
    await this.upsertSyncNode(client, current);

    if (current.sucursalCodigo !== DEFAULT_WAREHOUSE_CODE) {
      const originNode = this.buildFallbackSyncNode(DEFAULT_WAREHOUSE_CODE);
      await this.upsertSyncNode(client, {
        databaseName: current.databaseName,
        sucursalCodigo: originNode.SucursalCodigo,
        nodeId: originNode.NodeId,
        nombre: originNode.Nombre || DEFAULT_WAREHOUSE_CODE,
        tipo: originNode.Tipo || "BODEGA",
        apiUrl: originNode.ApiUrl || "http://localhost:3000",
      });
    }
  }

  private async upsertSyncNode(
    client: PrismaService | DevReturnTransactionClient,
    node: InstanceContext,
  ) {
    await client.$executeRawUnsafe(
      `
        insert into dbo."SYNC_NODES"
          ("NodeId", "SucursalCodigo", "Nombre", "Tipo", "ApiUrl", "CreatedAt", "UpdatedAt", "LastSeenAt")
        values ($1, $2, $3, $4, $5, now(), now(), now())
        on conflict ("NodeId") do update set
          "SucursalCodigo" = excluded."SucursalCodigo",
          "Nombre" = excluded."Nombre",
          "Tipo" = excluded."Tipo",
          "ApiUrl" = excluded."ApiUrl",
          "UpdatedAt" = now(),
          "LastSeenAt" = now()
      `,
      node.nodeId,
      node.sucursalCodigo,
      node.nombre,
      node.tipo,
      node.apiUrl,
    );
  }

  private async resolveSyncNodeId(
    client: PrismaService | DevReturnTransactionClient,
    sucursalCodigo: string,
  ) {
    const code = this.normalizeRequiredCode(sucursalCodigo, "Codigo de sucursal invalido.");
    const rows = await client.$queryRawUnsafe<SyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        where upper("SucursalCodigo") = upper($1) or upper("NodeId") = upper($1)
        order by case when upper("SucursalCodigo") = upper($1) then 0 else 1 end
        limit 1
      `,
      code,
    );

    if (rows[0]) {
      return rows[0].NodeId;
    }

    return this.buildFallbackSyncNode(code).NodeId;
  }

  private async resolveDestinationSyncNode(row: DevReturnSyncOutboxRow) {
    const rows = await this.prisma.$queryRawUnsafe<SyncNodeRow[]>(
      `
        select
          "NodeId",
          "SucursalCodigo",
          "Nombre",
          "Tipo",
          "ApiUrl",
          "CreatedAt",
          "UpdatedAt",
          "LastSeenAt"
        from dbo."SYNC_NODES"
        where
          upper("NodeId") = upper($1)
          or upper("SucursalCodigo") = upper($1)
          or upper("SucursalCodigo") = upper($2)
        order by
          case
            when upper("NodeId") = upper($1) then 0
            when upper("SucursalCodigo") = upper($1) then 1
            else 2
          end
        limit 1
      `,
      row.DestinationNodeId,
      row.CodigoRecibe,
    );

    if (rows[0]) {
      const fallback = this.buildFallbackSyncNode(rows[0].SucursalCodigo || row.CodigoRecibe);
      return {
        ...rows[0],
        ApiUrl: rows[0].ApiUrl || fallback.ApiUrl,
      };
    }

    const fallback = this.buildFallbackSyncNode(row.CodigoRecibe);
    return {
      ...fallback,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
      LastSeenAt: null,
    };
  }

  private buildFallbackSyncNode(codeOrNodeId: string) {
    const normalized = this.normalizeRequiredCode(codeOrNodeId, "Nodo invalido.");
    if (normalized === DEFAULT_WAREHOUSE_CODE) {
      return {
        NodeId: DEFAULT_WAREHOUSE_CODE,
        SucursalCodigo: DEFAULT_WAREHOUSE_CODE,
        Nombre: DEFAULT_WAREHOUSE_CODE,
        Tipo: "BODEGA",
        ApiUrl: "http://localhost:3000",
      };
    }

    const fromNodeId = normalized.match(/^TIENDA(\d{3})$/);
    const numericCode = fromNodeId?.[1] ?? (/^\d+$/.test(normalized) ? normalized.padStart(3, "0") : null);
    if (numericCode) {
      return {
        NodeId: `TIENDA${numericCode}`,
        SucursalCodigo: numericCode,
        Nombre: `Tienda ${numericCode}`,
        Tipo: "TIENDA",
        ApiUrl: `http://localhost:${3000 + Number(numericCode)}`,
      };
    }

    const warehouseMatch = normalized.match(/^(?:BODEGA|B)(\d{3})$/);
    if (warehouseMatch) {
      const code = warehouseMatch[1];
      return {
        NodeId: `BODEGA${code}`,
        SucursalCodigo: `B${code}`,
        Nombre: `Bodega ${code}`,
        Tipo: "BODEGA",
        ApiUrl: null,
      };
    }

    return {
      NodeId: normalized,
      SucursalCodigo: normalized,
      Nombre: normalized,
      Tipo: "BODEGA",
      ApiUrl: null,
    };
  }

  private buildDraftGlobalId(sourceNodeId: string, numero: bigint) {
    return `${this.normalizeSyncNodeId(sourceNodeId)}-DEVDR-${String(numero).padStart(10, "0")}`;
  }

  private buildEventGlobalId(draftGlobalId: string, suffix: string) {
    return `${this.normalizeGlobalId(draftGlobalId)}-${suffix}`;
  }

  private buildReturnDocumentOrigin(source: string | null | undefined, numero: bigint | number) {
    const normalizedSource = this.normalizeOptionalCode(source);
    if (normalizedSource && normalizedSource.length <= 12) {
      return normalizedSource;
    }

    const normalizedNumero = this.toNonNegativeInteger(numero, "Numero de devolucion invalido.")
      .toString()
      .padStart(9, "0")
      .slice(-9);

    return `DEV${normalizedNumero}`;
  }

  private buildDraftExportPayload(
    draft: DevDraftWithRelations,
    ids: { codigoOrigen: string; sourceNodeId: string; destinationNodeId: string },
  ): DraftExportPayload {
    return {
      schemaVersion: DEV_RETURN_SYNC_SCHEMA_VERSION,
      eventType: DEV_RETURN_EVENT_DRAFT_EXPORTED,
      globalId: this.buildDraftGlobalId(ids.sourceNodeId, draft.Numero),
      sourceNodeId: ids.sourceNodeId,
      destinationNodeId: ids.destinationNodeId,
      draft: {
        numero: draft.Numero.toString(),
        fecha: this.toIsoString(draft.Fecha),
        codigoOrigen: ids.codigoOrigen,
        codigoDestino: draft.CodigoDestino || "",
        observacion: draft.Observacion || "",
        status: 1,
        usuario: draft.Usuario,
      },
      items: draft.movimientos.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        numeroCaja: line.NumeroCaja,
        costo: line.Costo.toString(),
        articulo: this.serializeInventoryForSync(line.inventarioRef),
      })),
    };
  }

  private buildDraftApprovedPayload(payload: DraftExportPayload, user: UserView): DraftApprovedPayload {
    return {
      schemaVersion: DEV_RETURN_SYNC_SCHEMA_VERSION,
      eventType: DEV_RETURN_EVENT_DRAFT_APPROVED,
      globalId: this.buildEventGlobalId(payload.globalId, "ACK"),
      sourceNodeId: payload.destinationNodeId,
      destinationNodeId: payload.sourceNodeId,
      draftGlobalId: payload.globalId,
      draft: payload.draft,
      approvedAt: this.toIsoString(new Date()),
      approver: user.codUsuario,
    };
  }

  private buildReturnRegisteredPayload(
    devolucion: DevReturnWithRelations,
    draftGlobalId: string,
    ids: { sourceNodeId: string; destinationNodeId: string },
  ): ReturnRegisteredPayload {
    return {
      schemaVersion: DEV_RETURN_SYNC_SCHEMA_VERSION,
      eventType: DEV_RETURN_EVENT_RETURN_REGISTERED,
      globalId: this.buildEventGlobalId(draftGlobalId, "RETURN"),
      sourceNodeId: ids.sourceNodeId,
      destinationNodeId: ids.destinationNodeId,
      draftGlobalId,
      devolucion: {
        numero: devolucion.Numero,
        fecha: this.toIsoString(devolucion.Fecha),
        fechaEmision: this.toIsoString(devolucion.FechaEmision ?? devolucion.Fecha),
        codigoEnvia: devolucion.CodigoEnvia,
        codigoRecibe: devolucion.CodigoRecibe,
        documentoOrigen: this.buildReturnDocumentOrigin(
          devolucion.DocumentoOrigen || draftGlobalId,
          devolucion.Numero,
        ),
        totalValor: devolucion.TotalValor.toString(),
        observacion: devolucion.Observacion || "",
        status: devolucion.Status,
        usuario: devolucion.Usuario || null,
        interContable: devolucion.InterContable ?? 0,
        idLote: devolucion.IDLote,
        lote: {
          id: devolucion.lote.ID,
          lote: devolucion.lote.Lote,
          descripcion: devolucion.lote.Descripcion,
          estado: devolucion.lote.Estado,
        },
      },
      items: devolucion.movDevTransferencias.map((line) => ({
        item: line.Item,
        codigoBarra: line.CodigoBarra,
        cantidad: line.Cantidad.toString(),
        numeroCaja: line.NumeroCaja,
        costo: line.Valor.toString(),
        articulo: this.serializeInventoryForSync(line.inventarioRef),
      })),
    };
  }

  private buildReturnAppliedPayload(payload: ReturnRegisteredPayload, user: UserView): ReturnAppliedPayload {
    return {
      schemaVersion: DEV_RETURN_SYNC_SCHEMA_VERSION,
      eventType: DEV_RETURN_EVENT_RETURN_APPLIED,
      globalId: this.buildEventGlobalId(payload.draftGlobalId, "APPLIED"),
      sourceNodeId: payload.destinationNodeId,
      destinationNodeId: payload.sourceNodeId,
      draftGlobalId: payload.draftGlobalId,
      devolucion: {
        numero: payload.devolucion.numero,
        codigoEnvia: payload.devolucion.codigoEnvia,
        codigoRecibe: payload.devolucion.codigoRecibe,
      },
      approvedAt: this.toIsoString(new Date()),
      approver: user.codUsuario,
    };
  }

  private serializeInventoryForSync(
    article: DevDraftWithRelations["movimientos"][number]["inventarioRef"]
      | DevReturnWithRelations["movDevTransferencias"][number]["inventarioRef"]
      | InboundDevReturnWithRelations["iMovDevTransferencias"][number]["inventarioRef"],
  ): SyncInventoryPayload {
    return {
      codigoBarra: article.CodigoBarra,
      referencia: article.Referencia,
      codigoMarca: article.CodigoMarca,
      nombre: article.Nombre,
      talla: article.Talla,
      codigoColor: article.CodigoColor,
      fabricante: article.Fabricante,
      categoria: article.Categoria,
      nota: article.Nota,
      tipoImpuesto: article.TipoImpuesto,
      precioDetal: article.PrecioDetal.toString(),
      precioMayor: article.PrecioMayor.toString(),
      precioAfiliado: article.PrecioAfiliado.toString(),
      precioPromocion: article.PrecioPromocion.toString(),
      promocion: article.Promocion,
      fechaInicial: this.toIsoString(article.FechaInicial),
      fechaFinal: this.toIsoString(article.FechaFinal),
      costoInicial: article.CostoInicial.toString(),
      costoPromedio: article.CostoPromedio.toString(),
      ultimoCosto: article.UltimoCosto.toString(),
      costoDolar: article.CostoDolar.toString(),
      existenciaInicial: article.ExistenciaInicial.toString(),
      puntoReorden: article.PuntoReorden.toString(),
      tipo: article.Tipo,
      status: article.Status,
      serializado: article.Serializado,
      codigoBarraAnt: article.CodigoBarraAnt,
      catalogs: {
        marca: {
          codigo: article.marcaRef.Codigo,
          nombre: article.marcaRef.Nombre,
          status: article.marcaRef.Status,
        },
        talla: {
          codigo: article.tallaRef.Codigo,
          nombre: article.tallaRef.Codigo,
          status: 1,
        },
        color: {
          codigo: article.colorRef.Codigo,
          nombre: article.colorRef.Nombre,
          status: article.colorRef.Status,
        },
        fabricante: {
          codigo: article.fabricanteRef.Codigo,
          nombre: article.fabricanteRef.Nombre,
          status: article.fabricanteRef.Status,
        },
        categoria: {
          codigo: article.categoriaRef.Codigo,
          nombre: article.categoriaRef.Nombre,
          status: article.categoriaRef.Status,
        },
        impuesto: {
          codigo: article.impuestoRef.Codigo,
          nombre: article.impuestoRef.Nombre,
          porcentajeImpuesto: article.impuestoRef.PorcentajeImpuesto?.toString() ?? "0",
        },
      },
    };
  }

  private async recordSyncOutbox(
    tx: DevReturnTransactionClient,
    input: {
      globalId: string;
      numeroOrigen: bigint;
      codigoEnvia: string;
      codigoRecibe: string;
      sourceNodeId: string;
      destinationNodeId: string;
      eventType: string;
      payload: DevReturnSyncPayload;
    },
  ) {
    await tx.$executeRawUnsafe(
      `
        insert into dbo."DEV_RETURN_SYNC_OUTBOX"
          (
            "GlobalId",
            "NumeroOrigen",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "CreatedAt",
            "SentAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 0, null)
        on conflict ("GlobalId") do update set
          "NumeroOrigen" = excluded."NumeroOrigen",
          "CodigoEnvia" = excluded."CodigoEnvia",
          "CodigoRecibe" = excluded."CodigoRecibe",
          "SourceNodeId" = excluded."SourceNodeId",
          "DestinationNodeId" = excluded."DestinationNodeId",
          "EventType" = excluded."EventType",
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "SentAt" = null,
          "LastError" = null
      `,
      input.globalId,
      input.numeroOrigen,
      input.codigoEnvia,
      input.codigoRecibe,
      input.sourceNodeId,
      input.destinationNodeId,
      input.eventType,
      JSON.stringify(input.payload),
      DEV_RETURN_SYNC_STATUS_PENDING,
    );
  }

  private async upsertSyncInbox(
    tx: DevReturnTransactionClient,
    payload: DevReturnSyncPayload,
    status: string,
  ) {
    const envelope = this.extractPayloadEnvelope(payload);
    await tx.$executeRawUnsafe(
      `
        insert into dbo."DEV_RETURN_SYNC_INBOX"
          (
            "GlobalId",
            "NumeroOrigen",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "ReceivedAt",
            "AppliedAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 0, null)
        on conflict ("GlobalId") do update set
          "Payload" = excluded."Payload",
          "Status" = excluded."Status",
          "LastError" = null
      `,
      payload.globalId,
      envelope.numeroOrigen,
      envelope.codigoEnvia,
      envelope.codigoRecibe,
      payload.sourceNodeId,
      payload.destinationNodeId,
      payload.eventType,
      JSON.stringify(payload),
      status,
    );
  }

  private async updateSyncInboxStatus(
    tx: DevReturnTransactionClient,
    globalId: string,
    status: string,
    lastError: string | null,
  ) {
    await tx.$executeRawUnsafe(
      `
        update dbo."DEV_RETURN_SYNC_INBOX"
        set
          "Status" = $2,
          "AppliedAt" = case when $2 in ($3, $4) then now() else "AppliedAt" end,
          "Attempts" = "Attempts" + 1,
          "LastError" = $5
        where "GlobalId" = $1
      `,
      globalId,
      status,
      DEV_RETURN_SYNC_STATUS_APPROVED,
      DEV_RETURN_SYNC_STATUS_APPLIED,
      lastError,
    );
  }

  private async markSyncInboxError(payload: DevReturnSyncPayload, message: string) {
    const envelope = this.extractPayloadEnvelope(payload);
    await this.prisma.$executeRawUnsafe(
      `
        insert into dbo."DEV_RETURN_SYNC_INBOX"
          (
            "GlobalId",
            "NumeroOrigen",
            "CodigoEnvia",
            "CodigoRecibe",
            "SourceNodeId",
            "DestinationNodeId",
            "EventType",
            "Payload",
            "Status",
            "ReceivedAt",
            "AppliedAt",
            "Attempts",
            "LastError"
          )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), null, 1, $10)
        on conflict ("GlobalId") do update set
          "Status" = excluded."Status",
          "Attempts" = dbo."DEV_RETURN_SYNC_INBOX"."Attempts" + 1,
          "LastError" = excluded."LastError"
      `,
      payload.globalId,
      envelope.numeroOrigen,
      envelope.codigoEnvia,
      envelope.codigoRecibe,
      payload.sourceNodeId,
      payload.destinationNodeId,
      payload.eventType,
      JSON.stringify(payload),
      DEV_RETURN_SYNC_STATUS_ERROR,
      message,
    );
  }

  private async pushPendingSyncForGlobalId(globalId: string) {
    const rows = await this.prisma.$queryRawUnsafe<DevReturnSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_OUTBOX"
        where "GlobalId" = $1 and "Status" = $2
        order by "CreatedAt" desc
      `,
      this.normalizeGlobalId(globalId),
      DEV_RETURN_SYNC_STATUS_PENDING,
    );

    const results = await this.pushSyncRows(rows);

    return {
      processed: results.length,
      results,
    };
  }

  private async pushSyncRows(rows: DevReturnSyncOutboxRow[]) {
    const results = [];

    for (const row of rows) {
      try {
        const destination = await this.resolveDestinationSyncNode(row);
        if (!destination.ApiUrl) {
          throw new ConflictException(
            `El nodo destino ${row.DestinationNodeId || row.CodigoRecibe} no tiene apiUrl configurada.`,
          );
        }

        const payload = this.parseRawJson(row.Payload);
        const response = await this.postSyncPackage(destination.ApiUrl, payload);
        const sent = await this.updateSyncOutboxStatus(
          row.GlobalId,
          DEV_RETURN_SYNC_STATUS_SENT,
          null,
        );

        results.push({
          globalId: row.GlobalId,
          numero: row.NumeroOrigen.toString(),
          codigoRecibe: row.CodigoRecibe,
          status: sent.Status,
          destino: this.toSyncNodeView(destination),
          respuestaDestino: response,
        });
      } catch (error) {
        const message = this.extractSyncErrorMessage(error);
        this.logger.warn(`No se pudo sincronizar ${row.GlobalId}: ${message}`);
        await this.updateSyncOutboxStatus(
          row.GlobalId,
          DEV_RETURN_SYNC_STATUS_PENDING,
          message,
        );
        results.push({
          globalId: row.GlobalId,
          numero: row.NumeroOrigen.toString(),
          codigoRecibe: row.CodigoRecibe,
          status: DEV_RETURN_SYNC_STATUS_PENDING,
          error: message,
        });
      }
    }

    return results;
  }

  private async updateSyncOutboxStatus(
    globalId: string,
    status: string,
    lastError: string | null,
  ) {
    const rows = await this.prisma.$queryRawUnsafe<DevReturnSyncOutboxRow[]>(
      `
        update dbo."DEV_RETURN_SYNC_OUTBOX"
        set
          "Status" = $2,
          "SentAt" = case when $2 = $3 then now() else "SentAt" end,
          "Attempts" = "Attempts" + 1,
          "LastError" = $4
        where "GlobalId" = $1
        returning
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
      `,
      globalId,
      status,
      DEV_RETURN_SYNC_STATUS_SENT,
      lastError,
    );

    if (!rows[0]) {
      throw new NotFoundException("El paquete de sincronizacion no existe.");
    }

    return rows[0];
  }

  private async postSyncPackage(apiUrl: string, payload: unknown) {
    const baseUrl = this.normalizeRequiredApiUrl(apiUrl);
    const token = await this.loginRemoteNode(baseUrl);
    const response = await fetch(`${baseUrl}/api/dev-returns/sync/import`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await this.readRemoteJson(response);
    if (!response.ok) {
      throw new ConflictException(
        `Destino rechazo la devolucion: ${this.formatRemoteError(responseBody, response.status)}`,
      );
    }

    return responseBody;
  }

  private async loginRemoteNode(baseUrl: string) {
    const usuario = this.configService.get<string>("TRANSFER_SYNC_USERNAME", "admin");
    const password = this.configService.get<string>("TRANSFER_SYNC_PASSWORD", "123456");
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ usuario, password }),
    });
    const body = await this.readRemoteJson(response);

    if (!response.ok || !this.isRecord(body) || typeof body.accessToken !== "string") {
      throw new ConflictException(
        `No se pudo autenticar contra el nodo destino: ${this.formatRemoteError(body, response.status)}`,
      );
    }

    return body.accessToken;
  }

  private async readRemoteJson(response: Response) {
    const text = await response.text();
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private formatRemoteError(body: unknown, status: number) {
    if (this.isRecord(body)) {
      const message = body.message;
      if (Array.isArray(message)) {
        return message.join("; ");
      }

      if (typeof message === "string") {
        return message;
      }

      if (typeof body.error === "string") {
        return body.error;
      }
    }

    if (typeof body === "string") {
      return body;
    }

    return `HTTP ${status}`;
  }

  private async getDevReturnSyncInboxRow(
    tx: PrismaService | DevReturnTransactionClient,
    globalId: string,
  ) {
    const rows = await tx.$queryRawUnsafe<DevReturnSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_INBOX"
        where "GlobalId" = $1
        limit 1
      `,
      globalId,
    );

    return rows[0] ?? null;
  }

  private async getDevReturnSyncInboxRowOrThrow(
    tx: PrismaService | DevReturnTransactionClient,
    globalId: string,
  ) {
    const row = await this.getDevReturnSyncInboxRow(tx, globalId);
    if (!row) {
      throw new NotFoundException("El paquete sincronizado no existe.");
    }

    return row;
  }

  private async getSyncOutboxRow(
    tx: PrismaService | DevReturnTransactionClient,
    globalId: string,
  ) {
    const rows = await tx.$queryRawUnsafe<DevReturnSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_OUTBOX"
        where "GlobalId" = $1
        limit 1
      `,
      this.normalizeGlobalId(globalId),
    );

    return rows[0] ?? null;
  }

  private async findReturnExportRow(
    tx: PrismaService | DevReturnTransactionClient,
    numero: number,
  ) {
    const current = this.getCurrentInstanceContext();
    const draftGlobalId = this.buildDraftGlobalId(current.nodeId, BigInt(numero));
    const returnGlobalId = this.buildEventGlobalId(draftGlobalId, "RETURN");
    return this.getSyncOutboxRow(tx, returnGlobalId);
  }

  private async loadReturnExportRows(
    tx: PrismaService | DevReturnTransactionClient,
    numeros: number[],
  ) {
    const unique = [...new Set(numeros.filter((value) => Number.isFinite(value)))];
    const map = new Map<number, DevReturnSyncOutboxRow>();
    if (!unique.length) {
      return map;
    }

    const current = this.getCurrentInstanceContext();
    const globalIds = unique.map((numero) =>
      this.buildEventGlobalId(this.buildDraftGlobalId(current.nodeId, BigInt(numero)), "RETURN"),
    );
    const rows = await tx.$queryRawUnsafe<DevReturnSyncOutboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "CreatedAt",
          "SentAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_OUTBOX"
        where "GlobalId" = any($1::text[])
      `,
      globalIds,
    );

    for (const row of rows) {
      map.set(Number(row.NumeroOrigen), row);
    }

    return map;
  }

  private async getInboundDraftByNumero(
    tx: PrismaService | DevReturnTransactionClient,
    numero: bigint,
  ) {
    const rows = await tx.$queryRawUnsafe<DevReturnSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_INBOX"
        where "EventType" = $1
          and "NumeroOrigen" = $2
        order by "ReceivedAt" desc
        limit 1
      `,
      DEV_RETURN_EVENT_DRAFT_EXPORTED,
      numero,
    );

    return rows[0] ?? null;
  }

  private async getInboundReturnSyncRow(
    tx: PrismaService | DevReturnTransactionClient,
    numero: number,
    codigoEnvia: string,
    codigoRecibe: string,
  ) {
    const rows = await tx.$queryRawUnsafe<DevReturnSyncInboxRow[]>(
      `
        select
          "GlobalId",
          "NumeroOrigen",
          "CodigoEnvia",
          "CodigoRecibe",
          "SourceNodeId",
          "DestinationNodeId",
          "EventType",
          "Payload",
          "Status",
          "ReceivedAt",
          "AppliedAt",
          "Attempts",
          "LastError"
        from dbo."DEV_RETURN_SYNC_INBOX"
        where "EventType" = $1
          and "NumeroOrigen" = $2
          and upper("CodigoEnvia") = upper($3)
          and upper("CodigoRecibe") = upper($4)
        order by "ReceivedAt" desc
        limit 1
      `,
      DEV_RETURN_EVENT_RETURN_REGISTERED,
      BigInt(numero),
      codigoEnvia,
      codigoRecibe,
    );

    return rows[0] ?? null;
  }

  private extractPayloadEnvelope(payload: DevReturnSyncPayload) {
    if (payload.eventType === DEV_RETURN_EVENT_DRAFT_EXPORTED) {
      return {
        numeroOrigen: BigInt(payload.draft.numero),
        codigoEnvia: payload.draft.codigoOrigen,
        codigoRecibe: payload.draft.codigoDestino,
      };
    }

    if (payload.eventType === DEV_RETURN_EVENT_DRAFT_APPROVED) {
      return {
        numeroOrigen: BigInt(payload.draft.numero),
        codigoEnvia: payload.draft.codigoDestino,
        codigoRecibe: payload.draft.codigoOrigen,
      };
    }

    return {
      numeroOrigen: BigInt(payload.devolucion.numero),
      codigoEnvia: payload.devolucion.codigoEnvia,
      codigoRecibe: payload.devolucion.codigoRecibe,
    };
  }

  private normalizeDraftExportPayload(body: unknown): DraftExportPayload {
    if (!this.isRecord(body)) {
      throw new BadRequestException("Paquete de borrador invalido.");
    }

    const payload: DraftExportPayload = {
      schemaVersion: this.toPositiveInteger(body.schemaVersion, "Version de sincronizacion invalida."),
      eventType: String(body.eventType || "").trim().toUpperCase() as typeof DEV_RETURN_EVENT_DRAFT_EXPORTED,
      globalId: this.normalizeGlobalId(body.globalId),
      sourceNodeId: this.normalizeSyncNodeId(body.sourceNodeId),
      destinationNodeId: this.normalizeSyncNodeId(body.destinationNodeId),
      draft: this.normalizeDraftEnvelope(body.draft),
      items: this.normalizeDraftItems(body.items),
    };

    if (payload.schemaVersion !== DEV_RETURN_SYNC_SCHEMA_VERSION || payload.eventType !== DEV_RETURN_EVENT_DRAFT_EXPORTED) {
      throw new BadRequestException("Solo se pueden importar borradores exportados.");
    }

    return payload;
  }

  private normalizeDraftApprovedPayload(body: unknown): DraftApprovedPayload {
    if (!this.isRecord(body)) {
      throw new BadRequestException("Acuse de borrador invalido.");
    }

    const payload: DraftApprovedPayload = {
      schemaVersion: this.toPositiveInteger(body.schemaVersion, "Version de sincronizacion invalida."),
      eventType: String(body.eventType || "").trim().toUpperCase() as typeof DEV_RETURN_EVENT_DRAFT_APPROVED,
      globalId: this.normalizeGlobalId(body.globalId),
      sourceNodeId: this.normalizeSyncNodeId(body.sourceNodeId),
      destinationNodeId: this.normalizeSyncNodeId(body.destinationNodeId),
      draftGlobalId: this.normalizeGlobalId(body.draftGlobalId),
      draft: this.normalizeDraftEnvelope(body.draft),
      approvedAt: this.toRequiredIsoString(body.approvedAt, "Fecha de aprobacion invalida."),
      approver: this.normalizeOptionalCode(body.approver),
    };

    if (payload.schemaVersion !== DEV_RETURN_SYNC_SCHEMA_VERSION || payload.eventType !== DEV_RETURN_EVENT_DRAFT_APPROVED) {
      throw new BadRequestException("Solo se pueden importar aprobaciones de borradores.");
    }

    return payload;
  }

  private normalizeReturnRegisteredPayload(body: unknown): ReturnRegisteredPayload {
    if (!this.isRecord(body)) {
      throw new BadRequestException("Paquete de devolucion invalido.");
    }

    const record = this.normalizeReturnEnvelope(body.devolucion);
    const payload: ReturnRegisteredPayload = {
      schemaVersion: this.toPositiveInteger(body.schemaVersion, "Version de sincronizacion invalida."),
      eventType: String(body.eventType || "").trim().toUpperCase() as typeof DEV_RETURN_EVENT_RETURN_REGISTERED,
      globalId: this.normalizeGlobalId(body.globalId),
      sourceNodeId: this.normalizeSyncNodeId(body.sourceNodeId),
      destinationNodeId: this.normalizeSyncNodeId(body.destinationNodeId),
      draftGlobalId: this.normalizeGlobalId(body.draftGlobalId),
      devolucion: record,
      items: this.normalizeDraftItems(body.items),
    };

    if (payload.schemaVersion !== DEV_RETURN_SYNC_SCHEMA_VERSION || payload.eventType !== DEV_RETURN_EVENT_RETURN_REGISTERED) {
      throw new BadRequestException("Solo se pueden importar devoluciones registradas.");
    }

    return payload;
  }

  private normalizeReturnAppliedPayload(body: unknown): ReturnAppliedPayload {
    if (!this.isRecord(body)) {
      throw new BadRequestException("Acuse de devolucion invalido.");
    }

    if (!this.isRecord(body.devolucion)) {
      throw new BadRequestException("El encabezado de la devolucion es invalido.");
    }

    const payload: ReturnAppliedPayload = {
      schemaVersion: this.toPositiveInteger(body.schemaVersion, "Version de sincronizacion invalida."),
      eventType: String(body.eventType || "").trim().toUpperCase() as typeof DEV_RETURN_EVENT_RETURN_APPLIED,
      globalId: this.normalizeGlobalId(body.globalId),
      sourceNodeId: this.normalizeSyncNodeId(body.sourceNodeId),
      destinationNodeId: this.normalizeSyncNodeId(body.destinationNodeId),
      draftGlobalId: this.normalizeGlobalId(body.draftGlobalId),
      devolucion: {
        numero: this.toPositiveInteger(body.devolucion.numero, "Numero de devolucion invalido."),
        codigoEnvia: this.normalizeRequiredCode(body.devolucion.codigoEnvia, "Codigo envia invalido."),
        codigoRecibe: this.normalizeRequiredCode(body.devolucion.codigoRecibe, "Codigo recibe invalido."),
      },
      approvedAt: this.toRequiredIsoString(body.approvedAt, "Fecha de aprobacion invalida."),
      approver: this.normalizeOptionalCode(body.approver),
    };

    if (payload.schemaVersion !== DEV_RETURN_SYNC_SCHEMA_VERSION || payload.eventType !== DEV_RETURN_EVENT_RETURN_APPLIED) {
      throw new BadRequestException("Solo se pueden importar aprobaciones de devolucion.");
    }

    return payload;
  }

  private normalizeDraftEnvelope(value: unknown) {
    if (!this.isRecord(value)) {
      throw new BadRequestException("El encabezado del borrador es invalido.");
    }

    return {
      numero: String(this.toPositiveInteger(value.numero, "Numero de borrador invalido.")),
      fecha: this.toRequiredIsoString(value.fecha, "Fecha del borrador invalida."),
      codigoOrigen: this.normalizeRequiredCode(value.codigoOrigen, "Codigo origen invalido."),
      codigoDestino: this.normalizeRequiredCode(value.codigoDestino, "Codigo destino invalido."),
      observacion: String(value.observacion || "").trim(),
      status: this.toNonNegativeInteger(value.status, "Status del borrador invalido."),
      usuario: this.normalizeOptionalCode(value.usuario),
    };
  }

  private normalizeReturnEnvelope(value: unknown) {
    if (!this.isRecord(value) || !this.isRecord(value.lote)) {
      throw new BadRequestException("El encabezado de la devolucion es invalido.");
    }

    return {
      numero: this.toPositiveInteger(value.numero, "Numero de devolucion invalido."),
      fecha: this.toRequiredIsoString(value.fecha, "Fecha de devolucion invalida."),
      fechaEmision: this.toRequiredIsoString(value.fechaEmision, "Fecha emision invalida."),
      codigoEnvia: this.normalizeRequiredCode(value.codigoEnvia, "Codigo envia invalido."),
      codigoRecibe: this.normalizeRequiredCode(value.codigoRecibe, "Codigo recibe invalido."),
      documentoOrigen: String(value.documentoOrigen || "").trim(),
      totalValor: String(value.totalValor || "0").trim(),
      observacion: String(value.observacion || "").trim(),
      status: this.toNonNegativeInteger(value.status, "Status invalido."),
      usuario: this.normalizeOptionalCode(value.usuario),
      interContable: value.interContable === null || value.interContable === undefined
        ? null
        : this.toNonNegativeInteger(value.interContable, "Intercontable invalido."),
      idLote: this.toNonNegativeInteger(value.idLote, "Lote invalido."),
      lote: {
        id: this.toNonNegativeInteger(value.lote.id, "ID de lote invalido."),
        lote: String(value.lote.lote || "").trim(),
        descripcion: value.lote.descripcion == null ? null : String(value.lote.descripcion),
        estado: value.lote.estado == null ? null : this.toNonNegativeInteger(value.lote.estado, "Estado de lote invalido."),
      },
    };
  }

  private normalizeDraftItems(value: unknown) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException("El borrador debe contener al menos un renglon.");
    }

    return value.map((item, index) => {
      if (!this.isRecord(item) || !this.isRecord(item.articulo) || !this.isRecord(item.articulo.catalogs)) {
        throw new BadRequestException(`El renglon ${index + 1} del borrador es invalido.`);
      }

      const catalogs = item.articulo.catalogs;
      return {
        item: this.toPositiveInteger(item.item, "Item invalido."),
        codigoBarra: this.normalizeRequiredCode(item.codigoBarra, "Codigo de barra invalido."),
        cantidad: String(item.cantidad || "").trim(),
        numeroCaja: this.toNonNegativeInteger(item.numeroCaja, "Numero de caja invalido."),
        costo: String(item.costo || "").trim(),
        articulo: {
          codigoBarra: this.normalizeRequiredCode(item.articulo.codigoBarra, "Codigo de barra de articulo invalido."),
          referencia: String(item.articulo.referencia || "").trim().toUpperCase(),
          codigoMarca: this.normalizeRequiredCode(item.articulo.codigoMarca, "Marca invalida."),
          nombre: String(item.articulo.nombre || "").trim(),
          talla: this.normalizeRequiredCode(item.articulo.talla, "Talla invalida."),
          codigoColor: this.normalizeRequiredCode(item.articulo.codigoColor, "Color invalido."),
          fabricante: this.normalizeRequiredCode(item.articulo.fabricante, "Fabricante invalido."),
          categoria: this.normalizeRequiredCode(item.articulo.categoria, "Categoria invalida."),
          nota: item.articulo.nota == null ? null : String(item.articulo.nota),
          tipoImpuesto: this.toNonNegativeInteger(item.articulo.tipoImpuesto, "Impuesto invalido."),
          precioDetal: String(item.articulo.precioDetal || "0").trim(),
          precioMayor: String(item.articulo.precioMayor || "0").trim(),
          precioAfiliado: String(item.articulo.precioAfiliado || "0").trim(),
          precioPromocion: String(item.articulo.precioPromocion || "0").trim(),
          promocion: Boolean(item.articulo.promocion),
          fechaInicial: this.toRequiredIsoString(item.articulo.fechaInicial, "Fecha inicial invalida."),
          fechaFinal: this.toRequiredIsoString(item.articulo.fechaFinal, "Fecha final invalida."),
          costoInicial: String(item.articulo.costoInicial || "0").trim(),
          costoPromedio: String(item.articulo.costoPromedio || "0").trim(),
          ultimoCosto: String(item.articulo.ultimoCosto || "0").trim(),
          costoDolar: String(item.articulo.costoDolar || "0").trim(),
          existenciaInicial: String(item.articulo.existenciaInicial || "0").trim(),
          puntoReorden: String(item.articulo.puntoReorden || "0").trim(),
          tipo: this.toNonNegativeInteger(item.articulo.tipo, "Tipo de articulo invalido."),
          status: this.toNonNegativeInteger(item.articulo.status, "Status de articulo invalido."),
          serializado: this.toNonNegativeInteger(item.articulo.serializado, "Serializado invalido."),
          codigoBarraAnt: String(item.articulo.codigoBarraAnt || "").trim(),
          catalogs: {
            marca: this.normalizeCatalogPayload(catalogs.marca),
            talla: this.normalizeCatalogPayload(catalogs.talla),
            color: this.normalizeCatalogPayload(catalogs.color),
            fabricante: this.normalizeCatalogPayload(catalogs.fabricante),
            categoria: this.normalizeCatalogPayload(catalogs.categoria),
            impuesto: this.normalizeCatalogPayload(catalogs.impuesto),
          },
        },
      };
    });
  }

  private normalizeCatalogPayload(value: unknown): SyncCatalogPayload {
    if (!this.isRecord(value)) {
      throw new BadRequestException("Catalogo sincronizado invalido.");
    }

    return {
      codigo: String(value.codigo || "").trim(),
      nombre: value.nombre == null ? null : String(value.nombre),
      status: value.status == null ? null : this.toNonNegativeInteger(value.status, "Status de catalogo invalido."),
      porcentajeImpuesto: value.porcentajeImpuesto == null ? null : String(value.porcentajeImpuesto),
    };
  }

  private async registerReturnFromDraft(
    tx: DevReturnTransactionClient,
    draft: DevDraftWithRelations,
    options: {
      codigoEnvia: string;
      codigoRecibe: string;
      documentoOrigen: string;
      fechaEmision: Date;
      interContable: number;
      idLote: number;
      userCode: string;
      nextDraftStatus: number;
    },
  ) {
    const existingReturn = await tx.devTransferencias.findUnique({
      where: { Numero: Number(draft.Numero) },
      include: devReturnInclude,
    });

    if (existingReturn) {
      await tx.devBorrador.update({
        where: { Numero: draft.Numero },
        data: { Status: options.nextDraftStatus },
      });
      return existingReturn;
    }

    const totalValor = this.calculateDraftTotal(draft.movimientos);
    await this.ensureLocations(tx, [options.codigoEnvia, options.codigoRecibe]);
    await this.applyInventoryDelta(tx, this.aggregateDraftQuantities(draft.movimientos).negated);
    await this.mirrorSyncService.enqueueInventorySnapshotsTx(
      tx,
      draft.movimientos.map((line) => line.CodigoBarra),
    );

    await tx.devTransferencias.create({
      data: {
        Numero: Number(draft.Numero),
        Fecha: draft.Fecha,
        CodigoEnvia: options.codigoEnvia,
        CodigoRecibe: options.codigoRecibe,
        DocumentoOrigen: options.documentoOrigen,
        TotalValor: totalValor,
        Observacion: draft.Observacion,
        Status: 0,
        Usuario: options.userCode,
        FechaEmision: options.fechaEmision,
        InterContable: options.interContable,
        IDLote: options.idLote,
      },
    });

    await tx.movDevTransferencias.createMany({
      data: draft.movimientos.map((line) => ({
        Numero: Number(draft.Numero),
        Fecha: draft.Fecha,
        CodigoBarra: line.CodigoBarra,
        Cantidad: line.Cantidad,
        Valor: line.Costo,
        NumeroCaja: line.NumeroCaja,
        Item: line.Item,
        UltimoCosto: line.inventarioRef.UltimoCosto,
        CostoInicial: line.inventarioRef.CostoInicial,
        CostoDolar: line.inventarioRef.CostoDolar,
      })),
    });

    await tx.devBorrador.update({
      where: { Numero: draft.Numero },
      data: { Status: options.nextDraftStatus },
    });

    return this.findReturnOrThrow(tx, Number(draft.Numero));
  }

  private async ensureDefaultReturnLot(tx: DevReturnTransactionClient, userCode: string | null) {
    const existing = await tx.lotes.findUnique({
      where: { Lote: DEFAULT_RETURN_LOT },
    });

    if (existing) {
      return existing.ID;
    }

    const result = await tx.lotes.aggregate({
      _max: {
        ID: true,
      },
    });
    const nextLotId = (result._max.ID ?? 0) + 1;

    try {
      const created = await tx.lotes.create({
        data: {
          ID: nextLotId,
          Lote: DEFAULT_RETURN_LOT,
          Descripcion: DEFAULT_RETURN_LOT_DESCRIPTION,
          Estado: 1,
          FechaRegistro: new Date(),
          UsuarioCreacion: userCode || null,
        },
      });

      return created.ID;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        const lot = await tx.lotes.findUnique({
          where: { Lote: DEFAULT_RETURN_LOT },
        });

        if (lot) {
          return lot.ID;
        }
      }

      throw error;
    }
  }

  private async ensureLocations(client: PrismaService | DevReturnTransactionClient, codes: string[]) {
    const normalizedCodes = Array.from(
      new Set(
        codes
          .map((code) => String(code || "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );

    if (normalizedCodes.length === 0) {
      return;
    }

    const existing = await client.sucursales.findMany({
      where: {
        Codigo: { in: normalizedCodes },
      },
    });
    const existingCodes = new Set(existing.map((item) => item.Codigo));

    for (const code of normalizedCodes) {
      if (existingCodes.has(code)) {
        continue;
      }

      await client.sucursales.create({
        data: {
          Codigo: code,
          Nombre: code,
          Direccion: "",
          Telefono: "",
          Status: 1,
          PorcentajeDeRedondeo: ZERO,
        },
      });
    }
  }

  private async ensureSyncedLot(tx: DevReturnTransactionClient, payload: ReturnRegisteredPayload) {
    const existing = await tx.lotes.findUnique({
      where: { ID: payload.devolucion.idLote },
    });

    if (existing) {
      return;
    }

    const localLotUserCode = await this.resolveExistingLocalUserCode(
      tx,
      payload.devolucion.usuario,
      "admin",
    );

    await tx.lotes.create({
      data: {
        ID: payload.devolucion.idLote,
        Lote: payload.devolucion.lote.lote || `SYNC_DEV_LOTE_${payload.devolucion.idLote}`,
        Descripcion: payload.devolucion.lote.descripcion,
        Estado: payload.devolucion.lote.estado,
        FechaRegistro: new Date(),
        UsuarioCreacion: localLotUserCode,
      },
    });
  }

  private async resolveExistingLocalUserCode(
    tx: PrismaService | DevReturnTransactionClient,
    ...candidates: Array<string | null | undefined>
  ) {
    const normalizedCandidates = Array.from(
      new Set(
        candidates
          .map((value) => this.normalizeOptionalCode(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    for (const candidate of normalizedCandidates) {
      const exact = await tx.usuarios.findUnique({
        where: { CodUsuario: candidate },
      });
      if (exact?.CodUsuario) {
        return exact.CodUsuario;
      }

      const insensitive = await tx.usuarios.findFirst({
        where: {
          CodUsuario: {
            equals: candidate,
            mode: Prisma.QueryMode.insensitive,
          },
        },
        orderBy: {
          CodUsuario: "asc",
        },
      });
      if (insensitive?.CodUsuario) {
        return insensitive.CodUsuario;
      }
    }

    const fallback = await tx.usuarios.findFirst({
      where: {
        OR: [
          { Status: 1 },
          { Status: null },
        ],
      },
      orderBy: {
        CodUsuario: "asc",
      },
    });

    return fallback?.CodUsuario ?? null;
  }

  private async ensureSyncedInventoryDetails(
    tx: DevReturnTransactionClient,
    article: SyncInventoryPayload,
  ) {
    await tx.marcas.upsert({
      where: { Codigo: article.codigoMarca },
      update: {
        Nombre: this.catalogName(article.catalogs.marca, article.codigoMarca),
        Status: this.catalogStatus(article.catalogs.marca),
      },
      create: {
        Codigo: article.codigoMarca,
        Nombre: this.catalogName(article.catalogs.marca, article.codigoMarca),
        Status: this.catalogStatus(article.catalogs.marca),
      },
    });

    await tx.tallas.upsert({
      where: { Codigo: article.talla },
      update: {},
      create: { Codigo: article.talla },
    });

    await tx.colores.upsert({
      where: { Codigo: article.codigoColor },
      update: {
        Nombre: this.catalogName(article.catalogs.color, article.codigoColor),
        Status: this.catalogStatus(article.catalogs.color),
      },
      create: {
        Codigo: article.codigoColor,
        Nombre: this.catalogName(article.catalogs.color, article.codigoColor),
        Status: this.catalogStatus(article.catalogs.color),
      },
    });

    await tx.fabricantes.upsert({
      where: { Codigo: article.fabricante },
      update: {
        Nombre: this.catalogName(article.catalogs.fabricante, article.fabricante),
        Status: this.catalogStatus(article.catalogs.fabricante),
      },
      create: {
        Codigo: article.fabricante,
        Nombre: this.catalogName(article.catalogs.fabricante, article.fabricante),
        Status: this.catalogStatus(article.catalogs.fabricante),
      },
    });

    await tx.categorias.upsert({
      where: { Codigo: article.categoria },
      update: {
        Nombre: this.catalogName(article.catalogs.categoria, article.categoria),
        Status: this.catalogStatus(article.catalogs.categoria),
      },
      create: {
        Codigo: article.categoria,
        Nombre: this.catalogName(article.catalogs.categoria, article.categoria),
        Status: this.catalogStatus(article.catalogs.categoria),
      },
    });

    await tx.impuestos.upsert({
      where: { Codigo: article.tipoImpuesto },
      update: {
        Nombre: this.catalogName(article.catalogs.impuesto, `IVA ${article.tipoImpuesto}`),
        PorcentajeImpuesto: article.catalogs.impuesto.porcentajeImpuesto
          ? this.parseNonNegativeDecimal(article.catalogs.impuesto.porcentajeImpuesto, "Porcentaje de impuesto invalido.")
          : undefined,
      },
      create: {
        Codigo: article.tipoImpuesto,
        Nombre: this.catalogName(article.catalogs.impuesto, `IVA ${article.tipoImpuesto}`),
        PorcentajeImpuesto: article.catalogs.impuesto.porcentajeImpuesto
          ? this.parseNonNegativeDecimal(article.catalogs.impuesto.porcentajeImpuesto, "Porcentaje de impuesto invalido.")
          : ZERO,
      },
    });

    const existingInventory = await tx.inventario.findUnique({
      where: { CodigoBarra: article.codigoBarra },
    });

    if (existingInventory) {
      await tx.inventario.update({
        where: { CodigoBarra: article.codigoBarra },
        data: this.buildSyncedInventoryAttributeUpdate(article),
      });
      return;
    }

    const now = new Date();
    await tx.inventario.create({
      data: this.buildSyncedInventoryCreateInput(article, now),
    });
  }

  private buildSyncedInventoryCreateInput(
    article: SyncInventoryPayload,
    now: Date,
  ): Prisma.InventarioUncheckedCreateInput {
    return {
      ...this.buildSyncedInventoryAttributes(article),
      CodigoBarra: article.codigoBarra,
      ExistenciaInicial: ZERO,
      Existencia: ZERO,
      FechaPrimerMovimiento: now,
      UltimaActualizacion: now,
    };
  }

  private buildSyncedInventoryAttributeUpdate(
    article: SyncInventoryPayload,
  ): Prisma.InventarioUncheckedUpdateInput {
    return this.buildSyncedInventoryAttributes(article);
  }

  private buildSyncedInventoryAttributes(article: SyncInventoryPayload) {
    return {
      Referencia: article.referencia,
      CodigoMarca: article.codigoMarca,
      Nombre: article.nombre,
      Talla: article.talla,
      CodigoColor: article.codigoColor,
      Fabricante: article.fabricante,
      Categoria: article.categoria,
      Nota: article.nota,
      TipoImpuesto: article.tipoImpuesto,
      PrecioDetal: this.parseNonNegativeDecimal(article.precioDetal, "Precio detal invalido."),
      PrecioMayor: this.parseNonNegativeDecimal(article.precioMayor, "Precio mayor invalido."),
      PrecioAfiliado: this.parseNonNegativeDecimal(article.precioAfiliado, "Precio afiliado invalido."),
      PrecioPromocion: this.parseNonNegativeDecimal(article.precioPromocion, "Precio promocion invalido."),
      Promocion: article.promocion,
      FechaInicial: new Date(article.fechaInicial),
      FechaFinal: new Date(article.fechaFinal),
      CostoInicial: this.parseNonNegativeDecimal(article.costoInicial, "Costo inicial invalido."),
      CostoPromedio: this.parseNonNegativeDecimal(article.costoPromedio, "Costo promedio invalido."),
      UltimoCosto: this.parseNonNegativeDecimal(article.ultimoCosto, "Ultimo costo invalido."),
      CostoDolar: this.parseNonNegativeDecimal(article.costoDolar, "Costo dolar invalido."),
      PuntoReorden: this.parseNonNegativeDecimal(article.puntoReorden, "Punto de reorden invalido."),
      Tipo: article.tipo,
      Status: article.status,
      Serializado: article.serializado,
      CodigoBarraAnt: article.codigoBarraAnt,
    };
  }

  private catalogName(catalog: SyncCatalogPayload, fallback: string | number) {
    return String(catalog.nombre || fallback || "").trim();
  }

  private catalogStatus(catalog: SyncCatalogPayload) {
    return typeof catalog.status === "number" && Number.isFinite(catalog.status) ? catalog.status : 1;
  }

  private toSyncNodeView(row: SyncNodeRow) {
    return {
      nodeId: row.NodeId,
      sucursalCodigo: row.SucursalCodigo,
      nombre: row.Nombre,
      tipo: row.Tipo,
      apiUrl: row.ApiUrl,
      creado: row.CreatedAt,
      actualizado: row.UpdatedAt,
      ultimaConexion: row.LastSeenAt,
    };
  }

  private normalizeRequiredCode(value: unknown, message: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private normalizeOptionalCode(value: unknown) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized || null;
  }

  private normalizeSyncNodeId(value: unknown) {
    const normalized = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!normalized) {
      throw new BadRequestException("Identificador de nodo invalido.");
    }

    return normalized;
  }

  private normalizeGlobalId(value: unknown) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Identificador global invalido.");
    }

    return normalized;
  }

  private normalizeRequiredApiUrl(value: unknown) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException("La URL del nodo debe comenzar con http:// o https://.");
    }

    return normalized;
  }

  private toIsoString(value: Date) {
    return value.toISOString();
  }

  private toRequiredIsoString(value: unknown, message: string) {
    const date = new Date(String(value || ""));
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(message);
    }

    return date.toISOString();
  }

  private toPositiveInteger(value: unknown, message: string) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private toNonNegativeInteger(value: unknown, message: string) {
    const parsed = Number(value ?? 0);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parsePositiveDecimal(value: unknown, message: string) {
    try {
      const parsed = new Prisma.Decimal(String(value ?? "0"));
      if (parsed.lessThanOrEqualTo(0)) {
        throw new BadRequestException(message);
      }

      return parsed;
    } catch {
      throw new BadRequestException(message);
    }
  }

  private parseNonNegativeDecimal(value: unknown, message: string) {
    try {
      const parsed = new Prisma.Decimal(String(value ?? "0"));
      if (parsed.lessThan(0)) {
        throw new BadRequestException(message);
      }

      return parsed;
    } catch {
      throw new BadRequestException(message);
    }
  }

  private parseRawJson(value: unknown) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return value;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private extractSyncErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return "Error desconocido al sincronizar la devolucion.";
  }
}
