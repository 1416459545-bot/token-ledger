//! 价格表与计费，逐字对齐 TypeScript 的 src/core/pricing.ts。
//! 单位：美元 / 每 100 万 tokens。

#[derive(Debug, Clone)]
pub struct PriceEntry {
    pub provider: String,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// 内置价格表（键是模型族前缀，不是完整模型名）
fn builtin() -> Vec<(String, PriceEntry)> {
    let rows: &[(&str, &str, f64, f64, f64, f64)] = &[
        ("claude-opus", "anthropic", 15.0, 75.0, 1.5, 18.75),
        ("claude-sonnet", "anthropic", 3.0, 15.0, 0.3, 3.75),
        ("claude-haiku", "anthropic", 1.0, 5.0, 0.1, 1.25),
        ("gpt-5-mini", "openai", 0.25, 2.0, 0.025, 0.25),
        ("gpt-5", "openai", 1.25, 10.0, 0.125, 1.25),
        ("gpt-4o-mini", "openai", 0.15, 0.6, 0.075, 0.15),
        ("gpt-4o", "openai", 2.5, 10.0, 1.25, 2.5),
        ("o4-mini", "openai", 1.1, 4.4, 0.275, 1.1),
        ("o3", "openai", 2.0, 8.0, 0.5, 2.0),
        ("gemini-2.5-pro", "google", 1.25, 10.0, 0.31, 1.25),
        ("gemini-2.5-flash", "google", 0.3, 2.5, 0.075, 0.3),
        ("deepseek-reasoner", "deepseek", 0.55, 2.19, 0.14, 0.55),
        ("deepseek-chat", "deepseek", 0.27, 1.1, 0.07, 0.27),
    ];
    rows.iter()
        .map(|(k, p, i, o, r, w)| {
            (
                k.to_string(),
                PriceEntry {
                    provider: p.to_string(),
                    input: *i,
                    output: *o,
                    cache_read: *r,
                    cache_write: *w,
                },
            )
        })
        .collect()
}

/// 把千奇百怪的模型名洗成可匹配的形式
pub fn normalize_model(model: &str) -> String {
    let mut m = model.trim().to_lowercase();
    if m.is_empty() {
        return m;
    }
    if let Some(pos) = m.rfind('/') {
        m = m[pos + 1..].to_string();
    }
    if let Some(pos) = m.find('@') {
        m = m[..pos].to_string();
    }
    // 去掉尾部的日期后缀：-20240101 / -2024-01-01 / -2024-01
    m = strip_date_suffix(&m);
    m
}

fn strip_date_suffix(input: &str) -> String {
    let bytes: Vec<char> = input.chars().collect();
    let n = bytes.len();

    // -YYYY-MM-DD
    if n >= 11 {
        let tail: String = bytes[n - 10..].iter().collect();
        let sep = bytes[n - 11];
        if (sep == '-' || sep == '_') && is_date(&tail) && tail.as_bytes()[4] == b'-' {
            return bytes[..n - 11].iter().collect();
        }
    }
    // -YYYY-MM 或 _YYYY_MM
    if n >= 8 {
        let tail: String = bytes[n - 7..].iter().collect();
        let sep = bytes[n - 8];
        if (sep == '-' || sep == '_') && is_date_ym(&tail) {
            return bytes[..n - 8].iter().collect();
        }
    }
    // -YYYYMMDD
    if n >= 9 {
        let tail: String = bytes[n - 8..].iter().collect();
        let sep = bytes[n - 9];
        if (sep == '-' || sep == '_') && tail.chars().all(|c| c.is_ascii_digit()) {
            return bytes[..n - 9].iter().collect();
        }
    }
    input.to_string()
}

fn is_date(s: &str) -> bool {
    s.len() == 10
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[7] == b'-'
        && s.chars().filter(|c| *c != '-').all(|c| c.is_ascii_digit())
}

fn is_date_ym(s: &str) -> bool {
    s.len() == 7 && s.as_bytes()[4] == b'-' && s.chars().filter(|c| *c != '-').all(|c| c.is_ascii_digit())
}

/// `model` 中是否包含 `needle`，且两侧是分词边界（避免 `o3` 命中 `foo3`）
fn is_boundary_match(hay: &str, needle: &str) -> bool {
    let h: Vec<char> = hay.chars().collect();
    let n: Vec<char> = needle.chars().collect();
    if n.is_empty() || n.len() > h.len() {
        return false;
    }
    let mut from = 0usize;
    while from + n.len() <= h.len() {
        let mut hit = true;
        for (i, nc) in n.iter().enumerate() {
            if h[from + i] != *nc {
                hit = false;
                break;
            }
        }
        if hit {
            let before_ok = from == 0 || !h[from - 1].is_ascii_alphanumeric();
            let after_index = from + n.len();
            let after_ok = after_index >= h.len() || !h[after_index].is_ascii_alphanumeric();
            if before_ok && after_ok {
                return true;
            }
        }
        from += 1;
    }
    false
}

/// 查价：先精确、再按最长的模型族近似
pub fn resolve_price<'a>(model: &str, table: &'a [(String, PriceEntry)]) -> Option<&'a PriceEntry> {
    let normalized = normalize_model(model);
    if normalized.is_empty() {
        return None;
    }
    if let Some((_, entry)) = table.iter().find(|(k, _)| *k == normalized) {
        return Some(entry);
    }

    let mut keys: Vec<&(String, PriceEntry)> = table.iter().collect();
    keys.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    for (key, entry) in keys {
        if is_boundary_match(&normalized, key) {
            return Some(entry);
        }
    }
    None
}

/// 计费，结果保留 6 位小数（与 TS 的 Math.round(raw * 1e6) / 1e6 一致）
pub fn cost_of(input: i64, output: i64, cache_read: i64, cache_write: i64, price: &PriceEntry) -> f64 {
    let raw = (input as f64 * price.input
        + output as f64 * price.output
        + cache_read as f64 * price.cache_read
        + cache_write as f64 * price.cache_write)
        / 1_000_000.0;
    (raw * 1e6).round() / 1e6
}

/// 读用户价格表 ~/.token-ledger/prices.json 并与内置合并
pub fn load_pricing(home: &std::path::Path) -> Vec<(String, PriceEntry)> {
    let mut table = builtin();
    let file = home.join("prices.json");
    let Ok(text) = std::fs::read_to_string(&file) else {
        return table;
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        return table;
    };

    let models = parsed.get("models").cloned().unwrap_or(parsed.clone());
    let Some(obj) = models.as_object() else {
        return table;
    };

    let num = |v: Option<&serde_json::Value>| -> Option<f64> {
        match v {
            Some(serde_json::Value::Number(n)) => n.as_f64().filter(|x| *x >= 0.0),
            Some(serde_json::Value::String(s)) => s.trim().parse::<f64>().ok().filter(|x| *x >= 0.0),
            _ => None,
        }
    };

    for (raw_key, raw_value) in obj {
        let Some(v) = raw_value.as_object() else { continue };
        let (Some(input), Some(output)) = (num(v.get("input")), num(v.get("output"))) else {
            continue;
        };
        let cache_read = num(v.get("cacheRead")).unwrap_or(0.0);
        let cache_write = num(v.get("cacheWrite")).unwrap_or(input);
        let provider = v
            .get("provider")
            .and_then(|p| p.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "custom".to_string());

        let key = normalize_model(raw_key);
        table.retain(|(k, _)| *k != key);
        table.push((
            key,
            PriceEntry {
                provider,
                input,
                output,
                cache_read,
                cache_write,
            },
        ));
    }
    table
}
