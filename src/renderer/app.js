const state = {
  libraries: [],
  environment: null,
  selectedCollectionId: null,
  exporting: false,
};

const SOURCE_LABELS = {
  manual: "Manual selection",
  "profile-pref": "Profile preference",
  default: "Default data directory",
  "profile-root": "Profile root fallback",
};

function formatSelectionBadge(count) {
  return count === 1 ? "1 collection selected" : `${count} collections selected`;
}

function formatProcessedEntries(progress) {
  if (!progress.entriesTotal) {
    return progress.phase || "Processing";
  }

  return `${progress.entriesProcessed || 0}/${progress.entriesTotal} entries processed`;
}

const elements = {
  environmentDetails: document.getElementById("environment-details"),
  treeRoot: document.getElementById("tree-root"),
  selectionBadge: document.getElementById("selection-badge"),
  selectedTitle: document.getElementById("selected-title"),
  selectedDescription: document.getElementById("selected-description"),
  selectedSummary: document.getElementById("selected-summary"),
  progressBar: document.getElementById("progress-bar"),
  progressLabel: document.getElementById("progress-label"),
  progressPercent: document.getElementById("progress-percent"),
  progressMeta: document.getElementById("progress-meta"),
  exportButton: document.getElementById("export-button"),
  refreshButton: document.getElementById("refresh-button"),
  chooseDirButton: document.getElementById("choose-dir-button"),
};

function flattenCollections() {
  const entries = new Map();
  const visit = node => {
    entries.set(node.collectionID, node);
    node.children.forEach(visit);
  };

  state.libraries.forEach(library => library.children.forEach(visit));
  return entries;
}

function getSelectedCollection() {
  if (!state.selectedCollectionId) {
    return null;
  }
  return flattenCollections().get(state.selectedCollectionId) || null;
}

function countSubcollections(node) {
  return node.children.reduce((total, child) => total + 1 + countSubcollections(child), 0);
}

function renderEnvironment() {
  const environment = state.environment;
  elements.environmentDetails.innerHTML = "";
  if (!environment) {
    return;
  }

  const rows = [
    ["Data directory", environment.dataDir],
    ["Database file", environment.dbFileUsed],
    ["Profile", environment.profileDir || "Not detected"],
    ["Source", SOURCE_LABELS[environment.source] || environment.source],
  ];

  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    elements.environmentDetails.append(dt, dd);
  }
}

function renderTree() {
  elements.treeRoot.innerHTML = "";

  if (!state.libraries.length) {
    const empty = document.createElement("p");
    empty.className = "summary-text";
    empty.textContent = "No collections were found in the local Zotero library.";
    elements.treeRoot.appendChild(empty);
    return;
  }

  for (const library of state.libraries) {
    const section = document.createElement("section");
    section.className = "library-block";

    const title = document.createElement("p");
    title.className = "library-label";
    title.textContent = library.name;
    section.appendChild(title);

    const list = document.createElement("ul");
    list.className = "tree-list";
    renderNodes(list, library.children);
    section.appendChild(list);
    elements.treeRoot.appendChild(section);
  }
}

function renderNodes(container, nodes) {
  for (const node of nodes) {
    const item = document.createElement("li");
    item.className = "tree-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tree-node";
    if (state.selectedCollectionId === node.collectionID) {
      button.classList.add("is-selected");
    }
    button.textContent = node.name;
    button.addEventListener("click", () => {
      state.selectedCollectionId = node.collectionID;
      renderTree();
      renderSelection();
    });
    item.appendChild(button);

    if (node.children.length) {
      const nested = document.createElement("ul");
      nested.className = "tree-list";
      renderNodes(nested, node.children);
      item.appendChild(nested);
    }

    container.appendChild(item);
  }
}

