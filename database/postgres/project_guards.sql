-- Project-level guards required by the backend domain rules.
-- Barcode duplication must be impossible even if values differ only by spaces or casing.
CREATE UNIQUE INDEX IF NOT EXISTS "UX_INVENTARIO_CodigoBarra_Normalized"
  ON dbo."INVENTARIO" (upper(btrim("CodigoBarra")));