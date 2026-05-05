const path = require("path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const {
  detectZoteroEnvironment,
  loadCollectionTree,
  findCollectionNode,
} = require("./zotero");
const { exportCollectionToZip, planCollectionExport } = require("./exporter");

let mainWindow = null;
let manualDataDir = null;
const appIconPath = path.join(__dirname, "../../public/logo.png");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1080,
    minHeight: 720,
    title: "zotexport",
    icon: appIconPath,
    backgroundColor: "#f5f1e8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

async function buildAppState() {
  const environment = await detectZoteroEnvironment({
    manualDataDir,
  });
  const libraries = await loadCollectionTree(environment);

  return {
    environment: {
      dataDir: environment.dataDir,
      dbPath: environment.dbPath,
      dbFileUsed: environment.dbFileUsed,
      profileDir: environment.profileDir,
      profileRoot: environment.profileRoot,
      source: environment.source,
    },
    libraries,
  };
}

app.whenReady().then(() => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(appIconPath);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("app:get-state", async () => {
  return buildAppState();
});

ipcMain.handle("app:refresh-state", async () => {
  return buildAppState();
});

ipcMain.handle("app:choose-data-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose the Zotero data directory",
    properties: ["openDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  manualDataDir = result.filePaths[0];
  return {
    canceled: false,
    state: await buildAppState(),
  };
});

ipcMain.handle("app:get-export-preview", async (_event, payload) => {
  const collectionId = Number(payload?.collectionId);
  const includeSubcollections = payload?.includeSubcollections !== false;

  if (!Number.isInteger(collectionId)) {
    throw new Error("No valid collection was received for preview.");
  }

  const state = await buildAppState();
  const { summary } = await planCollectionExport({
    environment: state.environment,
    libraries: state.libraries,
    collectionId,
    includeSubcollections,
  });

  return summary;
});

ipcMain.handle("app:export-collection", async (_event, payload) => {
  const collectionId = Number(payload?.collectionId);
  const includeSubcollections = payload?.includeSubcollections !== false;
  if (!Number.isInteger(collectionId)) {
    throw new Error("No valid collection was received for export.");
  }

  const state = await buildAppState();
  const selectedCollection = findCollectionNode(state.libraries, collectionId);
  if (!selectedCollection) {
    throw new Error("The selected collection no longer exists in Zotero.");
  }

  const saveDialog = await dialog.showSaveDialog(mainWindow, {
    title: "Save export ZIP",
    defaultPath: `${selectedCollection.name}.zip`,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });

  if (saveDialog.canceled || !saveDialog.filePath) {
    return { canceled: true };
  }

  const result = await exportCollectionToZip({
    environment: state.environment,
    libraries: state.libraries,
    collectionId,
    includeSubcollections,
    outputPath: saveDialog.filePath,
    onProgress(progress) {
      mainWindow?.webContents.send("export:progress", progress);
    },
  });

  return {
    canceled: false,
    ...result,
  };
});