/* ============================================================
 * 番组计划 · Animi — Bangumi 追番同步
 * 依赖：window.APP_CONFIG.PROXY_BASE、window.Community(sb / isAuthed / renderMine / init)
 *
 * 流程：
 *   1) 点「绑定 Bangumi」→ 跳 bgm.tv OAuth（response_type=code, scope=collection）
 *   2) Bangumi 回跳到 {PROXY_BASE}/bgm/oauth/callback（代理用 secret 换 token）
 *   3) 代理把 token 以 #bgm_token=...&bgm_name=... 重定向回本站
 *   4) 本模块读 hash → 存 bgm_accounts → 拉 /v0/users/{name}/collections → upsert 进 collections
 *
 * 安全：client_id 是公开的应用 ID；client_secret 只在代理侧，绝不进前端。
 * 激活前需在代理（Worker/SCF）配置 BGM_CLIENT_ID / BGM_CLIENT_SECRET 两个环境变量，
 * 并在 https://bgm.tv/dev 把回调地址设为 {PROXY_BASE}/bgm/oauth/callback。
 * ============================================================ */
(function () {
  // ⚠️ 你在 https://bgm.tv/dev 注册的应用 client_id（公开，非 secret）
  const BGM_CLIENT_ID = "bgm66806a5dcdf4d9faf";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2800);
  }
  function proxyBase() {
    return (window.APP_CONFIG && window.APP_CONFIG.PROXY_BASE || "").replace(/\/$/, "");
  }
  async function ensureUser() {
    if (typeof window.Community === "undefined") return null;
    if (!window.Community.isAuthed()) { try { await window.Community.init(); } catch (e) {} }
    const sb = window.Community.sb;
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data && data.user ? data.user : null;
  }

  function startOAuth() {
    const cb = proxyBase() + "/bgm/oauth/callback";
    const returnTo = location.origin + location.pathname;
    const url = "https://bgm.tv/oauth/authorize"
      + "?response_type=code"
      + "&client_id=" + encodeURIComponent(BGM_CLIENT_ID)
      + "&redirect_uri=" + encodeURIComponent(cb)
      + "&scope=collection"
      + "&state=" + encodeURIComponent(returnTo);
    location.href = url;
  }

  // 代理回跳后：把 #bgm_token / #bgm_name 写入 bgm_accounts 并同步
  async function handleCallback() {
    const h = location.hash || "";
    const mT = h.match(/bgm_token=([^&]+)/);
    if (!mT) return false;
    const token = decodeURIComponent(mT[1]);
    const mN = h.match(/bgm_name=([^&]+)/);
    const mU = h.match(/bgm_uid=([^&]+)/);
    const bgm_name = mN ? decodeURIComponent(mN[1]) : "";
    const bgm_uid = mU ? decodeURIComponent(mU[1]) : "";
    history.replaceState(null, "", location.pathname + location.search);

    const user = await ensureUser();
    if (!user) {
      toast("请先登录网站账号，再绑定 Bangumi");
      if (window.Community && window.Community.openIdentity) window.Community.openIdentity();
      return true;
    }
    const sb = window.Community.sb;
    await sb.from("bgm_accounts").upsert({
      user_id: user.id,
      bgm_uid: bgm_uid ? parseInt(bgm_uid, 10) : null,
      bgm_username: bgm_name,
      access_token: token,
      updated_at: new Date().toISOString()
    });
    toast("Bangumi 已绑定，正在同步追番…");
    await syncNow(false);
    return true;
  }

  // 用已存 token 拉收藏并 upsert 进 collections
  async function syncNow(showToast) {
    const user = await ensureUser();
    if (!user) { toast("请先登录网站账号"); return; }
    const sb = window.Community.sb;
    const { data: acct, error } = await sb.from("bgm_accounts").select("*").eq("user_id", user.id).maybeSingle();
    if (error) { toast("读取绑定失败：" + error.message); return; }
    if (!acct || !acct.access_token) { toast("尚未绑定 Bangumi，请先绑定"); return; }
    const base = proxyBase();
    const name = acct.bgm_username;
    if (!name) { toast("缺少 Bangumi 用户名，无法同步"); return; }

    let all = [];
    for (let page = 0; page < 20; page++) {
      const offset = page * 50;
      try {
        const r = await fetch(base + "/v0/users/" + encodeURIComponent(name) + "/collections?subject_type=2&limit=50&offset=" + offset, {
          headers: { "Authorization": "Bearer " + acct.access_token, "Accept": "application/json" }
        });
        if (!r.ok) { toast("拉取 Bangumi 失败：" + r.status); break; }
        const j = await r.json();
        const arr = (j && j.data) || [];
        all = all.concat(arr);
        if (arr.length < 50) break;
      } catch (e) { toast("网络错误：" + e.message); break; }
    }

    const TYPE_MAP = { 1: "want", 2: "done", 3: "doing", 4: "hold", 5: "drop" };
    const rows = all.map(it => {
      const id = (it.subject && it.subject.id) || it.subject_id || (it.subject && it.subject.subject_id);
      const type = it.type || 0;
      return {
        user_id: user.id,
        anime_id: id,
        status: TYPE_MAP[type] || "want",
        rating: it.rate ? Number(it.rate) : null,
        note: "",
        updated_at: new Date().toISOString()
      };
    }).filter(r => r.anime_id);

    if (!rows.length) { toast("没有可同步的追番"); if (window.Community.renderMine) window.Community.renderMine(); return; }

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error: e2 } = await sb.from("collections").upsert(batch, { onConflict: "user_id,anime_id" });
      if (e2) { toast("写入失败：" + e2.message); return; }
    }
    toast("已同步 " + rows.length + " 部追番到「我的收藏」");
    if (window.Community.renderMine) window.Community.renderMine();
  }

  async function renderSyncBar(container) {
    if (!container) return;
    if (typeof window.Community === "undefined" || !window.Community.isAuthed()) {
      container.innerHTML = `<div class="bgm-sync"><span class="bgm-sync-tip">登录后可绑定 Bangumi，一键同步你的追番</span></div>`;
      return;
    }
    const sb = window.Community.sb;
    const user = await ensureUser();
    if (!user) {
      container.innerHTML = `<div class="bgm-sync"><span class="bgm-sync-tip">登录后可绑定 Bangumi，一键同步你的追番</span></div>`;
      return;
    }
    const { data: acct } = await sb.from("bgm_accounts").select("*").eq("user_id", user.id).maybeSingle();
    if (acct && acct.bgm_username) {
      container.innerHTML = `<div class="bgm-sync">
        <span class="bgm-sync-ok">✅ 已绑定 Bangumi：<b>${esc(acct.bgm_username)}</b></span>
        <button class="btn btn-sm btn-primary" id="bgm-sync-now">立即同步追番</button>
        <button class="btn btn-sm btn-ghost" id="bgm-unbind">解绑</button>
      </div>`;
      const b1 = container.querySelector("#bgm-sync-now"); if (b1) b1.onclick = () => syncNow(true);
      const b2 = container.querySelector("#bgm-unbind");
      if (b2) b2.onclick = async () => {
        if (!confirm("确定解绑 Bangumi 账号？已同步的追番会保留在「我的收藏」中。")) return;
        await sb.from("bgm_accounts").delete().eq("user_id", user.id);
        renderSyncBar(container);
      };
    } else {
      container.innerHTML = `<div class="bgm-sync">
        <span class="bgm-sync-tip">把 Bangumi 里「想看 / 在看 / 看过」的番剧一键同步到「我的收藏」</span>
        <button class="btn btn-sm btn-primary" id="bgm-bind">绑定 Bangumi 同步</button>
      </div>`;
      const b = container.querySelector("#bgm-bind"); if (b) b.onclick = () => startOAuth();
    }
  }

  function boot() {
    handleCallback().then(handled => {
      if (handled) {
        const bar = document.getElementById("mine-bgm-sync");
        if (bar) renderSyncBar(bar);
      }
    });
  }

  window.BgmSync = { startOAuth, syncNow, renderSyncBar, handleCallback };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
