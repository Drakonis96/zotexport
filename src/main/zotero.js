const fs = require("fs");
const os = require("os");
const path = require("path");
const initSqlJs = require("sql.js");

let sqlJsPromise = null;
const databaseCache = new Map();
const tableNameCache = new Map();

function normalizeDirectory(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  return path.resolve(value.replace(/^~(?=$|\/|\\)/, os.homedir()));
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  }
  catch (_error) {
    return false;
  }
}

function getProfileRoot() {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "Zotero");
    case "win32":
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Zotero");
    default:
      return path.join(os.homedir(), ".zotero", "zotero");
  }
}

function getDefaultDataDir() {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Zotero");
    case "win32":
      return path.join(os.homedir(), "Zotero");
    default:
      return path.join(os.homedir(), "Zotero");
  }
}

function parseIniSections(contents) {
  const sections = [];
  let current = null;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      current = {
        name: line.slice(1, -1),
        values: {},
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    current.values[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return sections;
}

function resolveProfileDirectory(profileRoot) {
  const profilesIniPath = path.join(profileRoot, "profiles.ini");
  if (!fileExists(profilesIniPath)) {
    return null;
  }

  const contents = fs.readFileSync(profilesIniPath, "utf8");
  const sections = parseIniSections(contents);
  const profileSections = sections.filter(section => section.name.startsWith("Profile"));
  const activeSection = profileSections.find(section => section.values.Default === "1") || profileSections[0];
  if (!activeSection?.values?.Path) {
    return null;
  }

  const isRelative = activeSection.values.IsRelative !== "0";
  return isRelative
    ? path.join(profileRoot, activeSection.values.Path)
    : activeSection.values.Path;
}

function readCustomDataDir(profileDir) {
  if (!profileDir) {
    return null;
  }

  const prefsPath = path.join(profileDir, "prefs.js");
  if (!fileExists(prefsPath)) {
    return null;
  }

  const prefs = fs.readFileSync(prefsPath, "utf8");
  const useDataDirMatch = prefs.match(/user_pref\("extensions\.zotero\.useDataDir",\s*(true|false)\);/);
  const dataDirMatch = prefs.match(/user_pref\("extensions\.zotero\.dataDir",\s*"((?:\\.|[^"\\])*)"\);/);

  if (!useDataDirMatch || useDataDirMatch[1] !== "true" || !dataDirMatch) {
    return null;
  }

  return normalizeDirectory(
    dataDirMatch[1]
      .replace(/\\\\/g, "\\")
      .replace(/\\"/g, '"')
  );
}

function getSqlWasmPath(fileName) {
  return require.resolve(`sql.js/dist/${fileName}`);
}

async function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile(fileName) {
        return getSqlWasmPath(fileName);
      },
    });
  }

  return sqlJsPromise;
}

async function getDatabaseHandle(dbPath) {
  const stats = fs.statSync(dbPath);
  const signature = `${stats.size}:${stats.mtimeMs}`;
  const cached = databaseCache.get(dbPath);

  if (cached?.signature === signature) {
    return cached;
  }

  cached?.database.close();

  const SQL = await getSqlJs();
  const database = new SQL.Database(fs.readFileSync(dbPath));
  const handle = { signature, database };
  databaseCache.set(dbPath, handle);
  return handle;
}

async function queryJson(dbPath, sql) {
  const { database } = await getDatabaseHandle(dbPath);
  const resultSets = database.exec(sql);

  if (!resultSets.length) {
    return [];
  }

  const rows = [];
  for (const resultSet of resultSets) {
    for (const values of resultSet.values) {
      const row = {};
      resultSet.columns.forEach((column, index) => {
        row[column] = values[index];
      });
      rows.push(row);
    }
  }

  return rows;
}

async function getTableNames(dbPath) {
  const { signature } = await getDatabaseHandle(dbPath);
  const cacheKey = `${dbPath}:${signature}`;

  if (tableNameCache.has(cacheKey)) {
    return tableNameCache.get(cacheKey);
  }

  const rows = await queryJson(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;"
  );
  const names = new Set(rows.map(row => row.name));
  tableNameCache.set(cacheKey, names);
  return names;
}

async function resolveWorkingDatabase(dataDir) {
  const candidates = [
    path.join(dataDir, "zotero.sqlite"),
    path.join(dataDir, "zotero.sqlite.bak"),
    path.join(dataDir, "zotero.sqlite.1.bak"),
  ];

  for (const candidate of candidates) {
    if (!fileExists(candidate)) {
      continue;
    }
    try {
      await queryJson(candidate, "SELECT 1 AS ok;");
      return candidate;
    }
    catch (_error) {
      continue;
    }
  }

  throw new Error(`Could not open a valid SQLite database in ${dataDir}`);
}

