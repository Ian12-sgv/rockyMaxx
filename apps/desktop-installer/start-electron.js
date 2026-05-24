const { spawn } = require("node:child_process");
const { join } = require("node:path");

const electronBinary = require("electron");

const env = {
  ...process.env,
};

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, [join(__dirname)], {
  cwd: __dirname,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
