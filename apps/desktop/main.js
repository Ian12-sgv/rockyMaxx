const { app, BrowserWindow, dialog } = require("electron");
const { existsSync } = require("node:fs");
const { spawn } = require("node:child_process");
const http = require("node:http");
const { join } = require("node:path");

const API_PORT = process.env.API_PORT || "3000";
const API_HOST = "127.0.0.1";
const API_URL = `http://${API_HOST}:${API_PORT}`;
const HEALTH_URL = `${API_URL}/api/health`;
const API_READY_TIMEOUT_MS = 30000;
const API_RETRY_DELAY_MS = 500;

let mainWindow = null;
let apiProcess = null;
let apiStartedByDesktop = false;
let appIsQuitting = false;

function resolveApiEntry() {
  const candidates = [
    join(__dirname, "..", "api", "dist", "main.js"),
    join(process.resourcesPath || "", "api", "dist", "main.js"),
  ];

  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
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
      return;
    }

    await delay(API_RETRY_DELAY_MS);
  }

  throw new Error("El backend no respondio a tiempo en el puerto 3000.");
}

function startApiServer() {
  if (apiProcess) {
    return;
  }

  const apiEntry = resolveApiEntry();
  if (!apiEntry) {
    throw new Error(
      "No se encontro apps/api/dist/main.js. Ejecuta primero `npm run build --workspace=@sistema-arabe/api`.",
    );
  }

  apiProcess = spawn(process.execPath, [apiEntry], {
    cwd: join(__dirname, "..", "api"),
    env: {
      ...process.env,
      API_PORT,
    },
    stdio: "ignore",
    windowsHide: true,
  });

  apiStartedByDesktop = true;

  apiProcess.once("exit", (code, signal) => {
    apiProcess = null;

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
  if (await isApiReady()) {
    return;
  }

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
    dialog.showErrorBox(
      "Rocky Maxx",
      `No se pudo iniciar la aplicacion de escritorio.\n\n${error.message}`,
    );
    app.quit();
  }
});
