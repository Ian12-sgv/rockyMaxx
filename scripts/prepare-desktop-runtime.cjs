const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { dirname, join, relative, sep } = require("node:path");

const rootDir = join(__dirname, "..");
const targetArgIndex = process.argv.findIndex((value) => value === "--target");
const targetRelativePath = targetArgIndex >= 0 ? process.argv[targetArgIndex + 1] : "apps/desktop-service";
const desktopDir = join(rootDir, targetRelativePath);
const bundleDir = join(desktopDir, ".bundle");
const apiBundleDir = join(bundleDir, "api");
const apiBundleVendorModulesDir = join(apiBundleDir, "vendor_modules");
const rootNodeModulesDir = join(rootDir, "node_modules");
const bundledNodeExecutablePath = join(
  apiBundleDir,
  process.platform === "win32" ? "node.exe" : "node",
);

function ensureCleanDir(targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
}

function copyDirectory(sourceDir, targetDir) {
  cpSync(sourceDir, targetDir, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

function copyOptionalDirectory(sourceDir, targetDir) {
  if (existsSync(sourceDir)) {
    mkdirSync(dirname(targetDir), { recursive: true });
    copyDirectory(sourceDir, targetDir);
  }
}

function copyApiEnvironmentFiles(sourceDir, targetDir) {
  if (!existsSync(sourceDir)) {
    return;
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.startsWith(".env") || entry.name.endsWith(".example")) {
      continue;
    }

    cpSync(join(sourceDir, entry.name), join(targetDir, entry.name), { force: true });
  }
}

function copyRuntimePath(sourcePath) {
  const relativePath = relative(rootNodeModulesDir, sourcePath);
  const targetPath = join(apiBundleVendorModulesDir, relativePath);

  mkdirSync(dirname(targetPath), { recursive: true });
  copyDirectory(sourcePath, targetPath);
}

function listRuntimeDependencyPaths() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `${npmCommand} ls --omit=dev --all --parseable --workspace=@sistema-arabe/api`]
      : ["ls", "--omit=dev", "--all", "--parseable", "--workspace=@sistema-arabe/api"];
  const result = spawnSync(
    process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : npmCommand,
    commandArgs,
    {
      cwd: rootDir,
      encoding: "utf8",
      shell: false,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || "No se pudo resolver el arbol de dependencias runtime del backend.");
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.startsWith(`${rootNodeModulesDir}${sep}`))
    .filter((value) => !value.includes(`${sep}@sistema-arabe${sep}api`));
}

function main() {
  const runtimeDependencyPaths = new Set(listRuntimeDependencyPaths());
  runtimeDependencyPaths.add(join(rootNodeModulesDir, ".prisma"));

  ensureCleanDir(bundleDir);
  mkdirSync(apiBundleVendorModulesDir, { recursive: true });

  copyDirectory(join(rootDir, "apps", "api", "dist"), join(apiBundleDir, "dist"));
  copyOptionalDirectory(join(rootDir, "apps", "api", "public"), join(apiBundleDir, "public"));
  copyOptionalDirectory(join(rootDir, "apps", "api", "prisma"), join(apiBundleDir, "prisma"));
  copyApiEnvironmentFiles(join(rootDir, "apps", "api"), apiBundleDir);

  if (!existsSync(join(apiBundleDir, ".env")) && existsSync(join(rootDir, ".env"))) {
    cpSync(join(rootDir, ".env"), join(apiBundleDir, ".env"), { force: true });
  }

  if (existsSync(join(rootDir, "apps", "api", "package.json"))) {
    cpSync(join(rootDir, "apps", "api", "package.json"), join(apiBundleDir, "package.json"), {
      force: true,
    });
  }

  if (existsSync(process.execPath)) {
    cpSync(process.execPath, bundledNodeExecutablePath, { force: true });
  }

  for (const dependencyPath of [...runtimeDependencyPaths].sort((left, right) => left.localeCompare(right))) {
    if (existsSync(dependencyPath)) {
      copyRuntimePath(dependencyPath);
    }
  }

  console.log(`Runtime de escritorio preparado en ${apiBundleDir}`);
}

main();
