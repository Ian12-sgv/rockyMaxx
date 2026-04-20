-- Generated from SQL Server metadata exports.
-- Source database: MODELOBD
-- Goal: PostgreSQL legacy mirror with exact table, column, PK, unique and FK shape where the engines allow it.
-- SQL Server programmable objects are inventoried separately because they require T-SQL to PL/pgSQL rewrites.

BEGIN;

CREATE SCHEMA IF NOT EXISTS dbo;

CREATE TABLE IF NOT EXISTS dbo."AJUSTES" (
  "Numero" bigint NOT NULL,
  "TipoAjuste" integer NOT NULL,
  "Signo" smallint NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "TotalValor" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(250) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "InterContable" integer DEFAULT 0 NOT NULL,
  "Status" integer DEFAULT 0 NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."BANCOS" (
  "Codigo" varchar(12) NOT NULL,
  "Nombre" varchar(30) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."CAJAS" (
  "Serie" varchar(15) NOT NULL,
  "Numero" smallint NOT NULL,
  "FondoCaja" numeric(24,8) NOT NULL,
  "TipoListaPrecio" smallint NOT NULL,
  "TipoVenta" smallint NOT NULL,
  "TipoReporte" smallint NOT NULL,
  "UltimaFactura" bigint DEFAULT 0 NOT NULL,
  "UltimaDevolucion" bigint DEFAULT 0 NOT NULL,
  "PermiteDescuento" smallint NOT NULL,
  "PermiteFacturasExentas" smallint DEFAULT 0 NOT NULL,
  "PermiteAlternarListas" smallint DEFAULT 0 NOT NULL,
  "CambiarPrecios" smallint DEFAULT 0 NOT NULL,
  "RequerirAutorizacion" smallint DEFAULT 0 NOT NULL,
  "IdImpresoraFiscal" numeric(2,0) DEFAULT 0 NOT NULL,
  "NombreImpresora" varchar(100) DEFAULT '',
  "NumeroCopias" integer DEFAULT 1,
  "IncluirIGTF" boolean
);

CREATE TABLE IF NOT EXISTS dbo."CARGOS" (
  "Codigo" varchar(3) NOT NULL,
  "Nombre" varchar(25) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."CATEGORIAS" (
  "Codigo" varchar(6) NOT NULL,
  "Nombre" varchar(60) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."CLIENTES" (
  "Codigo" varchar(15) NOT NULL,
  "Nombre" varchar(120) NOT NULL,
  "FechaIngreso" timestamp(0) without time zone NOT NULL,
  "Telefono" varchar(15) NOT NULL,
  "Direccion" varchar(300) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Tipo" smallint NOT NULL,
  "TipoContribuyente" smallint NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."COLORES" (
  "Codigo" varchar(3) NOT NULL,
  "Nombre" varchar(30) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."COMPRAS" (
  "Documento" varchar(12) NOT NULL,
  "Proveedor" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "FechaFactura" timestamp(0) without time zone NOT NULL,
  "PorcentajeDescuento" numeric(5,2) NOT NULL,
  "TipoPago" smallint NOT NULL,
  "DiasCredito" numeric(18,0) DEFAULT 0 NOT NULL,
  "Expediente" varchar(12) NOT NULL,
  "Observacion" varchar(100) NOT NULL,
  "TotalMercancia" numeric(24,8) NOT NULL,
  "TotalImpuesto" numeric(24,8) NOT NULL,
  "TotalImpuestoContable" numeric(24,8) NOT NULL,
  "TotalDescuento" numeric(24,8) NOT NULL,
  "TasaCambio" numeric(24,8) DEFAULT 1 NOT NULL,
  "Recargos" numeric(24,8) DEFAULT 0 NOT NULL,
  "TasaServicio" numeric(24,8) DEFAULT 0 NOT NULL,
  "OtrosImpuestos" numeric(24,8) DEFAULT 0 NOT NULL,
  "Flete" numeric(24,8) DEFAULT 0 NOT NULL,
  "Seguro" numeric(24,8) DEFAULT 0 NOT NULL,
  "PorcImpuestoGeneral" numeric(5,2) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "MetodoValorizacion" smallint DEFAULT 0 NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "BodegaExterna" smallint DEFAULT 0 NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL,
  "UsaFechaVencimiento" boolean
);

CREATE TABLE IF NOT EXISTS dbo."CTABANCOS" (
  "Codigo" varchar(12) NOT NULL,
  "Nombre" varchar(60) NOT NULL,
  "PuntoVenta" smallint DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."CTABANCOS_DOLARES" (
  "Codigo" varchar(12) NOT NULL,
  "Nombre" varchar(60) NOT NULL,
  "PuntoVenta" smallint DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."CTACONTABLE" (
  "Codigo" varchar(12) NOT NULL,
  "Nombre" varchar(50) NOT NULL,
  "ManejaDocumentos" smallint NOT NULL,
  "TieneAcreedor" smallint NOT NULL,
  "CuentaDevolucion" smallint DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."DEPOSITOS" (
  "NumeroDeposito" varchar(15) NOT NULL,
  "CuentaBanco" varchar(12) NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "TotalEfectivo" numeric(24,8) NOT NULL,
  "TotalCheques" numeric(24,8) NOT NULL,
  "Observacion" varchar(50) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "TasaCambio" numeric(24,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dbo."DEPOSITOS_DOLARES" (
  "NumeroDeposito" varchar(15) NOT NULL,
  "CuentaBanco" varchar(12) NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "TotalEfectivo" numeric(24,8) NOT NULL,
  "TotalCheques" numeric(24,8) NOT NULL,
  "Observacion" varchar(50) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "TasaCambio" numeric(24,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dbo."DEVCOMPRAS" (
  "Numero" bigint NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "Documento" varchar(12) NOT NULL,
  "Proveedor" varchar(15) NOT NULL,
  "TotalMercancia" numeric(24,8) NOT NULL,
  "TotalImpuesto" numeric(24,8) DEFAULT 0 NOT NULL,
  "PorcentajeDescuento" numeric(18,4) DEFAULT 0 NOT NULL,
  "TotalDescuento" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(250) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "InterContable" integer NOT NULL,
  "Status" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."DEVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoEnvia" varchar(12) NOT NULL,
  "CodigoRecibe" varchar(15) NOT NULL,
  "DocumentoOrigen" varchar(12) DEFAULT '' NOT NULL,
  "TotalValor" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(100) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "FechaEmision" timestamp(0) without time zone NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."DEVVENTAS" (
  "NumeroDevolucion" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "NumeroFactura" bigint NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "Vendedor" varchar(15) NOT NULL,
  "Cliente" varchar(15) NOT NULL,
  "TipoVenta" smallint NOT NULL,
  "TotalMercancia" numeric(24,8) NOT NULL,
  "TotalDescuento" numeric(24,8) NOT NULL,
  "TotalImpuesto" numeric(24,8) NOT NULL,
  "TotalCosto" numeric(24,8) NOT NULL,
  "InterContable" smallint NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "SerieFactura" varchar(15) DEFAULT ' ' NOT NULL,
  "Estacion" varchar(50),
  "TasaIGTF" numeric(24,2),
  "MontoIGTF" numeric(24,8),
  "BaseImponibleIGTF" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."DIARIOCAJA" (
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "Numero" smallint DEFAULT 0 NOT NULL,
  "FacturaInicial" bigint NOT NULL,
  "FacturaFinal" bigint NOT NULL,
  "PorcentajeImpuesto" numeric(10,2) DEFAULT 0 NOT NULL,
  "HoraApertura" timestamp(0) without time zone NOT NULL,
  "HoraCierre" timestamp(0) without time zone,
  "NumeroReporteZ" numeric(18,0) DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "ReporteZTexto" text DEFAULT '',
  "Acumulado" numeric(18,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."FABRICANTES" (
  "Codigo" varchar(12) NOT NULL,
  "Nombre" varchar(50) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."FORMAPAGO" (
  "Codigo" smallint NOT NULL,
  "Nombre" varchar(20) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Orden" integer
);

CREATE TABLE IF NOT EXISTS dbo."GRUPOS" (
  "CodGrupo" varchar(10) NOT NULL,
  "NombreGrupo" varchar(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."GRUPOSEG" (
  "CodGrupo" varchar(10) NOT NULL,
  "CodNodo" varchar(50) NOT NULL,
  "Ver" varchar(1)
);

CREATE TABLE IF NOT EXISTS dbo."IDEVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "CodigoEnvia" varchar(15) NOT NULL,
  "CodigoRecibe" varchar(12) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "FechaEmision" timestamp(0) without time zone NOT NULL,
  "TotalValor" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(100) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."IMOVDEVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "CodigoEnvia" varchar(15) NOT NULL,
  "Item" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) DEFAULT 0 NOT NULL,
  "Valor" numeric(24,8) DEFAULT 0 NOT NULL,
  "NumeroCaja" integer DEFAULT 0 NOT NULL,
  "UltimoCosto" numeric(24,8),
  "CostoInicial" numeric(24,8),
  "CostoDolar" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."IMOVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "CodigoEnvia" varchar(15) NOT NULL,
  "Item" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) DEFAULT 0 NOT NULL,
  "Valor" numeric(24,8) DEFAULT 0 NOT NULL,
  "NumeroCaja" integer DEFAULT 0 NOT NULL,
  "UltimoCosto" numeric(24,8),
  "CostoInicial" numeric(24,8),
  "CostoDolar" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."IMPRESORAFISCAL" (
  "ID" numeric(2,0) NOT NULL,
  "NombreImpresora" varchar(50) NOT NULL,
  "Status" smallint NOT NULL,
  "IdProcesoImpresion" numeric(2,0) DEFAULT 0,
  "MontoMaximoDiario" numeric(18,2) DEFAULT 0 NOT NULL,
  "IncluyeIGTF" boolean
);

CREATE TABLE IF NOT EXISTS dbo."IMPUESTOS" (
  "Codigo" smallint NOT NULL,
  "Nombre" varchar(20) NOT NULL,
  "PorcentajeImpuesto" numeric(10,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."INVENTARIO" (
  "CodigoBarra" varchar(15) NOT NULL,
  "Referencia" varchar(15) NOT NULL,
  "CodigoMarca" varchar(3) NOT NULL,
  "Nombre" varchar(150) NOT NULL,
  "Talla" varchar(6) NOT NULL,
  "CodigoColor" varchar(3) NOT NULL,
  "Fabricante" varchar(12) NOT NULL,
  "Categoria" varchar(6) NOT NULL,
  "Nota" varchar(255),
  "TipoImpuesto" smallint DEFAULT 1 NOT NULL,
  "PrecioDetal" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioMayor" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioAfiliado" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioPromocion" numeric(24,8) DEFAULT 0 NOT NULL,
  "Promocion" boolean DEFAULT FALSE NOT NULL,
  "FechaInicial" timestamp(0) without time zone NOT NULL,
  "FechaFinal" timestamp(0) without time zone NOT NULL,
  "CostoInicial" numeric(24,8) DEFAULT 0 NOT NULL,
  "CostoPromedio" numeric(24,8) DEFAULT 0 NOT NULL,
  "UltimoCosto" numeric(24,8) DEFAULT 0 NOT NULL,
  "CostoDolar" numeric(24,8) DEFAULT 0 NOT NULL,
  "ExistenciaInicial" numeric(18,2) DEFAULT 0 NOT NULL,
  "Existencia" numeric(18,2) DEFAULT 0 NOT NULL,
  "PuntoReorden" numeric(18,2) DEFAULT 0 NOT NULL,
  "FechaPrimerMovimiento" timestamp(0) without time zone,
  "UltimaActualizacion" timestamp(0) without time zone,
  "Tipo" smallint DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Serializado" smallint DEFAULT 0 NOT NULL,
  "CodigoBarraAnt" varchar(15) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."ITRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "CodigoEnvia" varchar(15) NOT NULL,
  "CodigoRecibe" varchar(12) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "FechaEmision" timestamp(0) without time zone NOT NULL,
  "TotalValor" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(100) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL,
  "IDDespacho" integer DEFAULT 0 NOT NULL,
  "Correccion" boolean DEFAULT FALSE NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."LISTAPRECIO" (
  "Numero" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "FactorDetal" numeric(5,2) NOT NULL,
  "FactorMayor" numeric(5,2) NOT NULL,
  "FactorAfiliado" numeric(5,2) NOT NULL,
  "Observacion" varchar(250),
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."LOTES" (
  "ID" integer NOT NULL,
  "Lote" varchar(10) NOT NULL,
  "Descripcion" varchar(200) NOT NULL,
  "Estado" smallint NOT NULL,
  "FechaRegistro" timestamp(3) without time zone NOT NULL,
  "UsuarioCreacion" varchar(15) DEFAULT 'SISTEMAS' NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MARCAS" (
  "Codigo" varchar(3) NOT NULL,
  "Nombre" varchar(20) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MOVCOMPRAS" (
  "Documento" varchar(12) NOT NULL,
  "Proveedor" varchar(15) NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) DEFAULT 0 NOT NULL,
  "CantidadDevuelta" numeric(18,2) DEFAULT 0 NOT NULL,
  "PrecioFactura" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioProrrateado" numeric(24,8) DEFAULT 0 NOT NULL,
  "PorcentajeImpuesto" numeric(5,2) DEFAULT 0 NOT NULL,
  "Impuesto" numeric(24,8) DEFAULT 0 NOT NULL,
  "Item" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MOVDEVBORRADOR" (
  "Numero" bigint NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) NOT NULL,
  "NumeroCaja" integer NOT NULL,
  "Item" integer NOT NULL,
  "Costo" numeric(24,8) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MOVDEVCOMPRAS" (
  "Numero" bigint NOT NULL,
  "Item" integer NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) NOT NULL,
  "Precio" numeric(24,8) NOT NULL,
  "PorcentajeImpuesto" numeric(18,2) DEFAULT 0 NOT NULL,
  "Impuesto" numeric(24,8) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MOVDEVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) DEFAULT 0 NOT NULL,
  "Valor" numeric(24,8) DEFAULT 0 NOT NULL,
  "NumeroCaja" integer DEFAULT 0 NOT NULL,
  "Item" integer DEFAULT 0 NOT NULL,
  "UltimoCosto" numeric(24,8),
  "CostoInicial" numeric(24,8),
  "CostoDolar" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."MOVDEVVENTAS" (
  "NumeroDevolucion" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Item" integer NOT NULL,
  "Hora" timestamp(0) without time zone NOT NULL,
  "TipoLista" varchar(1) NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Precio" numeric(24,8) NOT NULL,
  "PrecioLista" numeric(24,8) NOT NULL,
  "Costo" numeric(24,8) NOT NULL,
  "Impuesto" numeric(24,8) NOT NULL,
  "PorcentajeImpuesto" numeric(5,2) NOT NULL,
  "Cantidad" numeric(24,8) NOT NULL,
  "Medida" varchar(24) DEFAULT ' ' NOT NULL,
  "PorcentajeDescuento" numeric(5,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."MOVLISTAPRECIO" (
  "Numero" integer NOT NULL,
  "Referencia" varchar(50) NOT NULL,
  "CodigoMarca" varchar(3) NOT NULL,
  "Costo" numeric(24,8) DEFAULT 0 NOT NULL,
  "Descuento" numeric(5,2) NOT NULL,
  "PrecioDetalSugerido" numeric(24,8) NOT NULL,
  "PrecioDetal" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioMayorSugerido" numeric(24,8) NOT NULL,
  "PrecioMayor" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioAfiliadoSugerido" numeric(24,8) NOT NULL,
  "PrecioAfiliado" numeric(24,8) DEFAULT 0 NOT NULL,
  "PrecioPromocion" numeric(24,8) DEFAULT 0 NOT NULL,
  "Promocion" boolean DEFAULT FALSE NOT NULL,
  "FechaInicial" timestamp(0) without time zone NOT NULL,
  "FechaFinal" timestamp(0) without time zone NOT NULL,
  "UltimoCosto" numeric(24,8),
  "CostoInicial" numeric(24,8),
  "CostoDolar" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."MOVTRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "Fecha" timestamp(0) without time zone,
  "CodigoBarra" varchar(15) NOT NULL,
  "Cantidad" numeric(18,2) NOT NULL,
  "Valor" numeric(24,8) NOT NULL,
  "NumeroCaja" integer NOT NULL,
  "Item" integer NOT NULL,
  "UltimoCosto" numeric(24,8),
  "CostoInicial" numeric(24,8),
  "CostoDolar" numeric(24,8)
);

CREATE TABLE IF NOT EXISTS dbo."MOVVENTAS" (
  "NumeroFactura" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Hora" timestamp(0) without time zone NOT NULL,
  "TipoLista" varchar(1) NOT NULL,
  "CodigoBarra" varchar(15) NOT NULL,
  "Precio" numeric(24,8) NOT NULL,
  "PrecioLista" numeric(24,8) NOT NULL,
  "Costo" numeric(24,8) NOT NULL,
  "Impuesto" numeric(24,8) NOT NULL,
  "PorcentajeImpuesto" numeric(5,2) NOT NULL,
  "Cantidad" numeric(24,8) NOT NULL,
  "CantidadDevuelta" numeric(24,8) NOT NULL,
  "Item" integer NOT NULL,
  "PorcentajeDescuento" numeric(5,2) DEFAULT 0 NOT NULL,
  "PrecioDetal" numeric(24,4) DEFAULT 0 NOT NULL,
  "Regla" varchar(20) DEFAULT '' NOT NULL,
  "IDRegla" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."PAGOSVENTA" (
  "NumeroFactura" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Item" integer NOT NULL,
  "FormaPago" smallint NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "Documento" varchar(40) NOT NULL,
  "Aprobacion" varchar(12) NOT NULL,
  "Banco" varchar(12) NOT NULL,
  "PuntoVenta" varchar(12) NOT NULL,
  "Monto" numeric(24,8) DEFAULT 0 NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "JSON_Merchant" text,
  "MontoDivisa" numeric(24,8),
  "FormaPagoOriginal" smallint
);

CREATE TABLE IF NOT EXISTS dbo."PARAMETROS" (
  "Nombre" varchar(40),
  "Codigo" varchar(15),
  "NombreIdFiscal" varchar(6),
  "IDEmpresa" varchar(15),
  "Telefono" varchar(12),
  "Direccion" varchar(100),
  "CorreoElectronico" varchar(40),
  "Tipo" smallint NOT NULL,
  "SimboloMoneda" varchar(3),
  "Nota1" varchar(200),
  "Nota2" varchar(200),
  "ControlFactura" smallint NOT NULL,
  "UltimaFactura" bigint DEFAULT 0 NOT NULL,
  "UltimaDevolucion" bigint DEFAULT 0 NOT NULL,
  "RutaReporte" varchar(100),
  "CongelarFacturas" smallint NOT NULL,
  "MostrarBalanceDiario" smallint NOT NULL,
  "DiscriminarImpuestoPrecios" smallint NOT NULL,
  "ManejarClientesAfiliadosEspeciales" smallint DEFAULT 0 NOT NULL,
  "MargenAuxFact" numeric(18,2) DEFAULT 0 NOT NULL,
  "LineasDisponibles" smallint NOT NULL,
  "LineasReservadas" smallint NOT NULL,
  "ItemsPorFactura" integer DEFAULT 0 NOT NULL,
  "ActualizarPreciosArchivosExternos" smallint DEFAULT 1 NOT NULL,
  "DejarEditar" smallint DEFAULT 0 NOT NULL,
  "ManejarCantidadesDecimales" smallint DEFAULT 1 NOT NULL,
  "IdPais" varchar(2),
  "AutorizarEliminarItemFactura" smallint DEFAULT 0 NOT NULL,
  "VisualizarPromocion" smallint DEFAULT 0 NOT NULL,
  "VerificarCasaMatriz" smallint DEFAULT 1 NOT NULL,
  "IDPARAMETROS" integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."PROVEEDORES" (
  "Codigo" varchar(15) NOT NULL,
  "Nombre" varchar(120) NOT NULL,
  "Tipo" smallint NOT NULL,
  "Contacto" varchar(30),
  "FechaIngreso" timestamp(0) without time zone NOT NULL,
  "Pais" varchar(20) NOT NULL,
  "Estado" varchar(20) NOT NULL,
  "Ciudad" varchar(20) NOT NULL,
  "CodigoPostal" varchar(10) NOT NULL,
  "Direccion" varchar(250) NOT NULL,
  "Telefono" varchar(15) NOT NULL,
  "Fax" varchar(15) NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."SALIDASCAJA" (
  "Numero" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoContable" varchar(12) NOT NULL,
  "Acreedor" varchar(15) NOT NULL,
  "Documento" varchar(15) NOT NULL,
  "Descripcion" varchar(100) NOT NULL,
  "Monto" numeric(24,8) NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "TasaCambio" numeric(24,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dbo."SALIDASCAJA_DOLARES" (
  "Numero" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoContable" varchar(12) NOT NULL,
  "Acreedor" varchar(15) NOT NULL,
  "Documento" varchar(15) NOT NULL,
  "Descripcion" varchar(100) NOT NULL,
  "Monto" numeric(24,8) DEFAULT 0 NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "TasaCambio" numeric(24,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dbo."SEG" (
  "Nivel" integer NOT NULL,
  "NumNodo" integer NOT NULL,
  "NodoPadre" varchar(50) NOT NULL,
  "CodNodo" varchar(50) NOT NULL,
  "NomNodo" varchar(80) NOT NULL,
  "Imagen" bigint DEFAULT 0 NOT NULL,
  "Forma" varchar(50) NOT NULL,
  "Orden" integer DEFAULT 0 NOT NULL,
  "EsPadre" varchar(1) DEFAULT 'N' NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."SUCURSALES" (
  "Codigo" varchar(15) NOT NULL,
  "Nombre" varchar(100) DEFAULT '' NOT NULL,
  "Direccion" varchar(100) DEFAULT '' NOT NULL,
  "Telefono" varchar(15) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "PorcentajeDeRedondeo" numeric(5,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."sysdiagrams" (
  "name" varchar(128) NOT NULL,
  "principal_id" integer NOT NULL,
  "diagram_id" integer NOT NULL,
  "version" integer,
  "definition" bytea
);

CREATE TABLE IF NOT EXISTS dbo."TALLAS" (
  "Codigo" varchar(6) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TASA_CAMBIO" (
  "ID" bigint NOT NULL,
  "Fecha" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "Valor" numeric(24,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TASA_CAMBIO_M" (
  "ID" bigint NOT NULL,
  "Fecha" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "Valor" numeric(24,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TIPO_DESPACHO" (
  "ID" integer NOT NULL,
  "Descripcion" varchar(50) NOT NULL,
  "Estado" smallint DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TIPOSCLIENTE" (
  "Codigo" smallint NOT NULL,
  "Descripcion" varchar(20) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TIPOSCONTRIBUYENTE" (
  "Codigo" smallint NOT NULL,
  "Descripcion" varchar(20) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TIPOSPROVEEDOR" (
  "Codigo" smallint NOT NULL,
  "Descripcion" varchar(20) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."TRABAJADORES" (
  "Cedula" varchar(15) NOT NULL,
  "Codigo" integer NOT NULL,
  "Nombre" varchar(70) DEFAULT '' NOT NULL,
  "Cargo" varchar(3) NOT NULL,
  "FechaIngreso" timestamp(0) without time zone NOT NULL,
  "FechaNacimiento" timestamp(0) without time zone NOT NULL,
  "Direccion" varchar(200) DEFAULT '' NOT NULL,
  "Telefono" varchar(15) DEFAULT '' NOT NULL,
  "Celular" varchar(15) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "MarcajeInterDiario" boolean DEFAULT FALSE,
  "IndUsarCarnet" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dbo."TRANSFERENCIAS" (
  "Numero" integer NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "CodigoRecibe" varchar(15) NOT NULL,
  "CodigoEnvia" varchar(12) NOT NULL,
  "DocumentoOrigen" varchar(12) DEFAULT '' NOT NULL,
  "TotalValor" numeric(24,8) DEFAULT 0 NOT NULL,
  "Observacion" varchar(100) DEFAULT '' NOT NULL,
  "Status" smallint DEFAULT 0 NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "InterContable" smallint DEFAULT 0 NOT NULL,
  "FechaEmision" timestamp(0) without time zone NOT NULL,
  "IDLote" integer DEFAULT 0 NOT NULL,
  "IDDespacho" integer DEFAULT 0 NOT NULL,
  "Correccion" boolean DEFAULT FALSE NOT NULL,
  "Zona" varchar(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."USUARIOGRUPO" (
  "CodUsuario" varchar(15) NOT NULL,
  "CodGrupo" varchar(10) NOT NULL
);

CREATE TABLE IF NOT EXISTS dbo."USUARIOS" (
  "CodUsuario" varchar(15) NOT NULL,
  "NombreUsuario" varchar(50),
  "Pasword" varchar(50),
  "Status" smallint
);

CREATE TABLE IF NOT EXISTS dbo."VENTAS" (
  "NumeroFactura" bigint NOT NULL,
  "Serie" varchar(15) NOT NULL,
  "Fecha" timestamp(0) without time zone NOT NULL,
  "Vendedor" varchar(15) NOT NULL,
  "Cliente" varchar(15) NOT NULL,
  "TipoVenta" smallint NOT NULL,
  "FormaPago" smallint NOT NULL,
  "DiasCredito" smallint DEFAULT 0 NOT NULL,
  "TotalMercancia" numeric(24,8) NOT NULL,
  "TotalDescuento" numeric(24,8) NOT NULL,
  "TotalImpuesto" numeric(24,8) NOT NULL,
  "TotalCosto" numeric(24,8) NOT NULL,
  "InterContable" smallint NOT NULL,
  "Usuario" varchar(15) NOT NULL,
  "Status" smallint NOT NULL,
  "NumeroOrden" bigint DEFAULT 0 NOT NULL,
  "TotalPago" numeric(24,8) DEFAULT 0 NOT NULL,
  "TotalDolares" numeric(24,2) DEFAULT 0,
  "TasaCambio" numeric(24,2),
  "Estacion" varchar(50),
  "TotalDolaresE" numeric(24,2) DEFAULT 0,
  "TasaIGTF" numeric(24,2),
  "MontoIGTF" numeric(24,8),
  "BaseImponibleIGTF" numeric(24,8)
);

CREATE SEQUENCE IF NOT EXISTS dbo."SQ_IMPRESORAFISCAL_ID" START WITH 0 MINVALUE 0 INCREMENT BY 1;
ALTER SEQUENCE dbo."SQ_IMPRESORAFISCAL_ID" OWNED BY dbo."IMPRESORAFISCAL"."ID";
ALTER TABLE ONLY dbo."IMPRESORAFISCAL" ALTER COLUMN "ID" SET DEFAULT nextval('dbo."SQ_IMPRESORAFISCAL_ID"'::regclass);

CREATE SEQUENCE IF NOT EXISTS dbo."SQ_LOTES_ID" START WITH 0 MINVALUE 0 INCREMENT BY 1;
ALTER SEQUENCE dbo."SQ_LOTES_ID" OWNED BY dbo."LOTES"."ID";
ALTER TABLE ONLY dbo."LOTES" ALTER COLUMN "ID" SET DEFAULT nextval('dbo."SQ_LOTES_ID"'::regclass);

CREATE SEQUENCE IF NOT EXISTS dbo."SQ_sysdiagrams_diagram_id" START WITH 1 INCREMENT BY 1;
ALTER SEQUENCE dbo."SQ_sysdiagrams_diagram_id" OWNED BY dbo."sysdiagrams"."diagram_id";
ALTER TABLE ONLY dbo."sysdiagrams" ALTER COLUMN "diagram_id" SET DEFAULT nextval('dbo."SQ_sysdiagrams_diagram_id"'::regclass);

CREATE SEQUENCE IF NOT EXISTS dbo."SQ_TASA_CAMBIO_ID" START WITH 1 INCREMENT BY 1;
ALTER SEQUENCE dbo."SQ_TASA_CAMBIO_ID" OWNED BY dbo."TASA_CAMBIO"."ID";
ALTER TABLE ONLY dbo."TASA_CAMBIO" ALTER COLUMN "ID" SET DEFAULT nextval('dbo."SQ_TASA_CAMBIO_ID"'::regclass);

CREATE SEQUENCE IF NOT EXISTS dbo."SQ_TASA_CAMBIO_M_ID" START WITH 1 INCREMENT BY 1;
ALTER SEQUENCE dbo."SQ_TASA_CAMBIO_M_ID" OWNED BY dbo."TASA_CAMBIO_M"."ID";
ALTER TABLE ONLY dbo."TASA_CAMBIO_M" ALTER COLUMN "ID" SET DEFAULT nextval('dbo."SQ_TASA_CAMBIO_M_ID"'::regclass);

ALTER TABLE ONLY dbo."AJUSTES" ADD CONSTRAINT "PK_AJUSTES" PRIMARY KEY ("Numero");

ALTER TABLE ONLY dbo."BANCOS" ADD CONSTRAINT "PK_BANCOS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."CAJAS" ADD CONSTRAINT "PK_CAJAS" PRIMARY KEY ("Serie");

ALTER TABLE ONLY dbo."CARGOS" ADD CONSTRAINT "PK_CARGOS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."CATEGORIAS" ADD CONSTRAINT "PK_CATEGORIAS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."CLIENTES" ADD CONSTRAINT "PK_CLIENTES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."COLORES" ADD CONSTRAINT "PK_COLORES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."COMPRAS" ADD CONSTRAINT "PK_COMPRAS" PRIMARY KEY ("Documento", "Proveedor");

ALTER TABLE ONLY dbo."CTABANCOS" ADD CONSTRAINT "PK_CTABANCOS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."CTABANCOS_DOLARES" ADD CONSTRAINT "PK_CTABANCOS_DOLARES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."CTACONTABLE" ADD CONSTRAINT "PK_CTACONTABLE" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."DEPOSITOS" ADD CONSTRAINT "PK_DEPOSITOS" PRIMARY KEY ("NumeroDeposito", "CuentaBanco", "Serie");

ALTER TABLE ONLY dbo."DEPOSITOS_DOLARES" ADD CONSTRAINT "PK_DEPOSITOS_DOLARES" PRIMARY KEY ("NumeroDeposito", "CuentaBanco", "Serie");

ALTER TABLE ONLY dbo."DEVCOMPRAS" ADD CONSTRAINT "PK_DEVCOMPRAS" PRIMARY KEY ("Numero");

ALTER TABLE ONLY dbo."DEVTRANSFERENCIAS" ADD CONSTRAINT "PK_DEVTRANSFERENCIAS" PRIMARY KEY ("Numero");

ALTER TABLE ONLY dbo."DEVVENTAS" ADD CONSTRAINT "PK_DEVVENTAS" PRIMARY KEY ("NumeroDevolucion", "Serie");

ALTER TABLE ONLY dbo."DIARIOCAJA" ADD CONSTRAINT "PK_DIARIOCAJA_1" PRIMARY KEY ("Serie", "Fecha");

ALTER TABLE ONLY dbo."FABRICANTES" ADD CONSTRAINT "PK_FABRICANTES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."FORMAPAGO" ADD CONSTRAINT "PK_FORMAPAGO" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."GRUPOS" ADD CONSTRAINT "PK_GRUPOS" PRIMARY KEY ("CodGrupo");

ALTER TABLE ONLY dbo."GRUPOSEG" ADD CONSTRAINT "PK_GRUPOSEG" PRIMARY KEY ("CodGrupo", "CodNodo");

ALTER TABLE ONLY dbo."IDEVTRANSFERENCIAS" ADD CONSTRAINT "PK_IDEVTRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoEnvia");

ALTER TABLE ONLY dbo."IMOVDEVTRANSFERENCIAS" ADD CONSTRAINT "PK_IMOVDEVTRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoEnvia", "Item", "CodigoBarra", "NumeroCaja");

ALTER TABLE ONLY dbo."IMOVTRANSFERENCIAS" ADD CONSTRAINT "PK_IMOVTRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoEnvia", "Item", "CodigoBarra", "NumeroCaja");

ALTER TABLE ONLY dbo."IMPRESORAFISCAL" ADD CONSTRAINT "PK_ImpresoraFiscal" PRIMARY KEY ("ID");

ALTER TABLE ONLY dbo."IMPUESTOS" ADD CONSTRAINT "PK_IMPUESTOS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "PK_INVENTARIO" PRIMARY KEY ("CodigoBarra");

ALTER TABLE ONLY dbo."ITRANSFERENCIAS" ADD CONSTRAINT "PK_ITRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoEnvia");

ALTER TABLE ONLY dbo."LISTAPRECIO" ADD CONSTRAINT "PK_LISTAPRECIO" PRIMARY KEY ("Numero");

ALTER TABLE ONLY dbo."LOTES" ADD CONSTRAINT "PK_LOTES" PRIMARY KEY ("ID");
ALTER TABLE ONLY dbo."LOTES" ADD CONSTRAINT "IX_LOTES" UNIQUE ("Lote");

ALTER TABLE ONLY dbo."MARCAS" ADD CONSTRAINT "PK_MARCAS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."MOVCOMPRAS" ADD CONSTRAINT "PK_MOVCOMPRAS" PRIMARY KEY ("Documento", "Proveedor", "Item");

ALTER TABLE ONLY dbo."MOVDEVBORRADOR" ADD CONSTRAINT "PK_MOVDEVBORRADOR" PRIMARY KEY ("Numero", "CodigoBarra", "Item");

ALTER TABLE ONLY dbo."MOVDEVCOMPRAS" ADD CONSTRAINT "PK_MOVDEVCOMPRAS" PRIMARY KEY ("Numero", "Item");

ALTER TABLE ONLY dbo."MOVDEVTRANSFERENCIAS" ADD CONSTRAINT "PK_MOVDEVTRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoBarra", "NumeroCaja", "Item");

ALTER TABLE ONLY dbo."MOVDEVVENTAS" ADD CONSTRAINT "PK_MOVDEVVENTAS" PRIMARY KEY ("NumeroDevolucion", "Serie", "Item");

ALTER TABLE ONLY dbo."MOVLISTAPRECIO" ADD CONSTRAINT "PK_MOVLISTAPRECIO_1" PRIMARY KEY ("Numero", "Referencia", "CodigoMarca");

ALTER TABLE ONLY dbo."MOVTRANSFERENCIAS" ADD CONSTRAINT "PK_MOVTRANSFERENCIAS" PRIMARY KEY ("Numero", "CodigoBarra", "NumeroCaja", "Item");

ALTER TABLE ONLY dbo."MOVVENTAS" ADD CONSTRAINT "PK_MOVVENTAS" PRIMARY KEY ("NumeroFactura", "Serie", "Item");

ALTER TABLE ONLY dbo."PAGOSVENTA" ADD CONSTRAINT "PK_PAGOSVENTA" PRIMARY KEY ("NumeroFactura", "Serie", "Item");

ALTER TABLE ONLY dbo."PARAMETROS" ADD CONSTRAINT "pkIDPARAMETROS" PRIMARY KEY ("IDPARAMETROS");
ALTER TABLE ONLY dbo."PARAMETROS" ADD CONSTRAINT "uqIDPARAMETROS" UNIQUE ("IDPARAMETROS");

ALTER TABLE ONLY dbo."PROVEEDORES" ADD CONSTRAINT "PK_PROVEEDORES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."SALIDASCAJA" ADD CONSTRAINT "PK_SALIDASCAJA" PRIMARY KEY ("Numero", "Serie");

ALTER TABLE ONLY dbo."SALIDASCAJA_DOLARES" ADD CONSTRAINT "PK_SALIDASCAJA_DOLARES" PRIMARY KEY ("Numero", "Serie");

ALTER TABLE ONLY dbo."SEG" ADD CONSTRAINT "PK_SEG" PRIMARY KEY ("CodNodo");

ALTER TABLE ONLY dbo."SUCURSALES" ADD CONSTRAINT "PK_SUCURSALES" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."sysdiagrams" ADD CONSTRAINT "PK__sysdiagrams__014935CB" PRIMARY KEY ("diagram_id");
ALTER TABLE ONLY dbo."sysdiagrams" ADD CONSTRAINT "UK_principal_name" UNIQUE ("principal_id", "name");

ALTER TABLE ONLY dbo."TALLAS" ADD CONSTRAINT "PK_TALLAS" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."TASA_CAMBIO" ADD CONSTRAINT "PK_TASA_CAMBIO" PRIMARY KEY ("ID");

ALTER TABLE ONLY dbo."TASA_CAMBIO_M" ADD CONSTRAINT "PK_TASA_CAMBIO_M" PRIMARY KEY ("ID");

ALTER TABLE ONLY dbo."TIPO_DESPACHO" ADD CONSTRAINT "PK_TIPO_DESPACHO" PRIMARY KEY ("ID");
ALTER TABLE ONLY dbo."TIPO_DESPACHO" ADD CONSTRAINT "IX_TIPO_DESPACHO" UNIQUE ("Descripcion");

ALTER TABLE ONLY dbo."TIPOSCLIENTE" ADD CONSTRAINT "PK_TIPOSCLIENTE" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."TIPOSCONTRIBUYENTE" ADD CONSTRAINT "PK_TIPOSCONTRIBUYENTE" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."TIPOSPROVEEDOR" ADD CONSTRAINT "PK_TIPOSPROVEEDOR" PRIMARY KEY ("Codigo");

ALTER TABLE ONLY dbo."TRABAJADORES" ADD CONSTRAINT "PK_TRABAJADORES" PRIMARY KEY ("Cedula");

ALTER TABLE ONLY dbo."TRANSFERENCIAS" ADD CONSTRAINT "PK_TRANSFERENCIAS" PRIMARY KEY ("Numero");

ALTER TABLE ONLY dbo."USUARIOGRUPO" ADD CONSTRAINT "PK_USUARIOGRUPO" PRIMARY KEY ("CodUsuario", "CodGrupo");

ALTER TABLE ONLY dbo."USUARIOS" ADD CONSTRAINT "PK_USUARIOS" PRIMARY KEY ("CodUsuario");

ALTER TABLE ONLY dbo."VENTAS" ADD CONSTRAINT "PK_VENTAS" PRIMARY KEY ("NumeroFactura", "Serie");

ALTER TABLE ONLY dbo."CAJAS" ADD CONSTRAINT "FK_CAJAS_ImpresoraFiscal" FOREIGN KEY ("IdImpresoraFiscal") REFERENCES dbo."IMPRESORAFISCAL" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."CLIENTES" ADD CONSTRAINT "FK_CLIENTES_TIPOSCLIENTE" FOREIGN KEY ("Tipo") REFERENCES dbo."TIPOSCLIENTE" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."CLIENTES" ADD CONSTRAINT "FK_CLIENTES_TIPOSCONTRIBUYENTE" FOREIGN KEY ("TipoContribuyente") REFERENCES dbo."TIPOSCONTRIBUYENTE" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."COMPRAS" ADD CONSTRAINT "FK_COMPRAS_LOTES" FOREIGN KEY ("IDLote") REFERENCES dbo."LOTES" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."COMPRAS" ADD CONSTRAINT "FK_COMPRAS_PROVEEDORES" FOREIGN KEY ("Proveedor") REFERENCES dbo."PROVEEDORES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."COMPRAS" ADD CONSTRAINT "FK_COMPRAS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS" ADD CONSTRAINT "FK_DEPOSITOS_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS" ADD CONSTRAINT "FK_DEPOSITOS_CTABANCOS" FOREIGN KEY ("CuentaBanco") REFERENCES dbo."CTABANCOS" ("Codigo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS" ADD CONSTRAINT "FK_DEPOSITOS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS_DOLARES" ADD CONSTRAINT "FK_DEPOSITOS_DOLARES_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS_DOLARES" ADD CONSTRAINT "FK_DEPOSITOS_DOLARES_CTABANCOS" FOREIGN KEY ("CuentaBanco") REFERENCES dbo."CTABANCOS_DOLARES" ("Codigo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEPOSITOS_DOLARES" ADD CONSTRAINT "FK_DEPOSITOS_DOLARES_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVCOMPRAS" ADD CONSTRAINT "FK_DEVCOMPRAS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVTRANSFERENCIAS" ADD CONSTRAINT "FK_DEVTRANSFERENCIAS_LOTES" FOREIGN KEY ("IDLote") REFERENCES dbo."LOTES" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."DEVTRANSFERENCIAS" ADD CONSTRAINT "FK_DEVTRANSFERENCIAS_SUCURSALES" FOREIGN KEY ("CodigoRecibe") REFERENCES dbo."SUCURSALES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVVENTAS" ADD CONSTRAINT "FK_DEVVENTAS_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVVENTAS" ADD CONSTRAINT "FK_DEVVENTAS_CLIENTES" FOREIGN KEY ("Cliente") REFERENCES dbo."CLIENTES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVVENTAS" ADD CONSTRAINT "FK_DEVVENTAS_TRABAJADORES" FOREIGN KEY ("Vendedor") REFERENCES dbo."TRABAJADORES" ("Cedula") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DEVVENTAS" ADD CONSTRAINT "FK_DEVVENTAS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."DIARIOCAJA" ADD CONSTRAINT "FK_DIARIOCAJA_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."GRUPOSEG" ADD CONSTRAINT "FK_GRUPOSEG_GRUPOS" FOREIGN KEY ("CodGrupo") REFERENCES dbo."GRUPOS" ("CodGrupo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."GRUPOSEG" ADD CONSTRAINT "FK_GRUPOSEG_SEG" FOREIGN KEY ("CodNodo") REFERENCES dbo."SEG" ("CodNodo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_IDEVTRANSFERENCIAS_LOTES" FOREIGN KEY ("IDLote") REFERENCES dbo."LOTES" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."IDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_IDEVTRANSFERENCIAS_SUCURSALES" FOREIGN KEY ("CodigoEnvia") REFERENCES dbo."SUCURSALES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IMOVDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_IMOVDEVTRANSFERENCIAS_IDEVTRANSFERENCIAS" FOREIGN KEY ("Numero", "CodigoEnvia") REFERENCES dbo."IDEVTRANSFERENCIAS" ("Numero", "CodigoEnvia") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IMOVDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_IMOVDEVTRANSFERENCIAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IMOVTRANSFERENCIAS" ADD CONSTRAINT "FK_IMOVTRANSFERENCIAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IMOVTRANSFERENCIAS" ADD CONSTRAINT "FK_IMOVTRANSFERENCIAS_ITRANSFERENCIAS" FOREIGN KEY ("Numero", "CodigoEnvia") REFERENCES dbo."ITRANSFERENCIAS" ("Numero", "CodigoEnvia") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."IMPRESORAFISCAL" ADD CONSTRAINT "FK_ImpresoraFiscal_ImpresoraFiscal" FOREIGN KEY ("ID") REFERENCES dbo."IMPRESORAFISCAL" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_CATEGORIAS" FOREIGN KEY ("Categoria") REFERENCES dbo."CATEGORIAS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_COLORES" FOREIGN KEY ("CodigoColor") REFERENCES dbo."COLORES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_FABRICANTES" FOREIGN KEY ("Fabricante") REFERENCES dbo."FABRICANTES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_IMPUESTOS" FOREIGN KEY ("TipoImpuesto") REFERENCES dbo."IMPUESTOS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_MARCAS" FOREIGN KEY ("CodigoMarca") REFERENCES dbo."MARCAS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."INVENTARIO" ADD CONSTRAINT "FK_INVENTARIO_TALLAS" FOREIGN KEY ("Talla") REFERENCES dbo."TALLAS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."ITRANSFERENCIAS" ADD CONSTRAINT "FK_ITRANSFERENCIAS_LOTES" FOREIGN KEY ("IDLote") REFERENCES dbo."LOTES" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."ITRANSFERENCIAS" ADD CONSTRAINT "FK_ITRANSFERENCIAS_SUCURSALES" FOREIGN KEY ("CodigoEnvia") REFERENCES dbo."SUCURSALES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."ITRANSFERENCIAS" ADD CONSTRAINT "FK_ITRANSFERENCIAS_TIPO_DESPACHO" FOREIGN KEY ("IDDespacho") REFERENCES dbo."TIPO_DESPACHO" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."LISTAPRECIO" ADD CONSTRAINT "FK_LISTAPRECIO_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."LOTES" ADD CONSTRAINT "FK_LOTES_USUARIOS" FOREIGN KEY ("UsuarioCreacion") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVCOMPRAS" ADD CONSTRAINT "FK_MOVCOMPRAS_COMPRAS" FOREIGN KEY ("Documento", "Proveedor") REFERENCES dbo."COMPRAS" ("Documento", "Proveedor") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVCOMPRAS" ADD CONSTRAINT "FK_MOVCOMPRAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVCOMPRAS" ADD CONSTRAINT "FK_MOVDEVCOMPRAS_DEVCOMPRAS" FOREIGN KEY ("Numero") REFERENCES dbo."DEVCOMPRAS" ("Numero") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVCOMPRAS" ADD CONSTRAINT "FK_MOVDEVCOMPRAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_MOVDEVTRANSFERENCIAS_DEVTRANSFERENCIAS" FOREIGN KEY ("Numero") REFERENCES dbo."DEVTRANSFERENCIAS" ("Numero") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVTRANSFERENCIAS" ADD CONSTRAINT "FK_MOVDEVTRANSFERENCIAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVVENTAS" ADD CONSTRAINT "FK_MOVDEVVENTAS_DEVVENTAS" FOREIGN KEY ("NumeroDevolucion", "Serie") REFERENCES dbo."DEVVENTAS" ("NumeroDevolucion", "Serie") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVDEVVENTAS" ADD CONSTRAINT "FK_MOVDEVVENTAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVLISTAPRECIO" ADD CONSTRAINT "FK_MOVLISTAPRECIO_LISTAPRECIO" FOREIGN KEY ("Numero") REFERENCES dbo."LISTAPRECIO" ("Numero") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVLISTAPRECIO" ADD CONSTRAINT "FK_MOVLISTAPRECIO_MARCAS" FOREIGN KEY ("CodigoMarca") REFERENCES dbo."MARCAS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVTRANSFERENCIAS" ADD CONSTRAINT "FK_MOVTRANSFERENCIAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVTRANSFERENCIAS" ADD CONSTRAINT "FK_MOVTRANSFERENCIAS_TRANSFERENCIAS" FOREIGN KEY ("Numero") REFERENCES dbo."TRANSFERENCIAS" ("Numero") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVVENTAS" ADD CONSTRAINT "FK_MOVVENTAS_INVENTARIO" FOREIGN KEY ("CodigoBarra") REFERENCES dbo."INVENTARIO" ("CodigoBarra") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."MOVVENTAS" ADD CONSTRAINT "FK_MOVVENTAS_VENTAS" FOREIGN KEY ("NumeroFactura", "Serie") REFERENCES dbo."VENTAS" ("NumeroFactura", "Serie") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."PAGOSVENTA" ADD CONSTRAINT "FK_PAGOSVENTA_BANCOS" FOREIGN KEY ("Banco") REFERENCES dbo."BANCOS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."PAGOSVENTA" ADD CONSTRAINT "FK_PAGOSVENTA_CTABANCOS" FOREIGN KEY ("PuntoVenta") REFERENCES dbo."CTABANCOS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."PAGOSVENTA" ADD CONSTRAINT "FK_PAGOSVENTA_FORMAPAGO" FOREIGN KEY ("FormaPago") REFERENCES dbo."FORMAPAGO" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."PAGOSVENTA" ADD CONSTRAINT "FK_PAGOSVENTA_VENTAS" FOREIGN KEY ("NumeroFactura", "Serie") REFERENCES dbo."VENTAS" ("NumeroFactura", "Serie") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."PROVEEDORES" ADD CONSTRAINT "FK_PROVEEDORES_TIPOSPROVEEDOR" FOREIGN KEY ("Tipo") REFERENCES dbo."TIPOSPROVEEDOR" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."SALIDASCAJA" ADD CONSTRAINT "FK_SALIDASCAJA_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."SALIDASCAJA" ADD CONSTRAINT "FK_SALIDASCAJA_CTACONTABLE" FOREIGN KEY ("CodigoContable") REFERENCES dbo."CTACONTABLE" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."SALIDASCAJA_DOLARES" ADD CONSTRAINT "FK_SALIDASCAJA_DOLARES_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."SALIDASCAJA_DOLARES" ADD CONSTRAINT "FK_SALIDASCAJA_DOLARES_CTACONTABLE" FOREIGN KEY ("CodigoContable") REFERENCES dbo."CTACONTABLE" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."TRABAJADORES" ADD CONSTRAINT "FK_TRABAJADORES_CARGOS" FOREIGN KEY ("Cargo") REFERENCES dbo."CARGOS" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."TRANSFERENCIAS" ADD CONSTRAINT "FK_TRANSFERENCIAS_LOTES" FOREIGN KEY ("IDLote") REFERENCES dbo."LOTES" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."TRANSFERENCIAS" ADD CONSTRAINT "FK_TRANSFERENCIAS_SUCURSALES" FOREIGN KEY ("CodigoRecibe") REFERENCES dbo."SUCURSALES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."TRANSFERENCIAS" ADD CONSTRAINT "FK_TRANSFERENCIAS_TIPO_DESPACHO" FOREIGN KEY ("IDDespacho") REFERENCES dbo."TIPO_DESPACHO" ("ID") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE ONLY dbo."TRANSFERENCIAS" ADD CONSTRAINT "FK_TRANSFERENCIAS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."USUARIOGRUPO" ADD CONSTRAINT "FK_USUARIOGRUPO_GRUPOS" FOREIGN KEY ("CodGrupo") REFERENCES dbo."GRUPOS" ("CodGrupo") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."USUARIOGRUPO" ADD CONSTRAINT "FK_USUARIOGRUPO_USUARIOS" FOREIGN KEY ("CodUsuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."VENTAS" ADD CONSTRAINT "FK_VENTAS_CAJAS" FOREIGN KEY ("Serie") REFERENCES dbo."CAJAS" ("Serie") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."VENTAS" ADD CONSTRAINT "FK_VENTAS_CLIENTES" FOREIGN KEY ("Cliente") REFERENCES dbo."CLIENTES" ("Codigo") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."VENTAS" ADD CONSTRAINT "FK_VENTAS_TRABAJADORES" FOREIGN KEY ("Vendedor") REFERENCES dbo."TRABAJADORES" ("Cedula") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE ONLY dbo."VENTAS" ADD CONSTRAINT "FK_VENTAS_USUARIOS" FOREIGN KEY ("Usuario") REFERENCES dbo."USUARIOS" ("CodUsuario") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;

-- Source SQL Server collation inventory:
--   Modern_Spanish_CI_AS: 187 columns
-- SQL Server clustered index semantics are not portable 1:1 to PostgreSQL heap tables.
-- SQL Server views, procedures and functions are not emitted here; see the markdown report for the exact inventory.
