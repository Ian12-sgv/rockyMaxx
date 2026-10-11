// Identidad del nodo (tienda, bodega o Central) donde corre esta instancia del API.
//
// Antes cada servicio (transfers, price-changes, dev-returns, facturacion, cajas, inventory)
// deducia por su cuenta "quien soy" desde el nombre de la base, el puerto o el contenido de
// SYNC_NODES, con reglas ligeramente distintas entre si. Este archivo es la UNICA fuente:
//
// 1. Si el .env trae NODE_ID / NODE_ROLE / NODE_INSTANCE, esos mandan.
// 2. Si no, se deduce del nombre de la base exactamente como antes (rocky_tienda_00N[_vps],
//    rocky_bodega_00N[_vps], rocky_maxx, rocky_sync_central), para que un despliegue sin
//    tocar los .env se comporte igual que hoy.
// 3. Si lo explicito contradice a lo deducido (ej. NODE_ID=TIENDA003 sobre rocky_tienda_002,
//    un .env copiado de otra tienda), la identidad queda en CONFLICTO: role "desconocido",
//    sin nodeId ni ruta remota. Los procesos de sincronizacion fallan cerrado (no envian a
//    ninguna ruta) en vez de adivinar; la venta local no se ve afectada.
//
// Funciones puras (sin Nest) para poder probarlas aisladas.

export type NodeRole = "central" | "tienda" | "bodega" | "desconocido";
export type NodeIdentitySource = "env" | "database" | "ninguna";

export type NodeIdentity = {
  nodeId: string | null;
  sucursalCodigo: string | null;
  tipo: "TIENDA" | "BODEGA" | null;
  role: NodeRole;
  // true en las gemelas del VPS (bases *_vps) y en Central del VPS (rocky_sync_central).
  isVpsInstance: boolean;
  databaseName: string;
  // Ruta de este nodo detras de Nginx en el VPS: "" para Central, "/tienda003", etc.
  remotePath: string | null;
  source: NodeIdentitySource;
  conflict: string | null;
};

export type NodeDescriptor = {
  nodeId: string;
  sucursalCodigo: string;
  tipo: "TIENDA" | "BODEGA";
  role: Exclude<NodeRole, "desconocido">;
  remotePath: string;
};

export type NodeIdentityInput = {
  databaseUrl?: string | null;
  nodeId?: string | null;
  nodeRole?: string | null;
  nodeInstance?: string | null;
};

export const CENTRAL_NODE_ID = "ORIGEN";
// Alias historico de Central en SYNC_NODES y en el codigo de transferencias/cambio de precio.
export const CENTRAL_NODE_ALIAS = "BODEGA001";

const CENTRAL_LOCAL_DATABASE = "rocky_maxx";
const CENTRAL_VPS_DATABASE = "rocky_sync_central";

// Bases de prueba del VPS: no tienen identidad de tienda/bodega, solo una ruta Nginx propia.
const TEST_NODE_PATHS: Record<string, string> = {
  rocky_prueba_sistemas_tienda: "/prueba-sistemas-tienda",
  rocky_prueba_sistemas_bodega: "/prueba-sistemas-bodega",
  rocky_prueba_analista_tienda: "/prueba-analista-tienda",
  rocky_prueba_analista_bodega: "/prueba-analista-bodega",
};

const NODE_ROLES = new Set(["central", "tienda", "bodega"]);
const NODE_INSTANCES = new Set(["local", "vps"]);

export function extractDatabaseName(databaseUrl: string | null | undefined) {
  const match = String(databaseUrl || "").trim().match(/\/([^/?]+)(?:\?|$)/);
  return String(match?.[1] || "").trim();
}

