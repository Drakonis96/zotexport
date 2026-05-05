const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function createTempDir(prefix, testContext) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  testContext.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  return tempDir;
}

function runSqlite(dbPath, sql) {
  execFileSync("sqlite3", [dbPath, sql]);
}

function listZipEntries(zipPath) {
  const output = execFileSync("unzip", ["-Z1", zipPath], {
    encoding: "utf8",
  }).trim();

  if (!output) {
    return [];
  }

  return output.split(/\r?\n/).filter(Boolean);
}

module.exports = {
  createTempDir,
  listZipEntries,
  runSqlite,
};