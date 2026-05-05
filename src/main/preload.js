const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zotExportApp", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  refreshState: () => ipcRenderer.invoke("app:refresh-state"),
  chooseDataDir: () => ipcRenderer.invoke("app:choose-data-dir"),
  exportCollection: collectionId =>
    ipcRenderer.invoke("app:export-collection", { collectionId }),
  onExportProgress: handler => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("export:progress", listener);
    return () => ipcRenderer.removeListener("export:progress", listener);
  },
});