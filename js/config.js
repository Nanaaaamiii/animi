/* ============================================================
 * 番组计划 · Animi — 全局配置（前端唯一出口基地址）
 *
 * 所有出网请求（Supabase 社区 / Bangumi 详情 / Bilibili / 封面 / AI 对话）
 * 都以 PROXY_BASE 为基。要换反代（如从 Cloudflare Worker 切到国内边缘反代），
 * 只改这一行即可，无需改其它文件。
 *   海外反代：deploy/cloudflare_worker.js
 *   国内反代：deploy/edgeone_proxy.js（腾讯云 EdgeOne / CloudBase / 阿里云 FC）
 * ============================================================ */
window.APP_CONFIG = {
  // 当前：Cloudflare Worker（海外，国内不通）。换成国内可直连地址即全站免 VPN。
  PROXY_BASE: "https://kon.1770737253.workers.dev",
};