async function detectZoteroEnvironment({
  manualDataDir,
  profileRootOverride,
  defaultDataDirOverride,
} = {}) {
  const profileRoot = normalizeDirectory(profileRootOverride) || getProfileRoot();
  const profileDir = resolveProfileDirectory(profileRoot);
  const customDataDir = readCustomDataDir(profileDir);
  const defaultDataDir = normalizeDirectory(defaultDataDirOverride) || normalizeDirectory(getDefaultDataDir());

  const candidates = [
    { source: "manual", dir: normalizeDirectory(manualDataDir) },
    { source: "profile-pref", dir: customDataDir },
    { source: "default", dir: defaultDataDir },
    { source: "profile-root", dir: profileRoot },
  ].filter(candidate => candidate.dir);

  for (const candidate of candidates) {
    const storageDir = path.join(candidate.dir, "storage");
    if (!fileExists(storageDir)) {
      continue;
    }
    try {
      const dbPath = await resolveWorkingDatabase(candidate.dir);
      return {
        profileRoot,
        profileDir,
        dataDir: candidate.dir,
        storageDir,
        dbPath,
        dbFileUsed: path.basename(dbPath),
        source: candidate.source,
      };
    }
    catch (_error) {
      continue;
    }
  }

  throw new Error(
    "No valid Zotero data directory was found. Choose a folder that contains zotero.sqlite and storage/."
  );
}

async function loadCollectionTree(environment) {
  const dbPath = environment.dbPath;
  const tables = await getTableNames(dbPath);

  const librariesSql = tables.has("groups")
    ? `
      SELECT
        l.libraryID,
        l.type,
        l.editable,
        CASE
          WHEN l.type = 'user' THEN 'My Library'
          ELSE COALESCE(g.name, 'Group ' || l.libraryID)
        END AS name
      FROM libraries l
      LEFT JOIN groups g ON g.libraryID = l.libraryID
      WHERE l.type IN ('user', 'group')
      ORDER BY CASE WHEN l.type = 'user' THEN 0 ELSE 1 END, name COLLATE NOCASE;
    `
    : `
      SELECT
        libraryID,
        type,
        editable,
        CASE
          WHEN type = 'user' THEN 'My Library'
          ELSE 'Library ' || libraryID
        END AS name
      FROM libraries
      WHERE type IN ('user', 'group')
      ORDER BY CASE WHEN type = 'user' THEN 0 ELSE 1 END, name COLLATE NOCASE;
    `;

  const collectionsSql = tables.has("deletedCollections")
    ? `
      SELECT c.collectionID, c.collectionName, c.parentCollectionID, c.libraryID, c.key
      FROM collections c
      LEFT JOIN deletedCollections dc ON dc.collectionID = c.collectionID
      WHERE dc.collectionID IS NULL
      ORDER BY c.collectionName COLLATE NOCASE, c.collectionID;
    `
    : `
      SELECT collectionID, collectionName, parentCollectionID, libraryID, key
      FROM collections
      ORDER BY collectionName COLLATE NOCASE, collectionID;
    `;

  const libraries = await queryJson(dbPath, librariesSql);
  const collections = await queryJson(dbPath, collectionsSql);

  const libraryMap = new Map(
    libraries.map(library => [
      library.libraryID,
      {
        id: `library-${library.libraryID}`,
        libraryID: library.libraryID,
        type: library.type,
        editable: Boolean(library.editable),
        name: library.name,
        children: [],
      },
    ])
  );

  const collectionMap = new Map(
    collections.map(collection => [
      collection.collectionID,
      {
        id: `collection-${collection.collectionID}`,
        collectionID: collection.collectionID,
        libraryID: collection.libraryID,
        key: collection.key,
        name: collection.collectionName,
        parentCollectionID: collection.parentCollectionID,
        children: [],
      },
    ])
  );

  for (const node of collectionMap.values()) {
    if (node.parentCollectionID && collectionMap.has(node.parentCollectionID)) {
      collectionMap.get(node.parentCollectionID).children.push(node);
      continue;
    }

    const library = libraryMap.get(node.libraryID);
    if (library) {
      library.children.push(node);
    }
  }

  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const sortNodes = nodes => {
    nodes.sort((left, right) => collator.compare(left.name, right.name));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };

  for (const library of libraryMap.values()) {
    sortNodes(library.children);
  }

  return Array.from(libraryMap.values());
}

function findCollectionNode(libraries, collectionId) {
  for (const library of libraries) {
    const found = findInNodes(library.children, collectionId);
    if (found) {
      return found;
    }
  }
  return null;
}

function findInNodes(nodes, collectionId) {
  for (const node of nodes) {
    if (node.collectionID === collectionId) {
      return node;
    }
    const nested = findInNodes(node.children, collectionId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

module.exports = {
  detectZoteroEnvironment,
  loadCollectionTree,
  queryJson,
  getTableNames,
  findCollectionNode,
};