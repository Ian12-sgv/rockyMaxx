import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

import { MirrorSyncService } from "../mirror-sync/mirror-sync.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCatalogEntryDto } from "./dto/create-catalog-entry.dto";
import { CreateMerchandiseDto } from "./dto/create-merchandise.dto";
import { FindMerchandiseDto } from "./dto/find-merchandise.dto";
import { ResolveCreationAutofillDto } from "./dto/resolve-creation-autofill.dto";
import { UpdateMerchandiseDto } from "./dto/update-merchandise.dto";
import { inventoryInclude, InventoryWithRelations, toInventoryView } from "./inventory-view.util";

const DEFAULT_CATEGORY_CODE = "00";
const DEFAULT_CATEGORY_NAME = "UNISEX";
const DEFAULT_TAX_CODE = 1;
const DEFAULT_DATE = new Date("2000-01-01T00:00:00.000Z");
const DEFAULT_TYPE = 0;
const DEFAULT_STATUS = 1;
const DEFAULT_SERIALIZED = 0;
const DEFAULT_BRAND_NAME = "GENERAL";
const DUPLICATE_BARCODE_MESSAGE = "Codigo de barra duplicado.";

type InventorySibling = {
  PrecioDetal: Prisma.Decimal;
  PrecioMayor: Prisma.Decimal;
  PrecioAfiliado: Prisma.Decimal;
  Promocion: boolean;
  PrecioPromocion: Prisma.Decimal;
  FechaInicial: Date;
  FechaFinal: Date;
  CostoInicial: Prisma.Decimal;
  CostoPromedio: Prisma.Decimal;
  UltimoCosto: Prisma.Decimal;
};

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type NamedCatalogRecord = {
  Codigo: string;
  Nombre: string | null;
  Status: number | null;
};

type TaxRecord = {
  Codigo: number;
  Nombre: string | null;
  PorcentajeImpuesto: Prisma.Decimal | null;
  Status: number | null;
};

type NamedCatalogAutofill = {
  codigo: string;
  nombre: string | null;
  status: number | null;
  existente: boolean;
};

type TallaAutofill = {
  codigo: string;
  existente: boolean;
};

type TaxAutofill = {
  codigo: number;
  nombre: string | null;
  porcentajeImpuesto: string | null;
  existente: boolean;
};

type ResolvedNamedCatalog = {
  codigo: string;
  nombre: string;
  status: number;
};

type ResolvedCatalogs = {
  marca: ResolvedNamedCatalog;
  talla: { codigo: string };
  color: ResolvedNamedCatalog;
  fabricante: ResolvedNamedCatalog;
  categoria: ResolvedNamedCatalog;
  impuesto: {
    codigo: number;
    nombre: string | null;
    porcentajeImpuesto: string | null;
    status: number;
    existente: boolean;
  };
};

type CatalogInput = {
  codigo?: string;
  nombre?: string;
};

type TaxInput = {
  codigo?: number;
  nombre?: string;
  porcentajeImpuesto?: string;
};

type CatalogImportKind = "categorias" | "marcas" | "tallas" | "colores" | "fabricantes" | "impuestos";

type CatalogImportRow = {
  codigo?: string;
  nombre?: string;
  status?: number;
  porcentajeImpuesto?: string;
  rowNumber: number;
};

type ArticleImportRow = {
  codigoBarra?: string;
  referencia?: string;
  nombre?: string;
  categoria?: string;
  marca?: string;
  sexo?: string;
  talla?: string;
  costoInicial?: string;
  costoPromedio?: string;
  ultimoCosto?: string;
  costoDolar?: string;
  rowNumber: number;
};

type ArticleImportRateSnapshot = {
  rateBsPerUsd: number;
  rateMayor: number;
};

type ManualRateRow = {
  ID: number;
  Fecha: Date | string;
  Valor: unknown;
};

type NormalizedMerchandisePayload = {
  codigoBarra?: string;
  referencia?: string;
  codigoBarraAnt?: string;
  familia?: string;
  nombre?: string;
  nota?: string;
  puntoRecorte?: string;
  tipo?: number;
  status?: number;
  serializado?: number;
  marca: CatalogInput;
  talla: { codigo?: string };
  color: CatalogInput;
  fabricante: CatalogInput;
  categoria: CatalogInput;
  impuesto: TaxInput;
  precioDetal?: string;
  precioMayor?: string;
  precioAfiliado?: string;
  promocionActiva?: boolean;
  porcentajeDescuento?: string;
  precioPromocion?: string;
  fechaInicial?: string;
  fechaFinal?: string;
  costoInicial?: string;
  costoPromedio?: string;
  ultimoCosto?: string;
  costoDolar?: string;
  existenciaInicial?: string;
  existencia?: string;
};

type CompleteMerchandisePayload = {
  codigoBarra: string;
  referencia: string;
  codigoBarraAnt: string;
  familia: string;
  nombre: string;
  nota: string;
  puntoRecorte: string;
  tipo: number;
  status: number;
  serializado: number;
  marca: CatalogInput;
  talla: { codigo: string };
  color: CatalogInput;
  fabricante: CatalogInput;
  categoria: CatalogInput;
  impuesto: TaxInput;
  precioDetal: string;
  precioMayor: string;
  precioAfiliado: string;
  promocionActiva: boolean;
  precioPromocion: string;
  fechaInicial: string;
  fechaFinal: string;
  costoInicial: string;
  costoPromedio: string;
  ultimoCosto: string;
  costoDolar: string;
  existenciaInicial: string;
  existencia: string;
};

