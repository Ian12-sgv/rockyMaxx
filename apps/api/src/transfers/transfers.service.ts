import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type Inventario, type Sucursales } from "@prisma/client";

import { UserView } from "../users/user-view.util";
import { ApproveTransferDto, TransferDuplicateResolutionDto } from "./dto/approve-transfer.dto";
import { CreateTransferDto, CreateTransferLineDto } from "./dto/create-transfer.dto";
import { FindTransfersDto } from "./dto/find-transfers.dto";
import { UpdateTransferDto } from "./dto/update-transfer.dto";
import { toTransferDetailView, toTransferListItemView, transferInclude } from "./transfer-view.util";
import { PrismaService } from "../prisma/prisma.service";

const DEFAULT_TRANSFER_LOT = "TR_AUTO";
const DEFAULT_TRANSFER_LOT_DESCRIPTION = "Lote automatico para transferencias";
const DEFAULT_DISPATCH_ID = 0;
const DUPLICATE_BARCODE_MESSAGE = "Codigo de barra duplicado.";
const DEFAULT_ORIGIN_CODE = "ORIGEN";
const DEFAULT_DESTINATION_CODE = "DESTINO";
const ZERO = new Prisma.Decimal(0);

type TransferTransactionClient = Prisma.TransactionClient;
type TransferDuplicateResolutionAction = "modify-existing" | "create-new";
type TransferDuplicateResolution = {
  action: TransferDuplicateResolutionAction;
  nuevoCodigoBarra?: string;
};

type NormalizedTransferLine = {
  item: number;
  fecha: Date;
  codigoBarra: string;
  referencia: string;
  cantidad: Prisma.Decimal;
  valor: Prisma.Decimal;
  numeroCaja: number;
  ultimoCosto: Prisma.Decimal | null;
  costoInicial: Prisma.Decimal | null;
  costoDolar: Prisma.Decimal | null;
  articulo: Inventario;
};

type NormalizedTransferDraft = {
  fecha: Date;
  fechaEmision: Date;
  codigoEnvia: string;
  codigoRecibe: string;
  documentoOrigen: string;
  observacion: string;
  interContable: number;
  idDespacho: number;
  correccion: boolean;
  zona: string;
  lines: NormalizedTransferLine[];
  totalValor: Prisma.Decimal;
  quantitiesByBarcode: Map<string, Prisma.Decimal>;
};

@Injectable()
export class TransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata() {
    const [sucursales, tiposDespacho] = await Promise.all([
      this.prisma.sucursales.findMany({
        orderBy: [{ Status: "desc" }, { Codigo: "asc" }],
      }),
      this.prisma.tipoDespacho.findMany({
        orderBy: { ID: "asc" },
      }),
    ]);

