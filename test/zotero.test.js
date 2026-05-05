const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  detectZoteroEnvironment,
  findCollectionNode,
  loadCollectionTree,
} = require("../src/main/zotero");
const { createTempDir, runSqlite } = require("./helpers");

function escapePrefsPath(filePath) {
  return filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

test("detectZoteroEnvironment uses the profile preference data directory when available", async t => {
  const tempDir = createTempDir("zotexport-zotero-", t);
  const profileRoot = path.join(tempDir, "profile-root");
  const profileDir = path.join(profileRoot, "Profiles", "default");
  const dataDir = path.join(tempDir, "ZoteroData");

  fs.mkdirSync(profileDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "storage"), { recursive: true });

  fs.writeFileSync(
    path.join(profileRoot, "profiles.ini"),
    "[Profile0]\nName=default\nIsRelative=1\nPath=Profiles/default\nDefault=1\n"
  );
  fs.writeFileSync(
    path.join(profileDir, "prefs.js"),
    [
      'user_pref("extensions.zotero.useDataDir", true);',
      `user_pref("extensions.zotero.dataDir", "${escapePrefsPath(dataDir)}");`,
      "",
    ].join("\n")
  );
  runSqlite(path.join(dataDir, "zotero.sqlite"), "VACUUM;");

  const environment = await detectZoteroEnvironment({
    profileRootOverride: profileRoot,
    defaultDataDirOverride: path.join(tempDir, "missing-default"),
  });

  assert.equal(environment.source, "profile-pref");
  assert.equal(environment.dataDir, dataDir);
  assert.equal(environment.dbFileUsed, "zotero.sqlite");
  assert.equal(environment.profileDir, profileDir);
});

test("detectZoteroEnvironment accepts a manually selected data directory and backup database", async t => {
  const tempDir = createTempDir("zotexport-manual-", t);
  const manualDataDir = path.join(tempDir, "manual-data");

  fs.mkdirSync(path.join(manualDataDir, "storage"), { recursive: true });
  runSqlite(path.join(manualDataDir, "zotero.sqlite.bak"), "VACUUM;");

  const environment = await detectZoteroEnvironment({
    manualDataDir,
    profileRootOverride: path.join(tempDir, "empty-profile-root"),
    defaultDataDirOverride: path.join(tempDir, "missing-default"),
  });

  assert.equal(environment.source, "manual");
  assert.equal(environment.dataDir, manualDataDir);
  assert.equal(environment.dbFileUsed, "zotero.sqlite.bak");
});

test("loadCollectionTree builds a sorted tree and findCollectionNode resolves nested collections", async t => {
  const tempDir = createTempDir("zotexport-tree-", t);
  const dbPath = path.join(tempDir, "zotero.sqlite");

  runSqlite(
    dbPath,
    [
      "CREATE TABLE libraries (libraryID INTEGER PRIMARY KEY, type TEXT, editable INTEGER);",
      "CREATE TABLE groups (libraryID INTEGER PRIMARY KEY, name TEXT);",
      "CREATE TABLE collections (collectionID INTEGER PRIMARY KEY, collectionName TEXT, parentCollectionID INTEGER, libraryID INTEGER, key TEXT);",
      "CREATE TABLE deletedCollections (collectionID INTEGER PRIMARY KEY);",
      "INSERT INTO libraries VALUES (1, 'user', 1), (2, 'group', 0);",
      "INSERT INTO groups VALUES (2, 'Research Group');",
      "INSERT INTO collections VALUES",
      "  (10, 'Zeta', NULL, 1, 'ZETA'),",
      "  (11, 'Alpha', NULL, 1, 'ALPHA'),",
      "  (12, 'Child B', 11, 1, 'CHILD_B'),",
      "  (13, 'Child A', 11, 1, 'CHILD_A'),",
      "  (20, 'Shared', NULL, 2, 'SHARED'),",
      "  (99, 'Deleted Root', NULL, 1, 'DELETED');",
      "INSERT INTO deletedCollections VALUES (99);",
    ].join("\n")
  );

  const libraries = await loadCollectionTree({ dbPath });

  assert.equal(libraries.length, 2);
  assert.equal(libraries[0].name, "My Library");
  assert.equal(libraries[1].name, "Research Group");
  assert.deepEqual(
    libraries[0].children.map(node => node.name),
    ["Alpha", "Zeta"]
  );
  assert.deepEqual(
    libraries[0].children[0].children.map(node => node.name),
    ["Child A", "Child B"]
  );
  assert.equal(findCollectionNode(libraries, 13)?.name, "Child A");
  assert.equal(findCollectionNode(libraries, 99), null);
});