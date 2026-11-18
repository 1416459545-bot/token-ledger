//! 日志解析，逐字对齐 src/sources/claude.ts 与 src/sources/codex.ts。
//! 关键：事件 id 必须与 TypeScript 版本完全一致，否则两边会重复计账。

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use serde_json::Value;
use sha1::{Digest, Sha1};

#[derive(Debug, Clone)]
pub struct UsageEvent {
    pub id: String,
    pub ts: String,
    pub source: &'static str,
    pub provider: &'static str,
    pub model: String,
    pub project: Option<String>,
    pub session_id: Option<String>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
}

#[derive(Debug, Default)]
pub struct ParseStats {
    pub lines: usize,
    pub skipped: usize,
    pub events: usize,
}

/// 与 TS 的 shortHash 一致：sha1 十六进制前 16 位
pub fn short_hash(input: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{:02x}", b)).collect();
    hex[..16].to_string()
}

/// 解析时间戳；无时区的按本地时间解释（与 `new Date(str)` 一致）
pub fn parse_ts(raw: &str) -> Option<DateTime<Utc>> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(text) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S",
    ] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(text, fmt) {
            if let Some(dt) = Local.from_local_datetime(&naive).single() {
                return Some(dt.with_timezone(&Utc));
            }
        }
    }
    None
}

/// 与 JS `toISOString()` 一致：UTC、毫秒三位、Z 结尾
pub fn to_iso(dt: &DateTime<Utc>) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// 本地时区的 `YYYY-MM-DD`
pub fn local_day(dt: &DateTime<Utc>) -> String {
    dt.with_timezone(&Local).format("%Y-%m-%d").to_string()
}

/// 路径最后一段（同时兼容 / 和 \）
pub fn last_segment(input: &str) -> String {
    input
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .to_string()
}

fn to_positive_int(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .map(|x| x.round() as i64)
            .unwrap_or(0),
        Some(Value::String(s)) => s
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|x| x.is_finite() && *x > 0.0)
            .map(|x| x.round() as i64)
            .unwrap_or(0),
        _ => 0,
    }
}

fn as_object(v: Option<&Value>) -> Option<&serde_json::Map<String, Value>> {
    v.and_then(|x| x.as_object())
}

fn non_empty_str(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

// ───────────────────────── Claude Code ─────────────────────────

pub const CLAUDE_SOURCE: &str = "claude-code";
pub const CLAUDE_PROVIDER: &str = "anthropic";

/// 缓存写入 token：优先扁平字段，其次 cache_creation 明细求和
fn claude_cache_write(usage: &serde_json::Map<String, Value>) -> i64 {
    let flat = to_positive_int(usage.get("cache_creation_input_tokens"));
    if flat > 0 {
        return flat;
    }
    if let Some(Value::Object(nested)) = usage.get("cache_creation") {
        return nested.values().map(|v| to_positive_int(Some(v))).sum();
    }
    0
}

/// 从 cwd 或会话目录名推断项目名
fn claude_project(cwd: Option<&Value>, file_path: &str) -> Option<String> {
    if let Some(cwd) = cwd.and_then(|v| v.as_str()) {
        if !cwd.trim().is_empty() {
            let base = last_segment(cwd);
            if !base.is_empty() {
                return Some(base);
            }
        }
    }
    let dir = std::path::Path::new(file_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let dir_name = last_segment(&dir);
    // 形如 "C--Users-foo-bar" -> 取最后一段
    let cleaned = dir_name
        .strip_prefix(|c: char| c.is_ascii_alphabetic())
        .unwrap_or(&dir_name);
    let cleaned = cleaned.strip_prefix("--").unwrap_or(cleaned);
    let segs: Vec<&str> = cleaned.split('-').filter(|s| !s.is_empty()).collect();
    segs.last().map(|s| s.to_string())
}

pub fn parse_claude_line(raw: &Value, file_path: &str) -> Option<UsageEvent> {
    let obj = raw.as_object()?;
    if obj.get("type").and_then(|v| v.as_str()) != Some("assistant") {
        return None;
    }
    let msg = as_object(obj.get("message"))?;
    let usage = as_object(msg.get("usage")).or_else(|| as_object(obj.get("usage")))?;

    let model = msg
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if model.is_empty() || model == "<synthetic>" {
        return None;
    }

    let input = to_positive_int(usage.get("input_tokens"));
    let output = to_positive_int(usage.get("output_tokens"));
    let cache_read = to_positive_int(usage.get("cache_read_input_tokens"));
    let cache_write = claude_cache_write(usage);
    if input + output + cache_read + cache_write == 0 {
        return None;
    }

    let ts_raw = obj.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
    let ts_dt = parse_ts(ts_raw)?;
    let ts = to_iso(&ts_dt);

    let session_id = non_empty_str(obj.get("sessionId"));
    let message_id = non_empty_str(msg.get("id"));
    let uuid = non_empty_str(obj.get("uuid")).unwrap_or_default();

    let id = match message_id {
        Some(mid) => format!("{}:{}", CLAUDE_SOURCE, mid),
        None => format!(
            "{}:{}",
            CLAUDE_SOURCE,
            short_hash(&format!(
                "{}|{}|{}|{}|{}|{}",
                file_path, uuid, ts, model, input, output
            ))
        ),
    };

    Some(UsageEvent {
        id,
        ts,
        source: CLAUDE_SOURCE,
        provider: CLAUDE_PROVIDER,
        model,
        project: claude_project(obj.get("cwd"), file_path),
        session_id,
        input_tokens: input,
        output_tokens: output,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
    })
}

pub fn parse_claude_file(file_path: &str) -> (Vec<UsageEvent>, ParseStats) {
    let mut stats = ParseStats::default();
    let Ok(content) = std::fs::read_to_string(file_path) else {
        return (Vec::new(), stats);
    };

    let mut events = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for line in content.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        stats.lines += 1;
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            stats.skipped += 1;
            continue;
        };
        match parse_claude_line(&value, file_path) {
            Some(event) => {
                if seen.insert(event.id.clone()) {
                    events.push(event);
                    stats.events += 1;
                }
            }
            None => stats.skipped += 1,
        }
    }
    (events, stats)
}

