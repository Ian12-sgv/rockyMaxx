import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { UserView } from "../users/user-view.util";
import { CreateCompraDto, CompraItemDto } from "./dto/create-compra.dto";
import { FindComprasDto } from "./dto/find-compras.dto";
import { UpdateCompraDto } from "./dto/update-compra.dto";

const ZERO = new Prisma.Decimal(0);

type CompraTx = Prisma.TransactionClient;

type CompraWithRelations = Prisma.ComprasGetPayload<{
  include: {
    proveedorRef: true;
    lote: true;
    movCompras: {
      include: {
        inventarioRef: {
          include: {
            marcaRef: true;
          };
        };
      };
    };
  };
}>;

type DestinoOption = {
  codigo: string;
  nombre: string;
  status: number;
};

@Injectable()
export class ComprasService {
  constructor(private readonly prisma: PrismaService) {}

  async getMetadata(user: UserView) {
    const [proveedores, formasPago, sucursales, latestRate, latestTax, nextDocumento, nextLoteId, currentDatabase] =
      await Promise.all([
        this.prisma.proveedores.findMany({
          where: {
            Status: {
              not: 0,
            },
          },
          orderBy: [{ Nombre: "asc" }, { Codigo: "asc" }],
        }),
        this.prisma.formaPago.findMany({
          where: {
            Status: {
              not: 0,
            },
          },
          orderBy: [{ Orden: "asc" }, { Codigo: "asc" }],
        }),
        this.prisma.sucursales.findMany({
          where: {
            Status: {
              not: 0,
            },
          },
          orderBy: [{ Nombre: "asc" }, { Codigo: "asc" }],
        }),
        this.getLatestExchangeRate(),
        this.prisma.impuestos.findFirst({
          where: {
            Status: 1,
          },
          orderBy: {
            Codigo: "asc",
          },
        }),
        this.getNextDocumento(),
        this.getNextLoteId(),
        this.getCurrentDatabaseName(),
      ]);

    const currentDestinoCodigo = this.resolveCurrentDestinationCode(currentDatabase);
    const currentDestino =
      sucursales.find((item) => String(item.Codigo || "").trim().toUpperCase() === currentDestinoCodigo)
      ?? sucursales[0]
      ?? null;

    return {
      defaults: {
        documento: nextDocumento,
        proveedor: "",
        fecha: this.startOfDay(new Date()),
        fechaFactura: "",
        tipoPago: formasPago[0]?.Codigo ?? 1,
        observacion: "",
        totalMercancia: "0.00",
        tasaCambio: latestRate.valor,
        usuario: String(user?.codUsuario || "").trim(),
        status: 0,
        destino: currentDestino?.Codigo ?? currentDestinoCodigo,
        destinoNombre: currentDestino?.Nombre ?? currentDestinoCodigo,
        idLote: nextLoteId,
        porcImpuestoGeneral: this.toDecimalString(latestTax?.PorcentajeImpuesto ?? ZERO),
      },
      proveedores: proveedores.map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre,
        status: item.Status ?? 0,
      })),
      tiposPago: formasPago.map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre ?? "",
        status: item.Status ?? 0,
      })),
      destinos: sucursales.map((item) => ({
        codigo: item.Codigo,
        nombre: item.Nombre,
        status: item.Status ?? 0,
      })),
      contexto: {
        baseDatos: currentDatabase,
        destinoActual: currentDestino?.Codigo ?? currentDestinoCodigo,
      },
    };
  }

  async findAll(findComprasDto: FindComprasDto) {
    const [compras, destinos] = await Promise.all([
      this.prisma.compras.findMany({
        where: this.buildWhere(findComprasDto),
        include: {
          proveedorRef: true,
          lote: true,
          movCompras: {
            include: {
              inventarioRef: {
                include: {
                  marcaRef: true,
                },
              },
            },
          },
        },
        orderBy: [{ Fecha: "desc" }, { Documento: "desc" }],
        take: findComprasDto.limit ?? 100,
      }),
      this.getDestinosMap(),
    ]);

    return compras.map((item) => this.toCompraView(item, destinos));
  }

  async findOne(documento: string, proveedor: string) {
    const destinos = await this.getDestinosMap();
    const compra = await this.findCompraOrThrow(documento, proveedor);
    return this.toCompraView(compra, destinos);
  }

  async create(payload: CreateCompraDto, user: UserView) {
    const usuario = this.resolveUserCode(user);

    const created = await this.prisma.$transaction(async (tx) => {
      const proveedor = await this.resolveProveedorCode(tx, payload.proveedor);
      const documento = await this.resolveDocumentoForCreate(tx, payload.documento, proveedor);
      const tipoPago = await this.resolveTipoPago(tx, payload.tipoPago);
      const destino = await this.resolveDestino(tx, payload.destino);
      const tasaCambio = this.parseDecimal(payload.tasaCambio, "La tasa de cambio no es valida.", { defaultValue: ZERO });
      const porcentajeImpuesto = await this.resolveGeneralTax(tx);
      const loteId = await this.resolveLoteId(tx, documento, payload.idLote, usuario);
      const fecha = new Date();
      const fechaFactura = new Date();
      const items = await this.resolveCompraItems(tx, payload.items);
      const totalMercancia = this.computeCompraItemsTotal(items);

      const existing = await tx.compras.findUnique({
        where: {
          Documento_Proveedor: {
            Documento: documento,
            Proveedor: proveedor.Codigo,
          },
        },
      });

      if (existing) {
        throw new ConflictException("Ya existe una compra con ese documento y proveedor.");
      }

      const createdRecord = await tx.compras.create({
        data: {
          Documento: documento,
          Proveedor: proveedor.Codigo,
          Fecha: fecha,
          FechaFactura: fechaFactura,
          PorcentajeDescuento: ZERO,
          TipoPago: tipoPago.Codigo,
          DiasCredito: ZERO,
          Expediente: destino.codigo,
          Observacion: this.normalizeObservation(payload.observacion),
          TotalMercancia: totalMercancia,
          TotalImpuesto: ZERO,
          TotalImpuestoContable: ZERO,
          TotalDescuento: ZERO,
          TasaCambio: tasaCambio,
          Recargos: ZERO,
          TasaServicio: ZERO,
          OtrosImpuestos: ZERO,
          Flete: ZERO,
          Seguro: ZERO,
          PorcImpuestoGeneral: porcentajeImpuesto,
          Usuario: usuario,
          MetodoValorizacion: 0,
          InterContable: 0,
          Status: 0,
          BodegaExterna: destino.esBodega ? 1 : 0,
          IDLote: loteId,
          UsaFechaVencimiento: false,
        },
        include: {
          proveedorRef: true,
          lote: true,
          movCompras: {
            include: {
              inventarioRef: {
                include: {
                  marcaRef: true,
                },
              },
            },
          },
        },
      });

      if (items.length > 0) {
        await tx.movCompras.createMany({
          data: items.map((item, index) => ({
            Documento: documento,
            Proveedor: proveedor.Codigo,
            CodigoBarra: item.CodigoBarra,
            Cantidad: item.Cantidad,
            CantidadDevuelta: ZERO,
            PrecioFactura: item.CostoUnitario,
            PrecioProrrateado: item.CostoUnitario,
            PorcentajeImpuesto: item.PorcentajeImpuesto ?? ZERO,
            Impuesto: ZERO,
            Item: index + 1,
          })),
        });
      }

      return tx.compras.findUniqueOrThrow({
        where: {
          Documento_Proveedor: {
            Documento: createdRecord.Documento,
            Proveedor: createdRecord.Proveedor,
          },
        },
        include: {
          proveedorRef: true,
          lote: true,
          movCompras: {
            include: {
              inventarioRef: {
                include: {
                  marcaRef: true,
                },
              },
            },
          },
        },
      });
    });

    const destinos = await this.getDestinosMap();
    return this.toCompraView(created, destinos);
  }

  async update(documento: string, proveedor: string, payload: UpdateCompraDto, user: UserView) {
    const usuario = this.resolveUserCode(user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findCompraOrThrowTx(tx, documento, proveedor);
      if (Number(existing.Status ?? 0) === 1) {
        throw new ConflictException("La compra ya esta aprobada y no puede modificarse.");
      }

      const tipoPago = await this.resolveTipoPago(tx, payload.tipoPago);
      const destino = await this.resolveDestino(tx, payload.destino);
      const tasaCambio = this.parseDecimal(payload.tasaCambio, "La tasa de cambio no es valida.", { defaultValue: ZERO });
      const items = await this.resolveCompraItems(tx, payload.items);
      const totalMercancia = this.computeCompraItemsTotal(items);

      await tx.movCompras.deleteMany({
        where: {
          Documento: existing.Documento,
          Proveedor: existing.Proveedor,
        },
      });

      await tx.compras.update({
        where: {
          Documento_Proveedor: {
            Documento: existing.Documento,
            Proveedor: existing.Proveedor,
          },
        },
        data: {
          TipoPago: tipoPago.Codigo,
          Expediente: destino.codigo,
          Observacion: this.normalizeObservation(payload.observacion),
          TotalMercancia: totalMercancia,
          TasaCambio: tasaCambio,
          Usuario: usuario,
          BodegaExterna: destino.esBodega ? 1 : 0,
        },
      });

      if (items.length > 0) {
        await tx.movCompras.createMany({
          data: items.map((item, index) => ({
            Documento: existing.Documento,
            Proveedor: existing.Proveedor,
            CodigoBarra: item.CodigoBarra,
            Cantidad: item.Cantidad,
            CantidadDevuelta: ZERO,
            PrecioFactura: item.CostoUnitario,
            PrecioProrrateado: item.CostoUnitario,
            PorcentajeImpuesto: item.PorcentajeImpuesto ?? ZERO,
            Impuesto: ZERO,
            Item: index + 1,
          })),
        });
      }

      return tx.compras.findUniqueOrThrow({
        where: {
          Documento_Proveedor: {
            Documento: existing.Documento,
            Proveedor: existing.Proveedor,
          },
        },
        include: {
          proveedorRef: true,
          lote: true,
          movCompras: {
            include: {
              inventarioRef: {
                include: {
                  marcaRef: true,
                },
              },
            },
          },
        },
      });
    });

    const destinos = await this.getDestinosMap();
    return this.toCompraView(updated, destinos);
  }

  async approve(documento: string, proveedor: string) {
    const approved = await this.prisma.$transaction(async (tx) => {
      const existing = await this.findCompraOrThrowTx(tx, documento, proveedor);
      if (Number(existing.Status ?? 0) === 1) {
        throw new ConflictException("La compra ya esta aprobada.");
      }

      await tx.compras.update({
        where: {
          Documento_Proveedor: {
            Documento: existing.Documento,
            Proveedor: existing.Proveedor,
          },
        },
        data: {
          Status: 1,
          FechaFactura: new Date(),
        },
      });

      return tx.compras.findUniqueOrThrow({
        where: {
          Documento_Proveedor: {
            Documento: existing.Documento,
            Proveedor: existing.Proveedor,
          },
        },
        include: {
          proveedorRef: true,
          lote: true,
          movCompras: {
            include: {
              inventarioRef: {
                include: {
                  marcaRef: true,
                },
              },
            },
          },
        },
      });
    });

    const destinos = await this.getDestinosMap();
    return this.toCompraView(approved, destinos);
  }

  async remove(documento: string, proveedor: string) {
    const existing = await this.findCompraOrThrow(documento, proveedor);
    if (Number(existing.Status ?? 0) === 1) {
      throw new ConflictException("Solo se puede eliminar una compra no aprobada.");
    }

    await this.prisma.compras.delete({
      where: {
        Documento_Proveedor: {
          Documento: existing.Documento,
          Proveedor: existing.Proveedor,
        },
      },
    });
  }

  private async findCompraOrThrow(documento: string, proveedor: string) {
    const normalizedDocumento = this.normalizeDocumento(documento);
    const normalizedProveedor = await this.resolveProveedorCode(this.prisma, proveedor);
    const compra = await this.prisma.compras.findUnique({
      where: {
        Documento_Proveedor: {
          Documento: normalizedDocumento,
          Proveedor: normalizedProveedor.Codigo,
        },
      },
      include: {
        proveedorRef: true,
        lote: true,
        movCompras: {
          include: {
            inventarioRef: {
              include: {
                marcaRef: true,
              },
            },
          },
        },
      },
    });

    if (!compra) {
      throw new NotFoundException("La compra no existe.");
    }

    return compra;
  }

  private async findCompraOrThrowTx(tx: CompraTx, documento: string, proveedor: string) {
    const normalizedDocumento = this.normalizeDocumento(documento);
    const normalizedProveedor = await this.resolveProveedorCode(tx, proveedor);
    const compra = await tx.compras.findUnique({
      where: {
        Documento_Proveedor: {
          Documento: normalizedDocumento,
          Proveedor: normalizedProveedor.Codigo,
        },
      },
      include: {
        proveedorRef: true,
        lote: true,
        movCompras: {
          include: {
            inventarioRef: {
              include: {
                marcaRef: true,
              },
            },
          },
        },
      },
    });

    if (!compra) {
      throw new NotFoundException("La compra no existe.");
    }

    return compra;
  }

  private buildWhere(findComprasDto: FindComprasDto): Prisma.ComprasWhereInput {
    const filters: Prisma.ComprasWhereInput[] = [];
    const buscar = String(findComprasDto.buscar || "").trim();

    if (typeof findComprasDto.status === "number") {
      filters.push({ Status: findComprasDto.status });
    }

    if (buscar) {
      filters.push({
        OR: [
          { Documento: { contains: buscar, mode: "insensitive" } },
          { Proveedor: { contains: buscar, mode: "insensitive" } },
          { Expediente: { contains: buscar, mode: "insensitive" } },
          { Observacion: { contains: buscar, mode: "insensitive" } },
          { proveedorRef: { is: { Nombre: { contains: buscar, mode: "insensitive" } } } },
        ],
      });
    }

    return filters.length ? { AND: filters } : {};
  }

  private async resolveProveedorCode(
    client: PrismaService | CompraTx,
    value: string,
  ) {
    const input = String(value || "").trim();
    if (!input) {
      throw new BadRequestException("Debes indicar el proveedor.");
    }

    const exactCode = input.split("-")[0]?.trim() || input;
    const all = await client.proveedores.findMany({
      where: {
        Status: {
          not: 0,
        },
      },
      orderBy: [{ Nombre: "asc" }, { Codigo: "asc" }],
    });

    const normalizedInput = input.toUpperCase();
    const normalizedCode = exactCode.toUpperCase();

    const byCode = all.find((item) => String(item.Codigo || "").trim().toUpperCase() === normalizedCode);
    if (byCode) {
      return byCode;
    }

    const byName = all.find((item) => String(item.Nombre || "").trim().toUpperCase() === normalizedInput);
    if (byName) {
      return byName;
    }

    const partialMatches = all.filter((item) => {
      const haystack = `${item.Codigo || ""} ${item.Nombre || ""}`.toUpperCase();
      return haystack.includes(normalizedInput);
    });

    if (partialMatches.length === 1) {
      return partialMatches[0];
    }

    throw new BadRequestException("El proveedor indicado no existe o es ambiguo.");
  }

  private async resolveTipoPago(client: PrismaService | CompraTx, codigo: number) {
    if (!Number.isInteger(codigo) || codigo < 1) {
      throw new BadRequestException("Debes indicar el tipo de pago.");
    }

    const found = await client.formaPago.findUnique({
      where: {
        Codigo: codigo,
      },
    });

    if (!found || Number(found.Status ?? 0) === 0) {
      throw new BadRequestException("El tipo de pago indicado no existe.");
    }

    return found;
  }

  private async resolveDestino(client: PrismaService | CompraTx, value?: string) {
    const codigo = String(value || "").trim().toUpperCase();
    if (!codigo) {
      throw new BadRequestException("Debes indicar el destino.");
    }

    const found = await client.sucursales.findUnique({
      where: {
        Codigo: codigo,
      },
    });

    if (!found || Number(found.Status ?? 0) === 0) {
      throw new BadRequestException("El destino indicado no existe.");
    }

    return {
      codigo: found.Codigo,
      nombre: found.Nombre,
      esBodega: found.Codigo.toUpperCase().startsWith("B") || found.Codigo.toUpperCase() === "ORIGEN",
    };
  }

  private async resolveGeneralTax(client: PrismaService | CompraTx) {
    const active = await client.impuestos.findFirst({
      where: {
        Status: 1,
      },
      orderBy: {
        Codigo: "asc",
      },
    });

    return active?.PorcentajeImpuesto ?? ZERO;
  }

  private async resolveCompraItems(client: PrismaService | CompraTx, items: CompraItemDto[]) {
    const normalizedItems = items
      .map((item) => ({
        codigoBarra: String(item?.codigoBarra || "").trim().toUpperCase(),
        cantidad: item?.cantidad,
        costoUnitario: item?.costoUnitario,
      }))
      .filter((item) => item.codigoBarra);

    if (!normalizedItems.length) {
      throw new BadRequestException("Debes seleccionar al menos un articulo.");
    }

    const uniqueCodes = [...new Set(normalizedItems.map((item) => item.codigoBarra))];
    const found = await client.inventario.findMany({
      where: {
        CodigoBarra: {
          in: uniqueCodes,
        },
      },
      include: {
        impuestoRef: true,
      },
    });

    if (found.length !== uniqueCodes.length) {
      throw new BadRequestException("Uno o varios articulos seleccionados ya no existen.");
    }

    const byCode = new Map(found.map((item) => [String(item.CodigoBarra || "").trim().toUpperCase(), item]));
    return normalizedItems.map((rawItem) => {
      const inventory = byCode.get(rawItem.codigoBarra);
      const cantidad = this.parseDecimal(rawItem.cantidad, "La cantidad del articulo no es valida.", {
        defaultValue: ONE_DECIMAL,
      });
      const costoUnitario = this.parseDecimal(
        rawItem.costoUnitario,
        "El costo en dolares del articulo no es valido.",
        {
          defaultValue: inventory?.CostoDolar ?? ZERO,
        },
      );

      if (cantidad.lessThanOrEqualTo(0)) {
        throw new BadRequestException(`La cantidad del articulo ${inventory?.CodigoBarra ?? rawItem.codigoBarra} debe ser mayor a cero.`);
      }

      if (costoUnitario.lessThan(0)) {
        throw new BadRequestException(`El costo en dolares del articulo ${inventory?.CodigoBarra ?? rawItem.codigoBarra} no puede ser negativo.`);
      }

      return {
        CodigoBarra: inventory?.CodigoBarra ?? rawItem.codigoBarra,
        Cantidad: cantidad,
        CostoUnitario: costoUnitario,
        PorcentajeImpuesto: inventory?.impuestoRef?.PorcentajeImpuesto ?? ZERO,
      };
    });
  }

  private computeCompraItemsTotal(
    items: Array<{ Cantidad: Prisma.Decimal; CostoUnitario: Prisma.Decimal }>,
  ) {
    return items.reduce((accumulator, item) => {
      return accumulator.plus(item.Cantidad.times(item.CostoUnitario));
    }, ZERO);
  }

  private async resolveDocumentoForCreate(client: PrismaService | CompraTx, requested: string | undefined, proveedor: { Codigo: string }) {
    const normalized = String(requested || "").trim();
    if (normalized) {
      return this.normalizeDocumento(normalized);
    }

    const nextDocumento = await this.getNextDocumento(client);
    const duplicate = await client.compras.findUnique({
      where: {
        Documento_Proveedor: {
          Documento: nextDocumento,
          Proveedor: proveedor.Codigo,
        },
      },
    });

    if (duplicate) {
      throw new ConflictException("No se pudo generar un documento unico para la compra.");
    }

    return nextDocumento;
  }

  private normalizeDocumento(value: string) {
    const normalized = String(value || "").trim().toUpperCase();
    if (!normalized) {
      throw new BadRequestException("Debes indicar el documento de la compra.");
    }

    if (normalized.length > 12) {
      throw new BadRequestException("El documento de la compra no puede exceder 12 caracteres.");
    }

    return normalized;
  }

  private parseDecimal(value: string | undefined, message: string, options: { defaultValue: Prisma.Decimal }) {
    const raw = String(value || "").trim();
    if (!raw) {
      return options.defaultValue;
    }

    const normalized = raw.replace(/\s+/g, "");
    const commaIndex = normalized.lastIndexOf(",");
    const dotIndex = normalized.lastIndexOf(".");
    let parsedValue = normalized;

    if (commaIndex >= 0 && dotIndex >= 0) {
      parsedValue = commaIndex > dotIndex ? normalized.replace(/\./g, "").replace(",", ".") : normalized.replace(/,/g, "");
    } else if (commaIndex >= 0) {
      parsedValue = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      parsedValue = normalized.replace(/,/g, "");
    }

    try {
      return new Prisma.Decimal(parsedValue);
    } catch {
      throw new BadRequestException(message);
    }
  }

  private normalizeObservation(value?: string) {
    return String(value || "").trim().slice(0, 100);
  }

  private resolveUserCode(user: UserView) {
    const code = String(user?.codUsuario || "").trim();
    if (!code) {
      throw new BadRequestException("No se pudo identificar el usuario autenticado.");
    }

    return code;
  }

  private startOfDay(value: Date) {
    const normalized = new Date(value.getTime());
    normalized.setHours(0, 0, 0, 0);
    return normalized;
  }

  private async getLatestExchangeRate() {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ Valor: unknown }>>(
      `
        SELECT "Valor"
        FROM dbo."TASA_CAMBIO"
        ORDER BY "ID" DESC
        LIMIT 1
      `,
    );

    return {
      valor: this.toDecimalString(rows[0]?.Valor ?? ZERO),
    };
  }

  private async getNextDocumento(client: PrismaService | CompraTx = this.prisma) {
    const rows = await client.compras.findMany({
      select: {
        Documento: true,
      },
    });

    const numeric = rows
      .map((item) => Number.parseInt(String(item.Documento || "").trim(), 10))
      .filter((item) => Number.isInteger(item));

    return numeric.length ? String(Math.max(...numeric) + 1) : "1";
  }

  private async getNextLoteId(client: PrismaService | CompraTx = this.prisma) {
    const rows = await client.lotes.findMany({
      select: {
        ID: true,
      },
      orderBy: {
        ID: "desc",
      },
      take: 1,
    });

    return Number(rows[0]?.ID ?? 0) + 1;
  }

  private async resolveLoteId(client: PrismaService | CompraTx, documento: string, providedId: number | undefined, usuario: string) {
    if (Number.isInteger(providedId) && Number(providedId) > 0) {
      const existing = await client.lotes.findUnique({
        where: {
          ID: Number(providedId),
        },
      });

      if (existing) {
        return existing.ID;
      }
    }

    const nextId = await this.getNextLoteId(client);
    const baseCode = `CMP_${documento}`.slice(0, 24);
    let loteCode = baseCode;
    let suffix = 1;

    while (await client.lotes.findUnique({ where: { Lote: loteCode } })) {
      suffix += 1;
      loteCode = `${baseCode}_${suffix}`.slice(0, 24);
    }

    const created = await client.lotes.create({
      data: {
        ID: nextId,
        Lote: loteCode,
        Descripcion: `Compra ${documento}`.slice(0, 100),
        Estado: 1,
        FechaRegistro: new Date(),
        UsuarioCreacion: usuario,
      },
    });

    return created.ID;
  }

  private async getDestinosMap() {
    const destinos = await this.prisma.sucursales.findMany({
      orderBy: [{ Nombre: "asc" }, { Codigo: "asc" }],
    });

    return new Map(
      destinos.map((item) => [
        String(item.Codigo || "").trim().toUpperCase(),
        {
          codigo: item.Codigo,
          nombre: item.Nombre,
          status: item.Status ?? 0,
        } satisfies DestinoOption,
      ]),
    );
  }

  private toCompraView(item: CompraWithRelations, destinos: Map<string, DestinoOption>) {
    const destino = destinos.get(String(item.Expediente || "").trim().toUpperCase()) ?? null;
    const articulos = Array.isArray(item.movCompras) ? item.movCompras : [];

    return {
      documento: item.Documento,
      proveedor: item.Proveedor,
      proveedorNombre: item.proveedorRef?.Nombre ?? item.Proveedor,
      fecha: item.Fecha,
      fechaFactura: item.Status === 1 ? item.FechaFactura : null,
      tipoPago: item.TipoPago,
      observacion: item.Observacion,
      totalMercancia: this.toDecimalString(item.TotalMercancia),
      tasaCambio: this.toDecimalString(item.TasaCambio),
      usuario: item.Usuario,
      status: item.Status,
      statusNombre: Number(item.Status ?? 0) === 1 ? "Aprobada" : "No aprobada",
      destino: item.Expediente,
      destinoNombre: destino?.nombre ?? item.Expediente,
      idLote: item.IDLote,
      lote: item.lote?.Lote ?? "",
      bodegaExterna: item.BodegaExterna,
      puedeEliminar: Number(item.Status ?? 0) === 0,
      puedeAprobar: Number(item.Status ?? 0) === 0,
      items: articulos.map((detail) => ({
        item: detail.Item,
        codigoBarra: detail.CodigoBarra,
        referencia: detail.inventarioRef?.Referencia ?? detail.CodigoBarra,
        marca: detail.inventarioRef?.marcaRef?.Nombre ?? detail.inventarioRef?.CodigoMarca ?? "",
        nombre: detail.inventarioRef?.Nombre ?? detail.CodigoBarra,
        cantidad: this.toDecimalString(detail.Cantidad),
        costoUnitario: this.toDecimalString(detail.PrecioFactura ?? detail.inventarioRef?.CostoDolar ?? ZERO),
        subtotal: this.toDecimalString(
          new Prisma.Decimal(detail.Cantidad ?? ZERO).times(
            new Prisma.Decimal(detail.PrecioFactura ?? detail.inventarioRef?.CostoDolar ?? ZERO),
          ),
        ),
      })),
    };
  }

  private toDecimalString(value: unknown) {
    try {
      return new Prisma.Decimal((value ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2).toFixed(2);
    } catch {
      return "0.00";
    }
  }

  private getCurrentDatabaseName() {
    return this.prisma.$queryRawUnsafe<Array<{ database_name: string }>>(
      'SELECT current_database()::text AS database_name',
    ).then((rows) => String(rows[0]?.database_name || "").trim());
  }

  private resolveCurrentDestinationCode(databaseName: string) {
    const storeMatch = databaseName.match(/rocky_tienda_(\d+)/i);
    if (storeMatch) {
      return storeMatch[1].padStart(3, "0");
    }

    const warehouseMatch = databaseName.match(/rocky_bodega_(\d+)/i);
    if (warehouseMatch) {
      return `B${warehouseMatch[1].padStart(3, "0")}`;
    }

    return "ORIGEN";
  }
}

const ONE_DECIMAL = new Prisma.Decimal(1);