    return {
      defaults: {
        fecha: new Date(),
        idDespacho: tiposDespacho.some((item) => item.ID === DEFAULT_DISPATCH_ID)
          ? DEFAULT_DISPATCH_ID
          : tiposDespacho[0]?.ID ?? null,
        status: 0,
      },
      sucursales: sucursales.map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre,
        status: item.Status,
      })),
      tiposDespacho: tiposDespacho.map((item) => ({
        id: item.ID,
        descripcion: item.Descripcion,
        estado: item.Estado,
      })),
    };
  }

  async searchTransfers(findTransfersDto: FindTransfersDto) {
    const limit = findTransfersDto.limit ?? 25;
    const where = this.buildSearchWhere(findTransfersDto);

    const transfers = await this.prisma.transferencias.findMany({
      where,
      include: transferInclude,
      orderBy: [{ Numero: "desc" }],
      take: limit,
    });

    const originLocations = await this.loadLocationsByCode(transfers.map((item) => item.CodigoEnvia));

    return {
      items: transfers.map((item) =>
        toTransferListItemView(item, {
          codigoEnviaInfo: this.toLocationView(originLocations.get(item.CodigoEnvia)),
        }),
      ),
    };
  }

  async findOne(numero: number) {
    return {
      transferencia: await this.findTransferDetailOrThrow(this.prisma, numero),
    };
  }

  async createTransfer(createTransferDto: CreateTransferDto, user: UserView) {
    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const normalizedDraft = await this.normalizeTransferDraft(tx, createTransferDto);
        const numero = await this.getNextTransferNumber(tx);
        const loteId = await this.resolveTransferLoteId(tx, createTransferDto.idLote, user.codUsuario);

        await this.ensureLocations(tx, [normalizedDraft.codigoEnvia, normalizedDraft.codigoRecibe]);
        await this.ensureDispatchTypeExists(tx, normalizedDraft.idDespacho);
        await this.applyOriginDelta(tx, normalizedDraft.quantitiesByBarcode);

        await tx.transferencias.create({
          data: {
            Numero: numero,
            Fecha: normalizedDraft.fecha,
            CodigoRecibe: normalizedDraft.codigoRecibe,
            CodigoEnvia: normalizedDraft.codigoEnvia,
            DocumentoOrigen: normalizedDraft.documentoOrigen || `TRF${numero}`,
            TotalValor: normalizedDraft.totalValor,
            Observacion: normalizedDraft.observacion,
            Status: 0,
            Usuario: user.codUsuario,
            InterContable: normalizedDraft.interContable,
            FechaEmision: normalizedDraft.fechaEmision,
            IDLote: loteId,
            IDDespacho: normalizedDraft.idDespacho,
            Correccion: normalizedDraft.correccion,
            Zona: normalizedDraft.zona,
          },
        });

        await tx.movTransferencias.createMany({
          data: normalizedDraft.lines.map((line) => ({
            Numero: numero,
            Fecha: line.fecha,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            Valor: line.valor,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            UltimoCosto: line.ultimoCosto,
            CostoInicial: line.costoInicial,
            CostoDolar: line.costoDolar,
          })),
        });

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      transferencia,
    };
  }

  async updateTransfer(numero: number, updateTransferDto: UpdateTransferDto) {
    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transferencias.findUnique({
          where: { Numero: numero },
          include: {
            movTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: {
                inventarioRef: true,
              },
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La transferencia no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada y no puede editarse.");
        }

        const normalizedDraft = await this.normalizeTransferDraft(tx, updateTransferDto, {
          fechaFallback: existing.Fecha,
          fechaEmisionFallback: existing.FechaEmision,
          documentoOrigenFallback: existing.DocumentoOrigen,
          observacionFallback: existing.Observacion,
          interContableFallback: existing.InterContable,
          idDespachoFallback: existing.IDDespacho,
          correccionFallback: existing.Correccion,
          zonaFallback: existing.Zona,
        });

        const loteId = await this.resolveTransferLoteId(tx, updateTransferDto.idLote ?? existing.IDLote, existing.Usuario);
        const currentQuantities = this.aggregateSavedQuantities(existing.movTransferencias);
        const originDelta = this.subtractAggregateMaps(normalizedDraft.quantitiesByBarcode, currentQuantities);

        await this.ensureLocations(tx, [normalizedDraft.codigoEnvia, normalizedDraft.codigoRecibe]);
        await this.ensureDispatchTypeExists(tx, normalizedDraft.idDespacho);
        await this.applyOriginDelta(tx, originDelta);

        await tx.transferencias.update({
          where: { Numero: numero },
          data: {
            Fecha: normalizedDraft.fecha,
            CodigoRecibe: normalizedDraft.codigoRecibe,
            CodigoEnvia: normalizedDraft.codigoEnvia,
            DocumentoOrigen: normalizedDraft.documentoOrigen || existing.DocumentoOrigen,
            TotalValor: normalizedDraft.totalValor,
            Observacion: normalizedDraft.observacion,
            InterContable: normalizedDraft.interContable,
            FechaEmision: normalizedDraft.fechaEmision,
            IDLote: loteId,
            IDDespacho: normalizedDraft.idDespacho,
            Correccion: normalizedDraft.correccion,
            Zona: normalizedDraft.zona,
          },
        });

        await tx.movTransferencias.deleteMany({
          where: { Numero: numero },
        });

        await tx.movTransferencias.createMany({
          data: normalizedDraft.lines.map((line) => ({
            Numero: numero,
            Fecha: line.fecha,
            CodigoBarra: line.codigoBarra,
            Cantidad: line.cantidad,
            Valor: line.valor,
            NumeroCaja: line.numeroCaja,
            Item: line.item,
            UltimoCosto: line.ultimoCosto,
            CostoInicial: line.costoInicial,
            CostoDolar: line.costoDolar,
          })),
        });

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      transferencia,
    };
  }

  async approveTransfer(numero: number, approveTransferDto: ApproveTransferDto = {}) {
    const transferencia = await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transferencias.findUnique({
          where: { Numero: numero },
          include: {
            movTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
              include: {
                inventarioRef: true,
              },
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La transferencia no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada.");
        }

        if (existing.movTransferencias.length === 0) {
          throw new BadRequestException("La transferencia no tiene renglones para aprobar.");
        }

        await this.ensureLocations(tx, [existing.CodigoEnvia, existing.CodigoRecibe]);
        const currentTotalValor = await this.refreshTransferMovementValuesFromInventory(
          tx,
          existing.movTransferencias,
        );
        await this.applyDestinationReceipt(
          tx,
          numero,
          existing.movTransferencias,
          this.buildDuplicateResolutionMap(approveTransferDto.duplicateResolutions),
        );

        await tx.transferencias.update({
          where: { Numero: numero },
          data: {
            Status: 1,
            TotalValor: currentTotalValor,
          },
        });

        return this.findTransferDetailOrThrow(tx, numero);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      transferencia,
    };
  }

  async deletePendingTransfer(numero: number) {
    await this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.transferencias.findUnique({
          where: { Numero: numero },
          include: {
            movTransferencias: {
              orderBy: [{ Item: "asc" }, { NumeroCaja: "asc" }, { CodigoBarra: "asc" }],
            },
          },
        });

        if (!existing) {
          throw new NotFoundException("La transferencia no existe.");
        }

        if (existing.Status === 1) {
          throw new ConflictException("La transferencia ya fue aprobada y no puede eliminarse.");
        }

        await this.applyOriginDelta(
          tx,
          this.negateAggregateMap(this.aggregateSavedQuantities(existing.movTransferencias)),
        );

        await tx.movTransferencias.deleteMany({
          where: { Numero: numero },
        });

        await tx.transferencias.delete({
          where: { Numero: numero },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    return {
      deleted: true,
      numero,
    };
  }

  private async normalizeTransferDraft(
    tx: TransferTransactionClient,
    input: CreateTransferDto | UpdateTransferDto,
    options?: {
      fechaFallback?: Date;
      fechaEmisionFallback?: Date;
      documentoOrigenFallback?: string;
      observacionFallback?: string;
      interContableFallback?: number;
      idDespachoFallback?: number;
      correccionFallback?: boolean;
      zonaFallback?: string;
    },
  ): Promise<NormalizedTransferDraft> {
    const fecha = input.fecha ?? options?.fechaFallback ?? new Date();
    const fechaEmision = input.fechaEmision ?? options?.fechaEmisionFallback ?? fecha;
    const codigoEnvia = this.normalizeOptionalCode(input.codigoEnvia) || DEFAULT_ORIGIN_CODE;
    const codigoRecibe = this.normalizeOptionalCode(input.codigoRecibe) || DEFAULT_DESTINATION_CODE;

    if (codigoEnvia === codigoRecibe) {
      throw new BadRequestException("El origen y el destino no pueden ser iguales.");
    }

    const lines = await this.normalizeTransferLines(tx, input.items, fecha);

    const quantitiesByBarcode = this.aggregateLineQuantities(lines);
    const totalValor = lines.reduce((total, line) => total.plus(line.valor.mul(line.cantidad)), ZERO);

    return {
      fecha,
      fechaEmision,
      codigoEnvia,
      codigoRecibe,
      documentoOrigen: String(input.documentoOrigen ?? options?.documentoOrigenFallback ?? "").trim(),
      observacion: String(input.observacion ?? options?.observacionFallback ?? "").trim(),
      interContable: input.interContable ?? options?.interContableFallback ?? 0,
      idDespacho: input.idDespacho ?? options?.idDespachoFallback ?? DEFAULT_DISPATCH_ID,
      correccion: input.correccion ?? options?.correccionFallback ?? false,
      zona: String(input.zona ?? options?.zonaFallback ?? "").trim(),
      lines,
      totalValor,
      quantitiesByBarcode,
    };
  }

  private async normalizeTransferLines(
    tx: TransferTransactionClient,
    items: CreateTransferLineDto[] | undefined,
    fecha: Date,
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const meaningfulItems = items.filter((item) => Boolean(String(item.codigoBarra || "").trim()));

    if (meaningfulItems.length === 0) {
      return [];
    }

    const normalizedCodes = meaningfulItems.map((item) => this.normalizeRequiredCode(item.codigoBarra, "Codigo de barra invalido."));
    const normalizedReferences = meaningfulItems.map((item) => this.normalizeOptionalCode(item.referencia));
    const uniqueCodes = Array.from(new Set(normalizedCodes));

    const inventoryItems = await tx.inventario.findMany({
      where: {
        CodigoBarra: { in: uniqueCodes },
      },
    });

    if (inventoryItems.length !== uniqueCodes.length) {
      const foundCodes = new Set(inventoryItems.map((item) => item.CodigoBarra));
      const missingCodes = uniqueCodes.filter((code) => !foundCodes.has(code));
      throw new NotFoundException(
        `No se encontraron articulos en inventario para: ${missingCodes.join(", ")}.`,
      );
    }

    const inventoryByCode = new Map(inventoryItems.map((item) => [item.CodigoBarra, item]));

    return meaningfulItems.map((item, index) => {
      const codigoBarra = normalizedCodes[index];
      const referencia = normalizedReferences[index] || "";
      const articulo = inventoryByCode.get(codigoBarra);
      if (!articulo) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      const resolvedReferencia = referencia || String(articulo.Referencia || "").trim().toUpperCase();
      if (String(articulo.Referencia || "").trim().toUpperCase() !== resolvedReferencia) {
        throw new BadRequestException(
          `El articulo ${codigoBarra} no coincide con la referencia ${resolvedReferencia} en inventario.`,
        );
      }

      const cantidad = this.parsePositiveDecimal(
        item.cantidad || "1",
        `La cantidad del articulo ${codigoBarra} debe ser mayor a cero.`,
      );
      const valor = item.valor
        ? this.parseNonNegativeDecimal(item.valor, `El valor del articulo ${codigoBarra} no es valido.`)
        : this.resolveLineValue(articulo);

      return {
        item: index + 1,
        fecha,
        codigoBarra,
        referencia: resolvedReferencia,
        cantidad,
        valor,
        numeroCaja: item.numeroCaja ?? 0,
        ultimoCosto: articulo.UltimoCosto,
        costoInicial: articulo.CostoInicial,
        costoDolar: articulo.CostoDolar,
        articulo,
      };
    });
  }

  private async findTransferDetailOrThrow(
    client: PrismaService | TransferTransactionClient,
    numero: number,
  ) {
    const transferencia = await client.transferencias.findUnique({
      where: { Numero: numero },
      include: transferInclude,
    });

    if (!transferencia) {
      throw new NotFoundException("La transferencia no existe.");
    }

    const originLocations = await this.loadLocationsByCode([transferencia.CodigoEnvia], client);

    return toTransferDetailView(transferencia, {
      codigoEnviaInfo: this.toLocationView(originLocations.get(transferencia.CodigoEnvia)),
    });
  }

  private buildSearchWhere(findTransfersDto: FindTransfersDto): Prisma.TransferenciasWhereInput {
    const search = String(findTransfersDto.buscar || "").trim();
    const conditions: Prisma.TransferenciasWhereInput[] = [];

    if (typeof findTransfersDto.status === "number") {
      conditions.push({ Status: findTransfersDto.status });
    }

    if (search) {
      const numericSearch = Number.parseInt(search, 10);
      conditions.push({
        OR: [
          Number.isInteger(numericSearch) ? { Numero: numericSearch } : undefined,
          { CodigoEnvia: { contains: search, mode: "insensitive" } },
          { CodigoRecibe: { contains: search, mode: "insensitive" } },
          { DocumentoOrigen: { contains: search, mode: "insensitive" } },
          { Observacion: { contains: search, mode: "insensitive" } },
          { Usuario: { contains: search, mode: "insensitive" } },
        ].filter(Boolean) as Prisma.TransferenciasWhereInput[],
      });
    }

    if (conditions.length === 0) {
      return {};
    }

    return {
      AND: conditions,
    };
  }

  private async getNextTransferNumber(tx: TransferTransactionClient) {
    const result = await tx.transferencias.aggregate({
      _max: {
        Numero: true,
      },
    });

    return (result._max.Numero ?? 0) + 1;
  }

  private async resolveTransferLoteId(
    tx: TransferTransactionClient,
    requestedId: number | undefined,
    userCode: string,
  ) {
    if (typeof requestedId === "number") {
      const lot = await tx.lotes.findUnique({
        where: { ID: requestedId },
      });

      if (!lot) {
        throw new BadRequestException("El lote indicado no existe.");
      }

      return lot.ID;
    }

    const existing = await tx.lotes.findUnique({
      where: { Lote: DEFAULT_TRANSFER_LOT },
    });

    if (existing) {
      return existing.ID;
    }

    const nextLotId = await this.getNextLotId(tx);

    try {
      const created = await tx.lotes.create({
        data: {
          ID: nextLotId,
          Lote: DEFAULT_TRANSFER_LOT,
          Descripcion: DEFAULT_TRANSFER_LOT_DESCRIPTION,
          Estado: 1,
          FechaRegistro: new Date(),
          UsuarioCreacion: userCode,
        },
      });

      return created.ID;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        const lot = await tx.lotes.findUnique({
          where: { Lote: DEFAULT_TRANSFER_LOT },
        });

        if (lot) {
          return lot.ID;
        }
      }

      throw error;
    }
  }

  private async getNextLotId(tx: TransferTransactionClient) {
    const result = await tx.lotes.aggregate({
      _max: {
        ID: true,
      },
    });

    return (result._max.ID ?? 0) + 1;
  }

  private async ensureLocations(tx: TransferTransactionClient, codes: string[]) {
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

    const existing = await tx.sucursales.findMany({
      where: {
        Codigo: { in: normalizedCodes },
      },
    });

    const existingCodes = new Set(existing.map((item) => item.Codigo));

    for (const code of normalizedCodes) {
      if (existingCodes.has(code)) {
        continue;
      }

      await tx.sucursales.create({
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

  private async ensureDispatchTypeExists(tx: TransferTransactionClient, idDespacho: number) {
    const dispatch = await tx.tipoDespacho.findUnique({
      where: { ID: idDespacho },
    });

    if (!dispatch) {
      throw new BadRequestException("El tipo de despacho indicado no existe.");
    }
  }

  private aggregateLineQuantities(lines: NormalizedTransferLine[]) {
    const quantities = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = quantities.get(line.codigoBarra) ?? ZERO;
      quantities.set(line.codigoBarra, current.plus(line.cantidad));
    }

    return quantities;
  }

  private aggregateSavedQuantities(lines: Array<{ CodigoBarra: string; Cantidad: Prisma.Decimal }>) {
    const quantities = new Map<string, Prisma.Decimal>();

    for (const line of lines) {
      const current = quantities.get(line.CodigoBarra) ?? ZERO;
      quantities.set(line.CodigoBarra, current.plus(line.Cantidad));
    }

    return quantities;
  }

  private subtractAggregateMaps(
    current: Map<string, Prisma.Decimal>,
    previous: Map<string, Prisma.Decimal>,
  ) {
    const result = new Map<string, Prisma.Decimal>();
    const keys = new Set([...current.keys(), ...previous.keys()]);

    for (const key of keys) {
      const nextValue = current.get(key) ?? ZERO;
      const previousValue = previous.get(key) ?? ZERO;
      const delta = nextValue.minus(previousValue);

      if (!delta.isZero()) {
        result.set(key, delta);
      }
    }

    return result;
  }

  private negateAggregateMap(values: Map<string, Prisma.Decimal>) {
    const result = new Map<string, Prisma.Decimal>();

    for (const [key, value] of values.entries()) {
      if (!value.isZero()) {
        result.set(key, value.negated());
      }
    }

    return result;
  }

  private async applyOriginDelta(
    tx: TransferTransactionClient,
    deltaByBarcode: Map<string, Prisma.Decimal>,
  ) {
    const codes = Array.from(deltaByBarcode.keys());
    if (codes.length === 0) {
      return;
    }

    const inventoryItems = await tx.inventario.findMany({
      where: {
        CodigoBarra: { in: codes },
      },
    });

    const inventoryByCode = new Map(inventoryItems.map((item) => [item.CodigoBarra, item]));
    const now = new Date();

    for (const [codigoBarra, delta] of deltaByBarcode.entries()) {
      const article = inventoryByCode.get(codigoBarra);
      if (!article) {
        throw new NotFoundException(`No se encontro el articulo ${codigoBarra} en inventario.`);
      }

      let nextExistence = article.Existencia;
      if (delta.greaterThan(0)) {
        if (article.Existencia.lessThan(delta)) {
          throw new BadRequestException(
            `El articulo ${codigoBarra} no tiene existencia suficiente. Disponible: ${article.Existencia.toString()}, solicitado: ${delta.toString()}.`,
          );
        }

        nextExistence = article.Existencia.minus(delta);
      } else if (delta.lessThan(0)) {
        nextExistence = article.Existencia.plus(delta.abs());
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

  private async applyDestinationReceipt(
    tx: TransferTransactionClient,
    numero: number,
    lines: Array<{ Cantidad: Prisma.Decimal; inventarioRef: Inventario }>,
    duplicateResolutions: Map<string, TransferDuplicateResolution>,
  ) {
    if (lines.length === 0) {
      return;
    }

    const quantitiesByIdentity = new Map<
      string,
      { quantity: Prisma.Decimal; source: Inventario }
    >();

    for (const line of lines) {
      const source = line.inventarioRef;
      const identityKey = this.buildInventoryIdentityKey(source);
      const current = quantitiesByIdentity.get(identityKey);

      quantitiesByIdentity.set(identityKey, {
        source,
        quantity: (current?.quantity ?? ZERO).plus(line.Cantidad),
      });
    }

    const identities = Array.from(quantitiesByIdentity.values());
    const existingMatches = await tx.inventario.findMany({
      where: {
        OR: identities.map(({ source }) => ({
          CodigoBarra: source.CodigoBarra,
          Referencia: source.Referencia,
          CodigoMarca: source.CodigoMarca,
        })),
      },
    });

    const matchesByIdentity = new Map(
      existingMatches.map((item) => [this.buildInventoryIdentityKey(item), item]),
    );
    const identitiesWithoutMatch = identities.filter(
      ({ source }) => !matchesByIdentity.has(this.buildInventoryIdentityKey(source)),
    );
    const collisions = identitiesWithoutMatch.length
      ? await tx.inventario.findMany({
          where: {
            CodigoBarra: { in: identitiesWithoutMatch.map(({ source }) => source.CodigoBarra) },
          },
        })
      : [];
    const collisionsByBarcode = new Map(collisions.map((item) => [item.CodigoBarra, item]));
    const unresolvedCollisions = identitiesWithoutMatch.filter(({ source }) => {
      const collision = collisionsByBarcode.get(source.CodigoBarra);
      return collision && !duplicateResolutions.has(source.CodigoBarra);
    });

    if (unresolvedCollisions.length > 0) {
      throw new ConflictException({
        message: DUPLICATE_BARCODE_MESSAGE,
        code: "TRANSFER_DUPLICATE_BARCODE",
        duplicates: unresolvedCollisions.map(({ source }) => ({
          codigoBarra: source.CodigoBarra,
          referencia: source.Referencia,
          codigoMarca: source.CodigoMarca,
          nombre: source.Nombre,
        })),
      });
    }

    const now = new Date();

    for (const { source, quantity } of identities) {
      const identityKey = this.buildInventoryIdentityKey(source);
      const destinationArticle = matchesByIdentity.get(identityKey);

      if (destinationArticle) {
        await tx.inventario.update({
          where: { CodigoBarra: destinationArticle.CodigoBarra },
          data: {
            ...this.buildReceivedInventoryAttributeUpdate(source),
            Existencia: destinationArticle.Existencia.plus(quantity),
            UltimaActualizacion: now,
            FechaPrimerMovimiento: destinationArticle.FechaPrimerMovimiento ?? now,
          },
        });

        continue;
      }

      const barcodeCollision = collisionsByBarcode.get(source.CodigoBarra);

      if (barcodeCollision) {
        const resolution = duplicateResolutions.get(source.CodigoBarra);

        if (resolution?.action === "modify-existing") {
          await tx.inventario.update({
            where: { CodigoBarra: barcodeCollision.CodigoBarra },
            data: {
              ...this.buildReceivedInventoryAttributeUpdate(source),
              Existencia: barcodeCollision.Existencia.plus(quantity),
              UltimaActualizacion: now,
              FechaPrimerMovimiento: barcodeCollision.FechaPrimerMovimiento ?? now,
            },
          });

          continue;
        }

        if (resolution?.action === "create-new") {
          const nuevoCodigoBarra = this.normalizeRequiredCode(
            resolution.nuevoCodigoBarra,
            "Debes indicar el nuevo codigo de barra para crear el articulo.",
          );
          const existingNewBarcode = await tx.inventario.findUnique({
            where: { CodigoBarra: nuevoCodigoBarra },
          });

          if (existingNewBarcode) {
            throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
          }

          await this.createReceivedInventoryArticle(tx, source, quantity, now, nuevoCodigoBarra);
          await tx.movTransferencias.updateMany({
            where: {
              Numero: numero,
              CodigoBarra: source.CodigoBarra,
            },
            data: {
              CodigoBarra: nuevoCodigoBarra,
            },
          });

          continue;
        }
      }

      await this.createReceivedInventoryArticle(tx, source, quantity, now);
    }
  }

  private async refreshTransferMovementValuesFromInventory(
    tx: TransferTransactionClient,
    lines: Array<{
      Numero: number;
      CodigoBarra: string;
      NumeroCaja: number;
      Item: number;
      Cantidad: Prisma.Decimal;
      inventarioRef: Inventario;
    }>,
  ) {
    let totalValor = ZERO;

    for (const line of lines) {
      const currentArticle = line.inventarioRef;
      const currentValue = this.resolveLineValue(currentArticle);
      totalValor = totalValor.plus(currentValue.mul(line.Cantidad));

      await tx.movTransferencias.updateMany({
        where: {
          Numero: line.Numero,
          CodigoBarra: line.CodigoBarra,
          NumeroCaja: line.NumeroCaja,
          Item: line.Item,
        },
        data: {
          Valor: currentValue,
          UltimoCosto: currentArticle.UltimoCosto,
          CostoInicial: currentArticle.CostoInicial,
          CostoDolar: currentArticle.CostoDolar,
        },
      });
    }

    return totalValor;
  }

  private async createReceivedInventoryArticle(
    tx: TransferTransactionClient,
    source: Inventario,
    quantity: Prisma.Decimal,
    now: Date,
    codigoBarraOverride?: string,
  ) {
    await tx.inventario.create({
      data: {
        CodigoBarra: codigoBarraOverride ?? source.CodigoBarra,
        Referencia: source.Referencia,
        CodigoMarca: source.CodigoMarca,
        Nombre: source.Nombre,
        Talla: source.Talla,
        CodigoColor: source.CodigoColor,
        Fabricante: source.Fabricante,
        Categoria: source.Categoria,
        Nota: source.Nota,
        TipoImpuesto: source.TipoImpuesto,
        PrecioDetal: source.PrecioDetal,
        PrecioMayor: source.PrecioMayor,
        PrecioAfiliado: source.PrecioAfiliado,
        PrecioPromocion: source.PrecioPromocion,
        Promocion: source.Promocion,
        FechaInicial: source.FechaInicial,
        FechaFinal: source.FechaFinal,
        CostoInicial: source.CostoInicial,
        CostoPromedio: source.CostoPromedio,
        UltimoCosto: source.UltimoCosto,
        CostoDolar: source.CostoDolar,
        ExistenciaInicial: quantity,
        Existencia: quantity,
        PuntoReorden: source.PuntoReorden,
        FechaPrimerMovimiento: now,
        UltimaActualizacion: now,
        Tipo: source.Tipo,
        Status: source.Status,
        Serializado: source.Serializado,
        CodigoBarraAnt: source.CodigoBarraAnt,
      },
    });
  }

  private buildReceivedInventoryAttributeUpdate(source: Inventario): Prisma.InventarioUncheckedUpdateInput {
    return {
      Referencia: source.Referencia,
      CodigoMarca: source.CodigoMarca,
      Nombre: source.Nombre,
      Talla: source.Talla,
      CodigoColor: source.CodigoColor,
      Fabricante: source.Fabricante,
      Categoria: source.Categoria,
      Nota: source.Nota,
      TipoImpuesto: source.TipoImpuesto,
      PrecioDetal: source.PrecioDetal,
      PrecioMayor: source.PrecioMayor,
      PrecioAfiliado: source.PrecioAfiliado,
      PrecioPromocion: source.PrecioPromocion,
      Promocion: source.Promocion,
      FechaInicial: source.FechaInicial,
      FechaFinal: source.FechaFinal,
      CostoInicial: source.CostoInicial,
      CostoPromedio: source.CostoPromedio,
      UltimoCosto: source.UltimoCosto,
      CostoDolar: source.CostoDolar,
      PuntoReorden: source.PuntoReorden,
      Tipo: source.Tipo,
      Status: source.Status,
      Serializado: source.Serializado,
      CodigoBarraAnt: source.CodigoBarraAnt,
    };
  }

  private buildInventoryIdentityKey(item: Pick<Inventario, "CodigoBarra" | "Referencia" | "CodigoMarca">) {
    return [
      String(item.CodigoBarra || "").trim().toUpperCase(),
      String(item.Referencia || "").trim().toUpperCase(),
      String(item.CodigoMarca || "").trim().toUpperCase(),
    ].join("|");
  }

  private buildDuplicateResolutionMap(resolutions: TransferDuplicateResolutionDto[] | undefined) {
    const result = new Map<string, TransferDuplicateResolution>();

    for (const resolution of resolutions ?? []) {
      const codigoBarra = this.normalizeRequiredCode(resolution.codigoBarra, "Codigo de barra invalido.");
      result.set(codigoBarra, {
        action: resolution.action,
        nuevoCodigoBarra: resolution.nuevoCodigoBarra
          ? this.normalizeRequiredCode(resolution.nuevoCodigoBarra, "Codigo de barra nuevo invalido.")
          : undefined,
      });
    }

    return result;
  }

  private resolveLineValue(article: Inventario) {
    if (article.UltimoCosto && !article.UltimoCosto.isZero()) {
      return article.UltimoCosto;
    }

    if (article.CostoPromedio && !article.CostoPromedio.isZero()) {
      return article.CostoPromedio;
    }

    if (article.CostoInicial && !article.CostoInicial.isZero()) {
      return article.CostoInicial;
    }

    return ZERO;
  }

  private parsePositiveDecimal(value: string, message: string) {
    const parsed = this.parseDecimalValue(value, message);
    if (parsed.lessThanOrEqualTo(0)) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parseNonNegativeDecimal(value: string, message: string) {
    const parsed = this.parseDecimalValue(value, message);
    if (parsed.lessThan(0)) {
      throw new BadRequestException(message);
    }

    return parsed;
  }

  private parseDecimalValue(value: string, message: string) {
    try {
      return new Prisma.Decimal(String(value).trim());
    } catch {
      throw new BadRequestException(message);
    }
  }

  private normalizeRequiredCode(value: string | undefined, message: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private normalizeOptionalCode(value: string | undefined) {
    return String(value || "").trim().toUpperCase();
  }

  private async loadLocationsByCode(
    codes: string[],
    client: PrismaService | TransferTransactionClient = this.prisma,
  ) {
    const normalizedCodes = Array.from(new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)));
    if (normalizedCodes.length === 0) {
      return new Map<string, Sucursales>();
    }

    const locations = await client.sucursales.findMany({
      where: {
        Codigo: { in: normalizedCodes },
      },
    });

    return new Map(locations.map((location) => [location.Codigo, location]));
  }

  private toLocationView(location: Sucursales | null | undefined) {
    if (!location) {
      return null;
    }

    return {
      codigo: location.Codigo,
      nombre: location.Nombre,
      status: location.Status,
    };
  }
}
