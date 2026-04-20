# Legacy SQL Server Audit

## Source Snapshot

- Source engine: SQL Server
- Source database: `MODELOBD`
- Compatibility level: `100`
- Inspection basis:
  - catalog metadata exported from `sys.tables`, `sys.columns`, `sys.foreign_keys`, `sys.indexes`
  - module definitions from `sys.objects` and `sys.sql_modules`
  - unresolved dependency export from `sys.sql_expression_dependencies`

## Structural Summary

- Total tables discovered: `59`
- Business tables with PK defined: `58`
- System diagram table present: `dbo.sysdiagrams`
- Tables with rows: `16`
- Tables without rows: `43`
- Foreign keys: `74`
- FK column mappings: `80`
- Indexes: `63`
- Defaults: `179`
- Check constraints: `0`
- Identity columns: `5`
- Computed columns: `0`

## Core Transactional Tables Confirmed

### Inventory

- `dbo.INVENTARIO`
- PK: `CodigoBarra`
- Holds both catalog data and stock or cost state:
  - `Referencia`
  - `CodigoMarca`
  - `Talla`
  - `CodigoColor`
  - `Fabricante`
  - `Categoria`
  - `TipoImpuesto`
  - `PrecioDetal`
  - `PrecioMayor`
  - `PrecioAfiliado`
  - `PrecioPromocion`
  - `Promocion`
  - `CostoInicial`
  - `CostoPromedio`
  - `UltimoCosto`
  - `CostoDolar`
  - `ExistenciaInicial`
  - `Existencia`
  - `PuntoReorden`
  - `Serializado`
- FKs confirmed:
  - `Categoria -> CATEGORIAS.Codigo`
  - `CodigoColor -> COLORES.Codigo`
  - `Fabricante -> FABRICANTES.Codigo`
  - `TipoImpuesto -> IMPUESTOS.Codigo`
  - `CodigoMarca -> MARCAS.Codigo`
  - `Talla -> TALLAS.Codigo`

### Sales

- `dbo.VENTAS`
- PK: `NumeroFactura + Serie`
- Child detail: `dbo.MOVVENTAS`
- Detail PK: `NumeroFactura + Serie + Item`
- Payment detail: `dbo.PAGOSVENTA`
- Payment PK: `NumeroFactura + Serie + Item`
- FKs confirmed on header:
  - `Serie -> CAJAS.Serie`
  - `Cliente -> CLIENTES.Codigo`
  - `Vendedor -> TRABAJADORES.Cedula`
  - `Usuario -> USUARIOS.CodUsuario`
- FKs confirmed on detail:
  - `CodigoBarra -> INVENTARIO.CodigoBarra`
  - `NumeroFactura + Serie -> VENTAS`
- FKs confirmed on payments:
  - `Banco -> BANCOS.Codigo`
  - `PuntoVenta -> CTABANCOS.Codigo`
  - `FormaPago -> FORMAPAGO.Codigo`
  - `NumeroFactura + Serie -> VENTAS`

### Purchases

- `dbo.COMPRAS`
- PK: `Documento + Proveedor`
- Child detail: `dbo.MOVCOMPRAS`
- Detail PK: `Documento + Proveedor + Item`
- FKs confirmed on header:
  - `IDLote -> LOTES.ID`
  - `Proveedor -> PROVEEDORES.Codigo`
  - `Usuario -> USUARIOS.CodUsuario`
- FKs confirmed on detail:
  - `Documento + Proveedor -> COMPRAS`
  - `CodigoBarra -> INVENTARIO.CodigoBarra`

### Transfers

- `dbo.TRANSFERENCIAS`
- PK: `Numero`
- Child detail: `dbo.MOVTRANSFERENCIAS`
- Detail PK: `Numero + CodigoBarra + NumeroCaja + Item`
- FKs confirmed on header:
  - `IDLote -> LOTES.ID`
  - `CodigoRecibe -> SUCURSALES.Codigo`
  - `IDDespacho -> TIPO_DESPACHO.ID`
  - `Usuario -> USUARIOS.CodUsuario`
- FKs confirmed on detail:
  - `CodigoBarra -> INVENTARIO.CodigoBarra`
  - `Numero -> TRANSFERENCIAS.Numero`

### Returns and Adjustments

