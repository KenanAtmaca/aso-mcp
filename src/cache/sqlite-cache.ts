import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

const MAX_CACHE_ENTRIES = 5000;
const SIZE_CHECK_INTERVAL = 100;
const HISTORY_RETENTION_DAYS = 400;

let db: Database.Database;
let writesSinceLastCheck = 0;

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
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_accessed INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Migration: pre-1.4.0 databases lack last_accessed (eviction was FIFO).
  const cols = db.prepare("PRAGMA table_info(cache)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "last_accessed")) {
    db.exec("ALTER TABLE cache ADD COLUMN last_accessed INTEGER DEFAULT 0");
    db.exec("UPDATE cache SET last_accessed = created_at WHERE last_accessed = 0");
  }

  // Ranking history: durable snapshots written by track_ranking, read by
  // get_ranking_history. Lives in the same DB but is NOT part of the cache:
  // clear_cache and LRU eviction never touch it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ranking_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      country TEXT NOT NULL,
      position INTEGER,
      total_results INTEGER NOT NULL DEFAULT 0,
      top_app TEXT,
      recorded_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ranking_history_lookup
      ON ranking_history (app_id, country, keyword, recorded_at);
  `);

  // Clean up expired entries and stale history
  db.exec(`DELETE FROM cache WHERE expires_at < strftime('%s', 'now')`);
  db.prepare(
    "DELETE FROM ranking_history WHERE recorded_at < strftime('%s', 'now') - ?"
  ).run(HISTORY_RETENTION_DAYS * 86400);

  // Enforce size limit on startup
  enforceSizeLimit();
}

export function getFromCache(key: string): string | null {
  const row = db
    .prepare(
      "SELECT value FROM cache WHERE key = ? AND expires_at > strftime('%s', 'now')"
    )
    .get(key) as { value: string } | undefined;

  if (row) {
    // Touch for LRU eviction ordering
    db.prepare(
      "UPDATE cache SET last_accessed = strftime('%s', 'now') WHERE key = ?"
    ).run(key);
  }

  return row?.value ?? null;
}

export function setCache(
  key: string,
  value: string,
  ttlSeconds: number = 3600
): void {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  db.prepare(
    "INSERT OR REPLACE INTO cache (key, value, expires_at, last_accessed) VALUES (?, ?, ?, strftime('%s', 'now'))"
  ).run(key, value, expiresAt);

  // Throttle: only check size every SIZE_CHECK_INTERVAL writes (avoids O(N) COUNT per write).
  writesSinceLastCheck++;
  if (writesSinceLastCheck >= SIZE_CHECK_INTERVAL) {
    writesSinceLastCheck = 0;
    const count = (
      db.prepare("SELECT COUNT(*) as count FROM cache").get() as { count: number }
    ).count;
    if (count > MAX_CACHE_ENTRIES) {
      enforceSizeLimit();
    }
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
    // Remove least recently used entries to get back under limit
    const toRemove = count - MAX_CACHE_ENTRIES;
    db.prepare(
      `DELETE FROM cache WHERE key IN (
        SELECT key FROM cache ORDER BY last_accessed ASC, created_at ASC LIMIT ?
      )`
    ).run(toRemove);
  }
}

// ─── Ranking History ───

export interface RankingSnapshotInput {
  keyword: string;
  position: number | null;
  totalResults: number;
  topApp: string;
}

export interface RankingHistoryRow {
  keyword: string;
  position: number | null;
  totalResults: number;
  topApp: string | null;
  recordedAt: number;
}

export function recordRankingSnapshots(
  appId: string,
  country: string,
  entries: RankingSnapshotInput[]
): void {
  if (entries.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO ranking_history (app_id, keyword, country, position, total_results, top_app)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertAll = db.transaction((rows: RankingSnapshotInput[]) => {
    for (const r of rows) {
      insert.run(
        appId,
        r.keyword.trim().toLowerCase(),
        country,
        r.position,
        r.totalResults,
        r.topApp
      );
    }
  });
  insertAll(entries);
}

export function getRankingHistory(
  appId: string,
  country: string,
  days: number,
  keywords?: string[]
): RankingHistoryRow[] {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  let sql =
    `SELECT keyword, position, total_results, top_app, recorded_at
     FROM ranking_history
     WHERE app_id = ? AND country = ? AND recorded_at >= ?`;
  const params: any[] = [appId, country, cutoff];

  if (keywords && keywords.length > 0) {
    const placeholders = keywords.map(() => "?").join(",");
    sql += ` AND keyword IN (${placeholders})`;
    params.push(...keywords.map((k) => k.trim().toLowerCase()));
  }
  sql += " ORDER BY keyword ASC, recorded_at ASC";

  const rows = db.prepare(sql).all(...params) as {
    keyword: string;
    position: number | null;
    total_results: number;
    top_app: string | null;
    recorded_at: number;
  }[];

  return rows.map((r) => ({
    keyword: r.keyword,
    position: r.position,
    totalResults: r.total_results,
    topApp: r.top_app,
    recordedAt: r.recorded_at,
  }));
}
