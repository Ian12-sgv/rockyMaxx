const electronModule = require("electron");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const http = require("node:http");
const { networkInterfaces } = require("node:os");
const { basename, delimiter, dirname, join } = require("node:path");
const { promisify } = require("node:util");

const app = typeof electronModule === "string" ? null : electronModule.app;
const BrowserWindow = typeof electronModule === "string" ? null : electronModule.BrowserWindow;
const dialog = typeof electronModule === "string" ? null : electronModule.dialog;
const shell = typeof electronModule === "string" ? null : electronModule.shell;
const ipcMain = typeof electronModule === "string" ? null : electronModule.ipcMain;

const DEFAULT_API_PORT = process.env.API_PORT || "3000";
const DEFAULT_API_HOST = process.env.API_HOST || "0.0.0.0";
const API_READY_TIMEOUT_MS = 30000;
const API_RETRY_DELAY_MS = 500;
const RUNTIME_LOG_DIR = join(process.env.TEMP || process.cwd(), "rocky-maxx");
const RUNTIME_LOG_PATH = join(RUNTIME_LOG_DIR, "service-runtime.log");
const SERVICE_CONFIG_FILE = "service-config.json";
const execFileAsync = promisify(execFile);

let configuredApiPort = DEFAULT_API_PORT;
let configuredApiHost = DEFAULT_API_HOST;
let mainWindow = null;
let apiProcess = null;
let apiStartedByDesktop = false;
let appIsQuitting = false;
let currentHealthPayload = null;
let availableServiceProfiles = [];
let currentServiceProfile = null;
let expectedApiShutdownReason = "";
let configuredMirrorSyncEnabled = false;
let configuredMirrorSyncRemoteApiUrl = "";
let serviceConfigurationLocked = false;

