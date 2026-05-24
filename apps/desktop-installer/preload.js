const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rockyInstaller", {
  getState() {
    return ipcRenderer.invoke("installer:get-state");
  },
  installPostgres(payload) {
    return ipcRenderer.invoke("installer:install-postgres", payload);
  },
  installPgAdmin() {
    return ipcRenderer.invoke("installer:install-pgadmin");
  },
  installStack(payload) {
    return ipcRenderer.invoke("installer:install-stack", payload);
  },
  restoreFromVps(payload) {
    return ipcRenderer.invoke("installer:restore-from-vps", payload);
  },
});
