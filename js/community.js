/* ============================================================
 * 番组计划 · Animi — 社区模块（Supabase）
 * 功能：邮箱+密码注册登录 / UID（注册顺序） / 等级 Lv1-Lv6 + 每日签到经验 /
 *       每部动画讨论(A, 支持楼中楼回复) / 论坛发帖评论(B) / 共享收藏评分 / 社区番剧评价聚合
 * 前端仅使用 anon public key（可公开），配合 RLS 安全策略。
 * 注意：SUPABASE_ANON_KEY 占位符需由部署时填入真实 anon key。
 * ============================================================ */
(function () {
  const SUPABASE_URL = "https://uwrnnrowbqidnmskvemq.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cm5ucm93YnFpZG5tc2t2ZW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODM5MDIsImV4cCI6MjA5OTU1OTkwMn0.p3PqDi-blR-BEsmowy9QMfTuxpNggBmkqdh-P1Jchyc";

  const STATUS = { want: "想看", doing: "在看", done: "看过", hold: "搁置", drop: "抛弃" };
  const STATUS_ORDER = ["want", "doing", "done", "hold", "drop"];
  const STAR = "★";

  /* ---------------- 等级配置 ---------------- */
  // 累计经验达到该值即升到对应等级（索引=等级-1）；Lv6 为满级
  const LEVEL_EXP = [0, 50, 130, 250, 420, 650];
  const LEVEL_MAX = LEVEL_EXP.length; // 6
  function levelInfo(exp) {
    exp = exp || 0;
    let lv = 1;
    for (let i = 0; i < LEVEL_EXP.length; i++) if (exp >= LEVEL_EXP[i]) lv = i + 1;
    const max = lv >= LEVEL_MAX;
    const start = LEVEL_EXP[lv - 1];
    const next = max ? start : LEVEL_EXP[lv];
    const pct = max ? 100 : Math.max(0, Math.min(100, Math.round((exp - start) / (next - start) * 100)));
    return { lv, start, next, pct, max, exp };
  }
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const grad = (id) => { const h = (Number(id) * 37) % 360; return `linear-gradient(135deg,hsl(${h},70%,62%),hsl(${(h + 40) % 360},70%,55%))`; };
  // 头像：有 avatar_url 用图，否则用 id 生成的渐变首字母占位
  const avatarHTML = (profile, id, size = "") => {
    const cls = "avatar" + (size ? " " + size : "");
    const url = profile && profile.avatar_url;
    if (url) return `<img class="${cls}" src="${esc(url)}" alt="">`;
    const nm = (profile && profile.username) || "用户";
    return `<span class="${cls}" style="background:${grad(id || 0)}">${esc(nm[0] || "U")}</span>`;
  };
  const uidTag = (profile) => (profile && profile.uid != null) ? `<span class="c-uid">UID:${profile.uid}</span>` : "";
  // 用户称号（如「站长」），数据来自 profiles.role
  const ROLE_CLASS = { "站长": "role-owner", "管理员": "role-admin", "编辑": "role-editor" };
  const roleTag = (profile) => {
    if (!profile || !profile.role) return "";
    const cls = ROLE_CLASS[profile.role] || "role-custom";
    return `<span class="role-badge ${cls}">${esc(profile.role)}</span>`;
  };
  const timeAgo = (t) => {
    const d = (Date.now() - new Date(t).getTime()) / 1000;
    if (d < 60) return "刚刚"; if (d < 3600) return Math.floor(d / 60) + "分钟前";
    if (d < 86400) return Math.floor(d / 3600) + "小时前"; if (d < 2592000) return Math.floor(d / 86400) + "天前";
    return new Date(t).toLocaleDateString();
  };

  let sb = null, USER = null;
  let currentPostId = null, currentAnimeId = null, currentReplyTo = null;

  function isAuthed() { return !!USER; }

  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), 1600);
  }

  // 图片大图查看（点击评论配图触发）
  window.__cbLightbox = function (url) {
    let box = document.getElementById("cb-lightbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "cb-lightbox"; box.className = "cb-lightbox";
      box.innerHTML = `<img alt="大图">`;
      box.onclick = () => box.classList.remove("open");
      document.body.appendChild(box);
    }
    box.querySelector("img").src = url;
    box.classList.add("open");
  };

  async function init() {
    if (typeof supabase === "undefined") { console.warn("supabase-js 未加载"); return; }
    try { sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
    catch (e) { console.warn("Supabase 初始化失败", e); return; }
    bindCommunityUI();
    setupRealtime();
    await ensureSession();
    if ($("#view-community") && !$("#view-community").classList.contains("hidden")) renderForum();
  }

  async function ensureSession() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      USER = session ? session.user : null;
    } catch (e) { console.warn("读取会话失败", e); USER = null; }
    if (USER) await ensureProfile();
    renderUserChip();
  }

  async function ensureProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", USER.id).single();
    if (data) { USER.profile = data; return; }
    const { data: ins } = await sb.from("profiles").insert({ id: USER.id, username: "用户" + USER.id.slice(0, 8) }).select().single();
    USER.profile = ins || { id: USER.id, username: "用户" + USER.id.slice(0, 8) };
  }

  // 上传头像到 Supabase Storage（avatars 桶，按 uid 目录覆盖写）
  async function uploadAvatar(file) {
    if (!USER) throw new Error("未登录");
    const path = `${USER.id}/avatar.jpg`;
    const { error } = await sb.storage.from("avatars").upload(path, file, {
      cacheControl: "3600", upsert: true, contentType: file.type || "image/jpeg"
    });
    if (error) throw error;
    const { data } = sb.storage.from("avatars").getPublicUrl(path);
    return data.publicUrl;
  }

  // 上传评论配图到 Supabase Storage（comments 桶，按 uid/时间戳 命名，避免覆盖）
  async function uploadCommentImage(file) {
    if (!USER) throw new Error("未登录");
    const ext = (file.name && file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${USER.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await sb.storage.from("comments").upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "image/jpeg"
    });
    if (error) throw error;
    const { data } = sb.storage.from("comments").getPublicUrl(path);
    return data.publicUrl;
  }

  /* ---------------- 用户芯片 ---------------- */
  function renderUserChip() {
    const el = $("#user-chip"); if (!el) return;
    if (!USER) {
      el.innerHTML = `<button class="auth-btn" id="chip-enter">登录 / 注册</button>`;
      $("#chip-enter", el).onclick = openIdentity; return;
    }
    const p = USER.profile || {};
    const name = p.username || "用户";
    const lv = p.level || 1;
    el.innerHTML = `<button class="chip-btn" id="chip-name">${avatarHTML(p, USER.id, "sm")}<span class="chip-txt">${esc(name)}</span><span class="chip-lv">Lv${lv}</span></button>`;
    $("#chip-name", el).onclick = openIdentity;
  }

  /* ---------------- 身份入口（未登录=登录注册；已登录=资料） ---------------- */
  function openIdentity() {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    if (!USER) { openAuth(mask, modal); return; }
    openProfile(mask, modal);
  }

  function openAuth(mask, modal) {
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">登录 / 注册</div>
      <div class="auth-tabs">
        <button class="auth-tab active" data-tab="login">登录</button>
        <button class="auth-tab" data-tab="register">注册</button>
      </div>
      <div class="cb-row"><span class="cb-label">邮箱</span>
        <input id="au-email" class="auth-input" type="email" placeholder="you@example.com" autocomplete="email"/></div>
      <div class="cb-row"><span class="cb-label">密码</span>
        <input id="au-pass" class="auth-input" type="password" placeholder="至少 6 位" autocomplete="current-password"/></div>
      <div class="auth-err" id="au-err"></div>
      <button class="btn btn-primary" id="au-submit" style="width:100%;justify-content:center">登录</button>
      <div class="auth-hint">注册即获得 UID（按注册顺序分配），密码仅作演示用途，请使用真实邮箱以便找回。</div>`;
    $("#comm-close").onclick = closeComm;
    $$(".auth-tab", modal).forEach(t => t.onclick = () => {
      $$(".auth-tab", modal).forEach(x => x.classList.remove("active")); t.classList.add("active");
      $("#au-submit").textContent = t.dataset.tab === "login" ? "登录" : "注册";
      $("#au-err").textContent = "";
    });
    $("#au-submit").onclick = async () => {
      const tab = $(".auth-tab.active", modal).dataset.tab;
      const email = $("#au-email").value.trim();
      const pass = $("#au-pass").value;
      const err = $("#au-err");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "请输入有效邮箱"; return; }
      if (pass.length < 6) { err.textContent = "密码至少 6 位"; return; }
      err.textContent = "处理中…";
      if (tab === "register") {
        // 防重复注册：注册前先查该邮箱是否已存在（需 SQL 已部署 email_taken + profiles.email 唯一约束）
        try {
          const { data: taken, error: rpcErr } = await sb.rpc("email_taken", { p_email: email });
          if (!rpcErr && taken) { err.textContent = "该邮箱已注册，请直接登录"; return; }
        } catch (_) { /* 后端尚未就绪则放行，由唯一约束兜底 */ }
        const { data, error } = await sb.auth.signUp({ email, password: pass });
        if (error) { err.textContent = "注册失败：" + error.message; return; }
        if (data.session) {
          USER = data.session.user; await ensureProfile(); renderUserChip(); closeComm(); toast("注册成功，已登录");
        } else {
          err.textContent = "注册成功！请前往邮箱点击验证链接完成激活后登录。";
        }
      } else {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) { err.textContent = "登录失败：" + error.message; return; }
        USER = data.session.user; await ensureProfile(); renderUserChip(); closeComm(); toast("登录成功");
      }
    };
    mask.classList.add("open"); document.body.style.overflow = "hidden";
  }

  async function doCheckIn() {
    const p = USER.profile; if (!p) return;
    const today = todayStr();
    if (p.last_checkin === today) { toast("今天已经签到啦～"); return; }
    const newExp = (p.exp || 0) + 10;
    const beforeLv = levelInfo(p.exp || 0).lv;
    const newLv = levelInfo(newExp).lv;
    const { error } = await sb.from("profiles").update({ exp: newExp, level: newLv, last_checkin: today }).eq("id", USER.id);
    if (error) { toast("签到失败：" + error.message); return; }
    p.exp = newExp; p.level = newLv; p.last_checkin = today;
    renderUserChip();
    openProfile($("#comm-mask"), $("#comm-modal"));
    toast(newLv > beforeLv ? "签到成功！升级到 Lv" + newLv + " 🎉" : "签到成功！EXP +10");
  }

  // 发帖 / 评论等互动给予经验（让等级条有成长感）
  async function awardExp(n) {
    if (!USER || !USER.profile) return;
    const newExp = (USER.profile.exp || 0) + n;
    const newLv = levelInfo(newExp).lv;
    const { error } = await sb.from("profiles").update({ exp: newExp, level: newLv }).eq("id", USER.id);
    if (!error) {
      const before = USER.profile.level;
      USER.profile.exp = newExp; USER.profile.level = newLv;
      renderUserChip();
      if (newLv > before) toast("升级到 Lv" + newLv + " 🎉");
    }
  }

  function openProfile(mask, modal) {
    const p = USER.profile || {};
    const li = levelInfo(p.exp);
    const av = avatarHTML(p, USER.id, "lg");
    const signed = p.last_checkin === todayStr();
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">我的资料</div>
      <div class="id-card">
        <div class="cb-row id-avatar-row">
          <div class="avatar-prev">${av}</div>
          <div class="avatar-tools">
            <input type="file" id="avatar-file" accept="image/*" hidden>
            <button class="btn btn-ghost" id="avatar-pick" style="padding:8px 14px">选择头像</button>
            <div class="avatar-hint">建议方形图片，小于 2MB</div>
          </div>
        </div>
        <div class="uid-line">UID：<b>${p.uid != null ? p.uid : "—"}</b>${roleTag(p)}</div>
        <div class="lv-line">
          <span class="lv-badge">${li.max ? "Lv" + li.lv + " · 满级" : "Lv" + li.lv}</span>
          <span class="lv-exp">${li.max ? "EXP " + li.exp : "EXP " + li.exp + " / " + li.next}</span>
        </div>
        <div class="exp-bar"><div class="exp-fill" style="width:${li.pct}%"></div></div>
        <button class="btn btn-primary" id="checkin-btn" style="width:100%;justify-content:center;margin-top:10px">${signed ? "今日已签到 ✓" : "每日签到 +10 EXP"}</button>
        <div class="cb-row" style="margin-top:12px"><span class="cb-label">昵称</span>
          <input id="id-name" class="auth-input" value="${esc(p.username || "")}" placeholder="给自己起个名字" maxlength="20"/></div>
        <div class="cb-row"><span class="cb-label">简介</span>
          <textarea id="id-bio" class="cb-textarea" placeholder="一句话介绍自己（选填）" maxlength="120" style="min-height:60px">${esc(p.bio || "")}</textarea></div>
        <div class="auth-err" id="id-err"></div>
        <button class="btn btn-primary" id="id-save" style="width:100%;justify-content:center">保存资料</button>
        <button class="btn btn-ghost" id="id-logout" style="width:100%;justify-content:center;margin-top:8px">退出登录</button>
      </div>`;
    $("#comm-close").onclick = closeComm;
    $("#avatar-pick").onclick = () => $("#avatar-file").click();
    $("#avatar-file").onchange = () => {
      const f = $("#avatar-file").files[0]; if (!f) return;
      if (f.size > 2 * 1024 * 1024) { $("#id-err").textContent = "头像图片需小于 2MB"; $("#avatar-file").value = ""; return; }
      if (!/^image\//.test(f.type)) { $("#id-err").textContent = "请选择图片文件"; $("#avatar-file").value = ""; return; }
      const r = new FileReader();
      r.onload = e => { $(".avatar-prev").innerHTML = `<img class="avatar lg" src="${e.target.result}">`; };
      r.readAsDataURL(f);
    };
    $("#checkin-btn").onclick = () => doCheckIn();
    $("#id-save").onclick = async () => {
      const v = $("#id-name").value.trim();
      const bioVal = $("#id-bio").value.trim();
      const file = $("#avatar-file").files[0];
      const { error } = await sb.from("profiles").update({ username: v || ("用户" + USER.id.slice(0, 8)) }).eq("id", USER.id);
      if (error) { $("#id-err").textContent = "保存失败：" + error.message; return; }
      if (file || bioVal !== (p.bio || "")) {
        try {
          const patch = { bio: bioVal };
          if (file) patch.avatar_url = await uploadAvatar(file);
          const { error: e2 } = await sb.from("profiles").update(patch).eq("id", USER.id);
          if (e2) $("#id-err").textContent = "昵称已保存；头像/简介需先在 Supabase 执行最新建表 SQL（含 storage 头像桶）。";
        } catch (e) { $("#id-err").textContent = "头像上传失败：" + e.message; }
      }
      await ensureProfile(); renderUserChip(); openProfile(mask, modal); toast("已更新资料");
    };
    $("#id-logout").onclick = async () => {
      await sb.auth.signOut(); USER = null; renderUserChip(); closeComm(); toast("已退出登录");
    };
    mask.classList.add("open"); document.body.style.overflow = "hidden";
  }
  function closeComm() { const m = $("#comm-mask"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }

  /* ---------------- UI 绑定 ---------------- */
  function bindCommunityUI() {
    const mask = $("#comm-mask");
    if (mask) mask.addEventListener("click", (e) => { if (e.target.id === "comm-mask") closeComm(); });
    const np = $("#new-post-btn"); if (np) np.onclick = () => { if (!USER) { openIdentity(); return; } composePost(); };
    const tabs = $("#comm-tabs");
    if (tabs) tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".comm-tab"); if (!b) return;
      $$(".comm-tab", tabs).forEach(x => x.classList.remove("active")); b.classList.add("active");
      const t = b.dataset.tab;
      $("#forum-list").classList.toggle("hidden", t !== "forum");
      $("#comm-hot").classList.toggle("hidden", t !== "hot");
      $("#comm-anime").classList.toggle("hidden", t !== "anime");
      if (t === "forum") renderForum();
      else if (t === "hot") renderHot();
      else renderAnimeReviews();
    });
    document.addEventListener("click", (e) => {
      const it = e.target.closest("#mine-grid .anime-card");
      if (it && window.openModal) window.openModal(+it.dataset.id);
    });
    // 「我的」子标签：收藏 / 番剧评论 / 论坛
    const mtab = $("#mine-tabs");
    if (mtab) mtab.addEventListener("click", (e) => {
      const b = e.target.closest(".mine-tab"); if (!b) return;
      $$(".mine-tab", mtab).forEach(x => x.classList.remove("active")); b.classList.add("active");
      window.__mineTab = b.dataset.mt;
      $$(".mine-pane").forEach(p => p.classList.add("hidden"));
      const pane = $("#mine-" + b.dataset.mt); if (pane) pane.classList.remove("hidden");
      renderMine();
    });
  }

  /* ---------------- 论坛 (B) ---------------- */
  async function renderForum() {
    const wrap = $("#forum-list"); if (!wrap) return;
    if (!sb) { wrap.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    if (!USER) {
      wrap.innerHTML = `<div class="empty">登录后即可发帖交流。<button class="btn btn-primary" id="forum-login" style="margin-top:10px;padding:8px 18px">登录 / 注册</button></div>`;
      const b = $("#forum-login", wrap); if (b) b.onclick = openIdentity; return;
    }
    wrap.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("forum_posts").select("id,title,body,created_at,user_id,views").order("created_at", { ascending: false }).limit(50);
    if (error) { wrap.innerHTML = `<div class="err">加载失败：${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { wrap.innerHTML = `<div class="empty">还没有帖子，点右上角「＋ 发帖」抢沙发吧～</div>`; return; }
    const ids = [...new Set(data.map(p => p.user_id))];
    const names = await fetchNames(ids);
    const { data: cs } = await sb.from("forum_comments").select("post_id").in("post_id", ids);
    const cnt = {}; (cs || []).forEach(c => cnt[c.post_id] = (cnt[c.post_id] || 0) + 1);
    wrap.innerHTML = data.map(p => `
      <div class="post-card" data-id="${p.id}">
        <div class="post-main">
          <div class="post-title">${esc(p.title)}</div>
          <div class="post-body">${esc(p.body)}</div>
          <div class="post-meta"><span class="c-av">${avatarHTML(names[p.user_id], p.user_id, "xs")}</span><span>@${esc((names[p.user_id] && names[p.user_id].username) || "用户")}</span>${roleTag(names[p.user_id])}${uidTag(names[p.user_id])}<span>${timeAgo(p.created_at)}</span><span>👁 ${p.views || 0}</span><span>💬 ${cnt[p.id] || 0}</span></div>
        </div>
      </div>`).join("");
    $$(".post-card", wrap).forEach(c => c.onclick = () => openPost(c.dataset.id));
  }

  async function fetchNames(ids) {
    if (!ids.length) return {};
    const { data } = await sb.from("profiles").select("id,username,avatar_url,uid,role").in("id", ids);
    const m = {}; (data || []).forEach(u => m[u.id] = u); return m;
  }

  async function openPost(id) {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="loading">加载中…</div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const { data: post } = await sb.from("forum_posts").select("title,body,created_at,user_id").eq("id", id).single();
    if (!post) { modal.innerHTML = `<div class="err">帖子不存在</div>`; return; }
    const { data: vres } = await sb.rpc("inc_post_view", { p_id: id });
    const views = (vres && vres[0] && vres[0].inc_post_view) || post.views || 0;
    const names = await fetchNames([post.user_id]);
    const { data: comments } = await sb.from("forum_comments").select("id,body,created_at,user_id").eq("post_id", id).order("created_at", { ascending: true });
    currentPostId = id;
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-post">
        <div class="post-title">${esc(post.title)}</div>
        <div class="post-body" style="white-space:pre-wrap">${esc(post.body)}</div>
        <div class="post-meta"><span class="c-av">${avatarHTML(names[post.user_id], post.user_id, "xs")}</span><span>@${esc((names[post.user_id] && names[post.user_id].username) || "用户")}</span>${roleTag(names[post.user_id])}${uidTag(names[post.user_id])}<span>${timeAgo(post.created_at)}</span><span>👁 ${views}</span></div>
      </div>
      <div class="comm-divider">评论 ${comments ? comments.length : 0}</div>
      <div id="comment-list" class="comment-list">${comments && comments.length ? comments.map(c => commentHTML(c, names[c.user_id])).join("") : `<div class="empty">还没有评论</div>`}</div>
      <div class="comment-form">
        <textarea id="comment-input" class="cb-textarea" placeholder="${USER ? "说点什么…" : "登录后即可评论"}"></textarea>
        <button class="btn btn-primary" id="comment-send" style="justify-content:center">${USER ? "发送" : "登录"}</button>
      </div>`;
    $("#comm-close").onclick = closeComm;
    const list = $("#comment-list");
    if (list) list.addEventListener("click", async (e) => {
      const b = e.target.closest(".c-del"); if (!b) return;
      await sb.from("forum_comments").delete().eq("id", b.dataset.id).eq("user_id", USER.id); openPost(id);
    });
    $("#comment-send").onclick = async () => {
      if (!USER) { openIdentity(); return; }
      const v = $("#comment-input").value.trim(); if (!v) return;
      const { error } = await sb.from("forum_comments").insert({ post_id: id, user_id: USER.id, body: v });
      if (error) { toast("评论失败：" + error.message); return; }
      $("#comment-input").value = ""; await awardExp(2); openPost(id);
    };
  }

  function composePost() {
    if (!USER) { openIdentity(); return; }
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">发帖</div>
      <input id="post-title" class="auth-input" placeholder="标题" maxlength="60"/>
      <textarea id="post-body" class="cb-textarea" placeholder="分享点什么…" style="min-height:140px"></textarea>
      <div class="auth-err" id="post-err"></div>
      <button class="btn btn-primary" id="post-send" style="width:100%;justify-content:center">发布</button>`;
    $("#comm-close").onclick = closeComm;
    $("#post-send").onclick = async () => {
      const title = $("#post-title").value.trim(), body = $("#post-body").value.trim();
      if (title.length < 2) { $("#post-err").textContent = "标题至少 2 个字"; return; }
      if (!body) { $("#post-err").textContent = "内容不能为空"; return; }
      const { error } = await sb.from("forum_posts").insert({ user_id: USER.id, title, body });
      if (error) { $("#post-err").textContent = "发布失败：" + error.message; return; }
      await awardExp(5); closeComm(); renderForum(); toast("已发布 +5 EXP");
    };
    mask.classList.add("open"); document.body.style.overflow = "hidden";
  }

  /* ---------------- 每部动画讨论 (A) + 楼中楼回复 ---------------- */
  async function onModalOpen(a) {
    const body = $("#modal .modal-body"); if (!body) return;
    let box = $("#modal-discuss");
    if (!box) { box = document.createElement("div"); box.id = "modal-discuss"; body.appendChild(box); }
    let count = 0;
    try { const r = await sb.from("anime_comments").select("*", { count: "exact", head: true }).eq("anime_id", a.id).is("parent_id", null); count = r.count || 0; } catch (e) {}
    box.innerHTML = `<button class="btn btn-ghost" id="open-anime-discuss" style="margin-top:14px;width:100%;justify-content:center">💬 社区讨论 ${count}</button>`;
    $("#open-anime-discuss", box).onclick = () => openAnimeDiscussion(a.id, a.title);
  }

  function buildTree(comments) {
    const map = {}, roots = [];
    (comments || []).forEach(c => { c._replies = []; map[c.id] = c; });
    (comments || []).forEach(c => {
      if (c.parent_id && map[c.parent_id]) map[c.parent_id]._replies.push(c);
      else roots.push(c);
    });
    const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at);
    roots.sort(byTime);
    Object.values(map).forEach(c => c._replies.sort(byTime));
    return roots;
  }

  function commentHTML(c, profile, depth = 0) {
    const mine = USER && c.user_id === USER.id;
    const name = (profile && profile.username) || "用户";
    const replies = (c._replies || []).map(r => commentHTML(r, profile, depth + 1)).join("");
    return `<div class="comment-item${mine ? " mine" : ""}${depth ? " reply" : ""}">
      <div class="c-head"><span class="c-av">${avatarHTML(profile, c.user_id, "xs")}</span><span class="c-name">@${esc(name)}</span>${roleTag(profile)}${uidTag(profile)}<span class="c-time">${timeAgo(c.created_at)}</span>${mine ? `<button class="c-del" data-id="${c.id}">删除</button>` : ""}</div>
      ${c.body ? `<div class="c-body">${esc(c.body)}</div>` : ""}
      ${imagesHTML(c.images)}
      <div class="c-actions"><button class="c-reply" data-id="${c.id}" data-name="${esc(name)}">回复</button></div>
      ${replies ? `<div class="c-replies">${replies}</div>` : ""}
    </div>`;
  }

  // 渲染评论配图（数组），点击可在弹层查看大图
  function imagesHTML(images) {
    if (!Array.isArray(images) || !images.length) return "";
    const items = images.map(u => `<img class="c-img" src="${esc(u)}" alt="配图" loading="lazy" onclick="window.__cbLightbox && window.__cbLightbox('${esc(u)}')">`).join("");
    return `<div class="c-imgs">${items}</div>`;
  }

  async function openAnimeDiscussion(animeId, title, targetCommentId) {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="loading">加载中…</div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    currentAnimeId = animeId; currentReplyTo = null;
    const { data: comments } = await sb.from("anime_comments").select("id,anime_id,user_id,body,created_at,parent_id,images").eq("anime_id", animeId).order("created_at", { ascending: true });
    const ids = [...new Set((comments || []).map(c => c.user_id))];
    const names = await fetchNames(ids);
    const tree = buildTree(comments);
    // 若指定了某条评价，则默认把回复挂到它下面（楼中楼），不再生成新卡片
    let targetName = "";
    if (targetCommentId && comments) {
      const t = comments.find(c => c.id === targetCommentId);
      if (t) { currentReplyTo = targetCommentId; targetName = (names[t.user_id] && names[t.user_id].username) || "用户"; }
    }
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">💬 讨论：${esc(title || ("动画 #" + animeId))}</div>
      <div id="anime-comment-list" class="comment-list">${tree.length ? tree.map(c => commentHTML(c, names[c.user_id])).join("") : `<div class="empty">还没有人讨论这部，来当第一个～</div>`}</div>
      <div class="reply-hint hidden" id="reply-hint"></div>
      ${commentComposerHTML("ac")}`;
    $("#comm-close").onclick = closeComm;
    if (currentReplyTo) {
      const hint = $("#reply-hint");
      hint.textContent = "正在回复 @" + targetName + "（发送后将显示在其下方，不会新建卡片）";
      hint.classList.remove("hidden");
      setTimeout(() => { const el = document.querySelector(`.c-reply[data-id="${currentReplyTo}"]`); if (el) el.scrollIntoView({ block: "center", behavior: "smooth" }); }, 60);
    }
    initCommentComposer("ac", async (body, images) => {
      const row = { anime_id: animeId, user_id: USER.id, body };
      if (images.length) row.images = images;
      if (currentReplyTo) row.parent_id = currentReplyTo;
      const { error } = await sb.from("anime_comments").insert(row);
      if (error) { toast("发送失败：" + error.message); return false; }
      await awardExp(2);
      openAnimeDiscussion(animeId, title);
      return true;
    });
    const list = $("#anime-comment-list");
    if (list) list.addEventListener("click", async (e) => {
      const del = e.target.closest(".c-del");
      if (del) { await sb.from("anime_comments").delete().eq("id", del.dataset.id).eq("user_id", USER.id); openAnimeDiscussion(animeId, title); return; }
      const rep = e.target.closest(".c-reply");
      if (rep) {
        currentReplyTo = rep.dataset.id;
        const hint = $("#reply-hint");
        hint.textContent = "正在回复 @" + rep.dataset.name + "（发送后将在其下方显示）";
        hint.classList.remove("hidden");
        $("#ac-input").focus();
      }
    });
  }

  /* ---------------- 可复用图文评论器（讨论弹窗 & 社区发评价共用） ---------------- */
  function commentComposerHTML(prefix) {
    return `<div class="comment-form" id="${prefix}-form">
      <textarea id="${prefix}-input" class="cb-textarea" placeholder="说点什么…（支持插入图片）"></textarea>
      <div class="ac-thumbs" id="${prefix}-thumbs"></div>
      <div class="ac-bar">
        <label class="ac-imgbtn" title="插入图片">🖼️ 图片
          <input type="file" id="${prefix}-file" accept="image/*" multiple hidden>
        </label>
        <button class="btn btn-primary" id="${prefix}-send" style="justify-content:center">发送</button>
      </div>
    </div>`;
  }

  function initCommentComposer(prefix, onSend) {
    let pendingImgs = [];
    const inputEl = $("#" + prefix + "-input");
    if (inputEl) inputEl.placeholder = currentReplyTo ? "回复楼主（将显示在其下方）…" : "说点什么…（支持插入图片）";
    const thumbsEl = $("#" + prefix + "-thumbs");
    const sendBtn = $("#" + prefix + "-send");
    const fileInput = $("#" + prefix + "-file");
    function renderThumbs() {
      if (!thumbsEl) return;
      thumbsEl.innerHTML = pendingImgs.map((f, i) =>
        `<div class="ac-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="ac-thumb-x" data-i="${i}">✕</button></div>`
      ).join("");
      thumbsEl.querySelectorAll(".ac-thumb-x").forEach(b => b.onclick = () => { pendingImgs.splice(+b.dataset.i, 1); renderThumbs(); });
    }
    if (fileInput) fileInput.addEventListener("change", () => {
      const files = [...(fileInput.files || [])];
      for (const f of files) {
        if (!f.type.startsWith("image/")) { toast("只能插入图片"); continue; }
        if (f.size > 5 * 1024 * 1024) { toast("单张图片不能超过 5MB"); continue; }
        if (pendingImgs.length >= 6) { toast("最多插入 6 张图片"); break; }
        pendingImgs.push(f);
      }
      fileInput.value = ""; renderThumbs();
    });
    if (sendBtn) sendBtn.onclick = async () => {
      const v = $("#" + prefix + "-input").value.trim();
      if (!USER) { openIdentity(); return; }
      if (!v && !pendingImgs.length) return;
      sendBtn.disabled = true;
      const oldTxt = sendBtn.textContent;
      try {
        let imgUrls = [];
        if (pendingImgs.length) {
          sendBtn.textContent = "上传中…";
          imgUrls = []; for (const f of pendingImgs) imgUrls.push(await uploadCommentImage(f));
        }
        const ok = await onSend(v, imgUrls);
        if (ok) { $("#" + prefix + "-input").value = ""; pendingImgs = []; renderThumbs(); }
      } catch (e) {
        toast("图片上传失败：" + (e.message || e));
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = oldTxt;
      }
    };
  }

  /* ---------------- 社区页「发评价」弹窗（含番剧搜索选择） ---------------- */
  async function openReviewComposer() {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    if (!USER) { openIdentity(); return; }
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">✍️ 发表番剧评价</div>
      <div class="rv-picker">
        <input id="rv-search" class="cb-input" placeholder="🔍 先搜索并选择一部番剧…" autocomplete="off">
        <div id="rv-results" class="rv-results"></div>
        <div id="rv-chosen" class="rv-chosen hidden"></div>
      </div>
      <div id="rv-composer-host"></div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const search = $("#rv-search"), results = $("#rv-results"), chosen = $("#rv-chosen"), host = $("#rv-composer-host");
    let selected = null;
    function choose(a) {
      selected = a; chosen.innerHTML = `已选择：📺 <b>${esc(a.title)}</b> <button class="ac-thumb-x" id="rv-clear" style="position:static;display:inline-flex">✕</button>`;
      chosen.classList.remove("hidden"); search.classList.add("hidden"); results.innerHTML = "";
      $("#rv-clear").onclick = () => { selected = null; chosen.classList.add("hidden"); search.classList.remove("hidden"); search.value = ""; search.focus(); };
      host.innerHTML = commentComposerHTML("rv");
      initCommentComposer("rv", async (body, images) => {
        const row = { anime_id: selected.id, user_id: USER.id, body };
        if (images.length) row.images = images;
        const { error } = await sb.from("anime_comments").insert(row);
        if (error) { toast("发布失败：" + error.message); return false; }
        await awardExp(5); toast("已发布 +5 EXP");
        closeComm(); await renderAnimeReviews();
        return true;
      });
    }
    search.addEventListener("input", () => {
      const q = search.value.trim();
      if (!q) { results.innerHTML = ""; return; }
      const all = window.ANIME_DATA || [];
      const hit = all.filter(x => (x.title || "").toLowerCase().includes(q.toLowerCase())).slice(0, 8);
      results.innerHTML = hit.length
        ? hit.map(a => `<div class="rv-opt" data-id="${a.id}">${esc(a.title)}</div>`).join("")
        : `<div class="empty" style="padding:10px">没找到匹配的番剧</div>`;
      results.querySelectorAll(".rv-opt").forEach(o => o.onclick = () => choose(all.find(x => x.id === +o.dataset.id)));
    });
  }

  /* ---------------- 社区「番剧评价」聚合 ---------------- */
  async function renderAnimeReviews() {
    const wrap = $("#comm-anime"); if (!wrap) return;
    if (!sb) { wrap.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    wrap.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("anime_comments")
      .select("id,anime_id,user_id,body,created_at,parent_id,images")
      .is("parent_id", null)
      .order("created_at", { ascending: false }).limit(80);
    if (error) { wrap.innerHTML = `<div class="err">加载失败：${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { wrap.innerHTML = `<div class="empty">还没有人对番剧发表评价，<button class="btn btn-primary" id="rv-empty-new" style="padding:8px 18px;margin-top:8px">去发第一条</button>～</div>`; const be = $("#rv-empty-new", wrap); if (be) be.onclick = openReviewComposer; return; }
    const ids = [...new Set(data.map(c => c.user_id))];
    const names = await fetchNames(ids);
    // 取每部番的「我的评分」用于评价卡片展示评分
    const animeIds = [...new Set(data.map(c => c.anime_id))];
    const { data: colls } = await sb.from("collections").select("anime_id,rating").in("anime_id", animeIds);
    const ratings = {}; (colls || []).forEach(x => { if (x.rating) ratings[x.anime_id] = x.rating; });
    wrap.innerHTML = (USER ? `<button class="btn btn-primary" id="rv-new" style="padding:9px 20px;margin-bottom:12px">＋ 发评价（可带图）</button>` : "") + data.map(c => {
      const a = window.ANIME_DATA.find(x => x.id === c.anime_id);
      const prof = names[c.user_id]; const name = (prof && prof.username) || "用户";
      const rt = ratings[c.anime_id];
      const stars = rt ? "★".repeat(rt) + "☆".repeat(10 - rt) : "";
      return `<div class="review-card" data-anime="${c.anime_id}">
        <div class="rv-head"><span class="c-av">${avatarHTML(prof, c.user_id, "xs")}</span><span class="rv-name">@${esc(name)}</span>${roleTag(prof)}${uidTag(prof)}<span class="c-time">${timeAgo(c.created_at)}</span></div>
        <div class="rv-anime">📺 ${esc(a ? a.title : "未知番剧")}</div>
        ${rt ? `<div class="rv-score">我的评分：<b style="color:#ffce3d">${stars}</b> ${rt}/10</div>` : ""}
        ${c.body ? `<div class="rv-body">${esc(c.body)}</div>` : ""}
        ${imagesHTML(c.images)}
        <button class="rv-comment-btn" data-anime="${c.anime_id}" data-cid="${c.id}">💬 评论 (${a ? (a.title) : ""})</button>
      </div>`;
    }).join("");
    $$(".review-card", wrap).forEach(card => {
      // 点「评论」按钮 → 打开该番讨论区并定位到这条评价，回复将挂在其下方（楼中楼）
      const cb = card.querySelector(".rv-comment-btn");
      if (cb) cb.onclick = (e) => {
        e.stopPropagation();
        const aid = +cb.dataset.anime;
        const cid = cb.dataset.cid;
        const t = (window.ANIME_DATA.find(x => x.id === aid) || {}).title || ("动画 #" + aid);
        closeComm();
        openAnimeDiscussion(aid, t, cid);
      };
      // 点卡片其它区域 → 打开番剧详情页
      card.onclick = () => {
        if (window.openModal) { closeComm(); window.openModal(+card.dataset.anime); }
      };
    });
    const rvNew = $("#rv-new", wrap); if (rvNew) rvNew.onclick = openReviewComposer;
  }

  /* ---------------- 共享收藏 / 评分（替代 localStorage） ---------------- */
  async function renderCollectBox(a, box) {
    let coll = null;
    if (USER) { const { data } = await sb.from("collections").select("*").eq("user_id", USER.id).eq("anime_id", a.id).maybeSingle(); coll = data; }
    const st = coll ? coll.status : "";
    const rt = coll ? (coll.rating || 0) : 0;
    const cm = coll ? (coll.note || "") : "";
    const stBtns = STATUS_ORDER.map(k => `<button class="st-btn ${st === k ? "active" : ""}" data-st="${k}">${STATUS[k]}</button>`).join("");
    let stars = ""; for (let i = 1; i <= 10; i++) stars += `<span class="star ${i <= rt ? "on" : ""}" data-r="${i}">${STAR}</span>`;
    box.innerHTML = `
      <div class="cb-title">我的收藏</div>
      <div class="cb-row"><span class="cb-label">状态</span><div class="status-btns">${stBtns}</div></div>
      <div class="cb-row"><span class="cb-label">评分</span><div class="star-input" id="star-input">${stars}</div><span class="star-val" id="star-val">${rt ? rt + " 分" : "未评"}</span></div>
      <div class="cb-row"><span class="cb-label">评论</span><textarea id="comment-input" class="cb-textarea" placeholder="写下你的看法…">${esc(cm)}</textarea></div>
      <div class="cb-actions">
        <button class="btn btn-primary" id="save-collect" style="padding:10px 22px">保存</button>
        <button class="btn btn-ghost" id="del-collect" style="padding:10px 22px">移除收藏</button>
      </div>`;
    $$(".st-btn", box).forEach(b => b.onclick = () => { $$(".st-btn", box).forEach(x => x.classList.remove("active")); b.classList.add("active"); });
    const sinput = $("#star-input", box);
    $$(".star", sinput).forEach(s => s.onclick = () => { const r = +s.dataset.r; $$(".star", sinput).forEach(x => x.classList.toggle("on", +x.dataset.r <= r)); $("#star-val", box).textContent = r + " 分"; });
    $("#save-collect", box).onclick = async () => {
      if (!USER) { openIdentity(); return; }
      const activeSt = $(".st-btn.active", box); const curSt = activeSt ? activeSt.dataset.st : "want";
      const curRt = $$(".star.on", sinput).length; const curCm = $("#comment-input", box).value;
      const { error } = await sb.from("collections").upsert(
        { user_id: USER.id, anime_id: a.id, status: curSt, rating: curRt || null, note: curCm },
        { onConflict: "user_id,anime_id" }
      );
      if (error) { toast("保存失败：" + error.message); return; }
      toast("已保存"); if ($("#view-mine") && !$("#view-mine").classList.contains("hidden")) renderMine();
    };
    $("#del-collect", box).onclick = async () => {
      if (!USER) return;
      await sb.from("collections").delete().eq("user_id", USER.id).eq("anime_id", a.id);
      setupCollectBoxLocal(a, box);
      if ($("#view-mine") && !$("#view-mine").classList.contains("hidden")) renderMine();
      toast("已移除收藏");
    };
  }
  function setupCollectBoxLocal(a, box) {
    box.innerHTML = `<div class="cb-login"><span>登录后即可收藏、评分、写评论。</span>
      <button class="btn btn-primary" id="cb-login" style="padding:9px 18px">登录 / 注册</button></div>`;
    const b = $("#cb-login", box); if (b) b.onclick = () => openIdentity();
  }

  async function renderMine() {
    const grid = $("#mine-grid"), stats = $("#mine-stats"), filter = $("#mine-filter"), empty = $("#mine-empty");
    if (!grid) return;
    if (!USER) {
      grid.innerHTML = ""; stats.innerHTML = ""; filter.innerHTML = "";
      if (empty) { empty.hidden = false; empty.querySelector("p").textContent = "请先登录后查看你的收藏。"; }
      return;
    }
    // 当前子标签（collect / reviews / posts）
    const mt = window.__mineTab || "collect";
    if (mt === "reviews") return renderMineReviews();
    if (mt === "posts") return renderMinePosts();

    // ---- 收藏 ----
    const { data, error } = await sb.from("collections").select("*").eq("user_id", USER.id);
    if (error) { grid.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    let list = (data || []).map(c => ({ a: window.ANIME_DATA.find(x => x.id === c.anime_id), c })).filter(x => x.a);
    list.sort((x, y) => new Date(y.c.created_at) - new Date(x.c.created_at));
    const f = (window.__mineFilter || "all");
    const filtered = f === "all" ? list : list.filter(x => x.c.status === f);
    const counts = { all: list.length }; STATUS_ORDER.forEach(k => counts[k] = list.filter(x => x.c.status === k).length);
    stats.innerHTML = STATUS_ORDER.map(k => `<div class="mine-stat"><b>${counts[k]}</b><span>${STATUS[k]}</span></div>`).join("");
    filter.innerHTML = `<button class="f-chip ${f === "all" ? "active" : ""}" data-f="all">全部</button>` + STATUS_ORDER.map(k => `<button class="f-chip ${f === k ? "active" : ""}" data-f="${k}">${STATUS[k]} ${counts[k]}</button>`).join("");
    if (!filtered.length) {
      if (empty) { empty.hidden = false; empty.querySelector("p").textContent = f === "all" ? "还没有收藏任何番剧。" : "该状态暂无番剧，去动画库添加吧。"; }
      grid.innerHTML = "";
    } else {
      if (empty) empty.hidden = true;
      grid.innerHTML = filtered.map(x => mineCardHTML(x.a, x.c)).join("");
    }
  }

  async function renderMineReviews() {
    const list = $("#mine-reviews-list"), empty = $("#mine-reviews-empty");
    if (!list) return;
    const { data, error } = await sb.from("anime_comments")
      .select("id,anime_id,body,created_at,images,parent_id")
      .eq("user_id", USER.id).is("parent_id", null)
      .order("created_at", { ascending: false }).limit(100);
    if (error) { list.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { list.innerHTML = ""; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    list.innerHTML = data.map(c => {
      const a = window.ANIME_DATA.find(x => x.id === c.anime_id);
      return `<div class="post-card mine-post" data-id="${c.id}" data-anime="${c.anime_id}">
        <div class="post-main">
          <div class="post-title">📺 ${esc(a ? a.title : "未知番剧")}</div>
          ${c.body ? `<div class="post-body">${esc(c.body)}</div>` : ""}
          ${imagesHTML(c.images)}
          <div class="post-meta"><span class="c-time">${timeAgo(c.created_at)}</span></div>
        </div>
        <button class="post-del" data-del-rev="${c.id}">删除</button>
      </div>`;
    }).join("");
    bindMinePostEvents(list);
  }

  async function renderMinePosts() {
    const list = $("#mine-posts-list"), empty = $("#mine-posts-empty");
    if (!list) return;
    const { data, error } = await sb.from("forum_posts")
      .select("id,title,body,created_at").eq("user_id", USER.id)
      .order("created_at", { ascending: false }).limit(100);
    if (error) { list.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { list.innerHTML = ""; if (empty) empty.hidden = false; return; }
    if (empty) empty.hidden = true;
    list.innerHTML = data.map(p => `
      <div class="post-card mine-post" data-id="${p.id}">
        <div class="post-main">
          <div class="post-title">${esc(p.title)}</div>
          <div class="post-body">${esc(p.body)}</div>
          <div class="post-meta"><span class="c-time">${timeAgo(p.created_at)}</span></div>
        </div>
        <button class="post-del" data-del-post="${p.id}">删除</button>
      </div>`).join("");
    bindMinePostEvents(list);
  }

  function bindMinePostEvents(list) {
    // 番剧卡片点击 → 详情页
    list.querySelectorAll(".mine-post[data-anime]").forEach(card => card.onclick = (e) => {
      if (e.target.closest(".post-del")) return;
      if (window.openModal) window.openModal(+card.dataset.anime);
    });
    // 删除番剧评论（连同其楼中楼回复）
    list.querySelectorAll("[data-del-rev]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除这条番剧评论？其下的回复也会一并删除。")) return;
      const { error } = await sb.from("anime_comments").delete().eq("id", b.dataset.delRev).eq("user_id", USER.id);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); renderMineReviews();
    });
    // 删除论坛帖子
    list.querySelectorAll("[data-del-post]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除这条论坛帖子？")) return;
      const { error } = await sb.from("forum_posts").delete().eq("id", b.dataset.delPost).eq("user_id", USER.id);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); renderMinePosts();
    });
  }

  function mineCardHTML(a, c) {
    return `<article class="anime-card tilt" data-id="${a.id}">
      <div class="cover" style="background-image:${grad(a.id)}">
        <img class="img" src="${a.cover}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <div class="ov"></div>
        <div class="status-tag on">${STATUS[c.status] || ""}</div>
      </div>
      <div class="meta"><div class="title">${esc(a.title)}</div><div class="sub">${c.rating ? "我的评分 " + c.rating + "/10" : "未评分"}</div>${c.note ? `<div class="mine-comment">${esc(c.note)}</div>` : ""}</div>
    </article>`;
  }

  async function renderHot() {
    const wrap = $("#comm-hot"); if (!wrap) return;
    const { data, error } = await sb.from("collections").select("anime_id,rating").not("rating", "is", null);
    if (error) { wrap.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { wrap.innerHTML = `<div class="empty">还没有足够的评分数据，去动画详情页评分吧～</div>`; return; }
    const map = {};
    data.forEach(r => { if (!map[r.anime_id]) map[r.anime_id] = { sum: 0, n: 0 }; map[r.anime_id].sum += r.rating; map[r.anime_id].n++; });
    const top = Object.keys(map).map(id => ({ id: +id, avg: map[id].sum / map[id].n, n: map[id].n })).sort((a, b) => b.avg - a.avg).slice(0, 20);
    wrap.innerHTML = top.map(t => {
      const a = window.ANIME_DATA.find(x => x.id === t.id); if (!a) return "";
      return `<article class="anime-card tilt" data-id="${a.id}">
        <div class="cover" style="background-image:${grad(a.id)}">
          <img class="img" src="${a.cover}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
          <div class="ov"></div>
        </div>
        <div class="meta"><div class="title">${esc(a.title)}</div><div class="sub">社区均分 ${t.avg.toFixed(1)} · ${t.n} 人评</div></div>
      </article>`;
    }).join("");
    $$(".anime-card", wrap).forEach(c => c.onclick = () => { if (window.openModal) window.openModal(+c.dataset.id); });
  }

  /* ---------------- Realtime ---------------- */
  function setupRealtime() {
    if (!sb) return;
    try {
      sb.channel("forum-c").on("postgres_changes", { event: "INSERT", schema: "public", table: "forum_comments" }, () => { if (currentPostId) openPost(currentPostId); }).subscribe();
      sb.channel("anime-c").on("postgres_changes", { event: "INSERT", schema: "public", table: "anime_comments" }, (p) => { if (currentAnimeId && p.new.anime_id === currentAnimeId) openAnimeDiscussion(currentAnimeId); }).subscribe();
    } catch (e) { console.warn("realtime 订阅失败", e); }
  }

  /* ---------------- 导出 ---------------- */
  window.Community = { init, isAuthed, openIdentity, renderCollectBox, renderMine, onModalOpen, renderForum, openReviewComposer };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
