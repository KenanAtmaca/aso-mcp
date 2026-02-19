import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const MAX_CACHE_ENTRIES = 5000;

let db: Database.Database;

export function initCache(): void {
  const dataDir = path.join(os.homedir(), ".aso-mcp");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "cache.db");
  db = new Database(dbPath);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Clean up expired entries
  db.exec(`DELETE FROM cache WHERE expires_at < strftime('%s', 'now')`);

  // Enforce size limit on startup
  enforceSizeLimit();
}

export function getFromCache(key: string): string | null {
  const row = db
    .prepare(
      "SELECT value FROM cache WHERE key = ? AND expires_at > strftime('%s', 'now')"
    )
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

export function setCache(
  key: string,
  value: string,
  ttlSeconds: number = 3600
): void {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  db.prepare(
    "INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)"
  ).run(key, value, expiresAt);

  // Periodic size check (every ~100 writes, check and trim)
  const count = (
    db.prepare("SELECT COUNT(*) as count FROM cache").get() as { count: number }
  ).count;
  if (count > MAX_CACHE_ENTRIES) {
    enforceSizeLimit();
  }
}

export function deleteCache(keyPattern: string): void {
  db.prepare("DELETE FROM cache WHERE key LIKE ?").run(keyPattern);
}

export function clearCache(): void {
  db.exec("DELETE FROM cache");
}

export function getCacheStats(): {
  totalEntries: number;
  expiredEntries: number;
  maxEntries: number;
  dbPath: string;
} {
  const total = db
    .prepare("SELECT COUNT(*) as count FROM cache")
    .get() as { count: number };
  const expired = db
    .prepare(
      "SELECT COUNT(*) as count FROM cache WHERE expires_at < strftime('%s', 'now')"
    )
    .get() as { count: number };

  return {
    totalEntries: total.count,
    expiredEntries: expired.count,
    maxEntries: MAX_CACHE_ENTRIES,
    dbPath: path.join(os.homedir(), ".aso-mcp", "cache.db"),
  };
}

function enforceSizeLimit(): void {
  // First remove expired entries
  db.exec(`DELETE FROM cache WHERE expires_at < strftime('%s', 'now')`);

  const count = (
    db.prepare("SELECT COUNT(*) as count FROM cache").get() as { count: number }
  ).count;

  if (count > MAX_CACHE_ENTRIES) {
    // Remove oldest entries (by created_at) to get back under limit
    const toRemove = count - MAX_CACHE_ENTRIES;
    db.prepare(
      `DELETE FROM cache WHERE key IN (
        SELECT key FROM cache ORDER BY created_at ASC LIMIT ?
      )`
    ).run(toRemove);
  }
}
