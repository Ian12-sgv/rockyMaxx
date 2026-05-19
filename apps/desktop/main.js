const electronModule = require("electron");
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const http = require("node:http");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const app = typeof electronModule === "string" ? null : electronModule.app;
const BrowserWindow = typeof electronModule === "string" ? null : electronModule.BrowserWindow;
const dialog = typeof electronModule === "string" ? null : electronModule.dialog;
const ipcMain = typeof electronModule === "string" ? null : electronModule.ipcMain;
const shell = typeof electronModule === "string" ? null : electronModule.shell;

const DEFAULT_SERVER_URL = "http://127.0.0.1:3000";
const CLIENT_LOG_DIR = join(process.env.TEMP || process.cwd(), "rocky-maxx");
const CLIENT_LOG_PATH = join(CLIENT_LOG_DIR, "desktop-client.log");

let mainWindow = null;
let configWindow = null;

process.on("uncaughtException", (error) => {
  writeRuntimeLog(`uncaughtException: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  writeRuntimeLog(`unhandledRejection: ${message}`);
});

function writeRuntimeLog(message) {
  try {
    mkdirSync(CLIENT_LOG_DIR, { recursive: true });
    appendFileSync(CLIENT_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (error) {
    // Logging must never block startup.
  }
}

function relaunchDesktopFromNodeMode() {
  const env = {
    ...process.env,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  writeRuntimeLog(`El cliente arranco en modo Node y sera relanzado. execPath=${process.execPath}`);

  const child = spawn(process.execPath, [], {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

if (!app || !BrowserWindow || !dialog || !ipcMain || !shell) {
  relaunchDesktopFromNodeMode();
  process.exit(0);
}

app.setName("Rocky Maxx Cliente");

function normalizeServerUrl(value) {
  let normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\/+$/, "");
  if (normalized.toLowerCase().endsWith("/api")) {
    normalized = normalized.slice(0, -4);
  }

  return normalized;
}

function getConfigPath() {
  return join(app.getPath("userData"), "client-config.json");
}

function getLegacyConfigPath() {
  return join(app.getPath("appData"), "@sistema-arabe", "desktop", "client-config.json");
}

function parseClientConfig(configPath) {
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  return {
    serverUrl: normalizeServerUrl(raw?.serverUrl || DEFAULT_SERVER_URL) || DEFAULT_SERVER_URL,
    isConfigured: true,
  };
}

function loadClientConfig() {
  const fallback = {
    serverUrl: DEFAULT_SERVER_URL,
    isConfigured: false,
  };

  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      return parseClientConfig(configPath);
    } catch (error) {
      writeRuntimeLog(`No se pudo leer client-config.json: ${error.message}`);
      return fallback;
    }
  }

  const legacyConfigPath = getLegacyConfigPath();
  if (legacyConfigPath !== configPath && existsSync(legacyConfigPath)) {
    try {
      const legacyConfig = parseClientConfig(legacyConfigPath);
      saveClientConfig(legacyConfig.serverUrl);
      writeRuntimeLog(`Configuracion heredada desde ${legacyConfigPath}`);
      return legacyConfig;
    } catch (error) {
      writeRuntimeLog(`No se pudo migrar la configuracion legacy: ${error.message}`);
      return fallback;
    }
  }

  return fallback;
}

function saveClientConfig(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) {
    throw new Error("Debes indicar la URL del servidor local.");
  }

  const configPath = getConfigPath();
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ serverUrl: normalized }, null, 2), "utf8");
  return normalized;
}

function buildHealthUrl(serverUrl) {
  return `${normalizeServerUrl(serverUrl)}/api/health`;
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    req.setTimeout(3000, () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", reject);
  });
}

async function probeServer(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) {
    throw new Error("Debes indicar la URL del servidor.");
  }

  const response = await request(buildHealthUrl(normalized));
  let payload = null;

  try {
    payload = JSON.parse(response.body || "{}");
  } catch (error) {
    payload = response.body || "";
  }

  if (response.statusCode < 200 || response.statusCode >= 500) {
    throw new Error(`El servidor respondió con estado ${response.statusCode}.`);
  }

  return {
    serverUrl: normalized,
    payload,
  };
}

function createMainWindow(serverUrl) {
  writeRuntimeLog(`Abriendo ventana principal. url=${normalizeServerUrl(serverUrl)}`);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: "Rocky Maxx Cliente",
    autoHideMenuBar: true,
    backgroundColor: "#f5ead4",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      writeRuntimeLog(`renderer-console level=${level} source=${sourceId || "unknown"} line=${line} message=${message}`);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    writeRuntimeLog(`render-process-gone reason=${details?.reason || "unknown"} exitCode=${details?.exitCode ?? "unknown"}`);
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    writeRuntimeLog(`Falló la carga del cliente. url=${validatedUrl} code=${code} description=${description}`);
    dialog.showErrorBox(
      "Rocky Maxx Cliente",
      `No se pudo abrir el servidor configurado.\n\n${description}\n\nSe abrirá la configuración del cliente.`,
    );
    if (mainWindow) {
      mainWindow.close();
    }
    void openConfigWindow({
      serverUrl,
      errorMessage: "No se pudo abrir el servidor configurado. Revisa la URL o el estado del servicio local.",
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(normalizeServerUrl(serverUrl));
}

async function openConfigWindow(options = {}) {
  const config = loadClientConfig();
  const serverUrl = normalizeServerUrl(options.serverUrl || config.serverUrl || DEFAULT_SERVER_URL) || DEFAULT_SERVER_URL;
  const errorMessage = options.errorMessage || "";

  if (configWindow) {
    configWindow.focus();
    configWindow.webContents.once("did-finish-load", () => {
      configWindow?.webContents.send("client-config:state", {
        serverUrl,
        errorMessage,
      });
    });
    return;
  }

  configWindow = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 680,
    minHeight: 560,
    title: "Configurar Rocky Maxx Cliente",
    autoHideMenuBar: true,
    backgroundColor: "#f5ead4",
    show: false,
    webPreferences: {
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  configWindow.on("closed", () => {
    configWindow = null;
  });

  configWindow.once("ready-to-show", () => {
    configWindow?.show();
  });

  configWindow.webContents.on("did-fail-load", (_event, code, description, validatedUrl) => {
    writeRuntimeLog(`Fallo la carga de configuracion. url=${validatedUrl} code=${code} description=${description}`);
  });

  configWindow.webContents.once("did-finish-load", () => {
    configWindow?.webContents.send("client-config:state", {
      serverUrl,
      errorMessage,
    });
  });

  const configUrl = pathToFileURL(resolve(__dirname, "config.html")).toString();
  writeRuntimeLog(`Abriendo configuracion. url=${configUrl}`);
  await configWindow.loadURL(configUrl);
}

ipcMain.handle("client-config:get", async () => {
  const config = loadClientConfig();
  return {
    serverUrl: config.serverUrl,
  };
});

ipcMain.handle("client-server:check", async (_event, serverUrl) => {
  try {
    const result = await probeServer(serverUrl);
    return {
      ok: true,
      serverUrl: result.serverUrl,
      payload: result.payload,
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message,
    };
  }
});

ipcMain.handle("client-config:save", async (_event, serverUrl) => {
  const normalized = saveClientConfig(serverUrl);
  return {
    ok: true,
    serverUrl: normalized,
  };
});

ipcMain.handle("client-server:open", async (_event, serverUrl) => {
  const normalized = saveClientConfig(serverUrl);
  const result = await probeServer(normalized);

  if (configWindow) {
    configWindow.close();
  }

  if (mainWindow) {
    mainWindow.close();
  }

  createMainWindow(result.serverUrl);

  return {
    ok: true,
    serverUrl: result.serverUrl,
    payload: result.payload,
  };
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow && !configWindow) {
    const config = loadClientConfig();
    void openConfigWindow({ serverUrl: config.serverUrl });
  }
});

app.whenReady().then(async () => {
  const config = loadClientConfig();
  writeRuntimeLog(`Arranque del cliente. serverUrl=${config.serverUrl} configured=${config.isConfigured}`);

  if (!config.isConfigured) {
    await openConfigWindow({
      serverUrl: "",
      errorMessage:
        "Configura la URL de la PC principal para abrir Rocky Maxx en esta estación de trabajo.",
    });
    return;
  }

  try {
    await probeServer(config.serverUrl);
    createMainWindow(config.serverUrl);
  } catch (error) {
    writeRuntimeLog(`No se pudo abrir el servidor por defecto: ${error.message}`);
    await openConfigWindow({
      serverUrl: config.serverUrl,
      errorMessage:
        "No se pudo conectar al servidor configurado. Indica la URL de la PC principal, por ejemplo http://192.168.1.10:3000",
    });
  }
}).catch((error) => {
  writeRuntimeLog(`Fallo el arranque del cliente: ${error.stack || error.message}`);
  dialog.showErrorBox("Rocky Maxx Cliente", `No se pudo iniciar el cliente.\n\n${error.message}`);
  app.quit();
});