function writeRuntimeLog(message) {
  try {
    mkdirSync(RUNTIME_LOG_DIR, { recursive: true });
    appendFileSync(RUNTIME_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (_error) {
    // Logging must never block startup.
  }
}

function relaunchDesktopFromNodeMode() {
  const env = {
    ...process.env,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  writeRuntimeLog(`El servicio arranco en modo Node y sera relanzado. execPath=${process.execPath}`);

  const child = spawn(process.execPath, [], {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

if (!app || !BrowserWindow || !dialog || !shell || !ipcMain) {
  relaunchDesktopFromNodeMode();
  process.exit(0);
}

function getApiUrl() {
  return `http://127.0.0.1:${configuredApiPort}`;
}

function getHealthUrl() {
  return `${getApiUrl()}/api/health`;
}

function resolveApiRuntimeDir() {
  const candidates = [
    join(__dirname, "..", "api"),
    join(process.resourcesPath || "", "api"),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveApiEntry() {
  const runtimeDir = resolveApiRuntimeDir();
  if (!runtimeDir) {
    return null;
  }

  const entry = join(runtimeDir, "dist", "main.js");
  return existsSync(entry) ? entry : null;
}

function resolveApiNodeExecutable(runtimeDir) {
  const candidates = [];

  if (runtimeDir) {
    candidates.push(join(runtimeDir, process.platform === "win32" ? "node.exe" : "node"));
  }

  if (process.resourcesPath) {
    candidates.push(
      join(
        process.resourcesPath,
        "..",
        process.platform === "win32" ? `${app.getName()}.exe` : app.getName(),
      ),
    );
  }

  candidates.push(process.execPath);

  return candidates.find((candidate) => candidate && existsSync(candidate)) || process.execPath;
}

function getServiceConfigPath() {
  if (app.isPackaged) {
    return join(dirname(process.execPath), SERVICE_CONFIG_FILE);
  }

  return join(app.getPath("userData"), SERVICE_CONFIG_FILE);
}

function getLegacyServiceConfigPath() {
  return join(app.getPath("userData"), SERVICE_CONFIG_FILE);
}

function removeLegacyServiceConfig() {
  const legacyConfigPath = getLegacyServiceConfigPath();
  const currentConfigPath = getServiceConfigPath();

  if (legacyConfigPath === currentConfigPath || !existsSync(legacyConfigPath)) {
    return;
  }

  try {
    rmSync(legacyConfigPath, { force: true });
  } catch (error) {
    writeRuntimeLog(`No se pudo eliminar la configuracion legacy del servicio: ${error.message}`);
  }
}

function stripUtf8Bom(raw) {
  if (typeof raw !== "string" || !raw) {
    return raw;
  }

  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function readServiceConfig() {
  try {
    const configPath = getServiceConfigPath();
    const legacyConfigPath = getLegacyServiceConfigPath();

    if (!existsSync(configPath) && legacyConfigPath !== configPath && existsSync(legacyConfigPath)) {
      const legacyRaw = readFileSync(legacyConfigPath, "utf8");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, legacyRaw, "utf8");
      removeLegacyServiceConfig();
    }

    if (!existsSync(configPath)) {
      return {};
    }

    const raw = stripUtf8Bom(readFileSync(configPath, "utf8"));
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch (error) {
    writeRuntimeLog(`No se pudo leer la configuracion del servicio: ${error.message}`);
    return {};
  }
}

function writeServiceConfig(config) {
  const configPath = getServiceConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  removeLegacyServiceConfig();
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

function formatProfileLabel(fileName, databaseName, apiPort) {
  const resolvedDatabaseName = databaseName || "sin base";
  if (fileName === ".env") {
    return `Principal - ${resolvedDatabaseName} - puerto ${apiPort}`;
  }

  const suffix = fileName.replace(/^\.env\.?/, "").replace(/\./g, " ");
  const profileName = suffix ? suffix.toUpperCase() : fileName;
  return `${profileName} - ${resolvedDatabaseName} - puerto ${apiPort}`;
}

function loadAvailableServiceProfiles() {
  const runtimeDir = resolveApiRuntimeDir();
  if (!runtimeDir) {
    return [];
  }

  const profiles = [];
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.startsWith(".env") || entry.name.endsWith(".example")) {
      continue;
    }

    try {
      const filePath = join(runtimeDir, entry.name);
      const env = parseEnvFile(filePath);
      if (!env.DATABASE_URL) {
        continue;
      }

      const databaseName = extractDatabaseName(env.DATABASE_URL);
      const apiPort = String(env.API_PORT || DEFAULT_API_PORT || "3000").trim() || "3000";
      const apiHost = String(env.API_HOST || DEFAULT_API_HOST || "0.0.0.0").trim() || "0.0.0.0";

      profiles.push({
        id: entry.name,
        fileName: entry.name,
        env,
        databaseName,
        apiPort,
        apiHost,
        label: formatProfileLabel(entry.name, databaseName, apiPort),
      });
    } catch (error) {
      writeRuntimeLog(`No se pudo leer el perfil ${entry.name}: ${error.message}`);
    }
  }

  if (profiles.length === 0 && process.env.DATABASE_URL) {
    profiles.push({
      id: "runtime",
      fileName: "runtime",
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
        API_PORT: process.env.API_PORT || DEFAULT_API_PORT,
        API_HOST: process.env.API_HOST || DEFAULT_API_HOST,
      },
      databaseName: extractDatabaseName(process.env.DATABASE_URL),
      apiPort: String(process.env.API_PORT || DEFAULT_API_PORT || "3000"),
      apiHost: String(process.env.API_HOST || DEFAULT_API_HOST || "0.0.0.0"),
      label: `Runtime - ${extractDatabaseName(process.env.DATABASE_URL) || "sin base"} - puerto ${process.env.API_PORT || DEFAULT_API_PORT || "3000"}`,
    });
  }

  return profiles.sort((left, right) => {
    if (left.fileName === ".env") {
      return -1;
    }

    if (right.fileName === ".env") {
      return 1;
    }

    return left.label.localeCompare(right.label, "es");
  });
}

function applyServiceProfile(profile) {
  currentServiceProfile = profile || null;
  configuredApiPort = String(profile?.apiPort || DEFAULT_API_PORT || "3000").trim() || "3000";
  configuredApiHost = String(profile?.apiHost || DEFAULT_API_HOST || "0.0.0.0").trim() || "0.0.0.0";
  currentHealthPayload = null;
}

function initializeServiceProfile() {
  availableServiceProfiles = loadAvailableServiceProfiles();
  const savedConfig = readServiceConfig();
  const savedProfileId = typeof savedConfig.profileId === "string" ? savedConfig.profileId : "";
  configuredMirrorSyncEnabled = Boolean(savedConfig.mirrorSyncEnabled);
  configuredMirrorSyncRemoteApiUrl =
    typeof savedConfig.mirrorSyncRemoteApiUrl === "string"
      ? savedConfig.mirrorSyncRemoteApiUrl.trim()
      : "";
  const selectedProfile =
    availableServiceProfiles.find((profile) => profile.id === savedProfileId) ||
    availableServiceProfiles[0] ||
    null;

  serviceConfigurationLocked = Boolean(
    savedProfileId &&
      availableServiceProfiles.some((profile) => profile.id === savedProfileId),
  );
  applyServiceProfile(selectedProfile);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

    req.setTimeout(2000, () => {
      req.destroy(new Error("timeout"));
    });

    req.on("error", reject);
  });
}

async function getHealthPayload() {
  const response = await request(getHealthUrl());
  return {
    statusCode: response.statusCode,
    payload: JSON.parse(response.body || "{}"),
  };
}

async function isApiReady() {
  try {
    const response = await getHealthPayload();
    if (response.statusCode >= 200 && response.statusCode < 500) {
      currentHealthPayload = response.payload;
      return true;
    }
    return false;
  } catch (_error) {
    currentHealthPayload = null;
    return false;
  }
}

async function waitForApiReady() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < API_READY_TIMEOUT_MS) {
    if (await isApiReady()) {
      writeRuntimeLog("El backend local respondio correctamente al healthcheck.");
      return;
    }

    await delay(API_RETRY_DELAY_MS);
  }

  writeRuntimeLog("El backend local no respondio a tiempo.");
  throw new Error("El backend local no respondio a tiempo.");
}

async function findWindowsPortPids(port) {
  const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
    windowsHide: true,
  });
  const lines = stdout.split(/\r?\n/);
  const pids = new Set();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("TCP")) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }

    const localAddress = parts[1] || "";
    const state = parts[3] || "";
    const pid = Number.parseInt(parts[4] || "", 10);

    if (!localAddress.endsWith(`:${port}`) || state !== "LISTENING" || Number.isNaN(pid)) {
      continue;
    }

    if (pid !== process.pid) {
      pids.add(pid);
    }
  }

  return [...pids];
}

