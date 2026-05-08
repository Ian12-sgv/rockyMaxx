const electronModule = require("electron");
const { appendFileSync, existsSync, mkdirSync } = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const http = require("node:http");
const { basename, delimiter, join } = require("node:path");
const { promisify } = require("node:util");

const app = typeof electronModule === "string" ? null : electronModule.app;
const BrowserWindow = typeof electronModule === "string" ? null : electronModule.BrowserWindow;
const dialog = typeof electronModule === "string" ? null : electronModule.dialog;

const API_PORT = process.env.API_PORT || "3000";
const API_HOST = "127.0.0.1";
const API_URL = `http://${API_HOST}:${API_PORT}`;
const HEALTH_URL = `${API_URL}/api/health`;
const API_READY_TIMEOUT_MS = 30000;
const API_RETRY_DELAY_MS = 500;
const DESKTOP_LOG_DIR = join(process.env.TEMP || process.cwd(), "rocky-maxx");
const DESKTOP_LOG_PATH = join(DESKTOP_LOG_DIR, "desktop-runtime.log");
const execFileAsync = promisify(execFile);

let mainWindow = null;
let apiProcess = null;
let apiStartedByDesktop = false;
let appIsQuitting = false;

function writeRuntimeLog(message) {
  try {
    mkdirSync(DESKTOP_LOG_DIR, { recursive: true });
    appendFileSync(DESKTOP_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (error) {
    // Logging must never block startup.
  }
}

function relaunchDesktopFromNodeMode() {
  const env = {
    ...process.env,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  writeRuntimeLog(
    `El ejecutable arranco en modo Node. Se relanzara sin ELECTRON_RUN_AS_NODE. execPath=${process.execPath}`,
  );

  const child = spawn(process.execPath, [], {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

if (!app || !BrowserWindow || !dialog) {
  relaunchDesktopFromNodeMode();
  process.exit(0);
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

async function isApiReady() {
  try {
    const response = await request(HEALTH_URL);
    return response.statusCode >= 200 && response.statusCode < 500;
  } catch (error) {
    return false;
  }
}

async function waitForApiReady() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < API_READY_TIMEOUT_MS) {
    if (await isApiReady()) {
      writeRuntimeLog("El backend embebido respondio correctamente al healthcheck.");
      return;
    }

    await delay(API_RETRY_DELAY_MS);
  }

  writeRuntimeLog("El backend embebido no respondio a tiempo en el puerto 3000.");
  throw new Error("El backend no respondio a tiempo en el puerto 3000.");
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

  const pids = await findWindowsPortPids(API_PORT);
  writeRuntimeLog(`Procesos detectados en el puerto ${API_PORT}: ${pids.join(",") || "ninguno"}.`);
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
      "No se encontro apps/api/dist/main.js. Ejecuta primero `npm run build --workspace=@sistema-arabe/api`.",
    );
  }

  const nodeExecutable = resolveApiNodeExecutable(runtimeDir);
  const apiVendorModulesDir = join(runtimeDir, "vendor_modules");
  const env = {
    ...process.env,
    API_PORT,
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
    `Iniciando backend embebido. runtimeDir=${runtimeDir} entry=${apiEntry} node=${nodeExecutable} nodePath=${apiVendorModulesDir}`,
  );

  apiProcess = spawn(nodeExecutable, [apiEntry], {
    cwd: runtimeDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  apiStartedByDesktop = true;

  writeRuntimeLog(`Proceso backend lanzado con PID ${apiProcess.pid || "desconocido"}.`);

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
    writeRuntimeLog(`Error al lanzar el backend embebido: ${error.stack || error.message}`);
  });

  apiProcess.once("exit", (code, signal) => {
    apiProcess = null;

    writeRuntimeLog(
      code !== null
        ? `El backend embebido se cerro con codigo ${code}.`
        : `El backend embebido se cerro por la senal ${signal || "desconocida"}.`,
    );

    if (appIsQuitting) {
      return;
    }

    const reason =
      code !== null
        ? `El backend se cerro con codigo ${code}.`
        : `El backend se cerro por la senal ${signal || "desconocida"}.`;

    dialog.showErrorBox("Rocky Maxx", `${reason}\n\nLa aplicacion de escritorio se cerrara.`);

    app.quit();
  });
}

async function ensureApiRunning() {
  writeRuntimeLog(
    `Arranque del desktop. pid=${process.pid} execPath=${process.execPath} resourcesPath=${process.resourcesPath || "sin-resourcesPath"}`,
  );
  await releaseApiPort();
  startApiServer();
  await waitForApiReady();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    title: "Rocky Maxx",
    autoHideMenuBar: true,
    backgroundColor: "#f5ead4",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(API_URL);
}

async function shutdownApiServer() {
  if (!apiProcess || !apiStartedByDesktop) {
    return;
  }

  const processToClose = apiProcess;
  apiProcess = null;

  try {
    processToClose.kill();
  } catch (error) {
    return;
  }
}

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
    await ensureApiRunning();
    createMainWindow();
  } catch (error) {
    writeRuntimeLog(`Fallo el arranque del desktop: ${error.stack || error.message}`);
    dialog.showErrorBox(
      "Rocky Maxx",
      `No se pudo iniciar la aplicacion de escritorio.\n\n${error.message}`,
    );
    app.quit();
  }
});
