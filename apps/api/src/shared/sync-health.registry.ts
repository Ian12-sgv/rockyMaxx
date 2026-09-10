export type SyncHealthEntry = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessDetail: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

function emptyEntry(): SyncHealthEntry {
  return {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastSuccessDetail: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

// Registro en memoria (dura lo que dure el proceso) del estado de cada
// subsistema de sincronizacion (bodega-export, mirror-sync, transfers,
// dev-returns, price-changes). DiagnosticoPushService empuja este snapshot
// hacia bodega-api cada cierto tiempo, para poder ver desde afuera cual
// subsistema/entidad dejo de avanzar sin depender de que alguien copie a
// mano el log local de la tienda (ver el caso real que motivo esto: tienda
// 003 con VENTAS trabado en silencio mientras CAJAS seguia sincronizando).
class SyncHealthRegistry {
  private readonly entries = new Map<string, SyncHealthEntry>();

  private getOrCreate(key: string): SyncHealthEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = emptyEntry();
      this.entries.set(key, entry);
    }
    return entry;
  }

  recordAttempt(key: string) {
    this.getOrCreate(key).lastAttemptAt = new Date().toISOString();
  }

  recordSuccess(key: string, detail?: string) {
    const entry = this.getOrCreate(key);
    entry.lastSuccessAt = new Date().toISOString();
    entry.lastSuccessDetail = detail ?? null;
  }

  recordError(key: string, message: string) {
    const entry = this.getOrCreate(key);
    entry.lastErrorAt = new Date().toISOString();
    entry.lastErrorMessage = message;
  }

  snapshot(): Record<string, SyncHealthEntry> {
    return Object.fromEntries(this.entries);
  }
}

export const syncHealthRegistry = new SyncHealthRegistry();