async function releaseApiPort() {
  if (process.platform !== "win32") {
    return;
  }

  const pids = await findWindowsPortPids(configuredApiPort);
  writeRuntimeLog(`Procesos detectados en el puerto ${configuredApiPort}: ${pids.join(",") || "ninguno"}.`);
  for (const pid of pids) {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
    });
  }
}

function startApiServer() {
  if (apiProcess) {
    return;
  }

  const runtimeDir = resolveApiRuntimeDir();
  const apiEntry = resolveApiEntry();
  if (!runtimeDir || !apiEntry) {
    throw new Error(
      "No se encontro el runtime del API. Ejecuta primero el empaquetado del servicio local.",
    );
  }

  const nodeExecutable = resolveApiNodeExecutable(runtimeDir);
  const apiVendorModulesDir = join(runtimeDir, "vendor_modules");
  const profileEnv = currentServiceProfile?.env || {};
  const env = {
    ...process.env,
    ...profileEnv,
    API_PORT: configuredApiPort,
    API_HOST: configuredApiHost,
    MIRROR_SYNC_ENABLED: configuredMirrorSyncEnabled ? "true" : "false",
    MIRROR_SYNC_REMOTE_API_URL: configuredMirrorSyncRemoteApiUrl,
    NODE_ENV: process.env.NODE_ENV || "production",
    NODE_PATH: process.env.NODE_PATH
      ? `${apiVendorModulesDir}${delimiter}${process.env.NODE_PATH}`
      : apiVendorModulesDir,
  };

  if (!basename(nodeExecutable).toLowerCase().startsWith("node")) {
    env.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete env.ELECTRON_RUN_AS_NODE;
  }

  writeRuntimeLog(
    `Iniciando backend local. perfil=${currentServiceProfile?.id || "sin-perfil"} runtimeDir=${runtimeDir} entry=${apiEntry} node=${nodeExecutable} host=${configuredApiHost} port=${configuredApiPort} mirrorEnabled=${configuredMirrorSyncEnabled} mirrorUrl=${configuredMirrorSyncRemoteApiUrl || "-"}`,
  );

  apiProcess = spawn(nodeExecutable, [apiEntry], {
    cwd: runtimeDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  apiStartedByDesktop = true;

  apiProcess.stdout?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      writeRuntimeLog(`[api stdout] ${text}`);
    }
  });

  apiProcess.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) {
      writeRuntimeLog(`[api stderr] ${text}`);
    }
  });

  apiProcess.once("error", (error) => {
    writeRuntimeLog(`Error al lanzar el backend local: ${error.stack || error.message}`);
  });

  apiProcess.once("exit", (code, signal) => {
    apiProcess = null;
    apiStartedByDesktop = false;
    const shutdownWasExpected = Boolean(expectedApiShutdownReason);
    const shutdownReason = expectedApiShutdownReason;
    expectedApiShutdownReason = "";

    writeRuntimeLog(
      code !== null
        ? `El backend local se cerro con codigo ${code}.`
        : `El backend local se cerro por la senal ${signal || "desconocida"}.`,
    );

    if (appIsQuitting || shutdownWasExpected) {
      if (shutdownWasExpected) {
        writeRuntimeLog(`Cierre esperado del backend local: ${shutdownReason}.`);
      }
      return;
    }

    const reason =
      code !== null
        ? `El backend local se cerro con codigo ${code}.`
        : `El backend local se cerro por la senal ${signal || "desconocida"}.`;

    dialog.showErrorBox("Rocky Maxx Servicio Local", `${reason}\n\nEl servicio se cerrara.`);
    app.quit();
  });
}

