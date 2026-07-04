const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rockyClient", {
  getConfig() {
    return ipcRenderer.invoke("client-config:get");
  },
  saveConfig(serverUrl) {
    return ipcRenderer.invoke("client-config:save", serverUrl);
  },
  checkServer(serverUrl) {
    return ipcRenderer.invoke("client-server:check", serverUrl);
  },
  openServer(serverUrl) {
    return ipcRenderer.invoke("client-server:open", serverUrl);
  },
  listPrinters() {
    return ipcRenderer.invoke("client-printers:list");
  },
  printHtml(payload) {
    return ipcRenderer.invoke("client-printers:print-html", payload);
  },
  exportHtmlPdf(payload) {
    return ipcRenderer.invoke("client-printers:export-html-pdf", payload);
  },
  printHtmlViaPdf(payload) {
    return ipcRenderer.invoke("client-printers:print-html-via-pdf", payload);
  },
  onState(handler) {
    const listener = (_event, payload) => {
      handler(payload);
    };

    ipcRenderer.on("client-config:state", listener);
    return () => {
      ipcRenderer.removeListener("client-config:state", listener);
    };
  },
});

