#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::PathBuf;

/// 账本位置：优先 TOKEN_LEDGER_HOME，其次 ~/.token-ledger（与 CLI 完全共用）
fn db_path() -> PathBuf {
    if let Ok(home) = std::env::var("TOKEN_LEDGER_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home).join("ledger.db");
        }
    }
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".token-ledger").join("ledger.db")
}

fn open_db() -> Result<Connection, String> {
    let path = db_path();
    Connection::open_with_flags(path.clone(), OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("打不开账本 {}：{}", path.display(), e))
}

/// 一个维度的聚合
fn aggregate(
    conn: &Connection,
    column: &str,
    start: &str,
    end: &str,
    order_by_day: bool,
) -> Result<Vec<Value>, String> {
    let order = if order_by_day {
        "key ASC".to_string()
    } else {
        "SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) DESC".to_string()
    };
    let sql = format!(
        "SELECT {column} AS key,
                COUNT(*) AS events,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write,
                COALESCE(SUM(cost_usd), 0) AS cost,
                COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced
           FROM events
          WHERE day >= ?1 AND day <= ?2
          GROUP BY key
          ORDER BY {order}"
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([start, end], |row| {
            let input: i64 = row.get(2)?;
            let output: i64 = row.get(3)?;
            let cache_read: i64 = row.get(4)?;
            let cache_write: i64 = row.get(5)?;
            Ok(json!({
                "key": row.get::<_, String>(0)?,
                "events": row.get::<_, i64>(1)?,
                "input": input,
                "output": output,
                "cacheRead": cache_read,
                "cacheWrite": cache_write,
                "tokens": input + output + cache_read + cache_write,
                "cost": row.get::<_, f64>(6)?,
                "unpriced": row.get::<_, i64>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for item in mapped {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn totals(conn: &Connection, start: &str, end: &str) -> Result<Value, String> {
    let sql = "SELECT COUNT(*) AS events,
                      COALESCE(SUM(input_tokens), 0),
                      COALESCE(SUM(output_tokens), 0),
                      COALESCE(SUM(cache_read_tokens), 0),
                      COALESCE(SUM(cache_write_tokens), 0),
                      COALESCE(SUM(cost_usd), 0),
                      COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
                 FROM events WHERE day >= ?1 AND day <= ?2";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let (events, input, output, cache_read, cache_write, cost, unpriced) = stmt
        .query_row([start, end], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    Ok(json!({
        "events": events,
        "input": input,
        "output": output,
        "cacheRead": cache_read,
        "cacheWrite": cache_write,
        "tokens": input + output + cache_read + cache_write,
        "cost": cost,
        "unpriced": unpriced,
    }))
}

fn unpriced_models(conn: &Connection, start: &str, end: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT model, COUNT(*) AS c FROM events
              WHERE day >= ?1 AND day <= ?2 AND cost_usd IS NULL
              GROUP BY model ORDER BY c DESC",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([start, end], |row| {
            Ok(json!({ "model": row.get::<_, String>(0)?, "count": row.get::<_, i64>(1)? }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in mapped {
        out.push(item.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

fn monthly_trend(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT month,
                    COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
                    COALESCE(SUM(cost_usd), 0) AS cost
               FROM events GROUP BY month ORDER BY month DESC LIMIT 6",
        )
        .map_err(|e| e.to_string())?;
    let mapped = stmt
        .query_map([], |row| {
            Ok(json!({
                "month": row.get::<_, String>(0)?,
                "tokens": row.get::<_, i64>(1)?,
                "cost": row.get::<_, f64>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for item in mapped {
        out.push(item.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

fn budget_amount(conn: &Connection, month: &str) -> Option<f64> {
    conn.query_row("SELECT amount FROM budgets WHERE month = ?1", [month], |row| {
        row.get::<_, f64>(0)
    })
    .ok()
}

/// 前端传入区间，Rust 只负责查库聚合
#[tauri::command]
fn dashboard_data(start: String, end: String, month: Option<String>) -> Result<String, String> {
    let conn = open_db()?;

    let payload = json!({
        "start": start,
        "end": end,
        "totals": totals(&conn, &start, &end)?,
        "byModel": aggregate(&conn, "model", &start, &end, false)?,
        "byDay": aggregate(&conn, "day", &start, &end, true)?,
        "byProject": aggregate(&conn, "COALESCE(NULLIF(project, ''), '(未标注)')", &start, &end, false)?,
        "bySource": aggregate(&conn, "source", &start, &end, false)?,
        "unpriced": unpriced_models(&conn, &start, &end)?,
        "trend": monthly_trend(&conn)?,
        "budgetAmount": month.as_deref().and_then(|m| budget_amount(&conn, m)),
        "dbPath": db_path().display().to_string(),
    });

    Ok(payload.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dashboard_data])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