async function ensureApiRunning() {
  writeRuntimeLog(
    `Arranque del servicio local. pid=${process.pid} execPath=${process.execPath} resourcesPath=${process.resourcesPath || "sin-resourcesPath"} perfil=${currentServiceProfile?.id || "sin-perfil"}`,
  );

  if (await isApiReady()) {
    writeRuntimeLog("Se detecto un backend local ya disponible en el puerto configurado.");
    return;
  }

  await releaseApiPort();
  startApiServer();
  await waitForApiReady();
}

function getLanUrls() {
  const interfaces = networkInterfaces();
  const urls = [];

  for (const entries of Object.values(interfaces)) {
    for (const info of entries || []) {
      if (!info || info.internal || info.family !== "IPv4") {
        continue;
      }

      urls.push(`http://${info.address}:${configuredApiPort}`);
    }
  }

  return [...new Set(urls)].sort();
}

function buildServiceState(errorMessage = "") {
  const localUrl = getApiUrl();
  return {
    selectedProfileId: currentServiceProfile?.id || "",
    profiles: availableServiceProfiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      databaseName: profile.databaseName,
      apiPort: profile.apiPort,
      apiHost: profile.apiHost,
    })),
    currentProfile: currentServiceProfile
      ? {
          id: currentServiceProfile.id,
          label: currentServiceProfile.label,
          databaseName: currentServiceProfile.databaseName,
          apiPort: currentServiceProfile.apiPort,
          apiHost: currentServiceProfile.apiHost,
        }
      : null,
    apiPort: configuredApiPort,
    apiHost: configuredApiHost,
    mirrorSyncEnabled: configuredMirrorSyncEnabled,
    mirrorSyncRemoteApiUrl: configuredMirrorSyncRemoteApiUrl,
    configurationLocked: serviceConfigurationLocked,
    localUrl,
    healthUrl: getHealthUrl(),
    urls: getLanUrls(),
    health: currentHealthPayload,
    errorMessage,
  };
}

