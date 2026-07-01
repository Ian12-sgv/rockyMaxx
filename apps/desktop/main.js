const electronModule = require("electron");
const { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const http = require("node:http");
const { dirname, join, resolve } = require("node:path");
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

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
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

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "0.0.0.0";
}

function getServiceConfigCandidates() {
  const candidates = [
    join(process.env.LOCALAPPDATA || "", "Programs", "@sistema-arabedesktop-service", "service-config.json"),
    join(app.getPath("appData"), "@sistema-arabe", "desktop-service", "service-config.json"),
    join(__dirname, "..", "desktop-service", "service-config.json"),
  ];

  return [...new Set(candidates.filter(Boolean))];
}

function getServiceRuntimeCandidates() {
  const candidates = [
    join(process.env.LOCALAPPDATA || "", "Programs", "@sistema-arabedesktop-service", "resources", "api"),
    join(__dirname, "..", "desktop-service", ".bundle", "api"),
  ];

  return [...new Set(candidates.filter(Boolean))];
}

function parseEnvValue(rawValue) {
  let value = String(rawValue ?? "").trim();
  if (!value) {
    return "";
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(filePath) {
  const env = {};
  const raw = readFileSync(filePath, "utf8");

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    env[key] = parseEnvValue(value);
  }

  return env;
}

function extractDatabaseName(databaseUrl) {
  const match = String(databaseUrl || "").match(/\/([^/?]+)(\?|$)/);
  return String(match?.[1] || "").trim();
}

function readServiceConfigProfileId() {
  for (const candidate of getServiceConfigCandidates()) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      const raw = JSON.parse(readFileSync(candidate, "utf8"));
      const profileId = typeof raw?.profileId === "string" ? raw.profileId.trim() : "";
      if (profileId) {
        return profileId;
      }
    } catch (error) {
      writeRuntimeLog(`No se pudo leer la configuracion del Servicio Local en ${candidate}: ${error.message}`);
    }
  }

  return "";
}

function readServiceProfiles() {
  for (const runtimeDir of getServiceRuntimeCandidates()) {
    if (!existsSync(runtimeDir)) {
      continue;
    }

    try {
      const profiles = new Map();
      for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }

        if (!entry.name.startsWith(".env") || entry.name.endsWith(".example")) {
          continue;
        }

        const filePath = join(runtimeDir, entry.name);
        const env = parseEnvFile(filePath);
        profiles.set(entry.name, {
          id: entry.name,
          env,
          apiPort: String(env.API_PORT || "3000").trim() || "3000",
          apiHost: String(env.API_HOST || "0.0.0.0").trim() || "0.0.0.0",
          databaseName: extractDatabaseName(env.DATABASE_URL),
        });
      }

      if (profiles.size > 0) {
        return profiles;
      }
    } catch (error) {
      writeRuntimeLog(`No se pudieron leer los perfiles del Servicio Local: ${error.message}`);
    }
  }

  return new Map();
}

function resolveServerUrlFromServiceProfile(serverUrl) {
  const normalized = normalizeServerUrl(serverUrl);
  if (!normalized) {
    return "";
  }

  try {
    const parsedUrl = new URL(normalized);
    if (!isLoopbackHostname(parsedUrl.hostname)) {
      return normalized;
    }

    const profileId = readServiceConfigProfileId();
    if (!profileId) {
      return normalized;
    }

    const profiles = readServiceProfiles();
    const profile = profiles.get(profileId);
    if (!profile?.apiPort) {
      return normalized;
    }

    parsedUrl.hostname = "127.0.0.1";
    parsedUrl.port = profile.apiPort;
    parsedUrl.pathname = "";
    parsedUrl.search = "";
    parsedUrl.hash = "";
    const resolved = normalizeServerUrl(parsedUrl.toString());
    writeRuntimeLog(`Cliente resolvio URL local desde Servicio Local. perfil=${profileId} db=${profile.databaseName || "-"} url=${resolved}`);
    return resolved;
  } catch (error) {
    writeRuntimeLog(`No se pudo resolver la URL local desde el Servicio Local: ${error.message}`);
    return normalized;
  }
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
  return `${resolveServerUrlFromServiceProfile(serverUrl)}/api/health`;
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
  const normalized = resolveServerUrlFromServiceProfile(serverUrl);
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
    throw new Error(`El servidor respondiÃ³ con estado ${response.statusCode}.`);
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
      preload: join(__dirname, "preload.js"),
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
    writeRuntimeLog(`FallÃ³ la carga del cliente. url=${validatedUrl} code=${code} description=${description}`);
    dialog.showErrorBox(
      "Rocky Maxx Cliente",
      `No se pudo abrir el servidor configurado.\n\n${description}\n\nSe abrirÃ¡ la configuraciÃ³n del cliente.`,
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

function normalizePrinterResult(printer = {}) {
  return {
    name: String(printer.name || "").trim(),
    displayName: String(printer.displayName || printer.name || "").trim(),
    description: String(printer.description || "").trim(),
    status: printer.status ?? 0,
    isDefault: Boolean(printer.isDefault),
    isAvailable: printer.status === undefined || printer.status === 0,
    options: typeof printer.options === "object" && printer.options ? printer.options : {},
  };
}

async function getAvailablePrinters() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error("La ventana principal no esta disponible para consultar impresoras.");
  }

  const contents = mainWindow.webContents;
  const printers = typeof contents.getPrintersAsync === "function"
    ? await contents.getPrintersAsync()
    : typeof contents.getPrinters === "function"
      ? contents.getPrinters()
      : [];

  return printers
    .map((printer) => normalizePrinterResult(printer))
    .filter((printer) => printer.name);
}

function normalizePrinterLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function buildPrinterLookupText(printer = {}) {
  return [printer?.name, printer?.displayName, printer?.description]
    .map((value) => normalizePrinterLookupValue(value))
    .filter(Boolean)
    .join(" ");
}

function isVirtualPrinter(printer = {}) {
  const haystack = buildPrinterLookupText(printer);
  if (!haystack) {
    return false;
  }

  return [
    "microsoft print to pdf",
    "print to pdf",
    "pdf",
    "microsoft xps",
    "xps",
    "fax",
    "onenote",
    "adobe pdf",
    "virtual",
    "anydesk printer",
  ].some((pattern) => haystack.includes(pattern));
}

function scorePreferredPrinter(printer = {}) {
  const haystack = buildPrinterLookupText(printer);
  let score = 0;

  if (printer?.isAvailable !== false) {
    score += 50;
  }
  if (!isVirtualPrinter(printer)) {
    score += 200;
  }
  if (printer?.isDefault) {
    score += 20;
  }

  [
    ["dp8", 240],
    ["bixolon", 220],
    ["thermal", 180],
    ["termica", 180],
    ["receipt", 150],
    ["ticket", 150],
    ["pos", 120],
    ["epson tm", 110],
    ["generic / text only", 90],
  ].forEach(([pattern, value]) => {
    if (haystack.includes(pattern)) {
      score += value;
    }
  });

  return score;
}

function pickPreferredPrinter(printers, options = {}) {
  const allowVirtual = options?.allowVirtual === true;
  const candidates = (allowVirtual ? printers : printers.filter((printer) => !isVirtualPrinter(printer)))
    .filter((printer) => printer?.name);

  if (!candidates.length) {
    return allowVirtual ? printers.find((printer) => printer?.name) || null : null;
  }

  return [...candidates].sort((left, right) => scorePreferredPrinter(right) - scorePreferredPrinter(left))[0] || null;
}

function resolvePrinterDeviceName(printers, requestedPrinterName, options = {}) {
  const allowVirtual = options?.allowVirtual === true;
  const normalizedRequested = normalizePrinterLookupValue(requestedPrinterName);
  if (normalizedRequested) {
    const exactMatch = printers.find((printer) => {
      const values = [printer?.name, printer?.displayName, printer?.description].map((value) => normalizePrinterLookupValue(value));
      return values.includes(normalizedRequested);
    });
    if (exactMatch?.name && (allowVirtual || !isVirtualPrinter(exactMatch))) {
      return exactMatch.name;
    }

    const partialMatch = printers.find((printer) => {
      const haystack = buildPrinterLookupText(printer);
      return haystack.includes(normalizedRequested);
    });
    if (partialMatch?.name && (allowVirtual || !isVirtualPrinter(partialMatch))) {
      return partialMatch.name;
    }
  }

  const preferredPrinter = pickPreferredPrinter(printers, { allowVirtual });
  if (preferredPrinter?.name) {
    return preferredPrinter.name;
  }

  if (allowVirtual) {
    const defaultPrinter = printers.find((printer) => printer.isDefault) || printers[0];
    return defaultPrinter?.name || "";
  }

  return "";
}



function buildPrintableHtmlUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ""))}`;
}

async function executePrintJob(printWindow, options = {}) {
  const copies = Number.isInteger(options?.copies) && options.copies > 0 ? options.copies : 1;
  const deviceName = String(options?.deviceName || "").trim();
  const silent = options?.silent !== false;

  return new Promise((resolve, reject) => {
    printWindow.webContents.print(
      {
        silent,
        printBackground: true,
        deviceName: deviceName || undefined,
        copies,
      },
      (success, failureReason) => {
        if (!success) {
          reject(new Error(failureReason || "No se pudo completar la impresion."));
          return;
        }

        resolve({
          printerName: deviceName,
          silent,
        });
      },
    );
  });
}

async function printHtmlDocument(payload = {}) {
  const html = String(payload?.html || "").trim();
  if (!html) {
    throw new Error("No se recibio el contenido HTML para imprimir.");
  }

  const requestedPrinterName = String(payload?.printerName || "").trim();
  const requestedCopies = Number.parseInt(String(payload?.copies ?? 1), 10);
  const copies = Number.isInteger(requestedCopies) && requestedCopies > 0 ? requestedCopies : 1;
  const silent = payload?.silent !== false;
  const allowVirtualPrinter = payload?.allowVirtualPrinter === true;
  const allowDialogFallback = payload?.allowDialogFallback === true;
  const jobTitle = String(payload?.jobTitle || "Factura Rocky Maxx").trim() || "Factura Rocky Maxx";
  const printers = await getAvailablePrinters();
  const resolvedDeviceName = resolvePrinterDeviceName(printers, requestedPrinterName, { allowVirtual: allowVirtualPrinter });
  const preferredFallbackDeviceName = resolvePrinterDeviceName(printers, "", { allowVirtual: allowVirtualPrinter });

  if (!resolvedDeviceName && silent) {
    throw new Error(
      allowVirtualPrinter
        ? "No se encontro ninguna impresora disponible en Windows."
        : "No se encontro una impresora fisica disponible en Windows para imprimir la factura.",
    );
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 820,
    height: 1180,
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  try {
    await printWindow.loadURL(buildPrintableHtmlUrl(html));

    const attempts = [];
    if (resolvedDeviceName) {
      attempts.push({
        deviceName: resolvedDeviceName,
        silent,
        mode: silent ? "directa" : "dialogo",
      });
    }

    if (silent && preferredFallbackDeviceName && preferredFallbackDeviceName !== resolvedDeviceName) {
      attempts.push({
        deviceName: preferredFallbackDeviceName,
        silent: true,
        mode: "respaldo",
      });
    }

    if (allowDialogFallback) {
      attempts.push({
        deviceName: preferredFallbackDeviceName || resolvedDeviceName || "",
        silent: false,
        mode: "dialogo",
      });
    }

    let lastError = null;
    for (const attempt of attempts) {
      try {
        writeRuntimeLog(
          `Intentando imprimir ${jobTitle}. printer=${attempt.deviceName || '-'} mode=${attempt.mode} requested=${requestedPrinterName || '-'}`,
        );
        if (!attempt.silent && !printWindow.isDestroyed()) {
          printWindow.show();
          printWindow.focus();
        }
        const result = await executePrintJob(printWindow, {
          deviceName: attempt.deviceName,
          copies,
          silent: attempt.silent,
        });
        writeRuntimeLog(
          `Impresion completada ${jobTitle}. printer=${result.printerName || attempt.deviceName || '-'} mode=${attempt.mode}`,
        );
        return {
          ok: true,
          printerName: result.printerName || attempt.deviceName || resolvedDeviceName || preferredFallbackDeviceName,
          jobTitle,
          copies,
          fallbackMode: attempt.mode,
        };
      } catch (error) {
        lastError = error;
        writeRuntimeLog(
          `Fallo impresion ${jobTitle}. printer=${attempt.deviceName || '-'} mode=${attempt.mode}: ${error.message}`,
        );
      }
    }

    throw lastError || new Error("No se pudo completar la impresion.");
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

ipcMain.handle("client-config:get", async () => {
  const config = loadClientConfig();
  return {
    serverUrl: config.serverUrl,
  };
});

ipcMain.handle("client-printers:list", async () => {
  return {
    ok: true,
    printers: await getAvailablePrinters(),
  };
});

ipcMain.handle("client-printers:print-html", async (_event, payload) => {
  return printHtmlDocument(payload);
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

app.on("second-instance", () => {
  if (configWindow?.isMinimized()) {
    configWindow.restore();
  }
  if (mainWindow?.isMinimized()) {
    mainWindow.restore();
  }
  if (configWindow) {
    configWindow.focus();
    return;
  }
  if (mainWindow) {
    mainWindow.focus();
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
        "Configura la URL de la PC principal para abrir Rocky Maxx en esta estaciÃ³n de trabajo.",
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



