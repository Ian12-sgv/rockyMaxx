import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Categorias,
  Colores,
  Fabricantes,
  Impuestos,
  Marcas,
  Prisma,
  PrismaClient,
  Tallas,
} from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { CreateMerchandiseDto } from "./dto/create-merchandise.dto";
import { ResolveCreationAutofillDto } from "./dto/resolve-creation-autofill.dto";
import { inventoryInclude, toInventoryView } from "./inventory-view.util";

const DEFAULT_CATEGORY_CODE = "00";
const DEFAULT_CATEGORY_NAME = "UNISEX";
const DEFAULT_TAX_CODE = 1;
const DEFAULT_DATE = new Date("2000-01-01T00:00:00.000Z");

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

type NamedCatalogRecord = Marcas | Colores | Fabricantes | Categorias;

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
    existente: boolean;
  };
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getCreationMetadata() {
    const [marcas, tallas, colores, fabricantes, categorias, impuestos] = await Promise.all([
      this.prisma.marcas.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.tallas.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.colores.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.fabricantes.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.categorias.findMany({ orderBy: { Codigo: "asc" } }),
      this.prisma.impuestos.findMany({ orderBy: { Codigo: "asc" } }),
    ]);

    return {
      defaults: {
        categoria: DEFAULT_CATEGORY_CODE,
        tipoImpuesto: DEFAULT_TAX_CODE,
        promocion: false,
        tipo: 0,
        status: 1,
        serializado: 0,
        fechaInicial: DEFAULT_DATE,
        fechaFinal: DEFAULT_DATE,
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
        })),
      },
    };
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
        talla: talla ? this.buildTallaAutofill(talla, tallaRecord) : null,
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
    const codigoBarra = this.normalizeBarcode(createMerchandiseDto.codigoBarra);
    const referencia = createMerchandiseDto.referencia.trim();
    const resolvedCatalogs = await this.resolveRequiredCatalogs(createMerchandiseDto);

    const existing = await this.prisma.inventario.findUnique({
      where: { CodigoBarra: codigoBarra },
    });

    if (existing) {
      throw new ConflictException("Ya existe una mercancia con ese codigo de barra");
    }

    const siblingValues = await this.getSiblingValues(
      referencia,
      resolvedCatalogs.marca.codigo,
      codigoBarra,
    );

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.ensureCatalogs(tx, resolvedCatalogs);

        const now = new Date();
        const createdItem = await tx.inventario.create({
          data: {
            CodigoBarra: codigoBarra,
            Referencia: referencia,
            CodigoMarca: resolvedCatalogs.marca.codigo,
            Nombre: createMerchandiseDto.nombre.trim(),
            Talla: resolvedCatalogs.talla.codigo,
            CodigoColor: resolvedCatalogs.color.codigo,
            Fabricante: resolvedCatalogs.fabricante.codigo,
            Categoria: resolvedCatalogs.categoria.codigo,
            Nota: createMerchandiseDto.nota?.trim() ?? "",
            TipoImpuesto: resolvedCatalogs.impuesto.codigo,
            PrecioDetal: this.pickDecimal(createMerchandiseDto.precioDetal, siblingValues.PrecioDetal, "0"),
            PrecioMayor: this.pickDecimal(createMerchandiseDto.precioMayor, siblingValues.PrecioMayor, "0"),
            PrecioAfiliado: this.pickDecimal(createMerchandiseDto.precioAfiliado, siblingValues.PrecioAfiliado, "0"),
            PrecioPromocion: this.pickDecimal(createMerchandiseDto.precioPromocion, siblingValues.PrecioPromocion, "0"),
            Promocion: createMerchandiseDto.promocion ?? siblingValues.Promocion ?? false,
            FechaInicial: this.pickDate(createMerchandiseDto.fechaInicial, siblingValues.FechaInicial, DEFAULT_DATE),
            FechaFinal: this.pickDate(createMerchandiseDto.fechaFinal, siblingValues.FechaFinal, DEFAULT_DATE),
            CostoInicial: this.pickDecimal(createMerchandiseDto.costoInicial, siblingValues.CostoInicial, "0"),
            CostoPromedio: this.pickDecimal(createMerchandiseDto.costoPromedio, siblingValues.CostoPromedio, "0"),
            UltimoCosto: this.pickDecimal(createMerchandiseDto.ultimoCosto, siblingValues.UltimoCosto, "0"),
            CostoDolar: this.pickDecimal(createMerchandiseDto.costoDolar, null, "0"),
            ExistenciaInicial: this.pickDecimal(createMerchandiseDto.existenciaInicial, null, "0"),
            Existencia: this.pickDecimal(createMerchandiseDto.existencia, null, "0"),
            PuntoReorden: this.pickDecimal(createMerchandiseDto.puntoReorden, null, "0"),
            FechaPrimerMovimiento: now,
            UltimaActualizacion: now,
            Tipo: createMerchandiseDto.tipo ?? 0,
            Status: createMerchandiseDto.status ?? 1,
            Serializado: createMerchandiseDto.serializado ?? 0,
            CodigoBarraAnt: createMerchandiseDto.codigoBarraAnt
              ? this.normalizeBarcode(createMerchandiseDto.codigoBarraAnt)
              : codigoBarra,
          },
          include: inventoryInclude,
        });

        return createdItem;
      });

      return toInventoryView(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ya existe una mercancia con ese codigo de barra");
      }

      throw error;
    }
  }

  private async ensureCatalogs(tx: TransactionClient, payload: ResolvedCatalogs) {
    await tx.marcas.upsert({
      where: { Codigo: payload.marca.codigo },
      update: {},
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
      update: {},
      create: {
        Codigo: payload.color.codigo,
        Nombre: payload.color.nombre,
        Status: payload.color.status,
      },
    });

    await tx.fabricantes.upsert({
      where: { Codigo: payload.fabricante.codigo },
      update: {},
      create: {
        Codigo: payload.fabricante.codigo,
        Nombre: payload.fabricante.nombre,
        Status: payload.fabricante.status,
      },
    });

    await tx.categorias.upsert({
      where: { Codigo: payload.categoria.codigo },
      update: {},
      create: {
        Codigo: payload.categoria.codigo,
        Nombre: payload.categoria.nombre,
        Status: payload.categoria.status,
      },
    });

    await tx.impuestos.upsert({
      where: { Codigo: payload.impuesto.codigo },
      update: {},
      create: {
        Codigo: payload.impuesto.codigo,
        Nombre: payload.impuesto.nombre,
        PorcentajeImpuesto: payload.impuesto.porcentajeImpuesto,
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

  private pickDecimal(input: string | undefined, inherited: Prisma.Decimal | null, fallback: string) {
    return input ?? inherited ?? fallback;
  }

  private pickDate(input: string | undefined, inherited: Date | null, fallback: Date) {
    return input ? new Date(input) : inherited ?? fallback;
  }

  private async resolveRequiredCatalogs(createMerchandiseDto: CreateMerchandiseDto): Promise<ResolvedCatalogs> {
    const codigoMarca = this.normalizeUpper(createMerchandiseDto.codigoMarca);
    const talla = this.normalizeUpper(createMerchandiseDto.talla);
    const codigoColor = this.normalizeUpper(createMerchandiseDto.codigoColor);
    const fabricante = this.normalizeUpper(createMerchandiseDto.fabricante);
    const categoria = this.normalizeUpper(createMerchandiseDto.categoria ?? DEFAULT_CATEGORY_CODE);
    const tipoImpuesto = createMerchandiseDto.tipoImpuesto ?? DEFAULT_TAX_CODE;

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
      marca: this.resolveRequiredNamedCatalog(
        "marca",
        codigoMarca,
        createMerchandiseDto.nombreMarca,
        marcaRecord,
      ),
      talla: { codigo: tallaRecord?.Codigo ?? talla },
      color: this.resolveRequiredNamedCatalog(
        "color",
        codigoColor,
        createMerchandiseDto.nombreColor,
        colorRecord,
      ),
      fabricante: this.resolveRequiredNamedCatalog(
        "fabricante",
        fabricante,
        createMerchandiseDto.nombreFabricante,
        fabricanteRecord,
      ),
      categoria: this.resolveRequiredNamedCatalog(
        "categoria",
        categoria,
        createMerchandiseDto.nombreCategoria,
        categoriaRecord,
        categoria === DEFAULT_CATEGORY_CODE ? DEFAULT_CATEGORY_NAME : undefined,
      ),
      impuesto: this.resolveRequiredTax(
        tipoImpuesto,
        createMerchandiseDto.nombreImpuesto,
        createMerchandiseDto.porcentajeImpuesto,
        impuestoRecord,
      ),
    };
  }

  private async fetchCatalogRecords(payload: {
    codigoMarca?: string;
    talla?: string;
    codigoColor?: string;
    fabricante?: string;
    categoria?: string;
    tipoImpuesto?: number;
  }) {
    return Promise.all([
      payload.codigoMarca
        ? this.prisma.marcas.findUnique({ where: { Codigo: payload.codigoMarca } })
        : Promise.resolve(null),
      payload.talla ? this.prisma.tallas.findUnique({ where: { Codigo: payload.talla } }) : Promise.resolve(null),
      payload.codigoColor
        ? this.prisma.colores.findUnique({ where: { Codigo: payload.codigoColor } })
        : Promise.resolve(null),
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

  private buildTallaAutofill(codigo: string, record: Tallas | null): TallaAutofill {
    return {
      codigo: record?.Codigo ?? codigo,
      existente: Boolean(record),
    };
  }

  private buildTaxAutofill(
    codigo: number,
    providedName: string | undefined,
    providedPercentage: string | undefined,
    record: Impuestos | null,
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

  private resolveRequiredNamedCatalog(
    entityLabel: string,
    codigo: string,
    providedName: string | undefined,
    record: NamedCatalogRecord | null,
    defaultName?: string,
  ): ResolvedNamedCatalog {
    const autofill = this.buildNamedCatalogAutofill(codigo, providedName, record, defaultName);
    const nombre = autofill.nombre?.trim();

    if (!nombre) {
      throw new BadRequestException(`Debe indicar el nombre de ${entityLabel} para el codigo ${codigo}`);
    }

    return {
      codigo: autofill.codigo,
      nombre,
      status: autofill.status ?? 1,
    };
  }

  private resolveRequiredTax(
    codigo: number,
    providedName: string | undefined,
    providedPercentage: string | undefined,
    record: Impuestos | null,
  ) {
    if (record) {
      return {
        codigo: record.Codigo,
        nombre: this.normalizeOptionalName(record.Nombre),
        porcentajeImpuesto: record.PorcentajeImpuesto ? record.PorcentajeImpuesto.toString() : null,
        existente: true,
      };
    }

    const nombre = this.normalizeOptionalName(providedName);
    const porcentajeImpuesto = this.normalizeOptionalNumericString(providedPercentage);

    if (!nombre) {
      throw new BadRequestException(`Debe indicar el nombre del impuesto para el codigo ${codigo}`);
    }

    if (!porcentajeImpuesto) {
      throw new BadRequestException(`Debe indicar el porcentaje del impuesto para el codigo ${codigo}`);
    }

    return {
      codigo,
      nombre,
      porcentajeImpuesto,
      existente: false,
    };
  }

  private normalizeBarcode(value: string) {
    return value.trim().toUpperCase();
  }

  private normalizeUpper(value: string) {
    return value.trim().toUpperCase();
  }

  private normalizeOptionalUpper(value: string | undefined) {
    return value ? this.normalizeUpper(value) : undefined;
  }

  private normalizeOptionalName(value: string | null | undefined) {
    return typeof value === "string" ? value.trim() || null : null;
  }

  private normalizeOptionalNumericString(value: string | null | undefined) {
    return typeof value === "string" ? value.trim() || null : null;
  }
}
