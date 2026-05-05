const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");

const { exportCollectionToZip, planCollectionExport } = require("../src/main/exporter");
const { createTempDir, listZipEntries, runSqlite } = require("./helpers");

function writeStorageFile(dataDir, key, fileName, contents) {
  const storageDir = path.join(dataDir, "storage", key);
  fs.mkdirSync(storageDir, { recursive: true });
  const filePath = path.join(storageDir, fileName);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function createExportFixture(testContext) {
  const tempDir = createTempDir("zotexport-export-", testContext);
  const dataDir = path.join(tempDir, "zotero-data");
  const dbPath = path.join(dataDir, "zotero.sqlite");

  fs.mkdirSync(path.join(dataDir, "storage"), { recursive: true });
  writeStorageFile(dataDir, "ROOTPDF", "article.pdf", "root pdf");
  writeStorageFile(dataDir, "CHILDMD", "notes.md", "child notes");
  writeStorageFile(dataDir, "PNGKEY", "preview.png", "preview image");

  runSqlite(
    dbPath,
    [
      "CREATE TABLE collectionItems (collectionID INTEGER, itemID INTEGER);",
      "CREATE TABLE itemAttachments (itemID INTEGER PRIMARY KEY, parentItemID INTEGER, linkMode INTEGER, contentType TEXT, path TEXT);",
      "CREATE TABLE items (itemID INTEGER PRIMARY KEY, key TEXT, libraryID INTEGER);",
      "INSERT INTO collectionItems VALUES (1, 100), (2, 200), (2, 202), (2, 203);",
      "INSERT INTO itemAttachments VALUES",
      "  (101, 100, 1, 'application/pdf', 'storage:article.pdf'),",
      "  (201, 200, 1, 'text/markdown', 'storage:notes.md'),",
      "  (202, NULL, 1, 'image/png', 'storage:preview.png'),",
      "  (203, NULL, 1, 'application/pdf', 'storage:missing.pdf');",
      "INSERT INTO items VALUES",
      "  (101, 'ROOTPDF', 1),",
      "  (201, 'CHILDMD', 1),",
      "  (202, 'PNGKEY', 1),",
      "  (203, 'MISSKEY', 1);",
    ].join("\n")
  );

  const libraries = [
    {
      id: "library-1",
      libraryID: 1,
      type: "user",
      editable: true,
      name: "My Library",
      children: [
        {
          id: "collection-1",
          collectionID: 1,
          libraryID: 1,
          key: "ROOT",
          name: "Root / Collection",
          parentCollectionID: null,
          children: [
            {
              id: "collection-2",
              collectionID: 2,
              libraryID: 1,
              key: "CHILD",
              name: "Child:Collection",
              parentCollectionID: 1,
              children: [],
            },
          ],
        },
      ],
    },
  ];

  return {
    dataDir,
    dbPath,
    libraries,
    outputPath: path.join(tempDir, "export.zip"),
  };
}

test("exportCollectionToZip writes the selected subtree and skips unsupported attachments", async t => {
  const { dataDir, dbPath, libraries, outputPath } = createExportFixture(t);
  const progress = [];

  const result = await exportCollectionToZip({
    environment: {
      dbPath,
      dataDir,
    },
    libraries,
    collectionId: 1,
    outputPath,
    onProgress(payload) {
      progress.push(payload);
    },
  });

  assert.equal(result.directoryCount, 2);
  assert.equal(result.fileCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.equal(progress.at(-1)?.percent, 100);

  const entries = listZipEntries(outputPath).sort();
  assert.deepEqual(entries, [
    "Root Collection/",
    "Root Collection/Child Collection/",
    "Root Collection/Child Collection/notes.md",
    "Root Collection/article.pdf",
  ]);
});

test("planCollectionExport excludes child collections when requested", async t => {
  const { dataDir, dbPath, libraries } = createExportFixture(t);

  const result = await planCollectionExport({
    environment: {
      dbPath,
      dataDir,
    },
    libraries,
    collectionId: 1,
    includeSubcollections: false,
  });

  assert.equal(result.summary.directoryCount, 1);
  assert.equal(result.summary.fileCount, 1);
  assert.equal(result.summary.skippedCount, 0);
  assert.equal(result.summary.includedCollectionCount, 1);
  assert.equal(result.summary.includedSubcollectionCount, 0);
  assert.deepEqual(
    result.plan.directories.map(directory => directory.zipPath),
    ["Root Collection"]
  );
  assert.deepEqual(
    result.plan.files.map(file => file.zipPath),
    ["Root Collection/article.pdf"]
  );
});