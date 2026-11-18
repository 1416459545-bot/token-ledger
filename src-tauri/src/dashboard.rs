//! 看板数据聚合（供前端调用），与 src/core/ledger.ts 的查询保持一致。

use rusqlite::Connection;
use serde_json::{json, Value};

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
                COALESCE(SUM(input_tokens), 0),
                COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cache_read_tokens), 0),
                COALESCE(SUM(cache_write_tokens), 0),
                COALESCE(SUM(cost_usd), 0),
                COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
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

pub fn totals(conn: &Connection, start: &str, end: &str) -> Result<Value, String> {
    let mut stmt = conn
        .prepare(
            "SELECT COUNT(*),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0),
                    COALESCE(SUM(cache_write_tokens), 0),
                    COALESCE(SUM(cost_usd), 0),
                    COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0)
               FROM events WHERE day >= ?1 AND day <= ?2",
        )
        .map_err(|e| e.to_string())?;

    let row = stmt
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

    let (events, input, output, cache_read, cache_write, cost, unpriced) = row;
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
            "SELECT model, COUNT(*) FROM events
              WHERE day >= ?1 AND day <= ?2 AND cost_usd IS NULL
              GROUP BY model ORDER BY COUNT(*) DESC",
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
                    COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0),
                    COALESCE(SUM(cost_usd), 0)
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

/// 组装前端需要的完整 JSON
pub fn dashboard_json(
    conn: &Connection,
    start: &str,
    end: &str,
    month: Option<&str>,
) -> Result<String, String> {
    let payload = json!({
        "start": start,
        "end": end,
        "totals": totals(conn, start, end)?,
        "byModel": aggregate(conn, "model", start, end, false)?,
        "byDay": aggregate(conn, "day", start, end, true)?,
        "byProject": aggregate(conn, "COALESCE(NULLIF(project, ''), '(未标注)')", start, end, false)?,
        "bySource": aggregate(conn, "source", start, end, false)?,
        "unpriced": unpriced_models(conn, start, end)?,
        "trend": monthly_trend(conn)?,
        "budgetAmount": month.and_then(|m| budget_amount(conn, m)),
        "dbPath": crate::store::db_path().display().to_string(),
    });
    Ok(payload.to_string())
}
