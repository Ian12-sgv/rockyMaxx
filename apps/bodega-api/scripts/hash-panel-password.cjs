#!/usr/bin/env node
// Genera una entrada para PANEL_USUARIOS (usuarios del panel web de
// bodega_datos) sin guardar la contrasena en texto plano en ningun lado.
//
// Uso (en el VPS, dentro de apps/bodega-api):
//   npm run hash-password -- <usuario> <TODOS|B>
// Pide la contrasena dos veces sin mostrarla y imprime algo como:
//   admin|TODOS|<salt>.<hash>
// Esa linea se agrega a PANEL_USUARIOS en .env (varias separadas por ";")
// y se reinicia el servicio.
//
// Mismo formato que hashPassword() en src/auth/panel-auth.service.ts
// (scrypt, salt de 16 bytes, clave de 64 bytes, ambos en hex).

const { randomBytes, scryptSync } = require("node:crypto");
const readline = require("node:readline");

const [usuario, grupoArg] = process.argv.slice(2);
const grupo = String(grupoArg || "").toUpperCase();

if (!usuario || !/^[A-Za-z0-9._-]{1,40}$/.test(usuario) || (grupo !== "TODOS" && grupo !== "B")) {
  console.error("Uso: npm run hash-password -- <usuario> <TODOS|B>");
  console.error("  usuario: letras, numeros, punto, guion o guion bajo (max 40).");
  process.exit(1);
}

function preguntarOculto(pregunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = false;
    rl._writeToOutput = function escribir(texto) {
      if (rl.stdoutMuted && !texto.startsWith(pregunta)) {
        return;
      }
      rl.output.write(texto);
    };
    rl.question(pregunta, (respuesta) => {
      rl.close();
      process.stdout.write("\n");
      resolve(respuesta);
    });
    rl.stdoutMuted = true;
  });
}

(async () => {
  const password = await preguntarOculto("Contrasena: ");
  if (password.length < 8) {
    console.error("La contrasena debe tener al menos 8 caracteres.");
    process.exit(1);
  }
  const confirmacion = await preguntarOculto("Repite la contrasena: ");
  if (password !== confirmacion) {
    console.error("Las contrasenas no coinciden.");
    process.exit(1);
  }

  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  console.log("\nAgrega esta entrada a PANEL_USUARIOS en .env:\n");
  console.log(`${usuario}|${grupo}|${salt.toString("hex")}.${hash.toString("hex")}`);
})();
