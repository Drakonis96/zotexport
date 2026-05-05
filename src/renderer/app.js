const { countSubcollections, filterLibraries, flattenCollections } = window.zotExportCollections;

const state = {
  libraries: [],
  environment: null,
  selectedCollectionId: null,
  exporting: false,
  collectionFilter: "",
  includeSubcollections: true,
  exportPreview: null,
  previewRequestId: 0,
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
  collectionSearchInput: document.getElementById("collection-search"),
  environmentDetails: document.getElementById("environment-details"),
  treeRoot: document.getElementById("tree-root"),
  selectionBadge: document.getElementById("selection-badge"),
  includeSubcollectionsToggle: document.getElementById("include-subcollections"),
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

function getSelectedCollection() {
  if (!state.selectedCollectionId) {
    return null;
  }
  return flattenCollections(state.libraries).get(state.selectedCollectionId) || null;
}

function getLibraryName(libraryId) {
  return state.libraries.find(library => library.libraryID === libraryId)?.name || String(libraryId);
}

function resetExportPreview() {
  state.previewRequestId += 1;
  state.exportPreview = null;
}

function getDirectoryCountPreview(selected) {
  if (!selected) {
    return 0;
  }

  return state.includeSubcollections ? 1 + countSubcollections(selected) : 1;
}

function appendSummaryRow(label, value) {
  const row = document.createElement("li");
  const left = document.createElement("span");
  left.textContent = label;
  const right = document.createElement("strong");
  right.textContent = value;
  row.append(left, right);
  elements.selectedSummary.appendChild(row);
}

async function refreshExportPreview() {
  const selected = getSelectedCollection();
  const requestId = ++state.previewRequestId;

  if (!selected) {
    state.exportPreview = null;
    renderSelection();
    return;
  }

  state.exportPreview = { loading: true };
  renderSelection();

  try {
    const preview = await window.zotExportApp.getExportPreview({
      collectionId: selected.collectionID,
      includeSubcollections: state.includeSubcollections,
    });

    if (requestId !== state.previewRequestId) {
      return;
    }

    state.exportPreview = preview;
  }
  catch (error) {
    if (requestId !== state.previewRequestId) {
      return;
    }

    state.exportPreview = {
      error: error.message || String(error),
    };
  }

  if (requestId === state.previewRequestId) {
    renderSelection();
  }
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
  const filteredLibraries = filterLibraries(state.libraries, state.collectionFilter);

  if (!state.libraries.length) {
    const empty = document.createElement("p");
    empty.className = "summary-text";
    empty.textContent = "No collections were found in the local Zotero library.";
    elements.treeRoot.appendChild(empty);
    return;
  }

  if (!filteredLibraries.length) {
    const empty = document.createElement("p");
    empty.className = "summary-text";
    empty.textContent = `No collections match \"${state.collectionFilter.trim()}\".`;
    elements.treeRoot.appendChild(empty);
    return;
  }

  for (const library of filteredLibraries) {
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
      state.exportPreview = { loading: true };
      renderTree();
      renderSelection();
      void refreshExportPreview();
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
  const preview = state.exportPreview;
  elements.selectedSummary.innerHTML = "";

  if (!selected) {
    elements.selectionBadge.textContent = "No selection";
    elements.selectedTitle.textContent = "Select a collection";
    elements.selectedDescription.textContent =
      "The app will export the selected collection, its child subcollections, and the allowed attachments.";
    elements.exportButton.disabled = true;
    return;
  }

  elements.selectionBadge.textContent = formatSelectionBadge(1);
  elements.selectedTitle.textContent = selected.name;
  elements.selectedDescription.textContent =
    state.includeSubcollections
      ? "The selected collection will be exported as the root ZIP directory. Child subcollections and their allowed documents will be included as well."
      : "Only the selected collection directory and its allowed documents will be included in the ZIP.";

  appendSummaryRow("Library", getLibraryName(selected.libraryID));
  appendSummaryRow(
    "Included subcollections",
    String(preview?.includedSubcollectionCount ?? (state.includeSubcollections ? countSubcollections(selected) : 0))
  );
  appendSummaryRow(
    "Directories",
    String(preview?.directoryCount ?? getDirectoryCountPreview(selected))
  );

  if (preview?.error) {
    appendSummaryRow("Files", "Unavailable");
    appendSummaryRow("Total ZIP entries", "Unavailable");
    appendSummaryRow("Preview", preview.error);
  }
  else {
    appendSummaryRow("Files", preview?.loading ? "Calculating..." : String(preview?.fileCount ?? 0));
    appendSummaryRow(
      "Total ZIP entries",
      preview?.loading ? "Calculating..." : String(preview?.totalEntries ?? 0)
    );
  }

  elements.exportButton.disabled = state.exporting || Boolean(preview?.loading) || Boolean(preview?.error);
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
    resetExportPreview();

    if (!getSelectedCollection()) {
      state.selectedCollectionId = null;
    }

    renderEnvironment();
    renderTree();
    renderSelection();
    setIdleProgress();

    if (state.selectedCollectionId) {
      void refreshExportPreview();
    }
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
    resetExportPreview();
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
  if (!selected || state.exporting || state.exportPreview?.loading || state.exportPreview?.error) {
    return;
  }

  state.exporting = true;
  renderSelection();
  updateProgress({
    percent: 1,
    message: "Opening save dialog...",
  });

  try {
    const result = await window.zotExportApp.exportCollection({
      collectionId: selected.collectionID,
      includeSubcollections: state.includeSubcollections,
    });
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
elements.collectionSearchInput.addEventListener("input", event => {
  state.collectionFilter = event.target.value || "";
  renderTree();
});
elements.includeSubcollectionsToggle.addEventListener("change", event => {
  state.includeSubcollections = event.target.checked;
  if (state.selectedCollectionId) {
    void refreshExportPreview();
    return;
  }

  renderSelection();
});

window.zotExportApp.onExportProgress(updateProgress);

loadState();