function broadcastServiceState(errorMessage = "") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("service-config:state", buildServiceState(errorMessage));
  }
}

async function shutdownApiServer() {
  if (!apiProcess || !apiStartedByDesktop) {
    return;
  }

  const processToClose = apiProcess;
  apiProcess = null;
  apiStartedByDesktop = false;
  expectedApiShutdownReason = appIsQuitting ? "app-quit" : "service-restart";

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 5000);
    processToClose.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      processToClose.kill();
    } catch (_error) {
      expectedApiShutdownReason = "";
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function restartApiWithCurrentProfile() {
  currentHealthPayload = null;
  await shutdownApiServer();
  await delay(1000);
  await ensureApiRunning();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 780,
    minWidth: 820,
    minHeight: 660,
    title: "Rocky Maxx Servicio Local",
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

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
      broadcastServiceState();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadFile(join(__dirname, "config.html"));
}

ipcMain.handle("service-config:get-state", async () => {
  availableServiceProfiles = loadAvailableServiceProfiles();
  if (!currentServiceProfile && availableServiceProfiles.length > 0) {
    applyServiceProfile(availableServiceProfiles[0]);
  }

  await isApiReady();
  return buildServiceState();
});

ipcMain.handle("service-config:refresh", async () => {
  availableServiceProfiles = loadAvailableServiceProfiles();
  await isApiReady();
  const state = buildServiceState();
  broadcastServiceState();
  return state;
});

ipcMain.handle("service-config:save", async (_event, payload) => {
  availableServiceProfiles = loadAvailableServiceProfiles();
  const profileId = typeof payload?.profileId === "string" ? payload.profileId : "";
  const mirrorSyncEnabled = Boolean(payload?.mirrorSyncEnabled);
  const mirrorSyncRemoteApiUrl =
    typeof payload?.mirrorSyncRemoteApiUrl === "string"
      ? payload.mirrorSyncRemoteApiUrl.trim()
      : "";
  const selectedProfile = availableServiceProfiles.find((profile) => profile.id === String(profileId || ""));

  if (!selectedProfile) {
    throw new Error("No se encontro el perfil de base de datos seleccionado.");
  }

  configuredMirrorSyncEnabled = mirrorSyncEnabled;
  configuredMirrorSyncRemoteApiUrl = mirrorSyncRemoteApiUrl;
  writeServiceConfig({
    profileId: selectedProfile.id,
    mirrorSyncEnabled: configuredMirrorSyncEnabled,
    mirrorSyncRemoteApiUrl: configuredMirrorSyncRemoteApiUrl,
  });
  serviceConfigurationLocked = true;
  applyServiceProfile(selectedProfile);

  try {
    await restartApiWithCurrentProfile();
    const state = buildServiceState();
    broadcastServiceState();
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo reiniciar el backend local.";
    broadcastServiceState(message);
    throw error;
  }
});

app.on("before-quit", () => {
  appIsQuitting = true;
  void shutdownApiServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    createMainWindow();
  }
});

app.whenReady().then(async () => {
  try {
    initializeServiceProfile();
    await ensureApiRunning();
    createMainWindow();
  } catch (error) {
    writeRuntimeLog(`Fallo el arranque del servicio local: ${error.stack || error.message}`);
    dialog.showErrorBox(
      "Rocky Maxx Servicio Local",
      `No se pudo iniciar el backend local.\n\n${error.message}`,
    );
    app.quit();
  }
});