- `dbo.DEVVENTAS`
- `dbo.MOVDEVVENTAS`
- `dbo.DEVCOMPRAS`
- `dbo.MOVDEVCOMPRAS`
- `dbo.AJUSTES`
- `MOVAJUSTES` is referenced by modules, but not present in the exported catalog

### Cash and Banking

- `dbo.CAJAS`
- `dbo.DIARIOCAJA`
- `dbo.SALIDASCAJA`
- `dbo.DEPOSITOS`
- `dbo.BANCOS`
- `dbo.CTABANCOS`
- `dbo.CTABANCOS_DOLARES`

## Key Data Reality

The exported snapshot is structurally useful but almost empty for transactional behavior.

- `INVENTARIO`: `0` rows
- `VENTAS`: `0` rows
- `MOVVENTAS`: `0` rows
- `COMPRAS`: `0` rows
- `MOVCOMPRAS`: `0` rows
- `TRANSFERENCIAS`: `0` rows
- `MOVTRANSFERENCIAS`: `0` rows
- `CLIENTES`: `0` rows
- `CAJAS`: `0` rows
- `DEPOSITOS`: `0` rows
- `USUARIOS`: `0` rows
- `PAGOSVENTA`: `0` rows
- `PARAMETROS`: `0` rows
- `PROVEEDORES`: `1` row

Implication:

- structural analysis is reliable
- behavioral inference from live data is limited
- status catalogs, document state transitions, and operational sequences are not derivable from data in this snapshot

## Confirmed Modeling Weaknesses

- Heavy use of natural and composite primary keys
- Business document numbering embedded in PKs instead of separate business unique keys
- No check constraints despite multiple status and type fields
- Inventory master and inventory balance stored in the same table
- `DEVCOMPRAS` does not declare FK back to `COMPRAS`
- `DEVVENTAS` does not declare FK back to the original sale using `NumeroFactura` and `SerieFactura`
- `TRANSFERENCIAS.CodigoEnvia` is not enforced by FK in the exported schema
- `PARAMETROS` behaves like a singleton configuration table
- `USUARIOS.Pasword` is a plain varchar field in the legacy structure

## SQL Module Dependency Findings

There are unresolved dependencies in the database modules.

- Unresolved dependency rows: `71`
- Referencing modules affected: `44`
- Missing or unresolved object names: `27`

Most repeated unresolved names:

- `CODIGOS_RECARGOS`
- `PromocionesYOfertas_DevolverRemanente`
- `MOVTOMAFISICA1`
- `CONTROLACCESO`
- `TOMAFISICA1`
- `PATRON`
- `GRUPO_REGLAS`
- `MOVAJUSTES`
- `DETALLECONTROLACCESO`
- `DISPOSITIVOSMARCAJE`
- `CONFIGURACIONMARCAJE`
- `FISICOLOGICO`
- `TABLA_VALORES`
- `REFERENCIAS_MAYORISTAS`
- `SALDODIARIO`
- `fSALDODIARIO_InventarioDiario`

Modules directly affected for the commercial core:

- `ActualizarMovimientoFisicologico`
  - unresolved: `FISICOLOGICO`, `MOVAJUSTES`
- `CONSULTAS_ENTRADASYSALIDAS`
  - unresolved: `SALDODIARIO`, `fSALDODIARIO_InventarioDiario`
- `VW_AJUSTESNEGATIVOS`
  - unresolved: `MOVAJUSTES`
- `VW_AJUSTESPOSITIVOS`
  - unresolved: `MOVAJUSTES`

## Migration Position

The legacy database is sufficient to redesign the transactional core, but not sufficient to reproduce every legacy module without additional source material.

Safe redesign scope:

- products and SKU catalog
- prices and taxes
- customers and suppliers
- sales and sale items
- sale payments
- purchases and purchase items
- purchase returns
- sale returns
- transfers
- cash registers, bank accounts, deposits
- users and company settings

Modules that should be treated as separate redesign tracks:

- promotions and coupons
- physical counts or `toma fisica`
- daily inventory snapshots
- biometric or access control
- legacy adjustment detail reconstruction from missing `MOVAJUSTES`

## Recommended Next Step

Use the audited legacy schema as a source for domain mapping, then move to a new PostgreSQL and Prisma model that:

- replaces composite PKs with surrogate IDs
- keeps legacy business numbers as unique constraints
- separates product master data from inventory balances and movements
- recreates stock history through explicit movement tables
- treats the unresolved legacy modules as out-of-scope until their real source is recovered
