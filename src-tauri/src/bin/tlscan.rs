//! 无界面验证工具：与 CLI 交叉校验扫描结果是否一致。
//!
//!   tlscan scan                          # 扫描并打印摘要 JSON
//!   tlscan scan --force                  # 忽略文件缓存，重新解析全部日志
//!   tlscan report --start 2026-11-01 --end 2026-11-30   # 打印区间合计 JSON

use token_ledger_app::{dashboard, pricing, scan, store};

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(|s| s.as_str()).unwrap_or("scan");
    let force = args.iter().any(|a| a == "--force");

    let result = match command {
        "scan" => run_scan(force),
        "report" => {
            let start = arg_value(&args, "--start").unwrap_or_else(|| "1970-01-01".to_string());
            let end = arg_value(&args, "--end").unwrap_or_else(|| "2999-12-31".to_string());
            run_report(&start, &end)
        }
        other => Err(format!("未知命令：{}（可用：scan / report）", other)),
    };

    match result {
        Ok(text) => println!("{}", text),
        Err(err) => {
            eprintln!("错误：{}", err);
            std::process::exit(1);
        }
    }
}

fn run_scan(force: bool) -> Result<String, String> {
    let conn = store::open_rw()?;
    let prices = pricing::load_pricing(&store::ledger_home());
    let summary = scan::scan_all(&conn, &prices, force)?;
    Ok(serde_json::to_string_pretty(&summary).unwrap_or_default())
}

fn run_report(start: &str, end: &str) -> Result<String, String> {
    let conn = store::open_ro()?;
    let totals = dashboard::totals(&conn, start, end)?;
    Ok(serde_json::to_string_pretty(&totals).unwrap_or_default())
}
