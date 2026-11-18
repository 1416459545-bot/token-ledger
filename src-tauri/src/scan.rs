//! 扫描本机 agent 日志并入库，逐字对齐 src/core/scanner.ts 的行为。

use crate::pricing::PriceEntry;
use crate::sources::{find_jsonl_files, parse_claude_file, parse_codex_file, ParseStats, UsageEvent};
use crate::store;
use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, Default)]
pub struct SourceResult {
    pub name: String,
    pub label: String,
    pub root: String,
    pub files_total: usize,
    pub files_scanned: usize,
    pub files_skipped: usize,
    pub events: usize,
    pub inserted: usize,
    pub unpriced_models: Vec<String>,
    pub unreadable_files: Vec<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct ScanSummary {
    pub results: Vec<SourceResult>,
    pub inserted: usize,
    pub fixed_days: usize,
}

pub fn claude_root() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_PROJECTS_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir.trim());
        }
    }
    let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(profile).join(".claude").join("projects")
}

pub fn codex_root() -> PathBuf {
    if let Ok(dir) = std::env::var("CODEX_SESSIONS_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir.trim());
        }
    }
    let profile = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(profile).join(".codex").join("sessions")
}

fn scan_one(
    conn: &Connection,
    name: &str,
    label: &str,
    root: &PathBuf,
    parse: fn(&str) -> (Vec<UsageEvent>, ParseStats),
    prices: &[(String, PriceEntry)],
    force: bool,
) -> SourceResult {
    let files = find_jsonl_files(root);

    let mut result = SourceResult {
        name: name.to_string(),
        label: label.to_string(),
        root: root.display().to_string(),
        files_total: files.len(),
        ..Default::default()
    };

    for file in &files {
        let Some((mtime, size)) = store::file_stamp(std::path::Path::new(file)) else {
            result.unreadable_files.push(file.clone());
            continue;
        };

        if !force {
            if let Some((prev_mtime, prev_size)) = store::get_file_state(conn, file) {
                if prev_mtime == mtime && prev_size == size {
                    result.files_skipped += 1;
                    continue;
                }
            }
        }

        let (events, stats) = parse(file);
        result.files_scanned += 1;
        result.events += events.len();

        match store::insert_events(conn, &events, prices) {
            Ok((inserted, unpriced)) => {
                result.inserted += inserted;
                for model in unpriced {
                    if !result.unpriced_models.contains(&model) {
                        result.unpriced_models.push(model);
                    }
                }
                let _ = store::set_file_state(conn, file, mtime, size, inserted);
            }
            Err(err) => {
                result.unreadable_files.push(format!("{}（入库失败：{}）", file, err));
            }
        }

        let _ = stats;
    }

    result
}

pub fn scan_all(
    conn: &Connection,
    prices: &[(String, PriceEntry)],
    force: bool,
) -> Result<ScanSummary, String> {
    let fixed_days = store::migrate(conn)?;

    let claude = scan_one(
        conn,
        "claude-code",
        "Claude Code",
        &claude_root(),
        parse_claude_file,
        prices,
        force,
    );
    let codex = scan_one(
        conn,
        "codex",
        "Codex CLI",
        &codex_root(),
        parse_codex_file,
        prices,
        force,
    );

    let inserted = claude.inserted + codex.inserted;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let _ = store::set_meta(conn, "last_scan_at", &now);

    Ok(ScanSummary {
        results: vec![claude, codex],
        inserted,
        fixed_days,
    })
}
