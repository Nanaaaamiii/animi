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
  // 国内反代基地址 = 腾讯云 SCF Web 函数（广州，国内免 VPN 直连）。
  // 负责：Supabase 社区 / Bilibili / DeepSeek AI / 封面(weserv)。
  // 注意：Bangumi 详情(/bgm)不走这里——腾讯云广州节点连不上 api.bgm.tv，
  // 故 js/app.js 的 BGM_PROXY 改为浏览器直连 api.bgm.tv，靠本地烘焙数据兜底。
  PROXY_BASE: "https://1405238935-fbzyqrt6wp.ap-guangzhou.tencentscf.com",
};
