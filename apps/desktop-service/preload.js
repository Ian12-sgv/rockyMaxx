const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rockyService", {
  getState() {
    return ipcRenderer.invoke("service-config:get-state");
  },
  refreshState() {
    return ipcRenderer.invoke("service-config:refresh");
  },
  saveConfig(profileId) {
    return ipcRenderer.invoke("service-config:save", profileId);
  },
  onState(handler) {
    const listener = (_event, payload) => {
      handler(payload);
    };

    ipcRenderer.on("service-config:state", listener);
    return () => {
      ipcRenderer.removeListener("service-config:state", listener);
    };
  },
});
