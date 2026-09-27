import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Usuarios del panel web de bodega_datos (el que abre ClienteALI).
//
// "TODOS" ve todas las tiendas y puede registrar/editar/borrar movimientos de
// Balance. "B" solo ve las tiendas del grupo B (nombre con "rocky", mismo
// criterio que getGrupoTienda() en public/app.js) y Balance en solo lectura.
// La restriccion se aplica en el SERVIDOR (ver PanelAuthGuard y el filtro
// por alcance en ValidacionesService/BalanceService): ocultar cosas solo en
// el frontend no alcanzaria, la API seguiria entregando todo.
export type GrupoPanel = "TODOS" | "B";

export interface AlcancePanel {
  usuario: string;
  grupo: GrupoPanel;
}

interface UsuarioPanel {
  usuario: string;
  grupo: GrupoPanel;
  salt: Buffer;
  hash: Buffer;
}

const SESION_HORAS = 12;
const SCRYPT_KEYLEN = 64;
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_BLOQUEO_MS = 10 * 60 * 1000;

// Formato de una entrada en PANEL_USUARIOS: "usuario|GRUPO|salt.hash" (salt y
// hash en hex, scrypt con keylen 64). Varias entradas separadas por ";".
// Se generan con: npm run hash-password (scripts/hash-panel-password.cjs).
export function hashPassword(password: string, salt: Buffer = randomBytes(16)) {
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}.${hash.toString("hex")}`;
}

function base64url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

@Injectable()
export class PanelAuthService {
  private readonly logger = new Logger(PanelAuthService.name);
  private readonly intentosFallidos = new Map<string, { cantidad: number; desde: number }>();
  // Para no delatar si un usuario existe por el tiempo de respuesta: cuando
  // no existe, igual se corre scrypt contra este salt/hash de relleno.
  private readonly relleno = { salt: randomBytes(16), hash: randomBytes(SCRYPT_KEYLEN) };

  constructor(private readonly configService: ConfigService) {}

  private leerUsuarios(): UsuarioPanel[] {
    const raw = String(this.configService.get<string>("PANEL_USUARIOS", "") || "");
    const usuarios: UsuarioPanel[] = [];

    raw
      .split(";")
      .map((entrada) => entrada.trim())
      .filter(Boolean)
      .forEach((entrada) => {
        const [usuario, grupo, credencial] = entrada.split("|").map((parte) => (parte || "").trim());
        const [saltHex, hashHex] = String(credencial || "").split(".");
        const grupoNormalizado = String(grupo || "").toUpperCase();
        if (
          !usuario ||
          (grupoNormalizado !== "TODOS" && grupoNormalizado !== "B") ||
          !/^[0-9a-f]{32}$/i.test(saltHex || "") ||
          !new RegExp(`^[0-9a-f]{${SCRYPT_KEYLEN * 2}}$`, "i").test(hashHex || "")
        ) {
          this.logger.warn(`PANEL_USUARIOS: entrada invalida ignorada para "${usuario || "(sin usuario)"}".`);
          return;
        }
        usuarios.push({
          usuario,
          grupo: grupoNormalizado as GrupoPanel,
          salt: Buffer.from(saltHex, "hex"),
          hash: Buffer.from(hashHex, "hex"),
        });
      });

    return usuarios;
  }

  // Firma de las sesiones. PANEL_SESSION_SECRET si existe; si no, se deriva
  // de INGEST_AUTH_TOKEN (que ya es secreto y ya esta en el .env del VPS),
  // para no obligar a configurar una variable mas en el primer despliegue.
  private secretoSesion() {
    const propio = String(this.configService.get<string>("PANEL_SESSION_SECRET", "") || "").trim();
    const ingest = String(this.configService.get<string>("INGEST_AUTH_TOKEN", "") || "").trim();
    const secreto = propio || (ingest ? `panel-session:${ingest}` : "");
    if (!secreto) {
      throw new UnauthorizedException("El servidor no tiene configurado PANEL_SESSION_SECRET ni INGEST_AUTH_TOKEN.");
    }
    return secreto;
  }

  private firmar(payload: string) {
    return createHmac("sha256", this.secretoSesion()).update(payload).digest("base64url");
  }

  login(usuario: string, password: string, origen: string) {
    const usuarioNormalizado = String(usuario || "").trim();
    const clave = `${origen}|${usuarioNormalizado.toLowerCase()}`;
    const ahora = Date.now();

    const intentos = this.intentosFallidos.get(clave);
    if (intentos && ahora - intentos.desde < VENTANA_BLOQUEO_MS && intentos.cantidad >= MAX_INTENTOS_FALLIDOS) {
      throw new HttpException(
        "Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const usuarios = this.leerUsuarios();
    if (!usuarios.length) {
      throw new UnauthorizedException("No hay usuarios configurados en el servidor (PANEL_USUARIOS).");
    }

    const encontrado = usuarios.find((item) => item.usuario.toLowerCase() === usuarioNormalizado.toLowerCase());
    const salt = encontrado ? encontrado.salt : this.relleno.salt;
    const esperado = encontrado ? encontrado.hash : this.relleno.hash;
    const calculado = scryptSync(String(password || ""), salt, SCRYPT_KEYLEN);
    const valido = Boolean(encontrado) && timingSafeEqual(calculado, esperado);

    if (!valido || !encontrado) {
      const previo = intentos && ahora - intentos.desde < VENTANA_BLOQUEO_MS ? intentos : { cantidad: 0, desde: ahora };
      this.intentosFallidos.set(clave, { cantidad: previo.cantidad + 1, desde: previo.desde });
      throw new UnauthorizedException("Usuario o contrasena incorrectos.");
    }

    this.intentosFallidos.delete(clave);
    const expira = ahora + SESION_HORAS * 60 * 60 * 1000;
    const payload = base64url(JSON.stringify({ u: encontrado.usuario, g: encontrado.grupo, exp: expira }));
    return {
      token: `${payload}.${this.firmar(payload)}`,
      usuario: encontrado.usuario,
      grupo: encontrado.grupo,
      expira: new Date(expira).toISOString(),
    };
  }

  // Devuelve el alcance de una sesion valida, o null si la firma no cuadra,
  // expiro, o el usuario ya no existe / cambio de grupo en PANEL_USUARIOS
  // (asi quitar o degradar un usuario surte efecto sin esperar 12 h).
  verificarSesion(token: string): AlcancePanel | null {
    const [payload, firma] = String(token || "").split(".");
    if (!payload || !firma) {
      return null;
    }

    const esperada = Buffer.from(this.firmar(payload));
    const recibida = Buffer.from(firma);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) {
      return null;
    }

    let datos: { u?: string; g?: string; exp?: number };
    try {
      datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (!datos.u || !datos.exp || Date.now() > datos.exp) {
      return null;
    }

    const actual = this.leerUsuarios().find((item) => item.usuario === datos.u);
    if (!actual || actual.grupo !== datos.g) {
      return null;
    }
    return { usuario: actual.usuario, grupo: actual.grupo };
  }
}
