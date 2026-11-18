//! Token 账本桌面版的核心逻辑（Rust 侧）。
//! 与 TypeScript CLI 共用同一个账本文件，扫描结果与事件 id 完全一致。

pub mod dashboard;
pub mod pricing;
pub mod scan;
pub mod sources;
pub mod store;