// ───────────────────────── Codex CLI ─────────────────────────

pub const CODEX_SOURCE: &str = "codex";
pub const CODEX_PROVIDER: &str = "openai";

#[derive(Debug, Clone, Copy, Default)]
struct UsageTotals {
    input_tokens: i64,
    cached_input_tokens: i64,
    cache_write_input_tokens: i64,
    output_tokens: i64,
}

fn count_of(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .map(|x| x.round() as i64)
            .unwrap_or(0),
        _ => 0,
    }
}

fn read_usage_totals(raw: Option<&Value>) -> Option<UsageTotals> {
    let o = as_object(raw)?;
    let totals = UsageTotals {
        input_tokens: count_of(o.get("input_tokens")),
        cached_input_tokens: count_of(o.get("cached_input_tokens")),
        cache_write_input_tokens: count_of(o.get("cache_write_input_tokens")),
        output_tokens: count_of(o.get("output_tokens")),
    };
    let sum = totals.input_tokens
        + totals.cached_input_tokens
        + totals.cache_write_input_tokens
        + totals.output_tokens;
    if sum > 0 {
        Some(totals)
    } else {
        None
    }
}

/// 解析 rollout 文件：对 `total_token_usage`（会话累计值）做差分，避免重复计账
pub fn parse_codex_file(file_path: &str) -> (Vec<UsageEvent>, ParseStats) {
    let mut stats = ParseStats::default();
    let mut events = Vec::new();

    let Ok(content) = std::fs::read_to_string(file_path) else {
        return (events, stats);
    };

    let mut rows: Vec<(Value, Value)> = Vec::new();
    for line in content.split('\n') {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        stats.lines += 1;
        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            stats.skipped += 1;
            continue;
        };
        if !value.is_object() {
            stats.skipped += 1;
            continue;
        }
        let payload = match value.get("payload") {
            Some(Value::Object(_)) => value.get("payload").cloned().unwrap_or(Value::Null),
            _ => Value::Null,
        };
        rows.push((value, payload));
    }
    if rows.is_empty() {
        return (events, stats);
    }

    let type_of = |v: &Value| v.get("type").and_then(|x| x.as_str()).unwrap_or("").to_string();

    // 第一遍：会话信息与兜底模型
    let mut session_id: Option<String> = None;
    let mut fallback_cwd: Option<String> = None;
    let mut fallback_model: Option<String> = None;

    for (obj, payload) in &rows {
        let kind = type_of(obj);
        if kind == "session_meta" {
            if let Some(id) = non_empty_str(payload.get("id")) {
                session_id = Some(id);
            }
            if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                if fallback_cwd.is_none() {
                    fallback_cwd = Some(cwd.to_string());
                }
            }
        }
        if kind == "turn_context" {
            if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
                if fallback_model.is_none() {
                    fallback_model = Some(model.to_string());
                }
            }
            if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                if fallback_cwd.is_none() {
                    fallback_cwd = Some(cwd.to_string());
                }
            }
        }
    }

    // 第二遍：差分出每条用量
    let mut current_model = fallback_model.clone();
    let mut current_cwd = fallback_cwd.clone();
    let mut previous = UsageTotals::default();
    let mut index = 0usize;

    for (obj, payload) in &rows {
        let kind = type_of(obj);
        if kind == "turn_context" {
            if let Some(model) = payload.get("model").and_then(|v| v.as_str()) {
                if !model.is_empty() {
                    current_model = Some(model.to_string());
                }
            }
            if let Some(cwd) = payload.get("cwd").and_then(|v| v.as_str()) {
                if !cwd.is_empty() {
                    current_cwd = Some(cwd.to_string());
                }
            }
            continue;
        }
        if kind != "event_msg" || payload.get("type").and_then(|v| v.as_str()) != Some("token_count") {
            continue;
        }
        let info = payload.get("info");
        if !info.map(|v| v.is_object()).unwrap_or(false) {
            continue;
        }
        let Some(totals) = read_usage_totals(info.and_then(|i| i.get("total_token_usage"))) else {
            continue;
        };

        index += 1;
        let delta = UsageTotals {
            input_tokens: (totals.input_tokens - previous.input_tokens).max(0),
            cached_input_tokens: (totals.cached_input_tokens - previous.cached_input_tokens).max(0),
            cache_write_input_tokens: (totals.cache_write_input_tokens
                - previous.cache_write_input_tokens)
                .max(0),
            output_tokens: (totals.output_tokens - previous.output_tokens).max(0),
        };
        previous = totals;

        let delta_sum = delta.input_tokens
            + delta.cached_input_tokens
            + delta.cache_write_input_tokens
            + delta.output_tokens;
        if delta_sum == 0 {
            stats.skipped += 1;
            continue;
        }

        // OpenAI 语义：input_tokens 含缓存命中与写入，拆出来单独计价
        let plain_input =
            (delta.input_tokens - delta.cached_input_tokens - delta.cache_write_input_tokens).max(0);

        let ts_raw = obj.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let Some(ts_dt) = parse_ts(ts_raw) else {
            stats.skipped += 1;
            continue;
        };
        let ts = to_iso(&ts_dt);

        let model = current_model.clone().unwrap_or_else(|| "unknown".to_string());
        let project = current_cwd.as_deref().map(|cwd| last_segment(cwd)).filter(|s| !s.is_empty());

        // 与 TS 的 JSON.stringify([filePath, index, ts, deltaSum, model]) 保持一致
        let id_seed = serde_json::to_string(&serde_json::json!([
            file_path, index, ts, delta_sum, model
        ]))
        .unwrap_or_default();

        events.push(UsageEvent {
            id: format!("{}:{}", CODEX_SOURCE, short_hash(&id_seed)),
            ts,
            source: CODEX_SOURCE,
            provider: CODEX_PROVIDER,
            model,
            project,
            session_id: session_id.clone(),
            input_tokens: plain_input,
            output_tokens: delta.output_tokens,
            cache_read_tokens: delta.cached_input_tokens,
            cache_write_tokens: delta.cache_write_input_tokens,
        });
        stats.events += 1;
    }

    (events, stats)
}

// ───────────────────────── 目录遍历 ─────────────────────────

/// 递归找出所有 .jsonl 文件（按路径排序，保证顺序稳定）
pub fn find_jsonl_files(root: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    walk(root, &mut out);
    out.sort();
    out
}

fn walk(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, out);
        } else if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path.to_string_lossy().to_string());
        }
    }
}
