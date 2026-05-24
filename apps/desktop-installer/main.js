const electronModule = require("electron");
const {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { promisify } = require("node:util");

const app = typeof electronModule === "string" ? null : electronModule.app;
const BrowserWindow = typeof electronModule === "string" ? null : electronModule.BrowserWindow;
const dialog = typeof electronModule === "string" ? null : electronModule.dialog;
const ipcMain = typeof electronModule === "string" ? null : electronModule.ipcMain;

const execFileAsync = promisify(execFile);

const INSTALLER_LOG_DIR = join(process.env.TEMP || process.cwd(), "rocky-maxx");
const INSTALLER_LOG_PATH = join(INSTALLER_LOG_DIR, "desktop-installer.log");
const CONFIG_FILE_NAME = "installer-config.json";
const DEFAULT_REMOTE_API_USER = "sistema";
const DEFAULT_REMOTE_API_PASSWORD = "456789";
const DEFAULT_LOCAL_POSTGRES_USER = "postgres";
const DEFAULT_LOCAL_POSTGRES_PASSWORD = "123456";
const ROCKY_SERVICE_RUNTIME_DIR = join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "C:\\Users\\Public", "AppData", "Local"),
  "Programs",
  "@sistema-arabedesktop-service",
  "resources",
  "api",
);
const REMOTE_NODES = [
  {
    id: "central",
    label: "Bodega 001 - GalpoPrincipalMcbo",
    baseUrl: "http://68.183.105.135",
    remoteDatabaseName: "rocky_sync_central",
    localDatabaseName: "rocky_maxx",
  },
  {
    id: "tienda001",
    label: "Tienda 001 - RockyMaxxCentro",
    baseUrl: "http://68.183.105.135/tienda001",
    remoteDatabaseName: "rocky_tienda_001_vps",
    localDatabaseName: "rocky_tienda_001",
  },
  {
    id: "tienda002",
    label: "Tienda 002 - Moda shop",
    baseUrl: "http://68.183.105.135/tienda002",
    remoteDatabaseName: "rocky_tienda_002_vps",
    localDatabaseName: "rocky_tienda_002",
  },
  {
    id: "tienda003",
    label: "Tienda 003 - Moda shop 2",
    baseUrl: "http://68.183.105.135/tienda003",
    remoteDatabaseName: "rocky_tienda_003_vps",
    localDatabaseName: "rocky_tienda_003",
  },
  {
    id: "tienda004",
    label: "Tienda 004 - RockyMaxxMcbo",
    baseUrl: "http://68.183.105.135/tienda004",
    remoteDatabaseName: "rocky_tienda_004_vps",
    localDatabaseName: "rocky_tienda_004",
  },
  {
    id: "tienda005",
    label: "Tienda 005 - Titan",
    baseUrl: "http://68.183.105.135/tienda005",
    remoteDatabaseName: "rocky_tienda_005_vps",
    localDatabaseName: "rocky_tienda_005",
  },
  {
    id: "tienda006",
    label: "Tienda 006 - Top shop bqto",
    baseUrl: "http://68.183.105.135/tienda006",
    remoteDatabaseName: "rocky_tienda_006_vps",
    localDatabaseName: "rocky_tienda_006",
  },
  {
    id: "bodega002",
    label: "Bodega 002 - galpon barquisimeto",
    baseUrl: "http://68.183.105.135/bodega002",
    remoteDatabaseName: "rocky_bodega_002_vps",
    localDatabaseName: "rocky_bodega_002",
  },
];

let mainWindow = null;

