import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

let db: Database.Database;

export function initCache(): void {
  const dataDir = path.join(process.cwd(), "data");
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

  // Expired entry temizligi
  db.exec(`DELETE FROM cache WHERE expires_at < strftime('%s', 'now')`);
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
}

export function clearCache(): void {
  db.exec("DELETE FROM cache");
}

export function getCacheStats(): {
  totalEntries: number;
  expiredEntries: number;
} {
  const total = db
    .prepare("SELECT COUNT(*) as count FROM cache")
    .get() as { count: number };
  const expired = db
    .prepare(
      "SELECT COUNT(*) as count FROM cache WHERE expires_at < strftime('%s', 'now')"
    )
    .get() as { count: number };

  return { totalEntries: total.count, expiredEntries: expired.count };
}