function renderSelection() {
  const selected = getSelectedCollection();
  elements.selectedSummary.innerHTML = "";

  if (!selected) {
    elements.selectionBadge.textContent = "No selection";
    elements.selectedTitle.textContent = "Select a collection";
    elements.selectedDescription.textContent =
      "The app will export the selected collection, its child subcollections, and the allowed attachments.";
    elements.exportButton.disabled = true;
    return;
  }

  const subcollectionCount = countSubcollections(selected);
  elements.selectionBadge.textContent = formatSelectionBadge(1);
  elements.selectedTitle.textContent = selected.name;
  elements.selectedDescription.textContent =
    "The selected collection will be exported as the root ZIP directory. If it has subcollections, their directories and allowed documents will be included as well.";

  const summaryRows = [
    ["ID", String(selected.collectionID)],
    ["Library", String(selected.libraryID)],
    ["Included subcollections", String(subcollectionCount)],
  ];

  for (const [label, value] of summaryRows) {
    const row = document.createElement("li");
    const left = document.createElement("span");
    left.textContent = label;
    const right = document.createElement("strong");
    right.textContent = value;
    row.append(left, right);
    elements.selectedSummary.appendChild(row);
  }

  elements.exportButton.disabled = state.exporting;
}

function updateProgress(progress) {
  const percent = Number.isFinite(progress.percent) ? progress.percent : 0;
  elements.progressBar.value = percent;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressLabel.textContent = progress.message || "Processing...";

  if (progress.entriesTotal) {
    elements.progressMeta.textContent = formatProcessedEntries(progress);
  }
  else if (progress.bytesWritten) {
    elements.progressMeta.textContent = `${Math.round(progress.bytesWritten / 1024)} KB written`;
  }
  else {
    elements.progressMeta.textContent = progress.phase || "Processing";
  }
}

function setIdleProgress(message = "No export is currently running.") {
  elements.progressBar.value = 0;
  elements.progressPercent.textContent = "0%";
  elements.progressLabel.textContent = "Ready to export";
  elements.progressMeta.textContent = message;
}

async function loadState() {
  try {
    const result = await window.zotExportApp.getState();
    state.environment = result.environment;
    state.libraries = result.libraries;

    if (!getSelectedCollection()) {
      state.selectedCollectionId = null;
    }

    renderEnvironment();
    renderTree();
    renderSelection();
    setIdleProgress();
  }
  catch (error) {
    setIdleProgress(error.message || String(error));
    elements.treeRoot.innerHTML = `<p class="summary-text">${error.message || String(error)}</p>`;
  }
}

async function chooseDataDir() {
  try {
    const result = await window.zotExportApp.chooseDataDir();
    if (result.canceled) {
      return;
    }
    state.environment = result.state.environment;
    state.libraries = result.state.libraries;
    state.selectedCollectionId = null;
    renderEnvironment();
    renderTree();
    renderSelection();
    setIdleProgress("Data directory updated.");
  }
  catch (error) {
    setIdleProgress(error.message || String(error));
  }
}

async function exportSelectedCollection() {
  const selected = getSelectedCollection();
  if (!selected || state.exporting) {
    return;
  }

  state.exporting = true;
  elements.exportButton.disabled = true;
  updateProgress({
    percent: 1,
    message: "Opening save dialog...",
  });

  try {
    const result = await window.zotExportApp.exportCollection(selected.collectionID);
    if (result.canceled) {
      setIdleProgress("Export canceled.");
      return;
    }
    setIdleProgress(
      `ZIP created at ${result.outputPath}. Directories: ${result.directoryCount}. Files: ${result.fileCount}. Skipped: ${result.skippedCount}.`
    );
  }
  catch (error) {
    setIdleProgress(error.message || String(error));
  }
  finally {
    state.exporting = false;
    renderSelection();
  }
}

elements.refreshButton.addEventListener("click", loadState);
elements.chooseDirButton.addEventListener("click", chooseDataDir);
elements.exportButton.addEventListener("click", exportSelectedCollection);

window.zotExportApp.onExportProgress(updateProgress);

loadState();