function writeRuntimeLog(message) {
  try {
    mkdirSync(INSTALLER_LOG_DIR, { recursive: true });
    appendFileSync(INSTALLER_LOG_PATH, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch (_error) {
    // El log nunca debe bloquear la app.
  }
}

function relaunchDesktopFromNodeMode() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  writeRuntimeLog(`El instalador arranco en modo Node y sera relanzado. execPath=${process.execPath}`);

  const child = spawn(process.execPath, [], {
    detached: true,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

if (!app || !BrowserWindow || !dialog || !ipcMain) {
  relaunchDesktopFromNodeMode();
  process.exit(0);
}

function getConfigPath() {
  return join(app.getPath("userData"), CONFIG_FILE_NAME);
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function loadInstallerConfig() {
  const fallback = {
    localPostgresUser: DEFAULT_LOCAL_POSTGRES_USER,
    localPostgresPassword: DEFAULT_LOCAL_POSTGRES_PASSWORD,
    remoteNodeId: REMOTE_NODES[0].id,
    remoteBaseUrl: REMOTE_NODES[0].baseUrl,
    remoteApiUser: DEFAULT_REMOTE_API_USER,
    remoteApiPassword: DEFAULT_REMOTE_API_PASSWORD,
  };

  try {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
      return fallback;
    }

    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      localPostgresUser: String(raw?.localPostgresUser || fallback.localPostgresUser).trim() || fallback.localPostgresUser,
      localPostgresPassword: String(raw?.localPostgresPassword || fallback.localPostgresPassword).trim() || fallback.localPostgresPassword,
      remoteNodeId: String(raw?.remoteNodeId || fallback.remoteNodeId).trim() || fallback.remoteNodeId,
      remoteBaseUrl: normalizeBaseUrl(raw?.remoteBaseUrl || fallback.remoteBaseUrl) || fallback.remoteBaseUrl,
      remoteApiUser: String(raw?.remoteApiUser || fallback.remoteApiUser).trim() || fallback.remoteApiUser,
      remoteApiPassword: String(raw?.remoteApiPassword || fallback.remoteApiPassword).trim() || fallback.remoteApiPassword,
    };
  } catch (error) {
    writeRuntimeLog(`No se pudo leer installer-config.json: ${error.message}`);
    return fallback;
  }
}

function saveInstallerConfig(config) {
  const persisted = {
    localPostgresUser: String(config.localPostgresUser || DEFAULT_LOCAL_POSTGRES_USER).trim() || DEFAULT_LOCAL_POSTGRES_USER,
    localPostgresPassword: String(config.localPostgresPassword || DEFAULT_LOCAL_POSTGRES_PASSWORD).trim() || DEFAULT_LOCAL_POSTGRES_PASSWORD,
    remoteNodeId: String(config.remoteNodeId || REMOTE_NODES[0].id).trim() || REMOTE_NODES[0].id,
    remoteBaseUrl: normalizeBaseUrl(config.remoteBaseUrl || REMOTE_NODES[0].baseUrl) || REMOTE_NODES[0].baseUrl,
    remoteApiUser: String(config.remoteApiUser || DEFAULT_REMOTE_API_USER).trim() || DEFAULT_REMOTE_API_USER,
    remoteApiPassword: String(config.remoteApiPassword || DEFAULT_REMOTE_API_PASSWORD).trim() || DEFAULT_REMOTE_API_PASSWORD,
  };

  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(persisted, null, 2), "utf8");
  return persisted;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1260,
    height: 920,
    minWidth: 1040,
    minHeight: 760,
    title: "Rocky Maxx Instalador",
    autoHideMenuBar: true,
    backgroundColor: "#f5ead4",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, "preload.js"),
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const installerUrl = pathToFileURL(resolve(__dirname, "installer.html")).toString();
  void mainWindow.loadURL(installerUrl);
}

function parseNumericVersion(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function detectPostgresInstallation() {
  const baseDirectory = "C:\\Program Files\\PostgreSQL";
  if (!existsSync(baseDirectory)) {
    return {
      installed: false,
      version: "",
      binDir: "",
      psqlPath: "",
      pgRestorePath: "",
    };
  }

  const candidates = readdirSync(baseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const version = entry.name;
      const binDir = join(baseDirectory, version, "bin");
      const psqlPath = join(binDir, "psql.exe");
      const pgRestorePath = join(binDir, "pg_restore.exe");
      return {
        version,
        binDir,
        psqlPath,
        pgRestorePath,
      };
    })
    .filter((entry) => existsSync(entry.psqlPath) && existsSync(entry.pgRestorePath))
    .sort((left, right) => parseNumericVersion(right.version) - parseNumericVersion(left.version));

  if (candidates.length === 0) {
    return {
      installed: false,
      version: "",
      binDir: "",
      psqlPath: "",
      pgRestorePath: "",
    };
  }

  const selected = candidates[0];
  return {
    installed: true,
    version: selected.version,
    binDir: selected.binDir,
    psqlPath: selected.psqlPath,
    pgRestorePath: selected.pgRestorePath,
  };
}

function detectPgAdminInstallation() {
  const candidates = [
    join(process.env.ProgramFiles || "C:\\Program Files", "pgAdmin 4", "runtime", "pgAdmin4.exe"),
    join(process.env.LOCALAPPDATA || "", "Programs", "pgAdmin 4", "runtime", "pgAdmin4.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    return {
      installed: true,
      path: candidate,
      version: "",
    };
  }

  return {
    installed: false,
    path: "",
    version: "",
  };
}

function detectServiceRuntime() {
  if (!existsSync(ROCKY_SERVICE_RUNTIME_DIR)) {
    return {
      installed: false,
      path: "",
    };
  }

  return {
    installed: true,
    path: ROCKY_SERVICE_RUNTIME_DIR,
  };
}

function buildState() {
  const config = loadInstallerConfig();
  return {
    config,
    remoteNodes: REMOTE_NODES,
    postgres: detectPostgresInstallation(),
    pgAdmin: detectPgAdminInstallation(),
    serviceRuntime: detectServiceRuntime(),
  };
}

async function runCommand(command, args, options = {}) {
  writeRuntimeLog(`Ejecutando comando: ${command} ${args.join(" ")}`);
  try {
    return await execFileAsync(command, args, {
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = error?.stdout ? String(error.stdout) : "";
    const stderr = error?.stderr ? String(error.stderr) : "";
    const details = [error?.message || "Fallo el comando.", stdout.trim(), stderr.trim()]
      .filter(Boolean)
      .join("\n");
    throw new Error(details);
  }
}

async function installPostgres(payload) {
  const postgresState = detectPostgresInstallation();
  if (postgresState.installed) {
    const config = saveInstallerConfig(payload);
    await updateServiceRuntimeEnvFiles(config.localPostgresUser, config.localPostgresPassword);
    return {
      ok: true,
      message: `PostgreSQL ya estaba instalado (${postgresState.version}). Se dejaron actualizadas las credenciales de Rocky Maxx con el usuario ${config.localPostgresUser}.`,
    };
  }

  const config = saveInstallerConfig(payload);
  const overrideArgs = [
    "--mode",
    "unattended",
    "--unattendedmodeui",
    "minimal",
    "--superaccount",
    config.localPostgresUser,
    "--superpassword",
    config.localPostgresPassword,
    "--serverport",
    "5432",
    "--disable-components",
    "pgAdmin,stackbuilder",
  ];

  await runCommand(
    "winget",
    [
      "install",
      "--id",
      "PostgreSQL.PostgreSQL.18",
      "-e",
      "--source",
      "winget",
      "--accept-source-agreements",
      "--accept-package-agreements",
      "--disable-interactivity",
      "--silent",
      "--override",
      overrideArgs.join(" "),
    ],
  );

  await updateServiceRuntimeEnvFiles(config.localPostgresUser, config.localPostgresPassword);

  return {
    ok: true,
    message: `PostgreSQL 18 quedo instalado con el usuario ${config.localPostgresUser} y la clave ${config.localPostgresPassword}.`,
  };
}

async function installPgAdmin() {
  if (detectPgAdminInstallation().installed) {
    return {
      ok: true,
      message: "pgAdmin ya estaba instalado.",
    };
  }

  await runCommand("winget", [
    "install",
    "--id",
    "PostgreSQL.pgAdmin",
    "-e",
    "--source",
    "winget",
    "--accept-source-agreements",
    "--accept-package-agreements",
    "--disable-interactivity",
    "--silent",
  ]);

  return {
    ok: true,
    message: "pgAdmin quedo instalado con la version mas reciente disponible.",
  };
}

async function installStack(payload) {
  const postgresResult = await installPostgres(payload);
  const pgAdminResult = await installPgAdmin();
  return {
    ok: true,
    message: `${postgresResult.message} ${pgAdminResult.message}`,
  };
}

function resolveRemoteNode(payload) {
  const remoteNodeId = String(payload?.remoteNodeId || "").trim();
  const selectedNode = REMOTE_NODES.find((node) => node.id === remoteNodeId) || REMOTE_NODES[0];

  return {
    ...selectedNode,
    baseUrl: normalizeBaseUrl(payload?.remoteBaseUrl || selectedNode.baseUrl) || selectedNode.baseUrl,
    localDatabaseName: String(payload?.localDatabaseName || selectedNode.localDatabaseName).trim() || selectedNode.localDatabaseName,
  };
}

async function authenticateAgainstRemote(baseUrl, usuario, password) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      usuario,
      password,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`No se pudo autenticar contra ${baseUrl}. Estado ${response.status}. ${body}`.trim());
  }

  const payload = await response.json();
  if (!payload?.accessToken) {
    throw new Error(`La respuesta de login de ${baseUrl} no devolvio accessToken.`);
  }

  return payload.accessToken;
}