// Acepta NodeId ("TIENDA003", "BODEGA002", "ORIGEN", "BODEGA001") o codigo de sucursal
// ("003", "3", "B002"). Devuelve null si no es un nodo estandar (ej. nodos de prueba).
export function describeNode(codeOrNodeId: string | null | undefined): NodeDescriptor | null {
  const normalized = String(codeOrNodeId || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  if (normalized === CENTRAL_NODE_ID || normalized === CENTRAL_NODE_ALIAS) {
    return {
      nodeId: CENTRAL_NODE_ID,
      sucursalCodigo: CENTRAL_NODE_ID,
      tipo: "BODEGA",
      role: "central",
      remotePath: "",
    };
  }

  const store = normalized.match(/^(?:TIENDA)?(\d{1,3})$/);
  if (store) {
    const code = store[1].padStart(3, "0");
    return {
      nodeId: `TIENDA${code}`,
      sucursalCodigo: code,
      tipo: "TIENDA",
      role: "tienda",
      remotePath: `/tienda${code}`,
    };
  }

  const warehouse = normalized.match(/^(?:BODEGA|B)(\d{1,3})$/);
  if (warehouse) {
    const code = warehouse[1].padStart(3, "0");
    if (code === "001") {
      return describeNode(CENTRAL_NODE_ID);
    }
    return {
      nodeId: `BODEGA${code}`,
      sucursalCodigo: `B${code}`,
      tipo: "BODEGA",
      role: "bodega",
      remotePath: `/bodega${code}`,
    };
  }

  return null;
}

type DatabaseInference = {
  descriptor: NodeDescriptor | null;
  isVpsInstance: boolean | null;
  remotePath: string | null;
};

export function inferNodeFromDatabaseName(databaseName: string): DatabaseInference {
  const name = databaseName.trim().toLowerCase();

  if (name === CENTRAL_LOCAL_DATABASE || name === CENTRAL_VPS_DATABASE) {
    const descriptor = describeNode(CENTRAL_NODE_ID);
    return {
      descriptor,
      isVpsInstance: name === CENTRAL_VPS_DATABASE,
      remotePath: descriptor?.remotePath ?? null,
    };
  }

  const store = name.match(/^rocky_tienda_(\d+)(_vps)?$/);
  if (store) {
    const descriptor = describeNode(`TIENDA${store[1]}`);
    return { descriptor, isVpsInstance: Boolean(store[2]), remotePath: descriptor?.remotePath ?? null };
  }

  const warehouse = name.match(/^rocky_bodega_(\d+)(_vps)?$/);
  if (warehouse) {
    const descriptor = describeNode(`BODEGA${warehouse[1]}`);
    return { descriptor, isVpsInstance: Boolean(warehouse[2]), remotePath: descriptor?.remotePath ?? null };
  }

  return { descriptor: null, isVpsInstance: null, remotePath: TEST_NODE_PATHS[name] ?? null };
}

export function resolveNodeIdentity(input: NodeIdentityInput): NodeIdentity {
  const databaseName = extractDatabaseName(input.databaseUrl);
  const fromDatabase = inferNodeFromDatabaseName(databaseName);
  const rawNodeId = String(input.nodeId || "").trim();
  const rawRole = String(input.nodeRole || "").trim().toLowerCase();
  const rawInstance = String(input.nodeInstance || "").trim().toLowerCase();

  const fail = (conflict: string): NodeIdentity => ({
    nodeId: null,
    sucursalCodigo: null,
    tipo: null,
    role: "desconocido",
    isVpsInstance: rawInstance === "vps" || fromDatabase.isVpsInstance === true,
    databaseName,
    remotePath: null,
    source: rawNodeId || rawRole || rawInstance ? "env" : "database",
    conflict,
  });

  if (rawRole && !NODE_ROLES.has(rawRole)) {
    return fail(`NODE_ROLE=${rawRole} no es valido (usa central, tienda o bodega).`);
  }

  if (rawInstance && !NODE_INSTANCES.has(rawInstance)) {
    return fail(`NODE_INSTANCE=${rawInstance} no es valido (usa local o vps).`);
  }

  let explicit: NodeDescriptor | null = null;
  if (rawNodeId) {
    // describeNode tambien acepta codigos de sucursal ("003"); en NODE_ID se exige el NodeId
    // completo para que un valor ambiguo no pase como valido.
    if (!/^(ORIGEN|BODEGA\d{3}|TIENDA\d{3})$/i.test(rawNodeId)) {
      return fail(`NODE_ID=${rawNodeId} no tiene un formato valido (ej. TIENDA003, BODEGA002 u ORIGEN).`);
    }
    explicit = describeNode(rawNodeId);
  } else if (rawRole === "central") {
    explicit = describeNode(CENTRAL_NODE_ID);
  }

  if (explicit && rawRole && explicit.role !== rawRole) {
    return fail(`NODE_ID=${explicit.nodeId} es de rol "${explicit.role}" pero NODE_ROLE=${rawRole}.`);
  }

  const inferred = fromDatabase.descriptor;
  if (explicit && inferred && explicit.nodeId !== inferred.nodeId) {
    return fail(
      `El .env dice ${explicit.nodeId} pero la base "${databaseName}" corresponde a ${inferred.nodeId}. ` +
        "Corrige NODE_ID/NODE_ROLE o DATABASE_URL; la sincronizacion queda detenida hasta entonces.",
    );
  }

  if (!explicit && rawRole && rawRole !== "central") {
    if (!inferred) {
      return fail(`NODE_ROLE=${rawRole} sin NODE_ID: no se puede saber que ${rawRole} es. Define NODE_ID.`);
    }
    if (inferred.role !== rawRole) {
      return fail(`NODE_ROLE=${rawRole} pero la base "${databaseName}" corresponde a ${inferred.nodeId}.`);
    }
  }

  if (rawInstance && fromDatabase.isVpsInstance !== null && (rawInstance === "vps") !== fromDatabase.isVpsInstance) {
    return fail(
      `NODE_INSTANCE=${rawInstance} pero la base "${databaseName}" es de instancia ` +
        `${fromDatabase.isVpsInstance ? "vps" : "local"}.`,
    );
  }

  const descriptor = explicit ?? inferred;
  const isVpsInstance = rawInstance ? rawInstance === "vps" : fromDatabase.isVpsInstance === true;
  const source: NodeIdentitySource = rawNodeId || rawRole || rawInstance ? "env" : descriptor ? "database" : "ninguna";

  return {
    nodeId: descriptor?.nodeId ?? null,
    sucursalCodigo: descriptor?.sucursalCodigo ?? null,
    tipo: descriptor?.tipo ?? null,
    role: descriptor?.role ?? "desconocido",
    isVpsInstance,
    databaseName,
    remotePath: descriptor ? descriptor.remotePath : fromDatabase.remotePath,
    source,
    conflict: null,
  };
}

export function normalizeApiUrl(value: unknown) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

// Raiz de la red de nodos vista DESDE ESTE LADO: en una PC es "http://68.183.105.135"; si
// la URL configurada trae la ruta de un nodo ("/tienda003") se recorta.
export function deriveSyncRootUrl(configuredUrl: unknown) {
  const normalized = normalizeApiUrl(configuredUrl);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    parsed.pathname = parsed.pathname
      .replace(/\/(?:tienda|bodega)\d{3}\/?$/i, "")
      .replace(/\/prueba-[a-z-]+\/?$/i, "")
      .replace(/\/$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

// URL para llegar a otro nodo. El registro guarda una sola URL canonica, pero cada lado
// llega distinto (la PC por la IP publica, el VPS puede ir por 127.0.0.1): para nodos
// estandar la URL se ARMA con la raiz de este lado + la ruta del nodo, y la URL guardada
// solo se usa si no hay raiz configurada o el nodo no es estandar.
export function resolvePeerApiUrl(
  codeOrNodeId: string | null | undefined,
  storedApiUrl: string | null | undefined,
  rootUrl: string | null,
) {
  const descriptor = describeNode(codeOrNodeId);
  if (rootUrl && descriptor) {
    return `${rootUrl}${descriptor.remotePath}`;
  }
  return normalizeApiUrl(storedApiUrl);
}