@Injectable()
export class InventoryService {
  private ensureImpuestosStatusColumnPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly mirrorSyncService: MirrorSyncService,
  ) {}

  async getCreationMetadata() {
    await this.ensureImpuestosStatusColumn();

    const canCreateArticles = this.canCreateArticlesInCurrentInstance();
    const [marcas, tallas, colores, fabricantes, categorias, impuestos] = await Promise.all([
      this.prisma.marcas.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.tallas.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.colores.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.fabricantes.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.categorias.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.impuestos.findMany({ orderBy: { Codigo: "asc" } }),
    ]);
    const activeTax = this.pickPreferredTaxRecord(impuestos);

    return {
      defaults: {
        general: {
          categoria: DEFAULT_CATEGORY_CODE,
          puntoRecorte: "0",
          tipo: {
            codigo: DEFAULT_TYPE,
            nombre: "articulo",
          },
          status: {
            codigo: DEFAULT_STATUS,
            nombre: "activo",
          },
        },
        precios: {
          impuesto: activeTax?.Codigo ?? DEFAULT_TAX_CODE,
          promocion: {
            activa: false,
          },
        },
      },
      opciones: {
        tipos: [
          { codigo: 0, nombre: "articulo" },
          { codigo: 1, nombre: "servicio" },
        ],
        status: [
          { codigo: 1, nombre: "activo" },
          { codigo: 0, nombre: "inactivo" },
        ],
      },
      contexto: {
        puedeCrearArticulos: canCreateArticles,
        esBodegaPrincipal: canCreateArticles,
        baseDatos: this.getCurrentDatabaseName(),
      },
      catalogos: {
        marcas: marcas.map((item) => ({ codigo: item.Codigo, nombre: item.Nombre, status: item.Status })),
        tallas: tallas.map((item) => ({ codigo: item.Codigo })),
        colores: colores.map((item) => ({ codigo: item.Codigo, nombre: item.Nombre, status: item.Status })),
        fabricantes: fabricantes.map((item) => ({ codigo: item.Codigo, nombre: item.Nombre, status: item.Status })),
        categorias: categorias.map((item) => ({ codigo: item.Codigo, nombre: item.Nombre, status: item.Status })),
        impuestos: impuestos.map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          porcentajeImpuesto: item.PorcentajeImpuesto,
          status: item.Status ?? 0,
        })),
      },
    };
  }

  async importCatalogFromExcel(
    catalogType: string,
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined,
  ) {
    const resolvedType = this.resolveCatalogImportKind(catalogType);

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException("Debe adjuntar un archivo Excel valido");
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
    } catch {
      throw new BadRequestException("No se pudo leer el archivo Excel");
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException("El archivo Excel no contiene hojas");
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });

    if (rawRows.length === 0) {
      throw new BadRequestException("El archivo Excel no contiene filas para importar");
    }

    const rows = rawRows
      .map((row, index) => this.parseCatalogImportRow(row, index + 2, resolvedType))
      .filter((row): row is CatalogImportRow => row !== null);

    if (rows.length === 0) {
      throw new BadRequestException(
        "El archivo Excel no contiene filas validas. Usa columnas como Codigo, Nombre y Status.",
      );
    }

    const result = await this.persistCatalogImportRows(resolvedType, rows);
    if (result.codigosSincronizados.length > 0) {
      await this.mirrorSyncService.enqueueCatalogEntryUpserts(resolvedType, result.codigosSincronizados);
      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    }

    const { codigosSincronizados, ...summary } = result;

    return {
      tipo: resolvedType,
      archivo: file.originalname ?? "catalogo.xlsx",
      hoja: firstSheetName,
      resumen: summary,
    };
  }

  async importArticlesFromExcel(
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined,
  ) {
    this.assertCanCreateArticles();

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException("Debe adjuntar un archivo Excel valido");
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: false });
    } catch {
      throw new BadRequestException("No se pudo leer el archivo Excel");
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException("El archivo Excel no contiene hojas");
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });

    if (rawRows.length === 0) {
      throw new BadRequestException("El archivo Excel no contiene filas para importar");
    }

    const rows = rawRows
      .map((row, index) => this.parseArticleImportRow(row, index + 2))
      .filter((row): row is ArticleImportRow => row !== null);

    if (rows.length === 0) {
      throw new BadRequestException(
        "El archivo Excel no contiene filas validas. Usa columnas como CodigoBarra, Referencia, Nombre, Categoria, Marca, Sexo, Talla, CostoInicial, CostoPromedio, UltimoCosto y CostoDolar.",
      );
    }

    const rates = await this.getArticleImportRateSnapshot();
    const result = await this.persistArticleImportRows(rows, rates);

    if (result.codigosSincronizados.length > 0) {
      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });
    }

    const { codigosSincronizados, ...summary } = result;

    return {
      tipo: "articulos",
      archivo: file.originalname ?? "articulos.xlsx",
      hoja: firstSheetName,
      resumen: summary,
    };
  }

  async getCatalogImportEntries(catalogType: string) {
    const resolvedType = this.resolveCatalogImportKind(catalogType);

    switch (resolvedType) {
      case "categorias":
        return (
          await this.prisma.categorias.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        }));
      case "marcas":
        return (
          await this.prisma.marcas.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        }));
      case "tallas":
        return (
          await this.prisma.tallas.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: item.Codigo,
        }));
      case "colores":
        return (
          await this.prisma.colores.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        }));
      case "fabricantes":
        return (
          await this.prisma.fabricantes.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status,
        }));
      case "impuestos":
        await this.ensureImpuestosStatusColumn();
        return (
          await this.prisma.impuestos.findMany({
            orderBy: { Codigo: "asc" },
          })
        ).map((item) => ({
          codigo: String(item.Codigo),
          nombre: item.Nombre,
          porcentajeImpuesto: item.PorcentajeImpuesto?.toString() ?? "0",
          status: item.Status ?? 0,
        }));
      default:
        return [];
    }
  }

  async createCatalogEntry(catalogType: string, createCatalogEntryDto: CreateCatalogEntryDto) {
    const resolvedType = this.resolveCatalogImportKind(catalogType);
    const config = this.getCatalogImportConfig(resolvedType);

    if (resolvedType === "tallas") {
      const codigo = this.normalizeOptionalUpper(createCatalogEntryDto.codigo ?? createCatalogEntryDto.nombre);

      if (!codigo) {
        throw new BadRequestException("Debe indicar el codigo de la talla");
      }

      this.assertCatalogCodeLength(config.displayName, codigo, config.maxCodeLength);

      const existing = await this.prisma.tallas.findUnique({
        where: { Codigo: codigo },
      });

      if (existing) {
        throw new ConflictException("La talla ya existe");
      }

      const created = await this.prisma.tallas.create({
        data: {
          Codigo: codigo,
        },
      });

      await this.mirrorSyncService.enqueueCatalogEntryUpserts(resolvedType, [created.Codigo]);
      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

      return {
        codigo: created.Codigo,
      };
    }

    if (resolvedType === "impuestos") {
      await this.ensureImpuestosStatusColumn();

      const nombre = this.normalizeOptionalName(createCatalogEntryDto.nombre);
      const explicitCode = this.parseTaxCatalogCode(createCatalogEntryDto.codigo);
      const porcentajeImpuesto = this.parseTaxCatalogPercentage(createCatalogEntryDto.porcentajeImpuesto);

      if (!nombre) {
        throw new BadRequestException("Debe indicar el nombre del impuesto");
      }

      const codigo =
        explicitCode ??
        ((await this.prisma.impuestos.aggregate({ _max: { Codigo: true } }))._max.Codigo ?? 0) + 1;

      const existingByCode = await this.prisma.impuestos.findUnique({
        where: { Codigo: codigo },
      });
      const status = this.normalizeTaxStatus(
        createCatalogEntryDto.status,
        existingByCode?.Status ?? DEFAULT_STATUS,
      );

      const existingByName = await this.prisma.impuestos.findFirst({
        where: { Nombre: { equals: nombre, mode: "insensitive" } },
      });

      if (existingByName && existingByName.Codigo !== codigo) {
        throw new ConflictException("El nombre ya existe");
      }

      const saved = existingByCode
        ? await this.prisma.impuestos.update({
            where: { Codigo: codigo },
            data: {
              Nombre: nombre,
              PorcentajeImpuesto: porcentajeImpuesto,
              Status: status,
            },
          })
        : await this.prisma.impuestos.create({
            data: {
              Codigo: codigo,
              Nombre: nombre,
              PorcentajeImpuesto: porcentajeImpuesto,
              Status: status,
            },
          });

      if (status === 1) {
        await this.deactivateOtherTaxes(saved.Codigo);
      }

      await this.mirrorSyncService.enqueueCatalogEntryUpserts(resolvedType, [String(saved.Codigo)]);
      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

      return {
        codigo: String(saved.Codigo),
        nombre: saved.Nombre,
        porcentajeImpuesto: saved.PorcentajeImpuesto?.toString() ?? "0",
        status: saved.Status ?? 0,
      };
    }

    const nombre = this.normalizeOptionalName(createCatalogEntryDto.nombre);
    const status = createCatalogEntryDto.status ?? DEFAULT_STATUS;
    const defaultName = nombre ?? this.normalizeOptionalUpper(createCatalogEntryDto.codigo) ?? config.defaultName;
    const explicitCode = this.normalizeOptionalUpper(createCatalogEntryDto.codigo);

    if (explicitCode) {
      this.assertCatalogCodeLength(config.displayName, explicitCode, config.maxCodeLength);
    }

    if (!nombre) {
      throw new BadRequestException("Debe indicar el nombre del catalogo");
    }

    this.assertCatalogNameLength(config.displayName, nombre, config.maxNameLength);

    const codigo =
      explicitCode ??
      (await this.generateUniqueCode(defaultName, config.maxCodeLength, async (candidate) => {
        return this.namedCatalogCodeExists(resolvedType, candidate);
      }));

    if (await this.namedCatalogCodeExists(resolvedType, codigo)) {
      throw new ConflictException("El codigo ya existe");
    }

    if (await this.namedCatalogNameExists(resolvedType, nombre)) {
      throw new ConflictException("El nombre ya existe");
    }

    const created = await this.createNamedCatalogRecord(resolvedType, {
      Codigo: codigo,
      Nombre: nombre,
      Status: status,
    });

    await this.mirrorSyncService.enqueueCatalogEntryUpserts(resolvedType, [created.Codigo]);
    await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

    return {
      codigo: created.Codigo,
      nombre: created.Nombre,
      status: created.Status,
    };
  }

  async removeCatalogEntry(catalogType: string, codigo: string) {
    const resolvedType = this.resolveCatalogImportKind(catalogType);
    const config = this.getCatalogImportConfig(resolvedType);
    const normalizedCode = this.normalizeOptionalUpper(codigo);

    if (!normalizedCode) {
      throw new BadRequestException("Debe indicar el codigo del catalogo");
    }

    try {
      switch (resolvedType) {
        case "tallas": {
          const existing = await this.prisma.tallas.findUnique({
            where: { Codigo: normalizedCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, normalizedCode, config.displayName);

          const deleted = await this.prisma.tallas.delete({
            where: { Codigo: normalizedCode },
          });

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, deleted.Codigo);
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: deleted.Codigo,
          };
        }
        case "categorias": {
          const existing = await this.prisma.categorias.findUnique({
            where: { Codigo: normalizedCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, normalizedCode, config.displayName);

          const deleted = await this.prisma.categorias.delete({
            where: { Codigo: normalizedCode },
          });

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, deleted.Codigo);
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: deleted.Codigo,
            nombre: deleted.Nombre,
            status: deleted.Status,
          };
        }
        case "marcas": {
          const existing = await this.prisma.marcas.findUnique({
            where: { Codigo: normalizedCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, normalizedCode, config.displayName);

          const deleted = await this.prisma.marcas.delete({
            where: { Codigo: normalizedCode },
          });

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, deleted.Codigo);
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: deleted.Codigo,
            nombre: deleted.Nombre,
            status: deleted.Status,
          };
        }
        case "colores": {
          const existing = await this.prisma.colores.findUnique({
            where: { Codigo: normalizedCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, normalizedCode, config.displayName);

          const deleted = await this.prisma.colores.delete({
            where: { Codigo: normalizedCode },
          });

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, deleted.Codigo);
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: deleted.Codigo,
            nombre: deleted.Nombre,
            status: deleted.Status,
          };
        }
        case "fabricantes": {
          const existing = await this.prisma.fabricantes.findUnique({
            where: { Codigo: normalizedCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, normalizedCode, config.displayName);

          const deleted = await this.prisma.fabricantes.delete({
            where: { Codigo: normalizedCode },
          });

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, deleted.Codigo);
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: deleted.Codigo,
            nombre: deleted.Nombre,
            status: deleted.Status,
          };
        }
        case "impuestos": {
          await this.ensureImpuestosStatusColumn();

          const taxCode = this.parseTaxCatalogCode(normalizedCode);
          if (taxCode === undefined) {
            throw new BadRequestException("Debe indicar el codigo del impuesto");
          }

          const existing = await this.prisma.impuestos.findUnique({
            where: { Codigo: taxCode },
          });

          if (!existing) {
            throw new NotFoundException(`No se encontro ${this.getCatalogDisplayLabel(config.displayName)}.`);
          }

          await this.assertCatalogNotUsedByArticles(resolvedType, String(taxCode), config.displayName);

          const deleted = await this.prisma.impuestos.delete({
            where: { Codigo: taxCode },
          });

          if ((deleted.Status ?? 0) === 1) {
            await this.activateFallbackTax(deleted.Codigo);
          }

          await this.mirrorSyncService.enqueueCatalogEntryDelete(resolvedType, String(deleted.Codigo));
          await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

          return {
            codigo: String(deleted.Codigo),
            nombre: deleted.Nombre,
            porcentajeImpuesto: deleted.PorcentajeImpuesto?.toString() ?? "0",
            status: deleted.Status ?? 0,
          };
        }
        default:
          throw new BadRequestException("Tipo de catalogo no soportado.");
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2003", "P2014"].includes(error.code)) {
        throw new ConflictException(
          `No se puede eliminar ${this.getCatalogDisplayLabel(config.displayName)} porque ese registro esta siendo usado en articulos u otros registros.`,
        );
      }

      throw error;
    }
  }

  async getCreationAutofill(resolveCreationAutofillDto: ResolveCreationAutofillDto) {
    const codigoMarca = this.normalizeOptionalUpper(resolveCreationAutofillDto.codigoMarca);
    const talla = this.normalizeOptionalUpper(resolveCreationAutofillDto.talla);
    const codigoColor = this.normalizeOptionalUpper(resolveCreationAutofillDto.codigoColor);
    const fabricante = this.normalizeOptionalUpper(resolveCreationAutofillDto.fabricante);
    const categoria = this.normalizeOptionalUpper(resolveCreationAutofillDto.categoria);
    const tipoImpuesto = resolveCreationAutofillDto.tipoImpuesto;

    const [marcaRecord, tallaRecord, colorRecord, fabricanteRecord, categoriaRecord, impuestoRecord] =
      await this.fetchCatalogRecords({
        codigoMarca,
        talla,
        codigoColor,
        fabricante,
        categoria,
        tipoImpuesto,
      });

    return {
      defaults: {
        categoria: DEFAULT_CATEGORY_CODE,
        tipoImpuesto: DEFAULT_TAX_CODE,
      },
      catalogos: {
        marca: codigoMarca
          ? this.buildNamedCatalogAutofill(codigoMarca, resolveCreationAutofillDto.nombreMarca, marcaRecord)
          : null,
        talla: talla ? this.buildTallaAutofill(talla, tallaRecord?.Codigo ?? null) : null,
        color: codigoColor
          ? this.buildNamedCatalogAutofill(codigoColor, resolveCreationAutofillDto.nombreColor, colorRecord)
          : null,
        fabricante: fabricante
          ? this.buildNamedCatalogAutofill(
              fabricante,
              resolveCreationAutofillDto.nombreFabricante,
              fabricanteRecord,
            )
          : null,
        categoria: categoria
          ? this.buildNamedCatalogAutofill(
              categoria,
              resolveCreationAutofillDto.nombreCategoria,
              categoriaRecord,
              categoria === DEFAULT_CATEGORY_CODE ? DEFAULT_CATEGORY_NAME : undefined,
            )
          : null,
        impuesto:
          typeof tipoImpuesto === "number"
            ? this.buildTaxAutofill(
                tipoImpuesto,
                resolveCreationAutofillDto.nombreImpuesto,
                resolveCreationAutofillDto.porcentajeImpuesto,
                impuestoRecord,
              )
            : null,
      },
    };
  }

  async searchMerchandise(findMerchandiseDto: FindMerchandiseDto) {
    const page = findMerchandiseDto.page ?? 1;
    const limit = findMerchandiseDto.limit ?? 25;
    const where = this.buildSearchWhere(findMerchandiseDto);

    const [total, items] = await Promise.all([
      this.prisma.inventario.count({ where }),
      this.prisma.inventario.findMany({
        where,
        include: inventoryInclude,
        orderBy: [{ Nombre: "asc" }, { CodigoBarra: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: items.map((item) => toInventoryView(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(codigoBarra: string) {
    const item = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: this.normalizeBarcode(codigoBarra) },
      include: inventoryInclude,
    });

    if (!item) {
      throw new NotFoundException("Mercancia no encontrada");
    }

    return toInventoryView(item);
  }

  async createMerchandise(createMerchandiseDto: CreateMerchandiseDto) {
    this.assertCanCreateArticles();
    const normalized = this.normalizeMerchandisePayload(createMerchandiseDto);
    const codigoBarra = this.requireString(normalized.codigoBarra, "Debe indicar el codigo de barra");
    const referencia = this.requireString(normalized.referencia, "Debe indicar la referencia del articulo");
    const familia = this.requireString(normalized.familia, "Debe indicar la familia del articulo");

    const existing = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: codigoBarra },
    });

    if (existing) {
      throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
    }

    const marcaSeed = normalized.marca.codigo ?? normalized.marca.nombre ?? familia;
    const siblingValues = await this.getSiblingValues(
      referencia,
      this.buildCodeCandidate(marcaSeed),
      codigoBarra,
    );

    const completePayload = this.completeCreatePayload(normalized, siblingValues);
    const resolvedCatalogs = await this.resolveCatalogs(completePayload);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.ensureCatalogs(tx, resolvedCatalogs);
        await this.ensureUniqueBarcode(tx, completePayload.codigoBarra);
        await this.ensureUniqueReferencePerBrand(tx, completePayload.referencia, resolvedCatalogs.marca.codigo);

        const now = new Date();
        const created = await tx.inventario.create({
          data: {
            CodigoBarra: completePayload.codigoBarra,
            CodigoBarraAnt: completePayload.codigoBarraAnt,
            Referencia: completePayload.referencia,
            CodigoMarca: resolvedCatalogs.marca.codigo,
            Nombre: completePayload.nombre,
            Talla: resolvedCatalogs.talla.codigo,
            CodigoColor: resolvedCatalogs.color.codigo,
            Fabricante: resolvedCatalogs.fabricante.codigo,
            Categoria: resolvedCatalogs.categoria.codigo,
            Nota: completePayload.nota,
            TipoImpuesto: resolvedCatalogs.impuesto.codigo,
            PrecioDetal: completePayload.precioDetal,
            PrecioMayor: completePayload.precioMayor,
            PrecioAfiliado: completePayload.precioAfiliado,
            PrecioPromocion: completePayload.precioPromocion,
            Promocion: completePayload.promocionActiva,
            FechaInicial: new Date(completePayload.fechaInicial),
            FechaFinal: new Date(completePayload.fechaFinal),
            CostoInicial: completePayload.costoInicial,
            CostoPromedio: completePayload.costoPromedio,
            UltimoCosto: completePayload.ultimoCosto,
            CostoDolar: completePayload.costoDolar,
            ExistenciaInicial: completePayload.existenciaInicial,
            Existencia: completePayload.existencia,
            PuntoReorden: completePayload.puntoRecorte,
            FechaPrimerMovimiento: now,
            UltimaActualizacion: now,
            Tipo: completePayload.tipo,
            Status: completePayload.status,
            Serializado: completePayload.serializado,
          },
          include: inventoryInclude,
        });

        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, [created.CodigoBarra]);
        return created;
      });

      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

      return toInventoryView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
      }

      throw error;
    }
  }

  async updateMerchandise(codigoBarra: string, updateMerchandiseDto: UpdateMerchandiseDto) {
    const normalizedBarcode = this.normalizeBarcode(codigoBarra);
    const existing = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: normalizedBarcode },
      include: inventoryInclude,
    });

    if (!existing) {
      throw new NotFoundException("Mercancia no encontrada");
    }

    const normalized = this.normalizeMerchandisePayload(updateMerchandiseDto);
    const merged = this.mergeWithExisting(normalized, existing);
    const resolvedCatalogs = await this.resolveCatalogs(merged);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await this.ensureCatalogs(tx, resolvedCatalogs);
        await this.ensureUniqueBarcode(tx, merged.codigoBarra, normalizedBarcode);
        await this.ensureUniqueReferencePerBrand(
          tx,
          merged.referencia,
          resolvedCatalogs.marca.codigo,
          normalizedBarcode,
        );

        const updated = await tx.inventario.update({
          where: { CodigoBarra: normalizedBarcode },
          data: {
            CodigoBarra: merged.codigoBarra,
            CodigoBarraAnt: merged.codigoBarraAnt,
            Referencia: merged.referencia,
            CodigoMarca: resolvedCatalogs.marca.codigo,
            Nombre: merged.nombre,
            Talla: resolvedCatalogs.talla.codigo,
            CodigoColor: resolvedCatalogs.color.codigo,
            Fabricante: resolvedCatalogs.fabricante.codigo,
            Categoria: resolvedCatalogs.categoria.codigo,
            Nota: merged.nota,
            TipoImpuesto: resolvedCatalogs.impuesto.codigo,
            PrecioDetal: merged.precioDetal,
            PrecioMayor: merged.precioMayor,
            PrecioAfiliado: merged.precioAfiliado,
            PrecioPromocion: merged.precioPromocion,
            Promocion: merged.promocionActiva,
            FechaInicial: new Date(merged.fechaInicial),
            FechaFinal: new Date(merged.fechaFinal),
            CostoInicial: merged.costoInicial,
            CostoPromedio: merged.costoPromedio,
            UltimoCosto: merged.ultimoCosto,
            CostoDolar: merged.costoDolar,
            ExistenciaInicial: merged.existenciaInicial,
            Existencia: merged.existencia,
            PuntoReorden: merged.puntoRecorte,
            UltimaActualizacion: new Date(),
            Tipo: merged.tipo,
            Status: merged.status,
            Serializado: merged.serializado,
          },
          include: inventoryInclude,
        });

        if (updated.CodigoBarra !== normalizedBarcode) {
          await this.mirrorSyncService.enqueueInventoryDeleteTx(tx, normalizedBarcode);
        }

        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, [updated.CodigoBarra]);
        return updated;
      });

      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

      return toInventoryView(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("No se pudo actualizar la mercancia por restricciones de integridad");
      }

      throw error;
    }
  }

  async removeMerchandise(codigoBarra: string) {
    const normalizedBarcode = this.normalizeBarcode(codigoBarra);
    const existing = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: normalizedBarcode },
      include: inventoryInclude,
    });

    if (!existing) {
      throw new NotFoundException("Mercancia no encontrada");
    }

    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const removed = await tx.inventario.delete({
          where: { CodigoBarra: normalizedBarcode },
          include: inventoryInclude,
        });

        await this.mirrorSyncService.enqueueInventoryDeleteTx(tx, normalizedBarcode);
        return removed;
      });

      await this.mirrorSyncService.pushPendingMirrorSync({ limit: 25 });

      return toInventoryView(deleted);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException("No se puede eliminar la mercancia porque tiene movimientos asociados");
      }

      throw error;
    }
  }

  private assertCanCreateArticles() {
    if (this.canCreateArticlesInCurrentInstance()) {
      return;
    }

    throw new ForbiddenException("Solo la bodega principal puede crear articulos.");
  }

  private canCreateArticlesInCurrentInstance() {
    const override = String(this.configService.get<string>("INVENTORY_MAIN_WAREHOUSE", "") || "").trim();
    if (override) {
      return ["1", "true", "yes", "si", "sí"].includes(override.toLowerCase());
    }

    const databaseName = this.getCurrentDatabaseName();
    return databaseName.toLowerCase() === "rocky_maxx";
  }

  private getCurrentDatabaseName() {
    const databaseUrl = String(this.configService.get<string>("DATABASE_URL", "") || "");
    const databaseNameMatch = databaseUrl.match(/\/([^/?]+)(\?|$)/);
    return String(databaseNameMatch?.[1] || "").trim();
  }

  private buildSearchWhere(findMerchandiseDto: FindMerchandiseDto): Prisma.InventarioWhereInput {
    const filters: Prisma.InventarioWhereInput[] = [];
    const buscar = this.normalizeOptionalName(findMerchandiseDto.buscar);
    const categoria = this.normalizeOptionalName(findMerchandiseDto.categoria);
    const fabricante = this.normalizeOptionalName(findMerchandiseDto.fabricante);
    const color = this.normalizeOptionalName(findMerchandiseDto.color);
    const familia = this.normalizeOptionalName(findMerchandiseDto.familia);
    const talla = this.normalizeOptionalUpper(findMerchandiseDto.talla);
    const tipo = typeof findMerchandiseDto.tipo === "string" ? this.normalizeItemType(findMerchandiseDto.tipo) : undefined;
    const status =
      typeof findMerchandiseDto.status === "string" ? this.normalizeItemStatus(findMerchandiseDto.status) : undefined;

    if (buscar) {
      filters.push({
        OR: [
          { CodigoBarra: { contains: buscar, mode: "insensitive" } },
          { Referencia: { contains: buscar, mode: "insensitive" } },
          { CodigoBarraAnt: { contains: buscar, mode: "insensitive" } },
          { CodigoMarca: { contains: buscar.toUpperCase(), mode: "insensitive" } },
          { Nombre: { contains: buscar, mode: "insensitive" } },
          { Categoria: { contains: buscar.toUpperCase(), mode: "insensitive" } },
          { Fabricante: { contains: buscar.toUpperCase(), mode: "insensitive" } },
          { CodigoColor: { contains: buscar.toUpperCase(), mode: "insensitive" } },
          { Talla: { contains: buscar.toUpperCase(), mode: "insensitive" } },
          { marcaRef: { is: { Nombre: { contains: buscar, mode: "insensitive" } } } },
          { categoriaRef: { is: { Nombre: { contains: buscar, mode: "insensitive" } } } },
          { fabricanteRef: { is: { Nombre: { contains: buscar, mode: "insensitive" } } } },
          { colorRef: { is: { Nombre: { contains: buscar, mode: "insensitive" } } } },
        ],
      });
    }

    if (familia) {
      filters.push({
        CodigoBarraAnt: { contains: familia, mode: "insensitive" },
      });
    }

    if (categoria) {
      const upperCategoria = categoria.toUpperCase();
      filters.push({
        OR: [
          { Categoria: { equals: upperCategoria, mode: "insensitive" } },
          { categoriaRef: { is: { Nombre: { contains: categoria, mode: "insensitive" } } } },
        ],
      });
    }

    if (fabricante) {
      const upperFabricante = fabricante.toUpperCase();
      filters.push({
        OR: [
          { Fabricante: { equals: upperFabricante, mode: "insensitive" } },
          { fabricanteRef: { is: { Nombre: { contains: fabricante, mode: "insensitive" } } } },
        ],
      });
    }

    if (color) {
      const upperColor = color.toUpperCase();
      filters.push({
        OR: [
          { CodigoColor: { equals: upperColor, mode: "insensitive" } },
          { colorRef: { is: { Nombre: { contains: color, mode: "insensitive" } } } },
        ],
      });
    }

    if (talla) {
      filters.push({
        Talla: { equals: talla, mode: "insensitive" },
      });
    }

    if (typeof tipo === "number") {
      filters.push({ Tipo: tipo });
    }

    if (typeof status === "number") {
      filters.push({ Status: status });
    }

    if (filters.length === 0) {
      return {};
    }

    return {
      AND: filters,
    };
  }

  private normalizeMerchandisePayload(raw: CreateMerchandiseDto | UpdateMerchandiseDto): NormalizedMerchandisePayload {
    const general = this.asRecord(raw.general);
    const tallasColores = this.asRecord(raw.tallasColores);
    const precios = this.asRecord(raw.precios);
    const promocion = this.asRecord(precios?.promocion);

    return {
      codigoBarra: this.pickUpperString(raw.codigoBarra),
      referencia: this.pickString(raw.referencia, raw.codigoBarraAnt),
      codigoBarraAnt: this.pickString(raw.codigoBarraAnt),
      familia: this.pickString(general?.familia, raw.familia),
      nombre: this.pickString(general?.nombre, raw.nombre),
      nota: this.pickString(general?.nota, raw.nota),
      puntoRecorte: this.pickNumericString(general?.puntoRecorte, raw.puntoRecorte, raw.puntoReorden),
      tipo: this.pickType(general?.tipo, raw.tipo),
      status: this.pickStatus(general?.status, raw.status),
      serializado: typeof raw.serializado === "number" ? raw.serializado : undefined,
      marca: this.normalizeCatalogInput(
        general?.marca,
        {
          codigo: raw.codigoMarca,
          nombre: raw.nombreMarca,
        },
      ),
      talla: this.normalizeTallaInput(tallasColores?.talla, raw.talla),
      color: this.normalizeCatalogInput(
        tallasColores?.colores,
        tallasColores?.color,
        raw.color,
        raw.colores,
        {
          codigo: raw.codigoColor,
          nombre: raw.nombreColor,
        },
      ),
      fabricante: this.normalizeCatalogInput(
        general?.fabricante,
        raw.fabricante,
        {
          codigo: raw.codigoFabricante,
          nombre: raw.nombreFabricante,
        },
      ),
      categoria: this.normalizeCatalogInput(
        general?.categoria,
        raw.categoria,
        {
          codigo: raw.codigoCategoria,
          nombre: raw.nombreCategoria,
        },
      ),
      impuesto: this.normalizeTaxInput(
        precios?.impuesto,
        raw.impuesto,
        {
          codigo: raw.tipoImpuesto,
          nombre: raw.nombreImpuesto,
          porcentajeImpuesto: raw.porcentajeImpuesto,
        },
      ),
      precioDetal: this.pickNumericString(precios?.detal, raw.precioDetal),
      precioMayor: this.pickNumericString(precios?.mayor, raw.precioMayor),
      precioAfiliado: this.pickNumericString(precios?.afiliado, raw.precioAfiliado),
      promocionActiva: this.pickBoolean(promocion?.activa, raw.promocion),
      porcentajeDescuento: this.pickNumericString(promocion?.porcentajeDescuento, raw.porcentajeDescuento),
      precioPromocion: this.pickNumericString(promocion?.precio, raw.precioPromocion),
      fechaInicial: this.pickString(promocion?.desde, raw.fechaInicial),
      fechaFinal: this.pickString(promocion?.hasta, raw.fechaFinal),
      costoInicial: this.pickNumericString(raw.costoInicial),
      costoPromedio: this.pickNumericString(raw.costoPromedio),
      ultimoCosto: this.pickNumericString(raw.ultimoCosto),
      costoDolar: this.pickNumericString(raw.costoDolar),
      existenciaInicial: this.pickNumericString(raw.existenciaInicial),
      existencia: this.pickNumericString(raw.existencia),
    };
  }

  private completeCreatePayload(
    payload: NormalizedMerchandisePayload,
    siblingValues: ReturnType<InventoryService["reduceSiblingValues"]>,
  ): CompleteMerchandisePayload {
    const codigoBarra = this.requireString(payload.codigoBarra, "Debe indicar el codigo de barra");
    const referencia = this.requireString(payload.referencia, "Debe indicar la referencia del articulo");
    const familia = this.requireString(payload.familia, "Debe indicar la familia del articulo");
    const nombre = this.requireString(payload.nombre, "Debe indicar el nombre del articulo");
    const talla = this.requireString(payload.talla.codigo, "Debe indicar la talla del articulo");
    const fabricanteNombre = payload.fabricante.nombre ?? payload.fabricante.codigo;
    const colorNombre = payload.color.nombre ?? payload.color.codigo;

    if (!fabricanteNombre) {
      throw new BadRequestException("Debe indicar el fabricante del articulo");
    }

    if (!colorNombre) {
      throw new BadRequestException("Debe indicar el color del articulo");
    }

    const precioDetal = this.pickDecimal(payload.precioDetal, siblingValues.PrecioDetal, "0");
    const precioMayor = this.pickDecimal(payload.precioMayor, siblingValues.PrecioMayor, "0");
    const precioAfiliado = this.pickDecimal(payload.precioAfiliado, siblingValues.PrecioAfiliado, "0");
    const promocionActiva = payload.promocionActiva ?? siblingValues.Promocion ?? false;
    const promotion = this.resolvePromotionFields({
      activa: promocionActiva,
      detalle: precioDetal,
      porcentajeDescuento: payload.porcentajeDescuento,
      precioPromocion: payload.precioPromocion ?? siblingValues.PrecioPromocion?.toString() ?? "0",
      fechaInicial: payload.fechaInicial ?? siblingValues.FechaInicial?.toISOString() ?? DEFAULT_DATE.toISOString(),
      fechaFinal: payload.fechaFinal ?? siblingValues.FechaFinal?.toISOString() ?? DEFAULT_DATE.toISOString(),
      requireDatesWhenActive: true,
    });

    return {
      codigoBarra,
      referencia,
      codigoBarraAnt: this.pickString(payload.codigoBarraAnt) ?? familia,
      familia,
      nombre,
      nota: payload.nota ?? "",
      puntoRecorte: payload.puntoRecorte ?? "0",
      tipo: payload.tipo ?? DEFAULT_TYPE,
      status: payload.status ?? DEFAULT_STATUS,
      serializado: payload.serializado ?? DEFAULT_SERIALIZED,
      marca: this.normalizeBrandInput(payload),
      talla: { codigo: talla },
      color: payload.color,
      fabricante: payload.fabricante,
      categoria: this.normalizeCategoryInput(payload.categoria),
      impuesto: this.normalizeTaxDefaults(payload.impuesto),
      precioDetal,
      precioMayor,
      precioAfiliado,
      promocionActiva: promotion.activa,
      precioPromocion: promotion.precioPromocion,
      fechaInicial: promotion.fechaInicial,
      fechaFinal: promotion.fechaFinal,
      costoInicial: this.pickDecimal(payload.costoInicial, siblingValues.CostoInicial, "0"),
      costoPromedio: this.pickDecimal(payload.costoPromedio, siblingValues.CostoPromedio, "0"),
      ultimoCosto: this.pickDecimal(payload.ultimoCosto, siblingValues.UltimoCosto, "0"),
      costoDolar: payload.costoDolar ?? "0",
      existenciaInicial: payload.existenciaInicial ?? "0",
      existencia: payload.existencia ?? "0",
    };
  }

  private mergeWithExisting(
    payload: NormalizedMerchandisePayload,
    existing: InventoryWithRelations,
  ): CompleteMerchandisePayload {
    const precioDetal = payload.precioDetal ?? existing.PrecioDetal.toString();
    const precioMayor = payload.precioMayor ?? existing.PrecioMayor.toString();
    const precioAfiliado = payload.precioAfiliado ?? existing.PrecioAfiliado.toString();
    const promocionActiva = payload.promocionActiva ?? existing.Promocion;
    const promotion = this.resolvePromotionFields({
      activa: promocionActiva,
      detalle: precioDetal,
      porcentajeDescuento:
        payload.porcentajeDescuento ??
        this.calculateDiscountPercent(existing.PrecioDetal.toString(), existing.PrecioPromocion.toString(), existing.Promocion),
      precioPromocion: payload.precioPromocion ?? existing.PrecioPromocion.toString(),
      fechaInicial: payload.fechaInicial ?? existing.FechaInicial.toISOString(),
      fechaFinal: payload.fechaFinal ?? existing.FechaFinal.toISOString(),
      requireDatesWhenActive: true,
    });

    return {
      codigoBarra: payload.codigoBarra ?? existing.CodigoBarra,
      referencia: payload.referencia ?? existing.Referencia,
      codigoBarraAnt: payload.codigoBarraAnt ?? payload.familia ?? existing.CodigoBarraAnt,
      familia: payload.familia ?? existing.CodigoBarraAnt,
      nombre: payload.nombre ?? existing.Nombre,
      nota: payload.nota ?? existing.Nota ?? "",
      puntoRecorte: payload.puntoRecorte ?? existing.PuntoReorden.toString(),
      tipo: payload.tipo ?? existing.Tipo,
      status: payload.status ?? existing.Status,
      serializado: payload.serializado ?? existing.Serializado,
      marca: this.mergeCatalogInput(payload.marca, {
        codigo: existing.marcaRef.Codigo,
        nombre: existing.marcaRef.Nombre ?? DEFAULT_BRAND_NAME,
      }),
      talla: {
        codigo: payload.talla.codigo ?? existing.tallaRef.Codigo,
      },
      color: this.mergeCatalogInput(payload.color, {
        codigo: existing.colorRef.Codigo,
        nombre: existing.colorRef.Nombre ?? existing.colorRef.Codigo,
      }),
      fabricante: this.mergeCatalogInput(payload.fabricante, {
        codigo: existing.fabricanteRef.Codigo,
        nombre: existing.fabricanteRef.Nombre ?? existing.fabricanteRef.Codigo,
      }),
      categoria: this.mergeCatalogInput(payload.categoria, {
        codigo: existing.categoriaRef.Codigo,
        nombre: existing.categoriaRef.Nombre ?? existing.categoriaRef.Codigo,
      }),
      impuesto: this.mergeTaxInput(payload.impuesto, {
        codigo: existing.impuestoRef.Codigo,
        nombre: existing.impuestoRef.Nombre ?? undefined,
        porcentajeImpuesto: existing.impuestoRef.PorcentajeImpuesto?.toString() ?? undefined,
      }),
      precioDetal,
      precioMayor,
      precioAfiliado,
      promocionActiva: promotion.activa,
      precioPromocion: promotion.precioPromocion,
      fechaInicial: promotion.fechaInicial,
      fechaFinal: promotion.fechaFinal,
      costoInicial: payload.costoInicial ?? existing.CostoInicial.toString(),
      costoPromedio: payload.costoPromedio ?? existing.CostoPromedio.toString(),
      ultimoCosto: payload.ultimoCosto ?? existing.UltimoCosto.toString(),
      costoDolar: payload.costoDolar ?? existing.CostoDolar.toString(),
      existenciaInicial: payload.existenciaInicial ?? existing.ExistenciaInicial.toString(),
      existencia: payload.existencia ?? existing.Existencia.toString(),
    };
  }

  private async resolveCatalogs(payload: CompleteMerchandisePayload): Promise<ResolvedCatalogs> {
    const marcaInput = this.normalizeBrandInput(payload);
    const categoriaInput = this.normalizeCategoryInput(payload.categoria);
    const impuestoInput = this.normalizeTaxDefaults(payload.impuesto);

    const [marca, talla, color, fabricante, categoria, impuesto] = await Promise.all([
      this.resolveNamedCatalogInput({
        label: "marca",
        input: marcaInput,
        maxCodeLength: 3,
        fallbackName: DEFAULT_BRAND_NAME,
        findByCode: (code) => this.prisma.marcas.findUnique({ where: { Codigo: code } }),
        findByName: (name) =>
          this.prisma.marcas.findFirst({
            where: { Nombre: { equals: name, mode: "insensitive" } },
          }),
        codeExists: async (code) => {
          const match = await this.prisma.marcas.findUnique({ where: { Codigo: code } });
          return Boolean(match);
        },
      }),
      Promise.resolve({ codigo: this.requireString(payload.talla.codigo, "Debe indicar la talla del articulo") }),
      this.resolveNamedCatalogInput({
        label: "color",
        input: payload.color,
        maxCodeLength: 3,
        findByCode: (code) => this.prisma.colores.findUnique({ where: { Codigo: code } }),
        findByName: (name) =>
          this.prisma.colores.findFirst({
            where: { Nombre: { equals: name, mode: "insensitive" } },
          }),
        codeExists: async (code) => {
          const match = await this.prisma.colores.findUnique({ where: { Codigo: code } });
          return Boolean(match);
        },
      }),
      this.resolveNamedCatalogInput({
        label: "fabricante",
        input: payload.fabricante,
        maxCodeLength: 12,
        findByCode: (code) => this.prisma.fabricantes.findUnique({ where: { Codigo: code } }),
        findByName: (name) =>
          this.prisma.fabricantes.findFirst({
            where: { Nombre: { equals: name, mode: "insensitive" } },
          }),
        codeExists: async (code) => {
          const match = await this.prisma.fabricantes.findUnique({ where: { Codigo: code } });
          return Boolean(match);
        },
      }),
      this.resolveNamedCatalogInput({
        label: "categoria",
        input: categoriaInput,
        maxCodeLength: 6,
        fallbackName: DEFAULT_CATEGORY_NAME,
        findByCode: (code) => this.prisma.categorias.findUnique({ where: { Codigo: code } }),
        findByName: (name) =>
          this.prisma.categorias.findFirst({
            where: { Nombre: { equals: name, mode: "insensitive" } },
          }),
        codeExists: async (code) => {
          const match = await this.prisma.categorias.findUnique({ where: { Codigo: code } });
          return Boolean(match);
        },
      }),
      this.resolveTaxInput(impuestoInput),
    ]);

    return {
      marca,
      talla,
      color,
      fabricante,
      categoria,
      impuesto,
    };
  }

  private async ensureCatalogs(tx: TransactionClient, payload: ResolvedCatalogs) {
    await tx.marcas.upsert({
      where: { Codigo: payload.marca.codigo },
      update: {
        Nombre: payload.marca.nombre,
        Status: payload.marca.status,
      },
      create: {
        Codigo: payload.marca.codigo,
        Nombre: payload.marca.nombre,
        Status: payload.marca.status,
      },
    });

    await tx.tallas.upsert({
      where: { Codigo: payload.talla.codigo },
      update: {},
      create: { Codigo: payload.talla.codigo },
    });

    await tx.colores.upsert({
      where: { Codigo: payload.color.codigo },
      update: {
        Nombre: payload.color.nombre,
        Status: payload.color.status,
      },
      create: {
        Codigo: payload.color.codigo,
        Nombre: payload.color.nombre,
        Status: payload.color.status,
      },
    });

    await tx.fabricantes.upsert({
      where: { Codigo: payload.fabricante.codigo },
      update: {
        Nombre: payload.fabricante.nombre,
        Status: payload.fabricante.status,
      },
      create: {
        Codigo: payload.fabricante.codigo,
        Nombre: payload.fabricante.nombre,
        Status: payload.fabricante.status,
      },
    });

    await tx.categorias.upsert({
      where: { Codigo: payload.categoria.codigo },
      update: {
        Nombre: payload.categoria.nombre,
        Status: payload.categoria.status,
      },
      create: {
        Codigo: payload.categoria.codigo,
        Nombre: payload.categoria.nombre,
        Status: payload.categoria.status,
      },
    });

    await tx.impuestos.upsert({
      where: { Codigo: payload.impuesto.codigo },
      update: {
        Nombre: payload.impuesto.nombre,
        PorcentajeImpuesto: payload.impuesto.porcentajeImpuesto,
        Status: payload.impuesto.status,
      },
      create: {
        Codigo: payload.impuesto.codigo,
        Nombre: payload.impuesto.nombre,
        PorcentajeImpuesto: payload.impuesto.porcentajeImpuesto,
        Status: payload.impuesto.status,
      },
    });
  }

  private async getSiblingValues(referencia: string, codigoMarca: string, codigoBarra: string) {
    const siblings = await this.prisma.inventario.findMany({
      where: {
        Referencia: referencia,
        CodigoMarca: codigoMarca,
        CodigoBarra: { not: codigoBarra },
      },
      select: {
        PrecioDetal: true,
        PrecioMayor: true,
        PrecioAfiliado: true,
        Promocion: true,
        PrecioPromocion: true,
        FechaInicial: true,
        FechaFinal: true,
        CostoInicial: true,
        CostoPromedio: true,
        UltimoCosto: true,
      },
    });

    return this.reduceSiblingValues(siblings);
  }

  private async ensureUniqueBarcode(
    client: PrismaService | TransactionClient,
    codigoBarra: string,
    currentCodigoBarra?: string,
  ) {
    const normalizedCodigoBarra = this.normalizeBarcode(codigoBarra);
    const duplicate = await client.inventario.findFirst({
      where: {
        CodigoBarra: currentCodigoBarra
          ? {
              equals: normalizedCodigoBarra,
              not: this.normalizeBarcode(currentCodigoBarra),
            }
          : normalizedCodigoBarra,
      },
      select: {
        CodigoBarra: true,
      },
    });

    if (duplicate) {
      throw new ConflictException(DUPLICATE_BARCODE_MESSAGE);
    }
  }

  private async ensureUniqueReferencePerBrand(
    client: PrismaService | TransactionClient,
    referencia: string,
    codigoMarca: string,
    currentCodigoBarra?: string,
  ) {
    const duplicate = await client.inventario.findFirst({
      where: {
        Referencia: referencia,
        CodigoMarca: codigoMarca,
        ...(currentCodigoBarra
          ? {
              CodigoBarra: {
                not: this.normalizeBarcode(currentCodigoBarra),
              },
            }
          : {}),
      },
      select: {
        CodigoBarra: true,
      },
    });

    if (duplicate) {
      throw new ConflictException("No puede existir otra mercancia con la misma referencia para esa marca");
    }
  }

  private reduceSiblingValues(siblings: InventorySibling[]) {
    if (siblings.length === 0) {
      return {
        PrecioDetal: null,
        PrecioMayor: null,
        PrecioAfiliado: null,
        Promocion: null,
        PrecioPromocion: null,
        FechaInicial: null,
        FechaFinal: null,
        CostoInicial: null,
        CostoPromedio: null,
        UltimoCosto: null,
      };
    }

    const maxDecimal = (values: Prisma.Decimal[]) => {
      return values.reduce((highest, current) => {
        if (!highest) {
          return current;
        }

        return current.greaterThan(highest) ? current : highest;
      }, null as Prisma.Decimal | null);
    };

    const maxDate = (values: Date[]) => {
      return values.reduce((highest, current) => {
        if (!highest) {
          return current;
        }

        return current > highest ? current : highest;
      }, null as Date | null);
    };

    return {
      PrecioDetal: maxDecimal(siblings.map((item) => item.PrecioDetal)),
      PrecioMayor: maxDecimal(siblings.map((item) => item.PrecioMayor)),
      PrecioAfiliado: maxDecimal(siblings.map((item) => item.PrecioAfiliado)),
      Promocion: siblings.some((item) => item.Promocion),
      PrecioPromocion: maxDecimal(siblings.map((item) => item.PrecioPromocion)),
      FechaInicial: maxDate(siblings.map((item) => item.FechaInicial)),
      FechaFinal: maxDate(siblings.map((item) => item.FechaFinal)),
      CostoInicial: maxDecimal(siblings.map((item) => item.CostoInicial)),
      CostoPromedio: maxDecimal(siblings.map((item) => item.CostoPromedio)),
      UltimoCosto: maxDecimal(siblings.map((item) => item.UltimoCosto)),
    };
  }

  private resolvePromotionFields(payload: {
    activa: boolean;
    detalle: string;
    porcentajeDescuento?: string;
    precioPromocion?: string;
    fechaInicial?: string;
    fechaFinal?: string;
    requireDatesWhenActive: boolean;
  }) {
    if (!payload.activa) {
      return {
        activa: false,
        precioPromocion: "0",
        fechaInicial: DEFAULT_DATE.toISOString(),
        fechaFinal: DEFAULT_DATE.toISOString(),
      };
    }

    const fechaInicial = payload.fechaInicial ?? DEFAULT_DATE.toISOString();
    const fechaFinal = payload.fechaFinal ?? DEFAULT_DATE.toISOString();

    if (payload.requireDatesWhenActive && (this.isDefaultDateString(fechaInicial) || this.isDefaultDateString(fechaFinal))) {
      throw new BadRequestException("La promocion activa requiere fechas desde y hasta");
    }

    const precioPromocion =
      payload.precioPromocion ??
      (payload.porcentajeDescuento
        ? this.calculatePromotionPrice(payload.detalle, payload.porcentajeDescuento)
        : undefined);

    if (!precioPromocion) {
      throw new BadRequestException("La promocion activa requiere precio o porcentaje de descuento");
    }

    return {
      activa: true,
      precioPromocion,
      fechaInicial,
      fechaFinal,
    };
  }

  private async resolveNamedCatalogInput(args: {
    label: string;
    input: CatalogInput;
    maxCodeLength: number;
    fallbackName?: string;
    findByCode: (code: string) => Promise<NamedCatalogRecord | null>;
    findByName: (name: string) => Promise<NamedCatalogRecord | null>;
    codeExists: (code: string) => Promise<boolean>;
  }): Promise<ResolvedNamedCatalog> {
    const explicitCode = this.normalizeOptionalUpper(args.input.codigo);
    const explicitName = this.normalizeOptionalName(args.input.nombre) ?? args.fallbackName ?? null;
    const codeCandidate = explicitCode ?? this.buildCodeCandidate(explicitName ?? "");

    if (explicitCode) {
      const record = await args.findByCode(explicitCode);
      if (record) {
        return {
          codigo: record.Codigo,
          nombre: this.normalizeOptionalName(record.Nombre) ?? explicitName ?? record.Codigo,
          status: record.Status ?? 1,
        };
      }
    }

    if (explicitName) {
      const codeMatch = codeCandidate ? await args.findByCode(codeCandidate) : null;
      if (codeMatch) {
        return {
          codigo: codeMatch.Codigo,
          nombre: this.normalizeOptionalName(codeMatch.Nombre) ?? explicitName,
          status: codeMatch.Status ?? 1,
        };
      }

      const nameMatch = await args.findByName(explicitName);
      if (nameMatch) {
        return {
          codigo: nameMatch.Codigo,
          nombre: this.normalizeOptionalName(nameMatch.Nombre) ?? explicitName,
          status: nameMatch.Status ?? 1,
        };
      }
    }

    if (!explicitName && !explicitCode) {
      throw new BadRequestException(`Debe indicar ${args.label}`);
    }

    const generatedCode = explicitCode
      ? explicitCode
      : await this.generateUniqueCode(
          explicitName ?? args.fallbackName ?? args.label,
          args.maxCodeLength,
          args.codeExists,
        );

    return {
      codigo: generatedCode,
      nombre: explicitName ?? args.fallbackName ?? generatedCode,
      status: 1,
    };
  }

  private async resolveTaxInput(input: TaxInput) {
    await this.ensureImpuestosStatusColumn();

    const explicitCode = input.codigo;
    const explicitName = this.normalizeOptionalName(input.nombre);
    const explicitPercentage = this.normalizeOptionalNumericString(input.porcentajeImpuesto);

    if (typeof explicitCode === "number") {
      const record = await this.prisma.impuestos.findUnique({ where: { Codigo: explicitCode } });
      if (record) {
        return {
          codigo: record.Codigo,
          nombre: this.normalizeOptionalName(record.Nombre),
          porcentajeImpuesto: record.PorcentajeImpuesto ? record.PorcentajeImpuesto.toString() : null,
          status: record.Status ?? DEFAULT_STATUS,
          existente: true,
        };
      }
    }

    if (explicitName) {
      const record = await this.prisma.impuestos.findFirst({
        where: { Nombre: { equals: explicitName, mode: "insensitive" } },
      });

      if (record) {
        return {
          codigo: record.Codigo,
          nombre: this.normalizeOptionalName(record.Nombre),
          porcentajeImpuesto: record.PorcentajeImpuesto ? record.PorcentajeImpuesto.toString() : null,
          status: record.Status ?? DEFAULT_STATUS,
          existente: true,
        };
      }
    }

    if (!explicitName && !explicitPercentage && typeof explicitCode !== "number") {
      const defaultTax = await this.findActiveTaxRecord();
      if (defaultTax) {
        return {
          codigo: defaultTax.Codigo,
          nombre: this.normalizeOptionalName(defaultTax.Nombre),
          porcentajeImpuesto: defaultTax.PorcentajeImpuesto ? defaultTax.PorcentajeImpuesto.toString() : null,
          status: defaultTax.Status ?? DEFAULT_STATUS,
          existente: true,
        };
      }
    }

    if (!explicitName) {
      throw new BadRequestException("Debe indicar el nombre del impuesto");
    }

    if (!explicitPercentage) {
      throw new BadRequestException("Debe indicar el porcentaje del impuesto");
    }

    const aggregate = await this.prisma.impuestos.aggregate({
      _max: {
        Codigo: true,
      },
    });

    return {
      codigo: explicitCode ?? ((aggregate._max.Codigo ?? 0) + 1),
      nombre: explicitName,
      porcentajeImpuesto: explicitPercentage,
      status: DEFAULT_STATUS,
      existente: false,
    };
  }

  private normalizeTaxStatus(status: number | null | undefined, fallback = DEFAULT_STATUS) {
    if (status === 0) {
      return 0;
    }

    if (status === 1) {
      return 1;
    }

    return fallback === 0 ? 0 : 1;
  }

  private async ensureImpuestosStatusColumn() {
    if (!this.ensureImpuestosStatusColumnPromise) {
      this.ensureImpuestosStatusColumnPromise = (async () => {
        const columns = await this.prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'dbo' AND table_name = 'IMPUESTOS' AND column_name = 'Status'`,
        );

        if (!columns.length) {
          await this.prisma.$executeRawUnsafe(`ALTER TABLE dbo."IMPUESTOS" ADD COLUMN "Status" INTEGER`);
        }

        const activeRows = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count FROM dbo."IMPUESTOS" WHERE COALESCE("Status", 0) = 1`,
        );

        if ((activeRows[0]?.count ?? 0) === 0) {
          const preferredRows = await this.prisma.$queryRawUnsafe<Array<{ Codigo: number }>>(
            `SELECT "Codigo" FROM dbo."IMPUESTOS" ORDER BY CASE WHEN "Codigo" = ${DEFAULT_TAX_CODE} THEN 0 ELSE 1 END, "Codigo" ASC LIMIT 1`,
          );
          const preferredCode = preferredRows[0]?.Codigo;

          if (typeof preferredCode === "number") {
            await this.prisma.$executeRawUnsafe(
              `UPDATE dbo."IMPUESTOS" SET "Status" = CASE WHEN "Codigo" = ${preferredCode} THEN 1 ELSE 0 END`,
            );
          }
          return;
        }

        await this.prisma.$executeRawUnsafe(`UPDATE dbo."IMPUESTOS" SET "Status" = 0 WHERE "Status" IS NULL`);
      })().catch((error) => {
        this.ensureImpuestosStatusColumnPromise = null;
        throw error;
      });
    }

    await this.ensureImpuestosStatusColumnPromise;
  }

  private pickPreferredTaxRecord(records: TaxRecord[]) {
    return (
      records.find((record) => (record.Status ?? 0) === 1) ??
      records.find((record) => record.Codigo === DEFAULT_TAX_CODE) ??
      records[0] ??
      null
    );
  }

  private async findActiveTaxRecord() {
    await this.ensureImpuestosStatusColumn();

    const activeTax = await this.prisma.impuestos.findFirst({
      where: { Status: 1 },
      orderBy: { Codigo: "asc" },
    });

    if (activeTax) {
      return activeTax;
    }

    const fallbackTax = await this.prisma.impuestos.findUnique({
      where: { Codigo: DEFAULT_TAX_CODE },
    });

    if (fallbackTax) {
      return fallbackTax;
    }

    return this.prisma.impuestos.findFirst({
      orderBy: { Codigo: "asc" },
    });
  }

  private async deactivateOtherTaxes(activeCode: number) {
    await this.prisma.impuestos.updateMany({
      where: {
        Codigo: { not: activeCode },
        Status: { not: 0 },
      },
      data: {
        Status: 0,
      },
    });
  }

  private async activateFallbackTax(excludedCode?: number) {
    await this.ensureImpuestosStatusColumn();

    const fallback = await this.prisma.impuestos.findFirst({
      where: excludedCode == null ? undefined : { Codigo: { not: excludedCode } },
      orderBy: [
        {
          Codigo: "asc",
        },
      ],
    });

    if (!fallback) {
      return;
    }

    await this.prisma.impuestos.update({
      where: { Codigo: fallback.Codigo },
      data: { Status: 1 },
    });
    await this.deactivateOtherTaxes(fallback.Codigo);
  }

  private async fetchCatalogRecords(payload: {
    codigoMarca?: string;
    talla?: string;
    codigoColor?: string;
    fabricante?: string;
    categoria?: string;
    tipoImpuesto?: number;
  }) {
    if (typeof payload.tipoImpuesto === "number") {
      await this.ensureImpuestosStatusColumn();
    }

    return Promise.all([
      payload.codigoMarca ? this.prisma.marcas.findUnique({ where: { Codigo: payload.codigoMarca } }) : Promise.resolve(null),
      payload.talla ? this.prisma.tallas.findUnique({ where: { Codigo: payload.talla } }) : Promise.resolve(null),
      payload.codigoColor ? this.prisma.colores.findUnique({ where: { Codigo: payload.codigoColor } }) : Promise.resolve(null),
      payload.fabricante
        ? this.prisma.fabricantes.findUnique({ where: { Codigo: payload.fabricante } })
        : Promise.resolve(null),
      payload.categoria
        ? this.prisma.categorias.findUnique({ where: { Codigo: payload.categoria } })
        : Promise.resolve(null),
      typeof payload.tipoImpuesto === "number"
        ? this.prisma.impuestos.findUnique({ where: { Codigo: payload.tipoImpuesto } })
        : Promise.resolve(null),
    ] as const);
  }

  private buildNamedCatalogAutofill(
    codigo: string,
    providedName: string | undefined,
    record: NamedCatalogRecord | null,
    defaultName?: string,
  ): NamedCatalogAutofill {
    if (record) {
      return {
        codigo: record.Codigo,
        nombre:
          this.normalizeOptionalName(record.Nombre) ??
          this.normalizeOptionalName(providedName) ??
          defaultName ??
          record.Codigo,
        status: record.Status ?? 1,
        existente: true,
      };
    }

    return {
      codigo,
      nombre: this.normalizeOptionalName(providedName) ?? defaultName ?? null,
      status: 1,
      existente: false,
    };
  }

  private buildTallaAutofill(codigo: string, existingCode: string | null): TallaAutofill {
    return {
      codigo: existingCode ?? codigo,
      existente: Boolean(existingCode),
    };
  }

  private buildTaxAutofill(
    codigo: number,
    providedName: string | undefined,
    providedPercentage: string | undefined,
    record: TaxRecord | null,
  ): TaxAutofill {
    if (record) {
      return {
        codigo: record.Codigo,
        nombre: this.normalizeOptionalName(record.Nombre),
        porcentajeImpuesto: record.PorcentajeImpuesto ? record.PorcentajeImpuesto.toString() : null,
        existente: true,
      };
    }

    return {
      codigo,
      nombre: this.normalizeOptionalName(providedName),
      porcentajeImpuesto: this.normalizeOptionalNumericString(providedPercentage),
      existente: false,
    };
  }

  private normalizeCatalogInput(...values: unknown[]): CatalogInput {
    for (const value of values) {
      if (!value) {
        continue;
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) {
          return {
            nombre: trimmed,
          };
        }
        continue;
      }

      const record = this.asRecord(value);
      if (!record) {
        continue;
      }

      const codigo = this.pickUpperString(record.codigo, record.code, record.valor);
      const nombre = this.pickString(record.nombre, record.name, record.descripcion, record.label);
      if (codigo || nombre) {
        return {
          codigo,
          nombre,
        };
      }
    }

    return {};
  }

  private normalizeTallaInput(...values: unknown[]) {
    for (const value of values) {
      if (!value) {
        continue;
      }

      if (typeof value === "string") {
        const codigo = this.normalizeOptionalUpper(value);
        if (codigo) {
          return { codigo };
        }
      }

      const record = this.asRecord(value);
      if (!record) {
        continue;
      }

      const codigo = this.pickUpperString(record.codigo, record.code, record.valor, record.nombre, record.label);
      if (codigo) {
        return { codigo };
      }
    }

    return {};
  }

  private normalizeTaxInput(...values: unknown[]): TaxInput {
    for (const value of values) {
      if (!value) {
        continue;
      }

      if (typeof value === "number") {
        return { codigo: value };
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
          continue;
        }

        if (/^\d+$/.test(trimmed)) {
          return { codigo: Number.parseInt(trimmed, 10) };
        }

        return { nombre: trimmed };
      }

      const record = this.asRecord(value);
      if (!record) {
        continue;
      }

      const codigoValue = record.codigo ?? record.code;
      const codigo =
        typeof codigoValue === "number"
          ? codigoValue
          : typeof codigoValue === "string" && /^\d+$/.test(codigoValue.trim())
            ? Number.parseInt(codigoValue.trim(), 10)
            : undefined;
      const nombre = this.pickString(record.nombre, record.name, record.descripcion);
      const porcentajeImpuesto = this.pickNumericString(
        record.porcentajeImpuesto,
        record.porcentaje,
        record.rate,
      );

      if (typeof codigo === "number" || nombre || porcentajeImpuesto) {
        return {
          codigo,
          nombre,
          porcentajeImpuesto,
        };
      }
    }

    return {};
  }

  private normalizeBrandInput(payload: { familia?: string; marca: CatalogInput }) {
    if (payload.marca.codigo || payload.marca.nombre) {
      return payload.marca;
    }

    const familia = this.normalizeOptionalName(payload.familia);
    if (!familia) {
      return {
        nombre: DEFAULT_BRAND_NAME,
      };
    }

    return {
      nombre: familia,
    };
  }

  private normalizeCategoryInput(input: CatalogInput) {
    if (input.codigo || input.nombre) {
      return input;
    }

    return {
      codigo: DEFAULT_CATEGORY_CODE,
      nombre: DEFAULT_CATEGORY_NAME,
    };
  }

  private normalizeTaxDefaults(input: TaxInput) {
    if (
      typeof input.codigo === "number" ||
      this.normalizeOptionalName(input.nombre) ||
      this.normalizeOptionalNumericString(input.porcentajeImpuesto)
    ) {
      return input;
    }

    return {
      codigo: DEFAULT_TAX_CODE,
    };
  }

  private mergeCatalogInput(input: CatalogInput, fallback: CatalogInput): CatalogInput {
    const explicitCode = this.normalizeOptionalUpper(input.codigo);
    const explicitName = this.normalizeOptionalName(input.nombre);
    const fallbackCode = this.normalizeOptionalUpper(fallback.codigo);
    const fallbackName = this.normalizeOptionalName(fallback.nombre) ?? undefined;

    if (explicitCode) {
      return {
        codigo: explicitCode,
        nombre: explicitName ?? fallbackName,
      };
    }

    if (explicitName) {
      if (this.catalogInputMatchesFallback(explicitName, fallbackCode, fallbackName)) {
        return {
          codigo: fallbackCode,
          nombre: fallbackName ?? explicitName,
        };
      }

      return {
        nombre: explicitName,
      };
    }

    return {
      codigo: fallbackCode,
      nombre: fallbackName,
    };
  }

  private mergeTaxInput(input: TaxInput, fallback: TaxInput): TaxInput {
    return {
      codigo: typeof input.codigo === "number" ? input.codigo : fallback.codigo,
      nombre: input.nombre ?? fallback.nombre,
      porcentajeImpuesto: input.porcentajeImpuesto ?? fallback.porcentajeImpuesto,
    };
  }

  private catalogInputMatchesFallback(
    explicitName: string,
    fallbackCode?: string,
    fallbackName?: string,
  ) {
    const normalizedInput = this.normalizeOptionalName(explicitName);
    const normalizedFallbackName = this.normalizeOptionalName(fallbackName);
    const normalizedFallbackCode = this.normalizeOptionalUpper(fallbackCode);

    if (!normalizedInput) {
      return false;
    }

    return normalizedInput === normalizedFallbackName || normalizedInput.toUpperCase() === normalizedFallbackCode;
  }

  private parseArticleImportRow(row: Record<string, unknown>, rowNumber: number): ArticleImportRow | null {
    const codigoBarra = this.normalizeOptionalUpper(
      this.extractImportRowValue(row, ["codigobarra", "codigo", "barra", "codbarra"]),
    );
    const referencia = this.normalizeOptionalName(
      this.extractImportRowValue(row, ["referencia", "refer", "ref"]),
    ) ?? undefined;
    const nombre = this.normalizeOptionalName(
      this.extractImportRowValue(row, ["nombre", "articulo", "descripcion", "detalle"]),
    ) ?? undefined;
    const categoria = this.normalizeOptionalName(
      this.extractImportRowValue(row, ["categoria", "categorias"]),
    ) ?? undefined;
    const marca = this.normalizeOptionalName(this.extractImportRowValue(row, ["marca", "marcas"])) ?? undefined;
    const sexo = this.normalizeOptionalName(this.extractImportRowValue(row, ["sexo", "genero", "familia"])) ?? undefined;
    const talla = this.normalizeOptionalUpper(this.extractImportRowValue(row, ["talla", "tallas"]));
    const costoInicial = this.normalizeOptionalNumericString(
      this.extractImportRowValue(row, ["costoinicial", "costo", "costodetal", "costod"]),
    ) ?? undefined;
    const costoPromedio = this.normalizeOptionalNumericString(
      this.extractImportRowValue(row, ["costopromedio", "costomayor", "promedio"]),
    ) ?? undefined;
    const ultimoCosto = this.normalizeOptionalNumericString(
      this.extractImportRowValue(row, ["ultimocosto", "costoafiliado", "afiliado"]),
    ) ?? undefined;
    const costoDolar = this.normalizeOptionalNumericString(
      this.extractImportRowValue(row, ["costodolar", "dolar", "costousd", "usd"]),
    ) ?? undefined;

    if (
      !codigoBarra &&
      !referencia &&
      !nombre &&
      !categoria &&
      !marca &&
      !sexo &&
      !talla &&
      !costoInicial &&
      !costoPromedio &&
      !ultimoCosto &&
      !costoDolar
    ) {
      return null;
    }

    return {
      codigoBarra,
      referencia,
      nombre,
      categoria,
      marca,
      sexo,
      talla: talla ?? undefined,
      costoInicial,
      costoPromedio,
      ultimoCosto,
      costoDolar,
      rowNumber,
    };
  }

  private async getArticleImportRateSnapshot(): Promise<ArticleImportRateSnapshot> {
    const [detalle, mayor] = await Promise.all([
      this.getLatestManualRateRow("TASA_CAMBIO"),
      this.getLatestManualRateRow("TASA_CAMBIO_M"),
    ]);

    const rateBsPerUsd = this.toFiniteImportNumber(detalle?.Valor);
    const rateMayor = this.toFiniteImportNumber(mayor?.Valor);

    if (rateBsPerUsd <= 0) {
      throw new BadRequestException("Debes registrar la tasa manual de cambio antes de importar articulos.");
    }

    if (rateMayor <= 0) {
      throw new BadRequestException("Debes registrar la tasa manual del mayor antes de importar articulos.");
    }

    return {
      rateBsPerUsd,
      rateMayor,
    };
  }

  private async getLatestManualRateRow(tableName: "TASA_CAMBIO" | "TASA_CAMBIO_M") {
    const rows = await this.prisma.$queryRawUnsafe<ManualRateRow[]>(
      `
        SELECT "ID", "Fecha", "Valor"
        FROM dbo."${tableName}"
        ORDER BY "ID" DESC
        LIMIT 1
      `,
    );

    return rows[0] ?? null;
  }

  private async persistArticleImportRows(rows: ArticleImportRow[], rates: ArticleImportRateSnapshot) {
    let creados = 0;
    let actualizados = 0;
    let omitidos = 0;
    const detalleErrores: string[] = [];
    const codigosSincronizados = new Set<string>();
    const firstRowByBarcode = new Map<string, number>();
    const duplicateRowsByBarcode = new Map<string, number[]>();

    for (const row of rows) {
      const normalizedBarcode = this.normalizeOptionalUpper(row.codigoBarra);
      if (!normalizedBarcode) {
        continue;
      }

      const firstRow = firstRowByBarcode.get(normalizedBarcode);
      if (typeof firstRow === "number") {
        if (!duplicateRowsByBarcode.has(normalizedBarcode)) {
          duplicateRowsByBarcode.set(normalizedBarcode, [firstRow]);
        }

        duplicateRowsByBarcode.get(normalizedBarcode)?.push(row.rowNumber);
        continue;
      }

      firstRowByBarcode.set(normalizedBarcode, row.rowNumber);
    }

    const blockedBarcodes = new Set<string>();
    for (const [codigoBarra, duplicateRows] of duplicateRowsByBarcode.entries()) {
      blockedBarcodes.add(codigoBarra);
      detalleErrores.push(
        `Codigo de barra ${codigoBarra} repetido en filas ${duplicateRows.join(", ")}. Se omitieron todas sus filas.`,
      );
    }

    for (const row of rows) {
      const normalizedBarcode = this.normalizeOptionalUpper(row.codigoBarra);
      if (normalizedBarcode && blockedBarcodes.has(normalizedBarcode)) {
        omitidos += 1;
        continue;
      }

      try {
        const outcome = await this.createArticleImportRow(row, rates);

        if (outcome.result === "created") {
          creados += 1;
          if (outcome.codigo) {
            codigosSincronizados.add(outcome.codigo);
          }
          continue;
        }

        if (outcome.result === "updated") {
          actualizados += 1;
          if (outcome.codigo) {
            codigosSincronizados.add(outcome.codigo);
          }
          continue;
        }

        omitidos += 1;
      } catch (error) {
        detalleErrores.push(`Fila ${row.rowNumber}: ${this.extractImportErrorMessage(error)}`);
      }
    }

    return {
      procesados: rows.length,
      creados,
      actualizados,
      omitidos,
      errores: detalleErrores.length,
      detalleErrores: detalleErrores.slice(0, 10),
      codigosSincronizados: Array.from(codigosSincronizados),
    };
  }

  private async createArticleImportRow(row: ArticleImportRow, rates: ArticleImportRateSnapshot) {
    const importPayload = this.buildArticleImportPayload(row, rates);
    const normalized = this.normalizeMerchandisePayload(importPayload);
    const codigoBarra = this.requireString(normalized.codigoBarra, "Debe indicar el codigo de barra");

    const existing = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: codigoBarra },
      include: inventoryInclude,
    });

    if (existing) {
      const merged = this.mergeWithExisting(normalized, existing);
      const resolvedCatalogs = await this.resolveCatalogs(merged);

      const updated = await this.prisma.$transaction(async (tx) => {
        await this.ensureCatalogs(tx, resolvedCatalogs);
        await this.ensureUniqueBarcode(tx, merged.codigoBarra, codigoBarra);
        await this.ensureUniqueReferencePerBrand(
          tx,
          merged.referencia,
          resolvedCatalogs.marca.codigo,
          codigoBarra,
        );

        const updatedItem = await tx.inventario.update({
          where: { CodigoBarra: codigoBarra },
          data: {
            CodigoBarra: merged.codigoBarra,
            CodigoBarraAnt: merged.codigoBarraAnt,
            Referencia: merged.referencia,
            CodigoMarca: resolvedCatalogs.marca.codigo,
            Nombre: merged.nombre,
            Talla: resolvedCatalogs.talla.codigo,
            CodigoColor: resolvedCatalogs.color.codigo,
            Fabricante: resolvedCatalogs.fabricante.codigo,
            Categoria: resolvedCatalogs.categoria.codigo,
            Nota: merged.nota,
            TipoImpuesto: resolvedCatalogs.impuesto.codigo,
            PrecioDetal: merged.precioDetal,
            PrecioMayor: merged.precioMayor,
            PrecioAfiliado: merged.precioAfiliado,
            PrecioPromocion: merged.precioPromocion,
            Promocion: merged.promocionActiva,
            FechaInicial: new Date(merged.fechaInicial),
            FechaFinal: new Date(merged.fechaFinal),
            CostoInicial: merged.costoInicial,
            CostoPromedio: merged.costoPromedio,
            UltimoCosto: merged.ultimoCosto,
            CostoDolar: merged.costoDolar,
            ExistenciaInicial: merged.existenciaInicial,
            Existencia: merged.existencia,
            PuntoReorden: merged.puntoRecorte,
            UltimaActualizacion: new Date(),
            Tipo: merged.tipo,
            Status: merged.status,
            Serializado: merged.serializado,
          },
          include: inventoryInclude,
        });

        if (updatedItem.CodigoBarra !== codigoBarra) {
          await this.mirrorSyncService.enqueueInventoryDeleteTx(tx, codigoBarra);
        }

        await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, [updatedItem.CodigoBarra]);
        return updatedItem;
      });

      return {
        result: "updated" as const,
        codigo: updated.CodigoBarra,
      };
    }

    const referencia = this.requireString(normalized.referencia, "Debe indicar la referencia del articulo");
    const familia = this.requireString(normalized.familia, "Debe indicar la familia del articulo");
    const marcaSeed = normalized.marca.codigo ?? normalized.marca.nombre ?? familia;
    const siblingValues = await this.getSiblingValues(
      referencia,
      this.buildCodeCandidate(marcaSeed),
      codigoBarra,
    );

    const completePayload = this.completeCreatePayload(normalized, siblingValues);
    const resolvedCatalogs = await this.resolveCatalogs(completePayload);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.ensureCatalogs(tx, resolvedCatalogs);
      await this.ensureUniqueBarcode(tx, completePayload.codigoBarra);
      await this.ensureUniqueReferencePerBrand(tx, completePayload.referencia, resolvedCatalogs.marca.codigo);

      const now = new Date();
      const createdItem = await tx.inventario.create({
        data: {
          CodigoBarra: completePayload.codigoBarra,
          CodigoBarraAnt: completePayload.codigoBarraAnt,
          Referencia: completePayload.referencia,
          CodigoMarca: resolvedCatalogs.marca.codigo,
          Nombre: completePayload.nombre,
          Talla: resolvedCatalogs.talla.codigo,
          CodigoColor: resolvedCatalogs.color.codigo,
          Fabricante: resolvedCatalogs.fabricante.codigo,
          Categoria: resolvedCatalogs.categoria.codigo,
          Nota: completePayload.nota,
          TipoImpuesto: resolvedCatalogs.impuesto.codigo,
          PrecioDetal: completePayload.precioDetal,
          PrecioMayor: completePayload.precioMayor,
          PrecioAfiliado: completePayload.precioAfiliado,
          PrecioPromocion: completePayload.precioPromocion,
          Promocion: completePayload.promocionActiva,
          FechaInicial: new Date(completePayload.fechaInicial),
          FechaFinal: new Date(completePayload.fechaFinal),
          CostoInicial: completePayload.costoInicial,
          CostoPromedio: completePayload.costoPromedio,
          UltimoCosto: completePayload.ultimoCosto,
          CostoDolar: completePayload.costoDolar,
          ExistenciaInicial: completePayload.existenciaInicial,
          Existencia: completePayload.existencia,
          PuntoReorden: completePayload.puntoRecorte,
          FechaPrimerMovimiento: now,
          UltimaActualizacion: now,
          Tipo: completePayload.tipo,
          Status: completePayload.status,
          Serializado: completePayload.serializado,
        },
        include: inventoryInclude,
      });

      await this.mirrorSyncService.enqueueInventorySnapshotsTx(tx, [createdItem.CodigoBarra]);
      return createdItem;
    });

    return {
      result: "created" as const,
      codigo: created.CodigoBarra,
    };
  }

  private buildArticleImportPayload(row: ArticleImportRow, rates: ArticleImportRateSnapshot): CreateMerchandiseDto {
    const codigoBarra = this.requireString(row.codigoBarra, "Debe indicar el codigo de barra");
    const referencia = this.requireString(row.referencia, "Debe indicar la referencia del articulo");
    const nombre = this.requireString(row.nombre, "Debe indicar el nombre del articulo");
    const talla = this.requireString(row.talla, "Debe indicar la talla del articulo");
    const sexo = this.normalizeOptionalName(row.sexo) ?? DEFAULT_CATEGORY_NAME;
    const marca = this.normalizeOptionalName(row.marca) ?? DEFAULT_BRAND_NAME;
    const categoria = this.normalizeOptionalName(row.categoria) ?? DEFAULT_CATEGORY_NAME;
    const costoInicial = row.costoInicial ?? "0";
    const costoPromedio = row.costoPromedio?.trim() ? row.costoPromedio : "0";
    const ultimoCosto = row.ultimoCosto ?? "0";
    const costoDolar = row.costoDolar ?? costoInicial;

    return {
      codigoBarra,
      referencia,
      serializado: 0,
      general: {
        categoria,
        fabricante: marca,
        marca,
        nombre,
        puntoRecorte: "0",
        familia: sexo,
        nota: "",
        tipo: "articulo",
        status: "activo",
      },
      tallasColores: {
        talla,
        colores: "SIN COLOR",
      },
      precios: {
        detal: this.calculateArticleImportPrice(costoInicial, rates.rateBsPerUsd),
        mayor: this.calculateArticleImportPrice(costoPromedio, rates.rateMayor),
        afiliado: this.calculateArticleImportPrice(ultimoCosto, rates.rateBsPerUsd),
        promocion: {
          activa: false,
        },
      },
      costoInicial,
      costoPromedio,
      ultimoCosto,
      costoDolar,
    } as CreateMerchandiseDto;
  }

  private calculateArticleImportPrice(costValue: string | undefined, rate: number) {
    const cost = this.toFiniteImportNumber(costValue);
    if (cost <= 0 || rate <= 0) {
      return "0.00";
    }

    return (Math.round(cost * rate * 100) / 100).toFixed(2);
  }

  private toFiniteImportNumber(value: unknown) {
    const normalized = typeof value === "string" ? this.normalizeOptionalNumericString(value) ?? value : value;
    const parsed = Number(normalized ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private resolveCatalogImportKind(catalogType: string): CatalogImportKind {
    const normalizedType = String(catalogType || "").trim().toLowerCase();

    if (
      normalizedType === "categorias" ||
      normalizedType === "marcas" ||
      normalizedType === "tallas" ||
      normalizedType === "colores" ||
      normalizedType === "fabricantes" ||
      normalizedType === "impuestos"
    ) {
      return normalizedType;
    }

    throw new BadRequestException(
      "Tipo de catalogo no soportado. Usa categorias, marcas, tallas, colores, fabricantes o impuestos.",
    );
  }

  private parseCatalogImportRow(
    row: Record<string, unknown>,
    rowNumber: number,
    catalogType: CatalogImportKind,
  ): CatalogImportRow | null {
    const config = this.getCatalogImportConfig(catalogType);
    const statusAliases = ["status", "estado", "activo", "estatus"];

    const codigo = this.normalizeOptionalUpper(this.extractImportRowValue(row, config.codeAliases));
    const nombre = config.supportsName
      ? this.normalizeOptionalName(this.extractImportRowValue(row, config.nameAliases)) ?? undefined
      : undefined;
    const status = config.supportsStatus
      ? this.parseImportStatusValue(this.extractImportRowValue(row, statusAliases), rowNumber)
      : undefined;
    const porcentajeImpuesto = catalogType === "impuestos"
      ? this.normalizeOptionalNumericString(this.extractImportRowValue(row, ["porcentaje", "porcentajeimpuesto", "iva", "impuesto"]))
        ?? undefined
      : undefined;

    if (!codigo && !nombre && status === undefined && porcentajeImpuesto === undefined) {
      return null;
    }

    return {
      codigo,
      nombre,
      status,
      porcentajeImpuesto,
      rowNumber,
    };
  }

  private extractImportRowValue(row: Record<string, unknown>, aliases: string[]) {
    const normalizedAliases = new Set(aliases.map((alias) => this.normalizeImportHeader(alias)));

    for (const [key, value] of Object.entries(row)) {
      if (normalizedAliases.has(this.normalizeImportHeader(key))) {
        return typeof value === "string" ? value : value?.toString();
      }
    }

    return undefined;
  }

  private normalizeImportHeader(value: string) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toLowerCase();
  }

  private parseImportStatusValue(value: string | undefined, rowNumber: number) {
    if (!value || !value.trim()) {
      return undefined;
    }

    const normalizedBoolean = this.pickBoolean(value);
    if (typeof normalizedBoolean === "boolean") {
      return normalizedBoolean ? 1 : 0;
    }

    if (/^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10) > 0 ? 1 : 0;
    }

    throw new BadRequestException(`Fila ${rowNumber}: el status "${value}" no es valido.`);
  }

  private async persistCatalogImportRows(catalogType: CatalogImportKind, rows: CatalogImportRow[]) {
    let creados = 0;
    let actualizados = 0;
    let omitidos = 0;
    const detalleErrores: string[] = [];
    const codigosSincronizados = new Set<string>();

    for (const row of rows) {
      try {
        const outcome = await this.upsertCatalogImportRow(catalogType, row);

        if (outcome.result === "created") {
          creados += 1;
          if (outcome.codigo) {
            codigosSincronizados.add(outcome.codigo);
          }
          continue;
        }

        if (outcome.result === "updated") {
          actualizados += 1;
          if (outcome.codigo) {
            codigosSincronizados.add(outcome.codigo);
          }
          continue;
        }

        omitidos += 1;
      } catch (error) {
        detalleErrores.push(`Fila ${row.rowNumber}: ${this.extractImportErrorMessage(error)}`);
      }
    }

    return {
      procesados: rows.length,
      creados,
      actualizados,
      omitidos,
      errores: detalleErrores.length,
      detalleErrores: detalleErrores.slice(0, 10),
      codigosSincronizados: Array.from(codigosSincronizados),
    };
  }

  private async upsertCatalogImportRow(catalogType: CatalogImportKind, row: CatalogImportRow) {
    const config = this.getCatalogImportConfig(catalogType);

    if (catalogType === "tallas") {
      const codigo = this.normalizeOptionalUpper(row.codigo ?? row.nombre);

      if (!codigo) {
        return { result: "skipped" as const };
      }

      this.assertCatalogCodeLength(config.displayName, codigo, config.maxCodeLength);

      const existing = await this.prisma.tallas.findUnique({ where: { Codigo: codigo } });
      if (existing) {
        return { result: "skipped" as const, codigo: existing.Codigo };
      }

      await this.prisma.tallas.create({
        data: {
          Codigo: codigo,
        },
      });
      return { result: "created" as const, codigo };
    }

    if (catalogType === "impuestos") {
      await this.ensureImpuestosStatusColumn();

      const nombre = this.normalizeOptionalName(row.nombre);
      if (!row.codigo && !nombre && row.porcentajeImpuesto === undefined) {
        return { result: "skipped" as const };
      }

      if (!nombre) {
        throw new BadRequestException(`Fila ${row.rowNumber}: debe indicar el nombre del impuesto.`);
      }

      const explicitCode = this.parseTaxCatalogCode(row.codigo);
      const porcentajeImpuesto = this.parseTaxCatalogPercentage(row.porcentajeImpuesto);
      const codigo =
        explicitCode ??
        ((await this.prisma.impuestos.aggregate({ _max: { Codigo: true } }))._max.Codigo ?? 0) + 1;

      const existingByCode = await this.prisma.impuestos.findUnique({ where: { Codigo: codigo } });
      const status = this.normalizeTaxStatus(row.status, existingByCode?.Status ?? DEFAULT_STATUS);
      const existingByName = await this.prisma.impuestos.findFirst({
        where: { Nombre: { equals: nombre, mode: "insensitive" } },
      });

      if (existingByName && existingByName.Codigo !== codigo) {
        return { result: "skipped" as const, codigo: String(existingByName.Codigo) };
      }

      const saved = existingByCode
        ? await this.prisma.impuestos.update({
            where: { Codigo: codigo },
            data: {
              Nombre: nombre,
              PorcentajeImpuesto: porcentajeImpuesto,
              Status: status,
            },
          })
        : await this.prisma.impuestos.create({
            data: {
              Codigo: codigo,
              Nombre: nombre,
              PorcentajeImpuesto: porcentajeImpuesto,
              Status: status,
            },
          });

      if (status === 1) {
        await this.deactivateOtherTaxes(saved.Codigo);
      }

      return {
        result: existingByCode ? ("updated" as const) : ("created" as const),
        codigo: String(saved.Codigo),
      };
    }

    if (!row.codigo && !row.nombre) {
      return { result: "skipped" as const };
    }

    const status = row.status ?? DEFAULT_STATUS;
    const defaultName = row.nombre ?? row.codigo ?? config.defaultName;

    return this.upsertNamedCatalogImportRow(catalogType, row, {
      status,
      defaultName,
      displayName: config.displayName,
      maxCodeLength: config.maxCodeLength,
      maxNameLength: config.maxNameLength,
    });
  }

  private getCatalogImportConfig(catalogType: CatalogImportKind) {
    switch (catalogType) {
      case "categorias":
        return {
          displayName: "categoria",
          defaultName: "CATEGORIA",
          maxCodeLength: 6,
          maxNameLength: 60,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "codigocategoria", "codcategoria", "id"],
          nameAliases: ["nombre", "descripcion", "detalle", "categoria", "categorias"],
        };
      case "marcas":
        return {
          displayName: "marca",
          defaultName: "MARCA",
          maxCodeLength: 3,
          maxNameLength: 20,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "codigomarca", "codmarca", "id"],
          nameAliases: ["nombre", "descripcion", "detalle", "marca", "marcas"],
        };
      case "tallas":
        return {
          displayName: "talla",
          defaultName: "TALLA",
          maxCodeLength: 6,
          maxNameLength: 0,
          supportsName: false,
          supportsStatus: false,
          codeAliases: ["codigo", "cod", "codigotalla", "codtalla", "talla", "tallas", "nombre", "descripcion", "detalle", "id"],
          nameAliases: [] as string[],
        };
      case "colores":
        return {
          displayName: "color",
          defaultName: "COLOR",
          maxCodeLength: 3,
          maxNameLength: 30,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "codigocolor", "codcolor", "id"],
          nameAliases: ["nombre", "descripcion", "detalle", "color", "colores"],
        };
      case "fabricantes":
        return {
          displayName: "fabricante",
          defaultName: "FABRICANTE",
          maxCodeLength: 12,
          maxNameLength: 50,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "codigofabricante", "codfabricante", "id"],
          nameAliases: ["nombre", "descripcion", "detalle", "fabricante", "fabricantes"],
        };
      case "impuestos":
        return {
          displayName: "impuesto",
          defaultName: "IVA",
          maxCodeLength: 6,
          maxNameLength: 60,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "codigoimpuesto", "codimpuesto", "id"],
          nameAliases: ["nombre", "descripcion", "detalle", "impuesto", "impuestos", "iva"],
        };
      default:
        return {
          displayName: "catalogo",
          defaultName: "CATALOGO",
          maxCodeLength: 6,
          maxNameLength: 60,
          supportsName: true,
          supportsStatus: true,
          codeAliases: ["codigo", "cod", "id"],
          nameAliases: ["nombre", "descripcion", "detalle"],
        };
    }
  }

  private async upsertNamedCatalogImportRow(
    catalogType: Exclude<CatalogImportKind, "tallas">,
    row: CatalogImportRow,
    options: {
      displayName: string;
      status: number;
      defaultName: string;
      maxCodeLength: number;
      maxNameLength: number;
    },
  ) {
    const { displayName, status, defaultName, maxCodeLength, maxNameLength } = options;

    if (row.codigo) {
      this.assertCatalogCodeLength(displayName, row.codigo, maxCodeLength);
    }

    if (row.nombre) {
      this.assertCatalogNameLength(displayName, row.nombre, maxNameLength);
    }

    const findByCode = async (codigo: string) => {
      switch (catalogType) {
        case "categorias":
          return this.prisma.categorias.findUnique({ where: { Codigo: codigo } });
        case "marcas":
          return this.prisma.marcas.findUnique({ where: { Codigo: codigo } });
        case "colores":
          return this.prisma.colores.findUnique({ where: { Codigo: codigo } });
        case "fabricantes":
          return this.prisma.fabricantes.findUnique({ where: { Codigo: codigo } });
      }
    };

    const findByName = async (nombre: string) => {
      switch (catalogType) {
        case "categorias":
          return this.prisma.categorias.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          });
        case "marcas":
          return this.prisma.marcas.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          });
        case "colores":
          return this.prisma.colores.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          });
        case "fabricantes":
          return this.prisma.fabricantes.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          });
      }
    };

    const updateRecord = async (codigo: string, data: { Nombre: string; Status: number }) => {
      switch (catalogType) {
        case "categorias":
          await this.prisma.categorias.update({ where: { Codigo: codigo }, data });
          return;
        case "marcas":
          await this.prisma.marcas.update({ where: { Codigo: codigo }, data });
          return;
        case "colores":
          await this.prisma.colores.update({ where: { Codigo: codigo }, data });
          return;
        case "fabricantes":
          await this.prisma.fabricantes.update({ where: { Codigo: codigo }, data });
          return;
      }
    };

    const createRecord = async (data: { Codigo: string; Nombre: string; Status: number }) => {
      switch (catalogType) {
        case "categorias":
          await this.prisma.categorias.create({ data });
          return;
        case "marcas":
          await this.prisma.marcas.create({ data });
          return;
        case "colores":
          await this.prisma.colores.create({ data });
          return;
        case "fabricantes":
          await this.prisma.fabricantes.create({ data });
          return;
      }
    };

    const existing = row.codigo ? await findByCode(row.codigo) : row.nombre ? await findByName(row.nombre) : null;

    if (existing) {
      await updateRecord(existing.Codigo, {
        Nombre: row.nombre ?? existing.Nombre ?? existing.Codigo,
        Status: status,
      });
      return { result: "updated" as const, codigo: existing.Codigo };
    }

    const codigo =
      row.codigo ??
      (await this.generateUniqueCode(defaultName, maxCodeLength, async (candidate) => {
        const match = await findByCode(candidate);
        return Boolean(match);
      }));

    await createRecord({
      Codigo: codigo,
      Nombre: row.nombre ?? codigo,
      Status: status,
    });
    return { result: "created" as const, codigo };
  }

  private async namedCatalogCodeExists(
    catalogType: Exclude<CatalogImportKind, "tallas" | "impuestos">,
    codigo: string,
  ) {
    switch (catalogType) {
      case "categorias":
        return Boolean(await this.prisma.categorias.findUnique({ where: { Codigo: codigo } }));
      case "marcas":
        return Boolean(await this.prisma.marcas.findUnique({ where: { Codigo: codigo } }));
      case "colores":
        return Boolean(await this.prisma.colores.findUnique({ where: { Codigo: codigo } }));
      case "fabricantes":
        return Boolean(await this.prisma.fabricantes.findUnique({ where: { Codigo: codigo } }));
    }
  }

  private async namedCatalogNameExists(
    catalogType: Exclude<CatalogImportKind, "tallas" | "impuestos">,
    nombre: string,
  ) {
    switch (catalogType) {
      case "categorias":
        return Boolean(
          await this.prisma.categorias.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          }),
        );
      case "marcas":
        return Boolean(
          await this.prisma.marcas.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          }),
        );
      case "colores":
        return Boolean(
          await this.prisma.colores.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          }),
        );
      case "fabricantes":
        return Boolean(
          await this.prisma.fabricantes.findFirst({
            where: { Nombre: { equals: nombre, mode: "insensitive" } },
          }),
        );
    }
  }

  private async createNamedCatalogRecord(
    catalogType: Exclude<CatalogImportKind, "tallas" | "impuestos">,
    data: { Codigo: string; Nombre: string; Status: number },
  ) {
    switch (catalogType) {
      case "categorias":
        return this.prisma.categorias.create({ data });
      case "marcas":
        return this.prisma.marcas.create({ data });
      case "colores":
        return this.prisma.colores.create({ data });
      case "fabricantes":
        return this.prisma.fabricantes.create({ data });
    }
  }

  private extractImportErrorMessage(error: unknown) {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === "string") {
        return response;
      }

      if (typeof response === "object" && response && "message" in response) {
        const message = (response as { message?: string | string[] }).message;
        if (Array.isArray(message)) {
          return message.join(". ");
        }
        if (typeof message === "string") {
          return message;
        }
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Ocurrio un error al importar la fila.";
  }

  private buildCodeCandidate(seed: string) {
    return seed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
  }

  private async generateUniqueCode(
    seed: string,
    maxLength: number,
    codeExists: (code: string) => Promise<boolean>,
  ) {
    const normalizedSeed = this.buildCodeCandidate(seed) || "GEN";
    const base = normalizedSeed.slice(0, maxLength);

    if (!(await codeExists(base))) {
      return base;
    }

    for (let index = 1; index < 1000; index += 1) {
      const suffix = String(index);
      const candidate = `${base.slice(0, maxLength - suffix.length)}${suffix}`;
      if (!(await codeExists(candidate))) {
        return candidate;
      }
    }

    throw new ConflictException("No se pudo generar un codigo unico para el catalogo");
  }

  private assertCatalogCodeLength(displayName: string, codigo: string, maxLength: number) {
    if (codigo.length > maxLength) {
      throw new BadRequestException(
        `El codigo de ${this.getCatalogDisplayLabel(displayName)} no puede tener mas de ${maxLength} caracteres.`,
      );
    }
  }

  private assertCatalogNameLength(displayName: string, nombre: string, maxLength: number) {
    if (nombre.length > maxLength) {
      throw new BadRequestException(
        `El nombre de ${this.getCatalogDisplayLabel(displayName)} no puede tener mas de ${maxLength} caracteres.`,
      );
    }
  }

  private async assertCatalogNotUsedByArticles(
    catalogType: CatalogImportKind,
    codigo: string,
    displayName: string,
  ) {
    const usedCount = await this.countArticlesUsingCatalog(catalogType, codigo);

    if (usedCount > 0) {
      throw new ConflictException(
        `No se puede eliminar ${this.getCatalogDisplayLabel(displayName)} porque hay ${usedCount} articulo(s) con ese registro asignado.`,
      );
    }
  }

  private async countArticlesUsingCatalog(catalogType: CatalogImportKind, codigo: string) {
    switch (catalogType) {
      case "categorias":
        return this.prisma.inventario.count({
          where: {
            Categoria: {
              equals: codigo,
              mode: "insensitive",
            },
          },
        });
      case "marcas":
        return this.prisma.inventario.count({
          where: {
            CodigoMarca: {
              equals: codigo,
              mode: "insensitive",
            },
          },
        });
      case "tallas":
        return this.prisma.inventario.count({
          where: {
            Talla: {
              equals: codigo,
              mode: "insensitive",
            },
          },
        });
      case "colores":
        return this.prisma.inventario.count({
          where: {
            CodigoColor: {
              equals: codigo,
              mode: "insensitive",
            },
          },
        });
      case "fabricantes":
        return this.prisma.inventario.count({
          where: {
            Fabricante: {
              equals: codigo,
              mode: "insensitive",
            },
          },
        });
      case "impuestos":
        {
          const taxCode = this.parseTaxCatalogCode(codigo);
          if (taxCode === undefined) {
            return 0;
          }

        return this.prisma.inventario.count({
          where: {
            TipoImpuesto: taxCode,
          },
        });
        }
      default:
        return 0;
    }
  }

  private getCatalogDisplayLabel(displayName: string) {
    if (["categoria", "marca", "talla"].includes(displayName)) {
      return `la ${displayName}`;
    }

    return `el ${displayName}`;
  }

  private calculatePromotionPrice(detailPrice: string, percentage: string) {
    const hundred = new Prisma.Decimal(100);
    const detail = new Prisma.Decimal(detailPrice);
    const percent = new Prisma.Decimal(percentage);
    return detail.minus(detail.mul(percent).dividedBy(hundred)).toDecimalPlaces(2).toString();
  }

  private calculateDiscountPercent(detailPrice: string, promotionPrice: string, active: boolean) {
    if (!active) {
      return undefined;
    }

    const detail = new Prisma.Decimal(detailPrice);
    if (detail.lessThanOrEqualTo(0)) {
      return undefined;
    }

    const hundred = new Prisma.Decimal(100);
    const promotion = new Prisma.Decimal(promotionPrice);
    return detail.minus(promotion).dividedBy(detail).times(hundred).toDecimalPlaces(2).toString();
  }

  private pickDecimal(input: string | undefined, inherited: Prisma.Decimal | null, fallback: string) {
    return input ?? inherited?.toString() ?? fallback;
  }

  private pickString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value !== "string") {
        continue;
      }

      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }

    return undefined;
  }

  private pickUpperString(...values: unknown[]) {
    const value = this.pickString(...values);
    return value ? value.toUpperCase() : undefined;
  }

  private pickNumericString(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      return String(value).trim();
    }

    return undefined;
  }

  private pickBoolean(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value !== "string") {
        continue;
      }

      const normalized = value.trim().toLowerCase();
      if (["true", "1", "si", "s", "activo", "activa"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "n", "inactivo", "inactiva"].includes(normalized)) {
        return false;
      }
    }

    return undefined;
  }

  private pickType(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      return this.normalizeItemType(value);
    }

    return undefined;
  }

  private pickStatus(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined || value === "") {
        continue;
      }

      return this.normalizeItemStatus(value);
    }

    return undefined;
  }

  private normalizeItemType(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    const normalized = String(value).trim().toLowerCase();
    if (["0", "articulo", "artículo"].includes(normalized)) {
      return 0;
    }
    if (["1", "servicio"].includes(normalized)) {
      return 1;
    }

    throw new BadRequestException(`Tipo no valido: ${value}`);
  }

  private normalizeItemStatus(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }

    const normalized = String(value).trim().toLowerCase();
    if (["1", "activo", "activa", "true"].includes(normalized)) {
      return 1;
    }
    if (["0", "inactivo", "inactiva", "false"].includes(normalized)) {
      return 0;
    }

    throw new BadRequestException(`Status no valido: ${value}`);
  }

  private isDefaultDateString(value: string) {
    return new Date(value).toISOString() === DEFAULT_DATE.toISOString();
  }

  private requireString(value: string | undefined, message: string) {
    const normalized = this.normalizeOptionalName(value);
    if (!normalized) {
      throw new BadRequestException(message);
    }

    return normalized;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private normalizeBarcode(value: string) {
    return value.trim().toUpperCase();
  }

  private normalizeOptionalUpper(value: string | undefined) {
    return value ? value.trim().toUpperCase() : undefined;
  }

  private normalizeOptionalName(value: string | null | undefined) {
    return typeof value === "string" ? value.trim() || null : null;
  }

  private normalizeOptionalNumericString(value: string | null | undefined) {
    return typeof value === "string" ? value.trim() || null : null;
  }

  private parseTaxCatalogCode(value: string | undefined) {
    const normalized = this.normalizeOptionalUpper(value);
    if (!normalized) {
      return undefined;
    }

    if (!/^\d+$/.test(normalized)) {
      throw new BadRequestException("El codigo del impuesto debe ser numerico.");
    }

    return Number.parseInt(normalized, 10);
  }

  private parseTaxCatalogPercentage(value: string | undefined) {
    const normalized = this.normalizeOptionalNumericString(value);
    if (!normalized) {
      return "0";
    }

    const parsed = Number(normalized.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new BadRequestException("El porcentaje del impuesto no es valido.");
    }

    return parsed.toString();
  }
}
