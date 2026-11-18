#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use token_ledger_app::{dashboard, pricing, scan, store};

/// 前端拿看板数据（账本不存在时自动建库，显示空状态而不是报错）
#[tauri::command]
fn dashboard_data(start: String, end: String, month: Option<String>) -> Result<String, String> {
    let conn = if store::db_path().exists() {
        store::open_ro()?
    } else {
        store::open_rw()?
    };
    dashboard::dashboard_json(&conn, &start, &end, month.as_deref())
}

/// 扫描本机日志并入库（与 CLI 的 scan 行为一致）
#[tauri::command]
fn scan_logs(force: Option<bool>) -> Result<String, String> {
    let conn = store::open_rw()?;
    let prices = pricing::load_pricing(&store::ledger_home());
    let summary = scan::scan_all(&conn, &prices, force.unwrap_or(false))?;
    serde_json::to_string(&summary).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![dashboard_data, scan_logs])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 应用失败");
}
