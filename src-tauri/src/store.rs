//! 账本读写，与 CLI 完全共用同一个数据库文件（~/.token-ledger/ledger.db）。

use crate::pricing::{cost_of, resolve_price, PriceEntry};
use crate::sources::{local_day, parse_ts, UsageEvent};
use rusqlite::{params, Connection, OpenFlags};
use std::path::{Path, PathBuf};

/// 与 src/core/schema.ts 完全一致
pub const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
  id                 TEXT PRIMARY KEY,
  ts                 TEXT NOT NULL,
  day                TEXT NOT NULL,
  month              TEXT NOT NULL,
  source             TEXT NOT NULL,
  provider           TEXT NOT NULL,
  model              TEXT NOT NULL,
  project            TEXT,
  session_id         TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL
);
CREATE INDEX IF NOT EXISTS idx_events_month ON events(month);
CREATE INDEX IF NOT EXISTS idx_events_month_model ON events(month, model);

CREATE TABLE IF NOT EXISTS files (
  path            TEXT PRIMARY KEY,
  mtime_ms        INTEGER NOT NULL,
  size            INTEGER NOT NULL,
  events_inserted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS budgets (
  month    TEXT PRIMARY KEY,
  amount   REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

/// 账本目录：优先 TOKEN_LEDGER_HOME，其次 ~/.token-ledger
pub fn ledger_home() -> PathBuf {
    if let Ok(home) = std::env::var("TOKEN_LEDGER_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(profile).join(".token-ledger")
}

pub fn db_path() -> PathBuf {
    ledger_home().join("ledger.db")
}

pub fn open_rw() -> Result<Connection, String> {
    let home = ledger_home();
    std::fs::create_dir_all(&home)
        .map_err(|e| format!("无法创建账本目录 {}：{}", home.display(), e))?;
    let conn = Connection::open(db_path()).map_err(|e| format!("打不开账本：{}", e))?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    ensure_schema(&conn)?;
    Ok(conn)
}

pub fn open_ro() -> Result<Connection, String> {
    let path = db_path();
    if !path.exists() {
        return Err(format!("账本不存在：{}", path.display()));
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打不开账本：{}", e))
}

pub fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(SCHEMA).map_err(|e| e.to_string())
}

/// 历史迁移：day/month 按本地时区重算（幂等，靠 PRAGMA user_version）
pub fn migrate(conn: &Connection) -> Result<usize, String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if version >= 1 {
        return Ok(0);
    }

    let mut rows: Vec<(String, String, String, String)> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, ts, day, month FROM events")
            .map_err(|e| e.to_string())?;
        let mapped = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for item in mapped {
            rows.push(item.map_err(|e| e.to_string())?);
        }
    }

    let mut fixed = 0usize;
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let mut stmt = conn
            .prepare("UPDATE events SET day = ?1, month = ?2 WHERE id = ?3")
            .map_err(|e| e.to_string())?;
        for (id, ts, day, month) in &rows {
            let Some(dt) = parse_ts(ts) else { continue };
            let new_day = local_day(&dt);
            let new_month = new_day[..7.min(new_day.len())].to_string();
            if &new_day != day || &new_month != month {
                stmt.execute(params![new_day, new_month, id])
                    .map_err(|e| e.to_string())?;
                fixed += 1;
            }
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(err);
        }
    }
    conn.execute_batch("PRAGMA user_version = 1")
        .map_err(|e| e.to_string())?;
    Ok(fixed)
}

pub fn get_file_state(conn: &Connection, path: &str) -> Option<(i64, i64)> {
    conn.query_row(
        "SELECT mtime_ms, size FROM files WHERE path = ?1",
        [path],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )
    .ok()
}

pub fn set_file_state(
    conn: &Connection,
    path: &str,
    mtime_ms: i64,
    size: i64,
    inserted: usize,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO files (path, mtime_ms, size, events_inserted) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size,
           events_inserted = excluded.events_inserted",
        params![path, mtime_ms, size, inserted as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 入库并计算成本。返回 (新增条数, 未定价模型列表)
pub fn insert_events(
    conn: &Connection,
    events: &[UsageEvent],
    prices: &[(String, PriceEntry)],
) -> Result<(usize, Vec<String>), String> {
    if events.is_empty() {
        return Ok((0, Vec::new()));
    }

    let mut unpriced: Vec<String> = Vec::new();
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;

    let result = (|| -> Result<usize, String> {
        let mut stmt = conn
            .prepare(
                "INSERT OR IGNORE INTO events
                   (id, ts, day, month, source, provider, model, project, session_id,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            )
            .map_err(|e| e.to_string())?;

        let mut inserted = 0usize;
        for event in events {
            let dt = parse_ts(&event.ts)
                .ok_or_else(|| format!("时间戳无法解析：{}", event.ts))?;
            let day = local_day(&dt);
            let month = day[..7.min(day.len())].to_string();

            let (provider, cost) = match resolve_price(&event.model, prices) {
                Some(entry) => {
                    let cost = cost_of(
                        event.input_tokens,
                        event.output_tokens,
                        event.cache_read_tokens,
                        event.cache_write_tokens,
                        entry,
                    );
                    // 数据源自带的 provider 优先
                    let provider = if event.provider != "unknown" {
                        event.provider.to_string()
                    } else {
                        entry.provider.clone()
                    };
                    (provider, Some(cost))
                }
                None => {
                    if !unpriced.contains(&event.model) {
                        unpriced.push(event.model.clone());
                    }
                    (event.provider.to_string(), None)
                }
            };

            let changes = stmt
                .execute(params![
                    event.id,
                    event.ts,
                    day,
                    month,
                    event.source,
                    provider,
                    event.model,
                    event.project,
                    event.session_id,
                    event.input_tokens,
                    event.output_tokens,
                    event.cache_read_tokens,
                    event.cache_write_tokens,
                    cost,
                ])
                .map_err(|e| e.to_string())?;
            inserted += changes;
        }
        Ok(inserted)
    })();

    match result {
        Ok(inserted) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok((inserted, unpriced))
        }
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(err)
        }
    }
}

/// 文件大小与修改时间（毫秒）
pub fn file_stamp(path: &Path) -> Option<(i64, i64)> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len() as i64;
    let mtime = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as i64;
    Some((mtime, size))
}
