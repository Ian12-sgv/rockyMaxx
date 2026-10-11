import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  deriveSyncRootUrl,
  describeNode,
  inferNodeFromDatabaseName,
  NodeDescriptor,
  NodeIdentity,
  resolveNodeIdentity,
  resolvePeerApiUrl,
} from "./node-identity";

// Unica fuente de "quien soy" para todos los modulos. Ver node-identity.ts.
@Injectable()
export class NodeIdentityService {
  private readonly logger = new Logger(NodeIdentityService.name);
  private readonly identity: NodeIdentity;

  constructor(private readonly configService: ConfigService) {
    this.identity = resolveNodeIdentity({
      databaseUrl: this.configService.get<string>("DATABASE_URL", ""),
      nodeId: this.configService.get<string>("NODE_ID", ""),
      nodeRole: this.configService.get<string>("NODE_ROLE", ""),
      nodeInstance: this.configService.get<string>("NODE_INSTANCE", ""),
    });

    const { identity } = this;
    if (identity.conflict) {
      this.logger.error(`Identidad del nodo en CONFLICTO, sincronizacion detenida: ${identity.conflict}`);
    } else if (!identity.nodeId) {
      this.logger.warn(
        `No se pudo determinar la identidad del nodo (base "${identity.databaseName}"). ` +
          "Define NODE_ID en el .env para que no dependa del nombre de la base.",
      );
    } else {
      this.logger.log(
        `Identidad del nodo: ${identity.nodeId} (${identity.role}, ${identity.isVpsInstance ? "vps" : "local"}, origen=${identity.source}).`,
      );
    }
  }

  get(): NodeIdentity {
    return this.identity;
  }

  // Central se decide SOLO por NODE_ROLE/NODE_ID explicitos o por las bases rocky_maxx /
  // rocky_sync_central; nunca por puerto ni por el contenido de SYNC_NODES.
  isCentral() {
    return this.identity.role === "central" && !this.identity.conflict;
  }

  // Central de oficina (rocky_maxx), no la del VPS.
  isCentralLocal() {
    return this.isCentral() && !this.identity.isVpsInstance;
  }

  hasConflict() {
    return Boolean(this.identity.conflict);
  }

  // Para rotulos (encabezado de factura, reportes de caja), no para sincronizar: con la
  // identidad en conflicto manda la base, que es de quien son los datos que se imprimen.
  describeSelfForLabels(): NodeDescriptor | null {
    if (this.identity.conflict) {
      return inferNodeFromDatabaseName(this.identity.databaseName).descriptor;
    }
    return describeNode(this.identity.nodeId);
  }

  // Para los procesos de sincronizacion: con identidad en conflicto no se envia ni se
  // trae nada, en vez de adivinar la ruta.
  assertSyncIdentity() {
    if (this.identity.conflict) {
      throw new ConflictException(`Identidad del nodo en conflicto: ${this.identity.conflict}`);
    }
  }

  // Raiz de la red de nodos vista desde este lado. NODE_SYNC_BASE_URL tiene prioridad (ej.
  // http://127.0.0.1 en el VPS); luego las variables propias de cada modulo y por ultimo
  // las generales de sync, igual que antes.
  resolveSyncRootUrl(moduleKeys: string[] = []) {
    const keys = ["NODE_SYNC_BASE_URL", ...moduleKeys, "TRANSFER_SYNC_REMOTE_API_URL", "MIRROR_SYNC_REMOTE_API_URL"];
    for (const key of keys) {
      const root = deriveSyncRootUrl(this.configService.get<string>(key, ""));
      if (root) {
        return root;
      }
    }
    return null;
  }

  resolvePeerApiUrl(codeOrNodeId: string | null | undefined, storedApiUrl: string | null | undefined, moduleKeys: string[] = []) {
    return resolvePeerApiUrl(codeOrNodeId, storedApiUrl, this.resolveSyncRootUrl(moduleKeys));
  }
}
