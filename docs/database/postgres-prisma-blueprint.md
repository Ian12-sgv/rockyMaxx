# PostgreSQL and Prisma Blueprint

> Note: this document is the modernization target for the application model.
> If the requirement is an engine-level mirror of SQL Server in PostgreSQL, use `database/postgres/legacy_mirror.sql` together with `docs/database/postgres-exact-mirror.md`.

## Objective

Move from the analyzed SQL Server legacy schema to a PostgreSQL-backed backend with Prisma, preserving the transactional core while removing structural debt from the legacy model.

## Migration Principles

- Do not replicate the SQL Server schema 1:1.
- Keep legacy business identifiers as unique business keys, not as primary keys.
- Separate master data, document headers, document lines, and inventory movements.
- Make inventory balance a derived or synchronized structure, not the product master itself.
- Keep modules with unresolved legacy dependencies out of the first migration wave.

## Target Scope for Phase 1

### Include

- company settings
- users
- branches
- cash registers and cash sessions
- customers and customer types
- suppliers and supplier types
- banks and bank accounts
- taxes
- brands, colors, sizes, manufacturers, categories
- products
- inventory balances
- inventory movements
- purchases and purchase items
- purchase returns and return items
- sales and sale items
- sale payments
- sale returns and return items
- transfers and transfer items
- deposits
- adjustments and adjustment items

### Exclude for now

- promotions and coupon engine
- physical stock count subsystem
- access control and biometrics
- legacy daily inventory snapshot functions
- legacy objects that are unresolved in the SQL Server source

## Legacy to Target Mapping

| Legacy | Target |
| --- | --- |
| `INVENTARIO` | `Product` + `InventoryBalance` |
| `VENTAS` | `Sale` |
| `MOVVENTAS` | `SaleItem` |
| `PAGOSVENTA` | `SalePayment` |
| `COMPRAS` | `Purchase` |
| `MOVCOMPRAS` | `PurchaseItem` |
| `DEVVENTAS` | `SaleReturn` |
| `MOVDEVVENTAS` | `SaleReturnItem` |
| `DEVCOMPRAS` | `PurchaseReturn` |
| `MOVDEVCOMPRAS` | `PurchaseReturnItem` |
| `TRANSFERENCIAS` | `Transfer` |
| `MOVTRANSFERENCIAS` | `TransferItem` |
| `AJUSTES` + missing `MOVAJUSTES` | `Adjustment` + `AdjustmentItem` |
| `CAJAS` | `CashRegister` |
| `DIARIOCAJA` | `CashSession` |
| `DEPOSITOS` | `Deposit` |
| `BANCOS` | `Bank` |
| `CTABANCOS` | `BankAccount` |
| `CLIENTES` | `Customer` |
| `PROVEEDORES` | `Supplier` |
| `PARAMETROS` | `CompanySettings` |

## Domain Decisions

### Product and Inventory

- `Product` is the sellable SKU level, keyed by barcode in the legacy system but internally identified by UUID in PostgreSQL.
- `InventoryBalance` stores quantity by `product + branch`.
- `InventoryMovement` is the authoritative stock ledger.
- `averageCost` and `lastCost` stay on `Product` as operational caches, but movement history becomes the auditable source.

### Sales

- `Sale` keeps the legacy invoice number and cash register series as business identity.
- `SaleItem` stores price, tax, discount, and cost snapshots.
- `SalePayment` supports multiple payment lines per sale.
- `SaleReturn` links back to the original sale when known.

### Purchases

- `Purchase` keeps the supplier document number as a business key.
- `PurchaseItem` stores landed pricing and tax allocation snapshots.
- `PurchaseReturn` remains separate and can optionally reference the original purchase.

### Transfers

- `Transfer` explicitly stores origin and destination branches.
- `TransferItem` stores quantity and cost snapshot per line.
- Inventory posting should create movement rows for both origin and destination.

### Cash and Banking

- `CashRegister` is the modern replacement of `CAJAS`.
- `CashSession` replaces `DIARIOCAJA`.
- `Deposit` links cash register totals to a bank account.

## Suggested Migration Waves

### Wave 1

- catalogs and configuration
- users
- branches
- products
- cash registers
- banks and bank accounts

### Wave 2

- purchases and purchase items
- sales and sale items
- payments
- returns

### Wave 3

- transfers
- adjustments
- deposits
- inventory ledger and balance synchronization

### Wave 4

- reports
- promotions redesign
- physical count redesign
- optional legacy compatibility imports

## Backend Expectations

The backend should expose modules aligned with the target domain, not with the legacy table names:

- `catalog`
- `inventory`
- `sales`
- `purchases`
- `transfers`
- `cash`
- `payments`
- `customers`
- `suppliers`
- `identity`
- `settings`

## Open Questions Before Finalizing the First Migration

- How many branches or warehouses need to exist in the first release?
- Does `Serie` map strictly to a cash register, a fiscal printer, or both?
- How should the legacy `TipoVenta` and `FormaPago` values be normalized?
- Do returns always restore stock immediately?
- Are there negative stock scenarios the business currently tolerates?
- Should taxes be stored per line only, or also recomputed from catalog tax rates?

## Immediate Deliverable

The first implementation artifact after this blueprint is a draft Prisma schema for the transactional core. It should be treated as the target source of truth for backend development, while the SQL Server legacy schema remains only as migration input.


