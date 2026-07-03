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
  downloadPrinterDrivers() {
    return ipcRenderer.invoke("installer:download-printer-drivers");
  },
  openPrinterDriversFolder() {
    return ipcRenderer.invoke("installer:open-printer-drivers-folder");
  },
});