async function downloadRemoteDump(baseUrl, accessToken) {
  const dumpDirectory = mkdtempSync(join(tmpdir(), "rocky-maxx-remote-dump-"));
  const dumpPath = join(dumpDirectory, "remote.dump");

  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/maintenance/database-dump`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    rmSync(dumpDirectory, { recursive: true, force: true });
    throw new Error(`No se pudo descargar el respaldo remoto. Estado ${response.status}. ${body}`.trim());
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(dumpPath, Buffer.from(arrayBuffer));

  return {
    dumpDirectory,
    dumpPath,
  };
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

async function runPsqlCommand(postgresState, localUser, localPassword, databaseName, sql) {
  const result = await runCommand(
    postgresState.psqlPath,
    [
      "-h",
      "127.0.0.1",
      "-p",
      "5432",
      "-U",
      localUser,
      "-d",
      databaseName,
      "-v",
      "ON_ERROR_STOP=1",
      "-Atqc",
      sql,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: localPassword,
      },
    },
  );

  return String(result.stdout || "").trim();
}

async function ensureDatabaseRestorable(postgresState, localUser, localPassword, databaseName) {
  const databaseExists = await runPsqlCommand(
    postgresState,
    localUser,
    localPassword,
    "postgres",
    `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(databaseName)};`,
  );

  if (databaseExists === "1") {
    const answer = await dialog.showMessageBox({
      type: "question",
      title: "Base local existente",
      message: `La base local ${databaseName} ya existe.`,
      detail:
        "Si continuas, el instalador la eliminara y la restaurara nuevamente con los datos mas recientes del VPS.",
      buttons: ["Cancelar", "Eliminar y restaurar"],
      cancelId: 0,
      defaultId: 1,
      noLink: true,
    });

    if (answer.response !== 1) {
      throw new Error(`La restauracion se cancelo porque la base local ${databaseName} ya existe.`);
    }

    await runPsqlCommand(
      postgresState,
      localUser,
      localPassword,
      "postgres",
      [
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${quoteLiteral(databaseName)} AND pid <> pg_backend_pid();`,
        `DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)};`,
      ].join(" "),
    );
  }

  await runPsqlCommand(
    postgresState,
    localUser,
    localPassword,
    "postgres",
    `CREATE DATABASE ${quoteIdentifier(databaseName)} OWNER ${quoteIdentifier(localUser)};`,
  );
}

