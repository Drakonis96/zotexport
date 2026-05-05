const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

const { queryJson, getTableNames, findCollectionNode } = require("./zotero");

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".epub",
  ".doc",
  ".docx",
  ".md",
  ".markdown",
]);

function sanitizeSegment(name, fallback) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();

  return cleaned || fallback;
}

function ensureUniqueName(baseName, usedNames) {
  const extensionIndex = baseName.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const base = hasExtension ? baseName.slice(0, extensionIndex) : baseName;
  const extension = hasExtension ? baseName.slice(extensionIndex) : "";

  let candidate = baseName;
  let attempt = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${base} (${attempt})${extension}`;
    attempt += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function collectSubtree(node) {
  const nodes = [];

  const visit = current => {
    nodes.push(current);
    for (const child of current.children) {
      visit(child);
    }
  };

  visit(node);
  return nodes;
}

function buildDirectoryPlan(rootNode) {
  const directories = [];
  const pathByCollectionId = new Map();

  const walk = (node, parentPath, siblingUsedNames) => {
    const dirName = ensureUniqueName(
      sanitizeSegment(node.name, `collection-${node.collectionID}`),
      siblingUsedNames
    );
    const zipPath = parentPath ? path.posix.join(parentPath, dirName) : dirName;

    directories.push({
      collectionID: node.collectionID,
      zipPath,
      name: dirName,
      originalName: node.name,
    });
    pathByCollectionId.set(node.collectionID, zipPath);

    const childUsedNames = new Set();
    for (const child of node.children) {
      walk(child, zipPath, childUsedNames);
    }
  };

  walk(rootNode, "", new Set());
  return { directories, pathByCollectionId };
}

function resolveAttachmentSource(row, dataDir) {
  if (!row.path) {
    return null;
  }

  if (row.path.startsWith("storage:")) {
    return path.join(dataDir, "storage", row.attachmentKey, row.path.slice("storage:".length));
  }

  if (row.path.startsWith("file://")) {
    try {
      return new URL(row.path).pathname;
    }
    catch (_error) {
      return null;
    }
  }

  if (path.isAbsolute(row.path)) {
    return row.path;
  }

  return null;
}

function hasAllowedExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension);
}

async function queryAttachments(dbPath, collectionIds, tables) {
  if (!collectionIds.length) {
    return [];
  }

  const idList = collectionIds.map(id => Number(id)).filter(Number.isInteger).join(", ");
  if (!idList) {
    return [];
  }

  const deletedItemsJoin = tables.has("deletedItems")
    ? "LEFT JOIN deletedItems di ON di.itemID = ai.itemID"
    : "";
  const deletedItemsWhere = tables.has("deletedItems")
    ? "AND di.itemID IS NULL"
    : "";

  const sql = `
    SELECT
      ci.collectionID,
      ia.itemID AS attachmentItemID,
      ia.parentItemID,
      ia.linkMode,
      ia.contentType,
      ia.path,
      ai.key AS attachmentKey,
      ai.libraryID
    FROM collectionItems ci
    JOIN itemAttachments ia ON (ia.parentItemID = ci.itemID OR ia.itemID = ci.itemID)
    JOIN items ai ON ai.itemID = ia.itemID
    ${deletedItemsJoin}
    WHERE ci.collectionID IN (${idList})
      ${deletedItemsWhere}
    ORDER BY ci.collectionID, ia.itemID;
  `;

  return queryJson(dbPath, sql);
}

function buildArchivePlan({ rootNode, attachmentRows, dataDir }) {
  const { directories, pathByCollectionId } = buildDirectoryPlan(rootNode);
  const groupedAttachments = new Map();
  const skipped = [];

  for (const row of attachmentRows) {
    if (!groupedAttachments.has(row.collectionID)) {
      groupedAttachments.set(row.collectionID, []);
    }
    groupedAttachments.get(row.collectionID).push(row);
  }

  const files = [];
  for (const directory of directories) {
    const rows = groupedAttachments.get(directory.collectionID) || [];
    const seenAttachmentIds = new Set();
    const usedFileNames = new Set();

    for (const row of rows) {
      if (seenAttachmentIds.has(row.attachmentItemID)) {
        continue;
      }
      seenAttachmentIds.add(row.attachmentItemID);

      const sourcePath = resolveAttachmentSource(row, dataDir);
      if (!sourcePath) {
        skipped.push({ reason: "ruta_no_soportada", attachmentItemID: row.attachmentItemID });
        continue;
      }
      if (!hasAllowedExtension(sourcePath)) {
        skipped.push({ reason: "extension_no_permitida", sourcePath });
        continue;
      }
      if (!fs.existsSync(sourcePath)) {
        skipped.push({ reason: "archivo_no_encontrado", sourcePath });
        continue;
      }

      const fileName = ensureUniqueName(
        sanitizeSegment(path.basename(sourcePath), `file-${row.attachmentItemID}`),
        usedFileNames
      );

      files.push({
        collectionID: directory.collectionID,
        sourcePath,
        zipPath: path.posix.join(pathByCollectionId.get(directory.collectionID), fileName),
      });
    }
  }

  return {
    directories,
    files,
    skipped,
    totalEntries: directories.length + files.length,
  };
}

function writeArchive({ plan, outputPath, onProgress }) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const totalEntries = Math.max(plan.totalEntries, 1);

    output.on("close", () => {
      onProgress({
        phase: "done",
        percent: 100,
        message: "ZIP completed.",
        entriesProcessed: totalEntries,
        entriesTotal: totalEntries,
        bytesWritten: archive.pointer(),
      });
      resolve();
    });

    archive.on("warning", error => {
      reject(error);
    });

    archive.on("error", error => {
      reject(error);
    });

    archive.on("progress", payload => {
      const processed = payload.entries.processed || 0;
      const percent = Math.min(100, Math.round((processed / totalEntries) * 100));
      onProgress({
        phase: "writing",
        percent,
        message: `Writing ZIP: ${processed}/${totalEntries} entries`,
        entriesProcessed: processed,
        entriesTotal: totalEntries,
        bytesWritten: payload.fs.processedBytes || 0,
        bytesTotal: payload.fs.totalBytes || null,
      });
    });

    archive.pipe(output);

    for (const directory of plan.directories) {
      archive.append("", { name: `${directory.zipPath}/` });
    }

    for (const file of plan.files) {
      archive.file(file.sourcePath, { name: file.zipPath });
    }

    archive.finalize().catch(reject);
  });
}

async function exportCollectionToZip({ environment, libraries, collectionId, outputPath, onProgress }) {
  const rootNode = findCollectionNode(libraries, collectionId);
  if (!rootNode) {
    throw new Error("The selected collection was not found.");
  }

  const subtree = collectSubtree(rootNode);
  const collectionIds = subtree.map(node => node.collectionID);
  const tables = await getTableNames(environment.dbPath);

  onProgress({
    phase: "planning",
    percent: 5,
    message: "Reading Zotero attachments in read-only mode...",
  });

  const attachmentRows = await queryAttachments(environment.dbPath, collectionIds, tables);
  const plan = buildArchivePlan({
    rootNode,
    attachmentRows,
    dataDir: environment.dataDir,
  });

  onProgress({
    phase: "planning",
    percent: 12,
    message: `Preparing ${plan.directories.length} directories and ${plan.files.length} allowed files...`,
    entriesProcessed: 0,
    entriesTotal: plan.totalEntries,
  });

  await writeArchive({
    plan,
    outputPath,
    onProgress,
  });

  return {
    outputPath,
    fileCount: plan.files.length,
    directoryCount: plan.directories.length,
    skippedCount: plan.skipped.length,
  };
}

module.exports = {
  exportCollectionToZip,
};