async function restoreDumpIntoLocalDatabase(postgresState, localUser, localPassword, databaseName, dumpPath) {
  await runCommand(
    postgresState.pgRestorePath,
    [
      "-h",
      "127.0.0.1",
      "-p",
      "5432",
      "-U",
      localUser,
      "-d",
      databaseName,
      "--no-owner",
      "--no-privileges",
      "--role",
      localUser,
      dumpPath,
    ],
    {
      env: {
        ...process.env,
        PGPASSWORD: localPassword,
      },
    },
  );
}

function replaceDatabaseUrlCredentials(databaseUrl, userName, password) {
  const parsed = new URL(databaseUrl);
  parsed.username = encodeURIComponent(userName);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

async function updateServiceRuntimeEnvFiles(localUser, localPassword) {
  if (!existsSync(ROCKY_SERVICE_RUNTIME_DIR)) {
    return;
  }

  const envFiles = readdirSync(ROCKY_SERVICE_RUNTIME_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(".env") && !name.endsWith(".example"));

  for (const fileName of envFiles) {
    const filePath = join(ROCKY_SERVICE_RUNTIME_DIR, fileName);
    const original = readFileSync(filePath, "utf8");
    const updated = original.replace(/^DATABASE_URL=(.+)$/m, (_match, rawValue) => {
      let nextValue = String(rawValue || "").trim();
      if (
        (nextValue.startsWith('"') && nextValue.endsWith('"')) ||
        (nextValue.startsWith("'") && nextValue.endsWith("'"))
      ) {
        nextValue = nextValue.slice(1, -1);
      }

      const replaced = replaceDatabaseUrlCredentials(nextValue, localUser, localPassword);
      return `DATABASE_URL="${replaced}"`;
    });

    if (updated !== original) {
      writeFileSync(filePath, updated, "utf8");
    }
  }
}

async function restoreFromVps(payload) {
  const config = saveInstallerConfig(payload);
  const postgresState = detectPostgresInstallation();
  if (!postgresState.installed) {
    throw new Error("No se detecto PostgreSQL local. Instala PostgreSQL antes de restaurar una base del VPS.");
  }

  const localUser = String(config.localPostgresUser || DEFAULT_LOCAL_POSTGRES_USER).trim() || DEFAULT_LOCAL_POSTGRES_USER;
  const localPassword = String(config.localPostgresPassword || DEFAULT_LOCAL_POSTGRES_PASSWORD).trim() || DEFAULT_LOCAL_POSTGRES_PASSWORD;
  const remoteNode = resolveRemoteNode({
    ...config,
    ...payload,
  });

  const accessToken = await authenticateAgainstRemote(
    remoteNode.baseUrl,
    String(config.remoteApiUser || DEFAULT_REMOTE_API_USER).trim() || DEFAULT_REMOTE_API_USER,
    String(config.remoteApiPassword || DEFAULT_REMOTE_API_PASSWORD),
  );

  const dumpArtifact = await downloadRemoteDump(remoteNode.baseUrl, accessToken);
  try {
    await ensureDatabaseRestorable(postgresState, localUser, localPassword, remoteNode.localDatabaseName);
    await restoreDumpIntoLocalDatabase(
      postgresState,
      localUser,
      localPassword,
      remoteNode.localDatabaseName,
      dumpArtifact.dumpPath,
    );
    await updateServiceRuntimeEnvFiles(localUser, localPassword);
  } finally {
    rmSync(dumpArtifact.dumpDirectory, { recursive: true, force: true });
  }

  return {
    ok: true,
    message: `La base remota ${remoteNode.remoteDatabaseName} se restauro en local como ${remoteNode.localDatabaseName}.`,
  };
}

ipcMain.handle("installer:get-state", async () => buildState());

ipcMain.handle("installer:install-postgres", async (_event, payload) => installPostgres(payload));

ipcMain.handle("installer:install-pgadmin", async () => installPgAdmin());

ipcMain.handle("installer:install-stack", async (_event, payload) => installStack(payload));

ipcMain.handle("installer:restore-from-vps", async (_event, payload) => restoreFromVps(payload));

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

app.whenReady().then(() => {
  createMainWindow();
}).catch((error) => {
  writeRuntimeLog(`Fallo el arranque del instalador: ${error.stack || error.message}`);
  dialog.showErrorBox("Rocky Maxx Instalador", `No se pudo iniciar el instalador.\n\n${error.message}`);
  app.quit();
});
