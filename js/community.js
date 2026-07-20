/* ============================================================
 * 番组计划 · Animi — 社区模块（Supabase）
 * 功能：邮箱+密码注册登录 / UID（注册顺序） / 等级 Lv1-Lv6 + 每日签到经验 /
 *       每部动画讨论(A, 支持楼中楼回复) / 论坛发帖评论(B) / 共享收藏评分 / 社区番剧评价聚合
 * 前端仅使用 anon public key（可公开），配合 RLS 安全策略。
 * 注意：SUPABASE_ANON_KEY 占位符需由部署时填入真实 anon key。
 * ============================================================ */
(function () {
  const SUPABASE_URL = window.APP_CONFIG.PROXY_BASE; // 经反代（国内镜像请改为国内可直连地址，见 js/config.js）
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3cm5ucm93YnFpZG5tc2t2ZW1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5ODM5MDIsImV4cCI6MjA5OTU1OTkwMn0.p3PqDi-blR-BEsmowy9QMfTuxpNggBmkqdh-P1Jchyc";

  const STATUS = { want: "想看", doing: "在看", done: "看过", hold: "搁置", drop: "抛弃" };
  const STATUS_ORDER = ["want", "doing", "done", "hold", "drop"];
  const STAR = "★";

  /* ---------------- 等级配置 ---------------- */
  // 等级：每 200 EXP 升 1 级，线性、无上限（exp 0→Lv1，200→Lv2，400→Lv3 …）
  const EXP_PER_LEVEL = 200;
  // 社区互动经验：每次互动 +10 EXP，单日上限 50 EXP（约 5 次/天）。
  // 上限为【账号级】，累计值存 profiles.interact_exp / interact_date，跨天自动归零（列由 supabase/add_interact_cap.sql 提供）
  const INTERACT_EXP = 10;
  const INTERACT_DAILY_CAP = 50;
  function levelInfo(exp) {
    exp = exp || 0;
    const lv = Math.floor(exp / EXP_PER_LEVEL) + 1;
    const start = (lv - 1) * EXP_PER_LEVEL;
    const next = lv * EXP_PER_LEVEL;
    const pct = Math.max(0, Math.min(100, Math.round((exp - start) / (next - start) * 100)));
    return { lv, start, next, pct, max: false, exp };
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
  // 可点击跳转用户主页的包裹（头像/昵称用）：点开对方的「我的」
  const uLink = (inner, id) => `<span class="u-link" data-uid="${esc(id)}">${inner}</span>`;
  // 管理员判定：站长 / 管理员 可删除所有人内容（role 或 extra_role 任一命中即可，支持双身份）
  const isAdmin = () => {
    if (!USER || !USER.profile) return false;
    const r = USER.profile.role, e = USER.profile.extra_role;
    return r === "站长" || r === "管理员" || e === "站长" || e === "管理员";
  };
  // 仅站长（不含管理员）：用于「站长推荐视频」这类只授权站长本人的编辑入口
  const isWebmaster = () => {
    if (!USER || !USER.profile) return false;
    const r = USER.profile.role, e = USER.profile.extra_role;
    return r === "站长" || e === "站长";
  };
  // 用户称号（如「站长」「管理员」），数据来自 profiles.role / extra_role（支持同时显示两个徽章）
  const ROLE_CLASS = { "站长": "role-owner", "管理员": "role-admin", "编辑": "role-editor" };
  const roleBadge = (r) => {
    if (!r) return "";
    const cls = ROLE_CLASS[r] || "role-custom";
    return `<span class="role-badge ${cls}">${esc(r)}</span>`;
  };
  const roleTag = (profile) => {
    if (!profile) return "";
    // 主身份 + 副身份（去重），依次渲染，实现「站长 + 管理员」双徽章
    const roles = [profile.role, profile.extra_role].filter((r, i, arr) => r && arr.indexOf(r) === i);
    return roles.map(roleBadge).join("");
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
    try { sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); window.Community.sb = sb; }
    catch (e) { console.warn("Supabase 初始化失败", e); return; }
    bindCommunityUI();
    setupRealtime();
    await ensureSession();
    // 登录态（含 role 身份）加载完成后，补订阅私信通道 + 重新渲染首页公告栏，
    // 确保站长/管理员能在身份就绪后看到「编辑」按钮
    setupRealtime();
    setupAnnounceLayout();
    renderAnnouncement(document.getElementById("announce-panel"));
    // 登录 / 登出时同步刷新公告栏的编辑权限与实时通道
    try {
      sb.auth.onAuthStateChange(() => {
        setupRealtime();
        renderAnnouncement(document.getElementById("announce-panel"));
      });
    } catch (e) { /* 忽略 */ }    if ($("#view-community") && !$("#view-community").classList.contains("hidden")) renderForum();
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
    refreshMsgDot();   // 登录态变化后刷新私信红点 / 图标显隐
  }

  /* ---------------- 身份入口（未登录=登录注册；已登录=资料） ---------------- */
  function openIdentity() {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    if (!USER) { openAuth(mask, modal); return; }
    openProfile(USER.id, mask, modal);
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
      <div class="cb-row au-name-row" style="display:none"><span class="cb-label">昵称</span>
        <input id="au-name" class="auth-input" type="text" placeholder="设置昵称（注册后可在资料修改）" maxlength="20"/></div>
      <div class="auth-err" id="au-err"></div>
      <button class="btn btn-primary" id="au-submit" style="width:100%;justify-content:center">登录</button>
      <div class="auth-hint">注册即获得 UID（按注册顺序分配），密码仅作演示用途，请使用真实邮箱以便找回。</div>`;
    $("#comm-close").onclick = closeComm;
    $$(".auth-tab", modal).forEach(t => t.onclick = () => {
      $$(".auth-tab", modal).forEach(x => x.classList.remove("active")); t.classList.add("active");
      $("#au-submit").textContent = t.dataset.tab === "login" ? "登录" : "注册";
      const nr = $(".au-name-row", modal); if (nr) nr.style.display = t.dataset.tab === "register" ? "" : "none";
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
        // 昵称：注册时必须填写，且不可与已有用户重名
        const name = ($("#au-name") ? $("#au-name").value.trim() : "");
        if (name.length < 2) { err.textContent = "请设置至少 2 个字的昵称"; return; }
        try {
          const { data: taken, error: rpcErr } = await sb.rpc("username_taken", { p_name: name });
          if (!rpcErr && taken) { err.textContent = "昵称已被使用，请换一个"; return; }
        } catch (_) { /* 后端尚未就绪则放行，由唯一约束兜底 */ }
        // 防重复注册：注册前先查该邮箱是否已存在（需 SQL 已部署 email_taken + profiles.email 唯一约束）
        try {
          const { data: taken, error: rpcErr } = await sb.rpc("email_taken", { p_email: email });
          if (!rpcErr && taken) { err.textContent = "该邮箱已注册，请直接登录"; return; }
        } catch (_) { /* 后端尚未就绪则放行，由唯一约束兜底 */ }
        const { data, error } = await sb.auth.signUp({ email, password: pass });
        if (error) { err.textContent = "注册失败：" + error.message; return; }
        if (data.session) {
          USER = data.session.user;
          await ensureProfile();
          // 用用户自选昵称覆盖默认生成的昵称（唯一约束兜底防重名）
          try { await sb.from("profiles").update({ username: name }).eq("id", USER.id); } catch (_) {}
          await ensureProfile(); renderUserChip(); closeComm(); toast("注册成功，已登录");
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
    const newExp = (p.exp || 0) + 20;
    const beforeLv = levelInfo(p.exp || 0).lv;
    const newLv = levelInfo(newExp).lv;
    const { error } = await sb.from("profiles").update({ exp: newExp, level: newLv, last_checkin: today }).eq("id", USER.id);
    if (error) { toast("签到失败：" + error.message); return; }
    p.exp = newExp; p.level = newLv; p.last_checkin = today;
    renderUserChip();
    openProfile(USER.id, $("#comm-mask"), $("#comm-modal"));
    toast(newLv > beforeLv ? "签到成功！升级到 Lv" + newLv + " 🎉" : "签到成功！EXP +20");
  }

  // 社区互动（评论/点赞/发帖等）每次 +10 EXP，单日上限 50 EXP（账号级）；达上限不再加并提示
  async function awardExp() {
    if (!USER || !USER.profile) return;
    const today = todayStr();
    const before = USER.profile.level;
    let daily = USER.profile.interact_exp || 0;
    if ((USER.profile.interact_date || "") !== today) daily = 0; // 跨天：当日累计经验归零
    if (daily >= INTERACT_DAILY_CAP) {
      toast("今日社区互动经验已封顶（50 EXP）"); return;
    }
    const gain = INTERACT_EXP;
    const newExp = (USER.profile.exp || 0) + gain;
    const newLv = levelInfo(newExp).lv;
    const newDaily = daily + gain;
    const { error: e1 } = await sb.from("profiles").update({ exp: newExp, level: newLv }).eq("id", USER.id);
    if (e1) { toast("经验更新失败：" + e1.message); return; }
    USER.profile.exp = newExp; USER.profile.level = newLv;
    // 账号级单日上限：列由 supabase/add_interact_cap.sql 提供；未执行时这两列不存在，静默跳过（仅无上限，不影响经验发放）
    if (USER.profile.interact_date !== undefined || USER.profile.interact_exp !== undefined) {
      const { error: e2 } = await sb.from("profiles").update({ interact_exp: newDaily, interact_date: today }).eq("id", USER.id);
      if (!e2) { USER.profile.interact_exp = newDaily; USER.profile.interact_date = today; }
    }
    renderUserChip();
    toast(newLv > before ? "升级到 Lv" + newLv + " 🎉" : "社区互动 +10 EXP");
  }

  // 关注 / 粉丝 / 隐藏主页 相关
  async function openProfile(targetId, mask, modal) {
    mask = mask || $("#comm-mask"); modal = modal || $("#comm-modal");
    if (!targetId && !USER) { openAuth(mask, modal); return; }
    const tid = targetId || (USER && USER.id);
    if (!tid) { openAuth(mask, modal); return; }
    const isSelf = USER && tid === USER.id;

    const { data: tp, error } = await sb.from("profiles").select("*").eq("id", tid).single();
    if (error || !tp) {
      modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="err">用户不存在或已注销</div>`;
      $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden"; return;
    }

    // 关注统计 + 是否已关注
    let cntFollowing = 0, cntFollowers = 0, following = false;
    try {
      const [a, b] = await Promise.all([
        sb.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", tid),
        sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", tid)
      ]);
      cntFollowing = a.count || 0; cntFollowers = b.count || 0;
    } catch (_) {}
    if (USER && !isSelf) {
      const { data: fr } = await sb.from("follows").select("follower_id").eq("follower_id", USER.id).eq("following_id", tid).maybeSingle();
      following = !!fr;
    }

    const p = tp;
    const li = levelInfo(p.exp);
    const av = avatarHTML(p, tid, "lg");
    const signed = p.last_checkin === todayStr();
    const statsRow = `<div class="follow-stats">
        <button class="fs-item" id="fs-following"><b>${cntFollowing}</b><span>关注</span></button>
        <button class="fs-item" id="fs-followers"><b>${cntFollowers}</b><span>粉丝</span></button>
      </div>`;
    const _pt = window.__profileTab || "collect";
    const tabsHTML = `<div class="mine-tabs profile-tabs" id="profile-tabs">
        <button class="mine-tab ${_pt === "collect" ? "active" : ""}" data-mt="collect">收藏</button>
        <button class="mine-tab ${_pt === "reviews" ? "active" : ""}" data-mt="reviews">番剧评价</button>
        <button class="mine-tab ${_pt === "posts" ? "active" : ""}" data-mt="posts">论坛帖子</button>
      </div>`;

    // ---- 隐藏主页：非本人访问且 is_hidden → 仅展示占位 ----
    if (!isSelf && p.is_hidden) {
      modal.innerHTML = `
        <button class="modal-close" id="comm-close">✕</button>
        <div class="comm-title">用户资料</div>
        <div class="id-card">
          <div class="avatar-prev">${avatarHTML(p, tid, "lg")}</div>
          <div class="uid-line">${esc(p.username || "用户")}${roleTag(p)}</div>
          <div class="hidden-state">🔒 该用户已隐藏主页</div>
        </div>`;
      $("#comm-close").onclick = closeComm;
      mask.classList.add("open"); document.body.style.overflow = "hidden"; return;
    }

    // ---- 他人主页（只读）----
    if (!isSelf) {
      modal.innerHTML = `
        <button class="modal-close" id="comm-close">✕</button>
        <div class="comm-title">${esc(p.username || "用户")} 的资料</div>
        <div class="id-card">
          <div class="avatar-prev">${av}</div>
          <div class="uid-line">UID：<b>${p.uid != null ? p.uid : "—"}</b>${roleTag(p)}</div>
          ${statsRow}
          <div class="profile-actions">
            ${following
              ? `<button class="btn btn-ghost" id="follow-btn">✓ 已关注</button><button class="btn btn-unfollow" id="unfollow-btn">取消关注</button>`
              : `<button class="btn btn-primary" id="follow-btn">＋ 关注</button>`}
            <button class="btn btn-ghost" id="dm-btn">✉ 私信</button>
          </div>
        </div>
        ${tabsHTML}
        <div id="profile-content" class="profile-content"></div>`;
      $("#comm-close").onclick = closeComm;
      $("#follow-btn").onclick = () => toggleFollow(tid);
      const _ub = $("#unfollow-btn"); if (_ub) _ub.onclick = () => toggleFollow(tid);
      $("#dm-btn").onclick = () => {
        if (!USER) { openIdentity(); return; }
        openDMThread(tid, () => openProfile(tid, mask, modal));
      };
      $("#fs-following").onclick = () => openFollowList("following", tid);
      $("#fs-followers").onclick = () => openFollowList("followers", tid);
      bindProfileTabs(tid, false, $("#profile-content"));
      renderProfileContent(window.__profileTab || "collect", tid, false, $("#profile-content"));
      mask.classList.add("open"); document.body.style.overflow = "hidden"; return;
    }

    // ---- 本人主页（可编辑 + 隐藏开关）----
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
        ${statsRow}
        <div class="lv-line">
          <span class="lv-badge">Lv${li.lv}</span>
          <span class="lv-exp">${li.max ? "EXP " + li.exp : "EXP " + li.exp + " / " + li.next}</span>
        </div>
        <div class="exp-bar"><div class="exp-fill" style="width:${li.pct}%"></div></div>
        <button class="btn btn-primary" id="checkin-btn" style="width:100%;justify-content:center;margin-top:10px">${signed ? "今日已签到 ✓" : "每日签到 +20 EXP"}</button>
        <div class="cb-row" style="margin-top:12px"><span class="cb-label">昵称</span>
          <input id="id-name" class="auth-input" value="${esc(p.username || "")}" placeholder="给自己起个名字" maxlength="20"/></div>
        <div class="cb-row"><span class="cb-label">简介</span>
          <textarea id="id-bio" class="cb-textarea" placeholder="一句话介绍自己（选填）" maxlength="120" style="min-height:60px">${esc(p.bio || "")}</textarea></div>
        <div class="auth-err" id="id-err"></div>
        <button class="btn btn-primary" id="id-save" style="width:100%;justify-content:center">保存资料</button>
        <label class="hide-toggle"><input type="checkbox" id="hide-profile" ${p.is_hidden ? "checked" : ""}/> 隐藏我的主页（仅自己可见）</label>
        <button class="btn btn-ghost" id="id-logout" style="width:100%;justify-content:center;margin-top:8px">退出登录</button>
      </div>
      ${tabsHTML}
      <div id="profile-content" class="profile-content"></div>`;
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
    $("#fs-following").onclick = () => openFollowList("following", tid);
    $("#fs-followers").onclick = () => openFollowList("followers", tid);
    $("#id-save").onclick = async () => {
      const v = $("#id-name").value.trim();
      const bioVal = $("#id-bio").value.trim();
      const file = $("#avatar-file").files[0];
      const cur = (USER.profile && USER.profile.username) || "";
      // 改名且昵称与现有不同时，先查重（防重名）
      if (v && v !== cur) {
        try {
          const { data: taken } = await sb.rpc("username_taken", { p_name: v, p_self: USER.id });
          if (taken) { $("#id-err").textContent = "昵称已被使用，请换一个"; return; }
        } catch (_) { /* 后端未就绪则交由唯一约束兜底 */ }
      }
      const { error } = await sb.from("profiles").update({ username: v || cur }).eq("id", USER.id);
      if (error) { $("#id-err").textContent = "保存失败：" + error.message; return; }
      if (file || bioVal !== (p.bio || "")) {
        try {
          const patch = { bio: bioVal };
          if (file) patch.avatar_url = await uploadAvatar(file);
          const { error: e2 } = await sb.from("profiles").update(patch).eq("id", USER.id);
          if (e2) $("#id-err").textContent = "昵称已保存；头像/简介需先在 Supabase 执行最新建表 SQL（含 storage 头像桶）。";
        } catch (e) { $("#id-err").textContent = "头像上传失败：" + e.message; }
      }
      await ensureProfile(); renderUserChip(); openProfile(USER.id, mask, modal); toast("已更新资料");
    };
    $("#hide-profile").onchange = async () => {
      const hide = $("#hide-profile").checked;
      const { error } = await sb.from("profiles").update({ is_hidden: hide }).eq("id", USER.id);
      if (error) { toast("设置失败：" + error.message); $("#hide-profile").checked = !hide; return; }
      if (USER.profile) USER.profile.is_hidden = hide;
      toast(hide ? "已隐藏主页，仅自己可见" : "已公开主页");
    };
    $("#id-logout").onclick = async () => {
      await sb.auth.signOut(); USER = null; renderUserChip(); closeComm(); toast("已退出登录");
    };
    bindProfileTabs(tid, true, $("#profile-content"));
    renderProfileContent(window.__profileTab || "collect", tid, true, $("#profile-content"));
    mask.classList.add("open"); document.body.style.overflow = "hidden";
  }

  // 关注 / 取消关注
  async function toggleFollow(targetId) {
    if (!USER) { openIdentity(); return; }
    const btn = $("#follow-btn");
    const { data: ex } = await sb.from("follows").select("follower_id").eq("follower_id", USER.id).eq("following_id", targetId).maybeSingle();
    if (ex) {
      const { error } = await sb.from("follows").delete().eq("follower_id", USER.id).eq("following_id", targetId);
      if (error) { toast("操作失败：" + error.message); return; }
      toast("已取消关注");
    } else {
      const { error } = await sb.from("follows").insert({ follower_id: USER.id, following_id: targetId });
      if (error) { toast("操作失败：" + error.message); return; }
      toast("已关注");
    }
    openProfile(targetId, $("#comm-mask"), $("#comm-modal"));
  }

  // 关注 / 粉丝 列表弹窗
  async function openFollowList(kind, id) {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    const title = kind === "following" ? "关注" : "粉丝";
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="comm-title">${title}</div><div class="loading">加载中…</div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    let ids = [];
    try {
      if (kind === "following") {
        const { data } = await sb.from("follows").select("following_id").eq("follower_id", id);
        ids = (data || []).map(r => r.following_id);
      } else {
        const { data } = await sb.from("follows").select("follower_id").eq("following_id", id);
        ids = (data || []).map(r => r.follower_id);
      }
    } catch (e) { modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="comm-title">${title}</div><div class="err">加载失败</div>`; $("#comm-close").onclick = closeComm; return; }
    if (!ids.length) {
      modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="comm-title">${title}</div><div class="empty">${kind === "following" ? "还没有关注任何人" : "还没有粉丝"}</div>`;
      $("#comm-close").onclick = closeComm; return;
    }
    const names = await fetchNames(ids);
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">${title} ${ids.length}</div>
      <div class="follow-list">${ids.map(uid => `
        <div class="follow-row u-link" data-uid="${uid}">
          ${avatarHTML(names[uid], uid, "sm")}
          <span class="follow-name">${esc((names[uid] && names[uid].username) || "用户")}</span>
          ${roleTag(names[uid])}${uidTag(names[uid])}
        </div>`).join("")}</div>`;
    $("#comm-close").onclick = closeComm;
  }

  function bindProfileTabs(targetId, isSelf, host) {
    const tabs = $("#profile-tabs"); if (!tabs || !host) return;
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".mine-tab"); if (!b) return;
      $$(".mine-tab", tabs).forEach(x => x.classList.remove("active")); b.classList.add("active");
      window.__profileTab = b.dataset.mt;
      renderProfileContent(b.dataset.mt, targetId, isSelf, host);
    });
  }

  async function renderProfileContent(tab, targetId, isSelf, host) {
    if (tab === "reviews") return renderProfileReviews(targetId, isSelf, host);
    if (tab === "posts") return renderProfilePosts(targetId, isSelf, host);
    return renderProfileCollections(targetId, isSelf, host);
  }

  async function renderProfileCollections(targetId, isSelf, host) {
    host.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("collections").select("*").eq("user_id", targetId);
    if (error) { host.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    let list = (data || []).map(c => ({ a: window.ANIME_DATA.find(x => x.id === c.anime_id), c })).filter(x => x.a);
    list.sort((x, y) => new Date(y.c.created_at) - new Date(x.c.created_at));
    if (!list.length) { host.innerHTML = `<div class="empty">${isSelf ? "还没有收藏任何番剧。" : "TA 还没有收藏。"}</div>`; return; }
    host.innerHTML = `<div class="mine-grid">${list.map(x => mineCardHTML(x.a, x.c)).join("")}</div>`;
    host.querySelectorAll(".anime-card").forEach(card => card.onclick = () => openAnimeDetail(card.dataset.id));
  }

  async function renderProfileReviews(targetId, isSelf, host) {
    host.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("anime_comments")
      .select("id,anime_id,body,created_at,images,parent_id").eq("user_id", targetId).is("parent_id", null)
      .order("created_at", { ascending: false }).limit(100);
    if (error) { host.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { host.innerHTML = `<div class="empty">${isSelf ? "还没有发表评价。" : "TA 还没有评价。"}</div>`; return; }
    const animeIds = [...new Set(data.map(c => c.anime_id))];
    const { data: colls } = await sb.from("collections").select("anime_id,rating").in("anime_id", animeIds).eq("user_id", targetId);
    const ratings = {}; (colls || []).forEach(x => { if (x.rating) ratings[x.anime_id] = x.rating; });
    host.innerHTML = `<div class="mine-posts">${data.map(c => {
      const a = window.ANIME_DATA.find(x => x.id === c.anime_id);
      const rt = ratings[c.anime_id];
      const stars = rt ? "★".repeat(rt) + "☆".repeat(10 - rt) : "";
      return `<div class="post-card mine-post" data-anime="${c.anime_id}">
        <div class="post-main">
          <div class="post-title">📺 ${esc(a ? a.title : "未知番剧")}</div>
          ${c.body ? `<div class="post-body">${esc(c.body)}</div>` : ""}
          ${imagesHTML(c.images)}
          <div class="post-meta"><span class="c-time">${timeAgo(c.created_at)}</span></div>
        </div>
        ${(isSelf || isAdmin()) ? `<button class="post-del" data-del-rev="${c.id}">删除</button>` : ""}
      </div>`;
    }).join("")}</div>`;
    host.querySelectorAll(".mine-post[data-anime]").forEach(card => card.onclick = (e) => { if (e.target.closest(".post-del")) return; openAnimeDetail(card.dataset.anime); });
    if (isSelf || isAdmin()) host.querySelectorAll("[data-del-rev]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除这条番剧评论？其下的回复也会一并删除。")) return;
      const { error } = await sb.from("anime_comments").delete().eq("id", b.dataset.delRev);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); renderProfileReviews(targetId, isSelf, host);
    });
  }

  async function renderProfilePosts(targetId, isSelf, host) {
    host.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("forum_posts").select("id,title,body,created_at").eq("user_id", targetId).order("created_at", { ascending: false }).limit(100);
    if (error) { host.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { host.innerHTML = `<div class="empty">${isSelf ? "还没有发过帖子。" : "TA 还没有发帖。"}</div>`; return; }
    host.innerHTML = `<div class="mine-posts">${data.map(p => `
      <div class="post-card mine-post" data-id="${p.id}">
        <div class="post-main">
          <div class="post-title">${esc(p.title)}</div>
          <div class="post-body">${esc(p.body)}</div>
          <div class="post-meta"><span class="c-time">${timeAgo(p.created_at)}</span></div>
        </div>
        ${(isSelf || isAdmin()) ? `<button class="post-del" data-del-post="${p.id}">删除</button>` : ""}
      </div>`).join("")}</div>`;
    host.querySelectorAll(".mine-post[data-id]").forEach(card => card.onclick = () => openPost(card.dataset.id));
    if (isSelf || isAdmin()) host.querySelectorAll("[data-del-post]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除这条论坛帖子？")) return;
      const { error } = await sb.from("forum_posts").delete().eq("id", b.dataset.delPost);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); renderProfilePosts(targetId, isSelf, host);
    });
  }
  function closeComm() { const m = $("#comm-mask"); if (m) m.classList.remove("open"); document.body.style.overflow = ""; }

  // 统一打开番剧详情：先关掉社区弹窗 + 详情弹窗，避免层级遮挡
  function openAnimeDetail(id) {
    if (typeof id !== "number") id = +id;
    const dm = $("#modal-mask"); if (dm) dm.classList.remove("open");
    closeComm();
    if (window.openModal) window.openModal(id);
  }

  /* ---------------- UI 绑定 ---------------- */
  function bindCommunityUI() {
    const mask = $("#comm-mask");
    if (mask) mask.addEventListener("click", (e) => { if (e.target.id === "comm-mask") closeComm(); });
    const np = $("#new-post-btn"); if (np) np.onclick = () => { if (!USER) { openIdentity(); return; } composePost(); };
    const mi = $("#msg-icon"); if (mi) mi.onclick = () => openDMInbox();   // 私信入口（未登录时 hidden）
    const tabs = $("#comm-tabs");
    if (tabs) tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".comm-tab"); if (!b) return;
      $$(".comm-tab", tabs).forEach(x => x.classList.remove("active")); b.classList.add("active");
      const t = b.dataset.tab;
      $("#forum-list").classList.toggle("hidden", t !== "forum");
      $("#comm-hot").classList.toggle("hidden", t !== "hot");
      $("#comm-anime").classList.toggle("hidden", t !== "anime");
      const fsb = $("#forum-sort"); if (fsb) fsb.hidden = (t !== "forum");
      if (t === "forum") renderForum();
      else if (t === "hot") renderHot();
      else renderAnimeReviews();
    });
    const fs = $("#forum-sort");
    if (fs) fs.addEventListener("click", (e) => {
      const b = e.target.closest(".sort-chip"); if (!b) return;
      forumSort = b.dataset.sort;
      $$(".sort-chip", fs).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      renderForum();
    });
    document.addEventListener("click", (e) => {
      const it = e.target.closest("#mine-grid .anime-card");
      if (it) openAnimeDetail(it.dataset.id);
    });
    // 头像 / 昵称点击进入对方主页（capture 阶段优先处理，避免触发外层卡片的点击）
    document.addEventListener("click", (e) => {
      const ul = e.target.closest(".u-link");
      if (ul && ul.dataset.uid) { e.stopPropagation(); openProfile(ul.dataset.uid); }
    }, true);
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
  /* ---------------- 点赞 / 置顶 辅助 ---------------- */
  let forumSort = "new";
  async function myForumLikeSet(postIds) {
    const s = new Set();
    if (!USER || !postIds.length) return s;
    const { data } = await sb.from("forum_likes").select("post_id").in("post_id", postIds);
    (data || []).forEach(r => s.add(r.post_id));
    return s;
  }
  async function myAnimeLikeSet(commentIds) {
    const s = new Set();
    if (!USER || !commentIds.length) return s;
    const { data } = await sb.from("anime_comment_likes").select("comment_id").in("comment_id", commentIds);
    (data || []).forEach(r => s.add(r.comment_id));
    return s;
  }
  async function toggleForumLike(postId, btn) {
    if (!USER) { openIdentity(); return; }
    const liked = btn.classList.contains("liked");
    btn.disabled = true;
    try {
      if (liked) {
        const { error } = await sb.from("forum_likes").delete().eq("post_id", postId).eq("user_id", USER.id);
        if (error) { toast("操作失败：" + error.message); return; }
      } else {
        const { error } = await sb.from("forum_likes").insert({ post_id: postId, user_id: USER.id });
        if (error) { toast("操作失败：" + error.message); return; }
        await awardExp();
      }
      const n = (parseInt(btn.dataset.n || "0", 10)) + (liked ? -1 : 1);
      btn.dataset.n = n;
      btn.classList.toggle("liked", !liked);
      btn.querySelector(".lk-count").textContent = n;
    } finally { btn.disabled = false; }
  }
  async function toggleAnimeLike(commentId, btn) {
    if (!USER) { openIdentity(); return; }
    const liked = btn.classList.contains("liked");
    btn.disabled = true;
    try {
      if (liked) {
        const { error } = await sb.from("anime_comment_likes").delete().eq("comment_id", commentId).eq("user_id", USER.id);
        if (error) { toast("操作失败：" + error.message); return; }
      } else {
        const { error } = await sb.from("anime_comment_likes").insert({ comment_id: commentId, user_id: USER.id });
        if (error) { toast("操作失败：" + error.message); return; }
        await awardExp();
      }
      const n = (parseInt(btn.dataset.n || "0", 10)) + (liked ? -1 : 1);
      btn.dataset.n = n;
      btn.classList.toggle("liked", !liked);
      btn.querySelector(".lk-count").textContent = n;
    } finally { btn.disabled = false; }
  }
  async function setPin(postId, pin) {
    const { error } = await sb.rpc("set_post_pin", { p_post: postId, p_pin: pin });
    if (error) { toast("置顶失败：" + error.message); return false; }
    return true;
  }

  async function renderForum() {
    const wrap = $("#forum-list"); if (!wrap) return;
    const sortBar = $("#forum-sort"); if (sortBar) sortBar.hidden = false;
    if (!sb) { wrap.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    if (!USER) {
      wrap.innerHTML = `<div class="empty">登录后即可发帖交流。<button class="btn btn-primary" id="forum-login" style="margin-top:10px;padding:8px 18px">登录 / 注册</button></div>`;
      const b = $("#forum-login", wrap); if (b) b.onclick = openIdentity; return;
    }
    wrap.innerHTML = `<div class="loading">加载中…</div>`;
    const { data, error } = await sb.from("forum_posts").select("id,title,body,created_at,user_id,views,images,like_count,is_pinned,videos").order("created_at", { ascending: false }).limit(50);
    if (error) { wrap.innerHTML = `<div class="err">加载失败：${esc(error.message)}</div>`; return; }
    if (!data || !data.length) { wrap.innerHTML = `<div class="empty">还没有帖子，点右上角「＋ 发帖」抢沙发吧～</div>`; return; }
    const ids = [...new Set(data.map(p => p.user_id))];
    const names = await fetchNames(ids);
    const { data: cs } = await sb.from("forum_comments").select("post_id").in("post_id", ids);
    const cnt = {}; (cs || []).forEach(c => cnt[c.post_id] = (cnt[c.post_id] || 0) + 1);
    const myLikes = await myForumLikeSet(data.map(p => p.id));
    // 排序：置顶优先，再按模式（最新=发布时间倒序 / 最热=点赞数*5+观看数 综合）
    const sorted = data.slice().sort((a, b) => {
      const pa = a.is_pinned ? 1 : 0, pb = b.is_pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      if (forumSort === "hot") {
        const sa = (a.like_count || 0) * 5 + (a.views || 0);
        const sb2 = (b.like_count || 0) * 5 + (b.views || 0);
        if (sb2 !== sa) return sb2 - sa;
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const canDel = (uid) => isAdmin() || (USER && USER.id === uid);
    const adm = isAdmin();
    wrap.innerHTML = sorted.map(p => `
      <div class="post-card" data-id="${p.id}">
        <div class="post-main">
          ${canDel(p.user_id) ? `<button class="post-del" data-del-post="${p.id}">删除</button>` : ""}
          ${p.is_pinned ? `<span class="pin-badge">📌 置顶</span>` : ""}
          <div class="post-title">${esc(p.title)}</div>
          <div class="post-body">${esc(p.body)}</div>
          ${imagesHTML(p.images)}
          ${videosHTML(p.videos)}
          <div class="post-meta">${uLink(`<span class="c-av">${avatarHTML(names[p.user_id], p.user_id, "xs")}</span>`, p.user_id)}<span class="u-link" data-uid="${p.user_id}">@${esc((names[p.user_id] && names[p.user_id].username) || "用户")}</span>${roleTag(names[p.user_id])}${uidTag(names[p.user_id])}<span>${timeAgo(p.created_at)}</span><span>👁 ${p.views || 0}</span><span>💬 ${cnt[p.id] || 0}</span></div>
          <div class="post-actions">
            <button class="like-btn ${myLikes.has(p.id) ? "liked" : ""}" data-pid="${p.id}" data-n="${p.like_count || 0}">❤️ <span class="lk-count">${p.like_count || 0}</span></button>
            ${adm ? `<button class="pin-btn" data-pid="${p.id}" data-pin="${p.is_pinned ? 1 : 0}">${p.is_pinned ? "取消置顶" : "置顶"}</button>` : ""}
          </div>
        </div>
      </div>`).join("");
    $$(".post-card", wrap).forEach(c => c.onclick = () => openPost(c.dataset.id));
    wrap.querySelectorAll(".post-video-cell").forEach(cell => cell.addEventListener("click", (e) => { e.stopPropagation(); openBiliPlayer(cell.dataset.bvid, cell.dataset.title); }));
    wrap.querySelectorAll(".post-video-cell").forEach(cell => cell.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); openBiliPlayer(cell.dataset.bvid, cell.dataset.title); } }));
    wrap.querySelectorAll(".like-btn").forEach(b => b.onclick = (e) => { e.stopPropagation(); toggleForumLike(b.dataset.pid, b); });
    wrap.querySelectorAll(".pin-btn").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const ok = await setPin(b.dataset.pid, b.dataset.pin !== "1");
      if (ok) renderForum();
    });
    wrap.querySelectorAll("[data-del-post]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("确定删除这条论坛帖子？")) return;
      const { error } = await sb.from("forum_posts").delete().eq("id", b.dataset.delPost);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); renderForum();
    });
  }

  async function fetchNames(ids) {
    if (!ids.length) return {};
    const { data } = await sb.from("profiles").select("id,username,avatar_url,uid,role,extra_role").in("id", ids);
    const m = {}; (data || []).forEach(u => m[u.id] = u); return m;
  }

  async function openPost(id) {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="loading">加载中…</div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const { data: post } = await sb.from("forum_posts").select("title,body,created_at,user_id,views,images,like_count,is_pinned,videos").eq("id", id).single();
    if (!post) { modal.innerHTML = `<div class="err">帖子不存在</div>`; return; }
    const { data: vres } = await sb.rpc("inc_post_view", { p_id: id });
    const views = (vres && vres[0] && vres[0].inc_post_view) || post.views || 0;
    let liked = false;
    if (USER) { const { data: mylk } = await sb.from("forum_likes").select("post_id").eq("post_id", id).eq("user_id", USER.id).maybeSingle(); liked = !!mylk; }
    const names = await fetchNames([post.user_id]);
    const { data: comments } = await sb.from("forum_comments").select("id,body,created_at,user_id,images").eq("post_id", id).order("created_at", { ascending: true });
    currentPostId = id;
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-post">
        <div class="comm-post-head">
          <div class="post-title">${esc(post.title)} ${post.is_pinned ? '<span class="pin-badge">📌 置顶</span>' : ''}</div>
          ${(isAdmin() || (USER && USER.id === post.user_id)) ? `<button class="post-del" id="post-del-btn">删除</button>` : ""}
          ${isAdmin() ? `<button class="pin-btn" id="post-pin" data-pin="${post.is_pinned ? 1 : 0}">${post.is_pinned ? "取消置顶" : "置顶"}</button>` : ""}
        </div>
        <div class="post-body" style="white-space:pre-wrap">${esc(post.body)}</div>
        ${imagesHTML(post.images)}
        ${videosHTML(post.videos)}
        <div class="post-meta">${uLink(`<span class="c-av">${avatarHTML(names[post.user_id], post.user_id, "xs")}</span>`, post.user_id)}<span class="u-link" data-uid="${post.user_id}">@${esc((names[post.user_id] && names[post.user_id].username) || "用户")}</span>${roleTag(names[post.user_id])}${uidTag(names[post.user_id])}<span>${timeAgo(post.created_at)}</span><span>👁 ${views}</span></div>
        <div class="post-actions">
          <button class="like-btn ${liked ? "liked" : ""}" id="post-like" data-pid="${id}" data-n="${post.like_count || 0}">❤️ <span class="lk-count">${post.like_count || 0}</span></button>
        </div>
      </div>
      <div class="comm-divider">评论 ${comments ? comments.length : 0}</div>
      <div id="comment-list" class="comment-list">${comments && comments.length ? comments.map(c => commentHTML(c, names[c.user_id])).join("") : `<div class="empty">还没有评论</div>`}</div>
      <div class="comment-form">
        <textarea id="comment-input" class="cb-textarea" placeholder="${USER ? "说点什么…（支持插入图片）" : "登录后即可评论"}"></textarea>
        <div class="ac-thumbs" id="fc-thumbs"></div>
        <div class="ac-bar">
          <label class="ac-imgbtn" title="插入图片">🖼️ 图片
            <input type="file" id="fc-file" accept="image/*" multiple hidden>
          </label>
          <button class="btn btn-primary" id="comment-send" style="margin-left:auto;justify-content:center">${USER ? "发送" : "登录"}</button>
        </div>
      </div>`;
    $("#comm-close").onclick = closeComm;
    modal.querySelectorAll(".post-video-cell").forEach(cell => cell.addEventListener("click", () => openBiliPlayer(cell.dataset.bvid, cell.dataset.title)));
    modal.querySelectorAll(".post-video-cell").forEach(cell => cell.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBiliPlayer(cell.dataset.bvid, cell.dataset.title); } }));
    const likeBtn = $("#post-like"); if (likeBtn) likeBtn.onclick = () => toggleForumLike(id, likeBtn);
    const pinBtn = $("#post-pin"); if (pinBtn) pinBtn.onclick = async () => {
      const ok = await setPin(id, pinBtn.dataset.pin !== "1");
      if (ok) openPost(id);
    };
    const delBtn = $("#post-del-btn");
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm("确定删除这条论坛帖子？")) return;
      const { error } = await sb.from("forum_posts").delete().eq("id", id);
      if (error) { toast("删除失败：" + error.message); return; }
      toast("已删除"); closeComm(); renderForum();
    };
    const list = $("#comment-list");
    if (list) list.addEventListener("click", async (e) => {
      const b = e.target.closest(".c-del"); if (!b) return;
      await sb.from("forum_comments").delete().eq("id", b.dataset.id); openPost(id);
    });
    // 图片选择
    let fcImgs = [];
    const fcThumbs = $("#fc-thumbs"), fcFile = $("#fc-file");
    if (fcThumbs) {
      fcFile.addEventListener("change", () => {
        for (const f of [...(fcFile.files || [])]) {
          if (!f.type.startsWith("image/")) { toast("只能插入图片"); continue; }
          if (f.size > 5 * 1024 * 1024) { toast("单张图片不能超过 5MB"); continue; }
          if (fcImgs.length >= 6) { toast("最多插入 6 张图片"); break; }
          fcImgs.push(f);
        }
        fcFile.value = ""; fcThumbs.innerHTML = fcImgs.map((f, i) => `<div class="ac-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="ac-thumb-x" data-i="${i}">✕</button></div>`).join("");
        fcThumbs.querySelectorAll(".ac-thumb-x").forEach(b => b.onclick = () => { fcImgs.splice(+b.dataset.i, 1); fcThumbs.innerHTML = fcImgs.map((f, i) => `<div class="ac-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="ac-thumb-x" data-i="${i}">✕</button></div>`).join(""); });
      });
    }
    $("#comment-send").onclick = async () => {
      if (!USER) { openIdentity(); return; }
      const v = $("#comment-input").value.trim(); if (!v && !fcImgs.length) return;
      const btn = $("#comment-send"); btn.disabled = true; const oldTxt = btn.textContent;
      try {
        let imgUrls = [];
        if (fcImgs.length) { btn.textContent = "上传中…"; for (const f of fcImgs) imgUrls.push(await uploadCommentImage(f)); }
        const row = { post_id: id, user_id: USER.id, body: v };
        if (imgUrls.length) row.images = imgUrls;
        const { error } = await sb.from("forum_comments").insert(row);
        if (error) { toast("评论失败：" + error.message); return; }
        $("#comment-input").value = ""; fcImgs = []; if (fcThumbs) fcThumbs.innerHTML = ""; await awardExp(2); openPost(id);
      } catch (e) { toast("图片上传失败：" + (e.message || e)); }
      finally { btn.disabled = false; btn.textContent = oldTxt; }
    };
  }

  function composePost() {
    if (!USER) { openIdentity(); return; }
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `
      <button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">发帖</div>
      <input id="post-title" class="auth-input" placeholder="标题" maxlength="60"/>
      <textarea id="post-body" class="cb-textarea" placeholder="分享点什么…（支持插入图片与视频）" style="min-height:140px"></textarea>
      <div class="ac-thumbs" id="post-thumbs"></div>
      <div class="ac-bar">
        <label class="ac-imgbtn" title="插入图片">🖼️ 图片
          <input type="file" id="post-file" accept="image/*" multiple hidden>
        </label>
        <button type="button" class="ac-imgbtn" id="post-video-btn" title="插入 B站视频">🎬 视频</button>
        <span class="ac-vcount" id="post-vcount" style="font-size:12px;color:var(--text-faint)"></span>
      </div>
      <div class="auth-err" id="post-err"></div>
      <button class="btn btn-primary" id="post-send" style="width:100%;justify-content:center">发布</button>`;
    $("#comm-close").onclick = closeComm;
    // 视频选择逻辑（所有人可发，无权限限制）
    let pendingVideos = [];
    const vcount = $("#post-vcount"), videoBtn = $("#post-video-btn");
    function refreshVcount() { if (vcount) vcount.textContent = pendingVideos.length ? `已选 ${pendingVideos.length} 个视频` : ""; }
    if (videoBtn) videoBtn.onclick = () => openVideoPicker(pendingVideos, (list) => { pendingVideos = list; refreshVcount(); });
    // 图片选择逻辑
    let pendingImgs = [];
    const thumbsEl = $("#post-thumbs"), fileInput = $("#post-file");
    function renderThumbs() {
      thumbsEl.innerHTML = pendingImgs.map((f, i) =>
        `<div class="ac-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="ac-thumb-x" data-i="${i}">✕</button></div>`
      ).join("");
      thumbsEl.querySelectorAll(".ac-thumb-x").forEach(b => b.onclick = () => { pendingImgs.splice(+b.dataset.i, 1); renderThumbs(); });
    }
    fileInput.addEventListener("change", () => {
      for (const f of [...(fileInput.files || [])]) {
        if (!f.type.startsWith("image/")) { toast("只能插入图片"); continue; }
        if (f.size > 5 * 1024 * 1024) { toast("单张图片不能超过 5MB"); continue; }
        if (pendingImgs.length >= 6) { toast("最多插入 6 张图片"); break; }
        pendingImgs.push(f);
      }
      fileInput.value = ""; renderThumbs();
    });
    const sendBtn = $("#post-send");
    sendBtn.onclick = async () => {
      const title = $("#post-title").value.trim(), body = $("#post-body").value.trim();
      if (title.length < 2) { $("#post-err").textContent = "标题至少 2 个字"; return; }
      if (!body && !pendingImgs.length) { $("#post-err").textContent = "内容不能为空"; return; }
      sendBtn.disabled = true; const oldTxt = sendBtn.textContent;
      try {
        let imgUrls = [];
        if (pendingImgs.length) { sendBtn.textContent = "上传中…"; for (const f of pendingImgs) imgUrls.push(await uploadCommentImage(f)); }
        const row = { user_id: USER.id, title, body };
        if (imgUrls.length) row.images = imgUrls;
        if (pendingVideos.length) row.videos = pendingVideos;
        const { error } = await sb.from("forum_posts").insert(row);
        if (error) { $("#post-err").textContent = "发布失败：" + error.message; return; }
        await awardExp(); closeComm(); renderForum();
      } catch (e) {
        $("#post-err").textContent = "图片上传失败：" + (e.message || e);
      } finally { sendBtn.disabled = false; sendBtn.textContent = oldTxt; }
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
    // 管理员：本番可一键加入 / 移出「站长推荐」
    if (isAdmin()) {
      try {
        const { data } = await sb.from("recommendations").select("anime_id").eq("anime_id", a.id).maybeSingle();
        const inRec = !!data;
        const recBtn = document.createElement("button");
        recBtn.className = "btn btn-ghost";
        recBtn.style.cssText = "margin-top:10px;width:100%;justify-content:center";
        recBtn.textContent = inRec ? "★ 移出站长推荐" : "＋ 加入站长推荐";
        recBtn.onclick = async () => {
          if (!isAdmin()) return;
          if (inRec) {
            const { error } = await sb.from("recommendations").delete().eq("anime_id", a.id);
            if (error) { toast("操作失败：" + error.message); return; }
            recBtn.textContent = "＋ 加入站长推荐"; toast("已移出站长推荐");
          } else {
            const { error } = await sb.from("recommendations").insert({ anime_id: a.id, added_by: USER.id });
            if (error) { toast("操作失败：" + error.message); return; }
            recBtn.textContent = "★ 移出站长推荐"; toast("已加入站长推荐");
          }
          const host = $("#picks-grid"); if (host) renderOwnerPicks(host);
        };
        box.appendChild(recBtn);
      } catch (_) {}
    }
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
    const adm = isAdmin();
    const name = (profile && profile.username) || "用户";
    const replies = (c._replies || []).map(r => commentHTML(r, profile, depth + 1)).join("");
    return `<div class="comment-item${mine ? " mine" : ""}${depth ? " reply" : ""}">
      <div class="c-head">${uLink(`<span class="c-av">${avatarHTML(profile, c.user_id, "xs")}</span>`, c.user_id)}<span class="u-link" data-uid="${c.user_id}">@${esc(name)}</span>${roleTag(profile)}${uidTag(profile)}<span class="c-time">${timeAgo(c.created_at)}</span>${(mine || adm) ? `<button class="c-del" data-id="${c.id}">删除</button>` : ""}</div>
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
      await awardExp();
      openAnimeDiscussion(animeId, title);
      return true;
    });
    const list = $("#anime-comment-list");
    if (list) list.addEventListener("click", async (e) => {
      const del = e.target.closest(".c-del");
      if (del) { await sb.from("anime_comments").delete().eq("id", del.dataset.id); openAnimeDiscussion(animeId, title); return; }
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
        await awardExp();
        closeComm(); await renderAnimeReviews();
        return true;
      });
    }
    search.addEventListener("input", () => {
      const q = search.value.trim();
      if (!q) { results.innerHTML = ""; return; }
      const all = window.ANIME_DATA || [];
      const hit = all.filter(x => (x.title || "").toLowerCase().includes(q.toLowerCase())).slice(0, 20);
      results.innerHTML = hit.length
        ? hit.map(a => `<div class="rv-opt" data-id="${a.id}">
            <img class="rv-opt-cover" src="${esc(a.cover || "")}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <div class="rv-opt-info"><div class="rv-opt-title">${esc(a.title)}</div><div class="rv-opt-meta">${a.rating ? "★ " + a.rating : ""}${a.year ? (a.rating ? " · " : "") + a.year : ""}</div></div>
          </div>`).join("")
        : `<div class="empty" style="padding:14px">没找到匹配的番剧</div>`;
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
    const myLikes = await myAnimeLikeSet(data.map(c => c.id));
    // 取每部番的「我的评分」用于评价卡片展示评分
    const animeIds = [...new Set(data.map(c => c.anime_id))];
    const { data: colls } = await sb.from("collections").select("anime_id,rating").in("anime_id", animeIds);
    const ratings = {}; (colls || []).forEach(x => { if (x.rating) ratings[x.anime_id] = x.rating; });
    wrap.innerHTML = (USER ? `<button class="btn btn-primary" id="rv-new" style="padding:9px 20px;margin-bottom:12px">＋ 发评价（可带图）</button>` : "") + data.map(c => {
      const a = window.ANIME_DATA.find(x => x.id === c.anime_id);
      const prof = names[c.user_id]; const name = (prof && prof.username) || "用户";
      const rt = ratings[c.anime_id];
      const stars = rt ? "★".repeat(rt) + "☆".repeat(10 - rt) : "";
      const liked = myLikes.has(c.id);
      return `<div class="review-card" data-anime="${c.anime_id}">
        <div class="rv-head">${uLink(`<span class="c-av">${avatarHTML(prof, c.user_id, "xs")}</span>`, c.user_id)}<span class="u-link" data-uid="${c.user_id}">@${esc(name)}</span>${roleTag(prof)}${uidTag(prof)}<span class="c-time">${timeAgo(c.created_at)}</span></div>
        <div class="rv-anime">📺 ${esc(a ? a.title : "未知番剧")}</div>
        ${rt ? `<div class="rv-score">我的评分：<b style="color:#ffce3d">${stars}</b> ${rt}/10</div>` : ""}
        ${c.body ? `<div class="rv-body">${esc(c.body)}</div>` : ""}
        ${imagesHTML(c.images)}
        <div class="rv-actions">
          <button class="like-btn ${liked ? "liked" : ""}" data-cid="${c.id}" data-n="${c.like_count || 0}">❤️ <span class="lk-count">${c.like_count || 0}</span></button>
          <button class="rv-comment-btn" data-anime="${c.anime_id}" data-cid="${c.id}">💬 评论 (${a ? (a.title) : ""})</button>
        </div>
      </div>`;
    }).join("");
    $$(".review-card", wrap).forEach(card => {
      const lb = card.querySelector(".like-btn");
      if (lb) lb.onclick = (e) => { e.stopPropagation(); toggleAnimeLike(lb.dataset.cid, lb); };
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
      card.onclick = () => openAnimeDetail(card.dataset.anime);
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

  // 「我的观看进度」：记录每部动画看到第几集（UI 在详情页 collect-box 下方）
  async function renderEpisodeBox(a) {
    const box = $("#episode-box"); if (!box) return;
    if (!sb) { box.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    if (!USER) {
      box.innerHTML = `<div class="ep-login"><span>📺 登录后记录你看到了第几集</span>
        <button class="btn btn-primary" id="ep-login" style="padding:8px 16px">登录 / 注册</button></div>`;
      const b = $("#ep-login", box); if (b) b.onclick = () => openIdentity();
      return;
    }
    let row = null;
    try { const { data } = await sb.from("episode_progress").select("*").eq("user_id", USER.id).eq("anime_id", a.id).maybeSingle(); row = data; }
    catch (e) { /* 离线/被拦截：默认 0 */ }
    let watched = (row && row.watched != null) ? (+row.watched || 0) : 0;
    // 总集数：优先烘焙数据 a.episodes，其次已存 total
    let total = (a.episodes != null && !isNaN(+a.episodes) && +a.episodes > 0) ? +a.episodes
              : (row && row.total != null ? (+row.total || null) : null);
    const totalKnown = total != null && !isNaN(total) && total > 0;
    const pct = totalKnown ? Math.min(100, Math.round(watched / total * 100)) : 0;

    box.innerHTML = `
      <div class="ep-head">📺 我的观看进度</div>
      <div class="ep-controls">
        <button class="ep-step" id="ep-minus" aria-label="上一集">-</button>
        <div class="ep-count">
          <input type="number" id="ep-watched" class="ep-input" min="0" value="${watched}">
          <span class="ep-of">/ ${totalKnown ? `<span id="ep-total">${total}</span>` : `?`} 集</span>
        </div>
        <button class="ep-step" id="ep-plus" aria-label="下一集">+</button>
      </div>
      <div class="ep-bar"><div class="ep-bar-fill" id="ep-fill" style="width:${pct}%"></div></div>
      <div class="ep-actions">
        ${totalKnown ? `<button class="btn btn-ghost ep-btn" id="ep-done">标记看完</button>` : ``}
        <button class="btn btn-ghost ep-btn" id="ep-reset">重置</button>
        <span class="ep-status" id="ep-status"></span>
      </div>
      ${!totalKnown ? `<div class="ep-total-row">总集数：<input type="number" id="ep-total-input" class="ep-input-sm" min="1" placeholder="未知"> 集</div>` : ``}
    `;

    const wInput = $("#ep-watched", box);
    const fill = $("#ep-fill", box);
    const status = $("#ep-status", box);
    let saveTimer = null;
    const markDirty = () => { if (status) status.textContent = "未保存"; clearTimeout(saveTimer); saveTimer = setTimeout(save, 500); };
    const clamp = () => {
      let w = parseInt(wInput.value, 10); if (isNaN(w) || w < 0) w = 0;
      if (totalKnown && w > total) w = total;
      wInput.value = w; watched = w;
      if (fill) fill.style.width = (totalKnown && total > 0) ? Math.min(100, Math.round(watched / total * 100)) + "%" : "0%";
      markDirty();
    };
    const save = async () => {
      try {
        const payload = { user_id: USER.id, anime_id: a.id, watched: watched };
        if (totalKnown) payload.total = total;
        else {
          const ti = $("#ep-total-input", box);
          const tv = ti && ti.value ? parseInt(ti.value, 10) : null;
          payload.total = (tv && tv > 0) ? tv : null;
        }
        const { error } = await sb.from("episode_progress").upsert(payload, { onConflict: "user_id,anime_id" });
        if (error) { if (status) status.textContent = "保存失败"; toast("保存失败：" + error.message); }
        else if (status) status.textContent = "已保存 ✓";
      } catch (e) { if (status) status.textContent = "保存失败"; }
    };
    wInput.addEventListener("input", clamp);
    wInput.addEventListener("blur", save);
    $("#ep-minus", box).onclick = () => { wInput.value = Math.max(0, (parseInt(wInput.value, 10) || 0) - 1); clamp(); };
    $("#ep-plus", box).onclick = () => { const mx = totalKnown ? total : 99999; wInput.value = Math.min(mx, (parseInt(wInput.value, 10) || 0) + 1); clamp(); };
    const doneBtn = $("#ep-done", box); if (doneBtn) doneBtn.onclick = () => { wInput.value = total; clamp(); };
    $("#ep-reset", box).onclick = () => { wInput.value = 0; clamp(); };
    const ti = $("#ep-total-input", box);
    if (ti) ti.addEventListener("input", () => {
      const tv = parseInt(ti.value, 10);
      if (fill && tv > 0) fill.style.width = Math.min(100, Math.round(watched / tv * 100)) + "%";
      markDirty();
    });
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

    // 排序：收藏时间 / 番剧评分（均支持升降序切换）
    const sortMode = window.__mineSort || "time";      // time | rating
    const sortDir = window.__mineSortDir || "desc";    // desc | asc
    console.log("[Animi] 排序执行:", sortMode, sortDir, "共", list.length, "条收藏");
    list.sort((x, y) => {
      if (sortMode === "rating") {
        const diff = (y.a.rating || 0) - (x.a.rating || 0);
        return sortDir === "asc" ? -diff : diff;       // 番剧评分：默认高→低，asc 反转
      }
      const tx = new Date(x.c.created_at).getTime(), ty = new Date(y.c.created_at).getTime();
      return sortDir === "asc" ? tx - ty : ty - tx;     // 收藏时间
    });

    const f = (window.__mineFilter || "all");
    const filtered = f === "all" ? list : list.filter(x => x.c.status === f);
    const counts = { all: list.length }; STATUS_ORDER.forEach(k => counts[k] = list.filter(x => x.c.status === k).length);
    stats.innerHTML = STATUS_ORDER.map(k => `<div class="mine-stat"><b>${counts[k]}</b><span>${STATUS[k]}</span></div>`).join("");
    filter.innerHTML = `<button class="f-chip ${f === "all" ? "active" : ""}" data-f="all">全部</button>` + STATUS_ORDER.map(k => `<button class="f-chip ${f === k ? "active" : ""}" data-f="${k}">${STATUS[k]} ${counts[k]}</button>`).join("");

    // 排序栏（收藏时间 / 番剧评分，均支持升降序切换）
    const sortEl = $("#mine-sort");
    if (sortEl) {
      const timeLabel = "收藏时间" + (sortMode === "time" ? (sortDir === "asc" ? " ↑" : " ↓") : "");
      const ratingLabel = "番剧评分" + (sortMode === "rating" ? (sortDir === "asc" ? " ↑" : " ↓") : "");
      sortEl.innerHTML = `<span class="sort-label">排序</span>` +
        `<button class="sort-chip ${sortMode === "time" ? "active" : ""}" data-sort="time">${timeLabel}</button>` +
        `<button class="sort-chip ${sortMode === "rating" ? "active" : ""}" data-sort="rating">${ratingLabel}</button>`;
      sortEl.querySelectorAll(".sort-chip").forEach(b => b.onclick = () => {
        const k = b.dataset.sort;
        if (window.__mineSort === k) {
          // 同一模式再次点击：切换方向
          window.__mineSortDir = window.__mineSortDir === "asc" ? "desc" : "asc";
        } else {
          window.__mineSort = k;
          window.__mineSortDir = "desc";  // 切换模式时默认降序
        }
        renderMine();
      });
    }

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
    // 卡片点击 → 进入它所在的社区页面（番剧评论进该番讨论区并定位到该条；论坛帖进该帖）
    list.querySelectorAll(".mine-post").forEach(card => card.onclick = (e) => {
      if (e.target.closest(".post-del")) return;
      const aid = card.dataset.anime;
      if (aid) {
        const a = window.ANIME_DATA.find(x => x.id === Number(aid));
        openAnimeDiscussion(Number(aid), a ? a.title : "", card.dataset.id || undefined);
      } else if (card.dataset.id) {
        openPost(card.dataset.id);
      }
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
      <div class="meta"><div class="title">${esc(a.title)}</div><div class="sub">${c.rating ? "评分 " + c.rating + "/10" : "未评分"}</div>${c.note ? `<div class="mine-comment">${esc(c.note)}</div>` : ""}</div>
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
    $$(".anime-card", wrap).forEach(c => c.onclick = () => openAnimeDetail(c.dataset.id));
  }

  /* ---------------- Realtime ---------------- */
  // 已建立的实时通道引用。init 会多次调用 setupRealtime（初始化时 / 登录态就绪后 /
  // onAuthStateChange），而 Supabase v2 一旦通道 .subscribe() 后就不能再对其 .on(
  // "postgres_changes") —— 否则报 "cannot add postgres_changes callbacks ... after
  // subscribe()"。因此每次重订阅前先移除旧通道，并用唯一后缀保证拿到的是全新的、
  // 未订阅的通道，彻底规避该报错。
  let rtCh = { forum: null, anime: null, ann: null, dm: null };
  let rtSeq = 0;
  function teardownRealtime() {
    if (!sb) return;
    Object.values(rtCh).forEach(ch => { if (ch) { try { sb.removeChannel(ch); } catch (e) {} } });
    rtCh = { forum: null, anime: null, ann: null, dm: null };
  }
  function setupRealtime() {
    if (!sb) return;
    teardownRealtime();
    rtSeq++;
    const t = "-" + rtSeq; // 唯一后缀：每次都是全新的、未订阅的通道
    try {
      rtCh.forum = sb.channel("forum-c" + t).on("postgres_changes", { event: "INSERT", schema: "public", table: "forum_comments" }, () => { if (currentPostId) openPost(currentPostId); }).subscribe();
      rtCh.anime = sb.channel("anime-c" + t).on("postgres_changes", { event: "INSERT", schema: "public", table: "anime_comments" }, (p) => { if (currentAnimeId && p.new.anime_id === currentAnimeId) openAnimeDiscussion(currentAnimeId); }).subscribe();
      // 公告栏变更（编辑内容 / 拖动布局）→ 所有访客实时同步
      rtCh.ann = sb.channel("ann-c" + t).on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => { renderAnnouncement(document.getElementById("announce-panel")); }).subscribe();
      // 私信：只监听「发给我的新消息」→ 刷新红点（RLS 保证仅接收方可见）
      if (USER) {
        rtCh.dm = sb.channel("dm-c" + t).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${USER.id}` }, () => { refreshMsgDot(); }).subscribe();
      }
    } catch (e) { console.warn("realtime 订阅失败", e); }
  }

  /* ---------------- 用户搜索（昵称 / UID） ---------------- */
  async function searchUsers(q, cb) {
    if (!sb || !USER) { if (cb) cb([]); return; }
    const trimmed = (q || "").trim();
    if (!trimmed) { if (cb) cb([]); return; }
    try {
      const num = parseInt(trimmed, 10);
      let data = [];
      if (!isNaN(num) && String(num) === trimmed) {
        const { data: byUid } = await sb.from("profiles").select("id,username,avatar_url,uid,role").eq("uid", num).limit(12);
        data = byUid || [];
        if (data.length < 12) {
          const { data: byName } = await sb.from("profiles").select("id,username,avatar_url,uid,role").ilike("username", "%" + trimmed + "%").limit(12);
          const have = new Set(data.map(x => x.id));
          data = data.concat((byName || []).filter(x => !have.has(x.id)));
        }
      } else {
        const { data: byName } = await sb.from("profiles").select("id,username,avatar_url,uid,role").ilike("username", "%" + trimmed + "%").limit(12);
        data = byName || [];
      }
      let followingMap = {};
      if (data.length) {
        const { data: fr } = await sb.from("follows").select("following_id").eq("follower_id", USER.id).in("following_id", data.map(u => u.id));
        (fr || []).forEach(r => followingMap[r.following_id] = true);
      }
      const rows = data.map(u => ({
        id: u.id, username: u.username, avatar_url: u.avatar_url, uid: u.uid, role: u.role,
        following: !!followingMap[u.id], isSelf: u.id === USER.id
      }));
      if (cb) cb(rows);
    } catch (_) { if (cb) cb([]); }
  }

  /* ---------------- 站长推荐（仅 站长/管理员 可编辑） ---------------- */
  // 兼容 app.js 注入的卡片渲染（若未注入则用内置兜底）
  function ownerCard(a) {
    const fn = window.Community && window.Community.cardHTML;
    if (fn) return fn(a);
    const statusCls = a.status === "连载中" ? "on" : "end";
    const rtxt = (a.rating_count != null && a.rating_count < 70) ? "暂无" : (a.rating ? a.rating.toFixed(1) : "暂无");
    return `<article class="anime-card tilt" data-id="${a.id}">
      <div class="cover" style="background-image:${grad(a.id)}">
        <img class="img" src="${a.cover}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <div class="ov"></div>
        <div class="status-tag ${statusCls}">${a.status}</div>
      </div>
      <div class="meta"><div class="title">${esc(a.title)}</div>
        <div class="sub">${a.date} · ${a.status}</div>
        <div class="row"><span class="rate">${STAR}${rtxt}</span></div>
      </div></article>`;
  }
  async function renderOwnerPicks(host) {
    if (!host) return;
    host.innerHTML = `<div class="loading">加载站长推荐…</div>`;
    if (!sb) { host.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    const { data, error } = await sb.from("recommendations").select("anime_id,note").order("created_at", { ascending: false }).limit(30);
    if (error) { host.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    const ids = (data || []).map(r => r.anime_id);
    const anime = ids.map(id => window.ANIME_DATA.find(x => x.id === id)).filter(Boolean);
    if (!anime.length) {
      host.innerHTML = `<div class="cal-empty" style="grid-column:1/-1;padding:40px">站长还没推荐番剧～` +
        (isAdmin() ? `<div style="margin-top:12px"><button class="btn btn-primary" id="op-add">＋ 添加站长推荐</button></div>` : ``) + `</div>`;
      const ba = $("#op-add", host); if (ba) ba.onclick = openOwnerPickAdder;
      return;
    }
    // 注意：op-remove 是 position:absolute，必须包在 position:relative 的 .op-cell 里，
    // 否则会锚定到整块网格、所有 ✕ 挤在角落（之前"看不到删除键"的根因）。
    host.innerHTML = anime.map((a) => `<div class="op-cell">${ownerCard(a)}` +
      (isAdmin() ? `<button class="op-remove" data-id="${a.id}" title="移出站长推荐">✕</button>` : "") + `</div>`).join("") +
      (isAdmin() ? `<div style="grid-column:1/-1;text-align:center;margin-top:8px"><button class="btn btn-ghost" id="op-add">＋ 添加 / 管理</button></div>` : "");
    host.querySelectorAll(".anime-card").forEach(c => c.onclick = () => openAnimeDetail(c.dataset.id));
    host.querySelectorAll(".op-remove").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await sb.from("recommendations").delete().eq("anime_id", +b.dataset.id);
      toast("已移出站长推荐"); renderOwnerPicks(host);
    });
    const ba = $("#op-add", host); if (ba) ba.onclick = openOwnerPickAdder;
  }
  // 管理员添加推荐：本地库搜索番剧
  function openOwnerPickAdder() {
    if (!isAdmin()) { toast("仅站长可操作"); return; }
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">添加站长推荐</div>
      <div class="cb-row"><span class="cb-label">番剧</span>
        <input id="op-q" class="auth-input" placeholder="输入番剧名称或 Bangumi ID" /></div>
      <div class="auth-err" id="op-err"></div>
      <div id="op-res" class="op-res"></div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const q = $("#op-q"), res = $("#op-res"), err = $("#op-err");
    q.addEventListener("input", () => {
      const t = q.value.trim();
      if (!t) { res.innerHTML = ""; return; }
      const num = parseInt(t, 10);
      const list = (window.ANIME_DATA || []).filter(a => {
        if (!isNaN(num) && String(num) === t && a.id === num) return true;
        return (a.title + a.jp + a.en).toLowerCase().includes(t.toLowerCase());
      }).slice(0, 12);
      if (!list.length) { res.innerHTML = `<div class="empty">未找到匹配番剧</div>`; return; }
      res.innerHTML = list.map(a => `<div class="op-item" data-id="${a.id}">
        <img class="op-thumb" src="${esc(a.cover)}" onerror="this.style.display='none'"/>
        <div class="op-info"><div class="op-name">${esc(a.title)}</div><div class="op-sub">${a.date||""}</div></div>
        <button class="btn btn-primary op-add-btn">添加</button></div>`).join("");
      res.querySelectorAll(".op-item").forEach(it => it.querySelector(".op-add-btn").onclick = () => addOwnerPick(+it.dataset.id));
    });
  }
  async function addOwnerPick(id) {
    if (!isAdmin()) { toast("仅站长可操作"); return; }
    const { error } = await sb.from("recommendations").insert({ anime_id: id, added_by: USER.id });
    if (error) { toast("添加失败：" + error.message); return; }
    toast("已加入站长推荐");
    const host = $("#picks-grid"); if (host) renderOwnerPicks(host);
    closeComm();
  }

  /* ---------------- 站长推荐视频（仅站长可编辑） ----------------
     站长填入 BV 号即可：自动拉取标题/作者/发布时间，显示为卡片，点击跳 B站播放
     （不再用内联 iframe，避免 B站禁止嵌入导致无法播放）。数据存 Supabase owner_videos 表。 */
  const BILI_VIEW = window.APP_CONFIG.PROXY_BASE + "/bili/x/web-interface/view";
  // ⚠️ B站 BV 号大小写敏感（base58 编码），绝不能 toUpperCase！只把前缀 "BV" 统一大写，后 10 位原样保留。
  function normBvid(raw) {
    const m = String(raw || "").match(/BV[0-9A-Za-z]{8,}/i);
    if (!m) return "";
    return "BV" + m[0].slice(2);
  }
  // 封面走反代 /img（规避 B站图床防盗链 403 + 国内免 VPN）。
  function ovProxyImg(u) {
    if (!u) return "";
    return window.APP_CONFIG.PROXY_BASE + "/img?url=" + encodeURIComponent(u.replace(/^https?:\/\//, "")) + "&w=480&h=300&fit=cover&output=jpg&q=82";
  }
  function parseBiliView(j) {
    if (j && j.code === 0 && j.data) {
      return {
        title: j.data.title || "",
        author: (j.data.owner && j.data.owner.name) || "",
        pubdate: j.data.pubdate ? new Date(j.data.pubdate * 1000).toISOString() : null,
        cover: (j.data.pic || "").replace(/^http:/, "https:").replace(/^\/\//, "https://")
      };
    }
    return null;
  }
  // 通道①：Worker 代理（部署后最稳，带浏览器 UA/Referer 防风控）
  async function fetchViaWorker(bvid) {
    try {
      const r = await fetch(BILI_VIEW + "?bvid=" + encodeURIComponent(bvid), { headers: { "Accept": "application/json" } });
      if (!r.ok) return null;
      return parseBiliView(await r.json());
    } catch (e) { return null; }
  }
  // 通道②：JSONP（<script> 注入，绕过浏览器跨域限制，Worker 未部署也能自动识别）
  function fetchViaJsonp(bvid) {
    return new Promise((resolve) => {
      const cb = "__biliCb" + Math.random().toString(36).slice(2);
      const s = document.createElement("script");
      let done = false;
      const cleanup = () => { try { delete window[cb]; } catch (e) { window[cb] = undefined; } s.remove(); };
      window[cb] = (j) => { if (done) return; done = true; cleanup(); resolve(parseBiliView(j)); };
      s.onerror = () => { if (done) return; done = true; cleanup(); resolve(null); };
      setTimeout(() => { if (done) return; done = true; cleanup(); resolve(null); }, 6000);
      s.src = "https://api.bilibili.com/x/web-interface/view?bvid=" + encodeURIComponent(bvid) + "&jsonp=jsonp&callback=" + cb;
      document.head.appendChild(s);
    });
  }
  // 拉单条视频元数据（标题/作者/发布时间/封面）：先试 Worker，再试 JSONP，都失败回退手动填。
  async function fetchBiliMeta(bvid) {
    const id = normBvid(bvid); if (!id) return null;
    return (await fetchViaWorker(id)) || (await fetchViaJsonp(id));
  }
  // 彻底销毁播放器：先卸载 iframe（导航到 about:blank）以强制停止音频，再移除节点。
  // 仅 mask.remove() 在部分浏览器（尤其跨域 iframe）下音频仍会继续，必须把 iframe 卸载。
  function destroyBiliPlayer(m) {
    if (!m) return;
    const f = m.querySelector ? m.querySelector("iframe") : null;
    if (f) {
      try { f.src = "about:blank"; } catch (e) {}
      try { if (f.contentWindow && f.contentWindow.stop) f.contentWindow.stop(); } catch (e) {}
    }
    m.remove();
  }
  // 站内内置播放器（B站官方 embed，isOutside=true 支持外站嵌入）
  function openBiliPlayer(bvid, title) {
    const bid = normBvid(bvid) || bvid;
    const old = document.getElementById("bili-player-mask"); if (old) destroyBiliPlayer(old);
    const mask = document.createElement("div");
    mask.id = "bili-player-mask"; mask.className = "bili-player-mask";
    const src = "https://player.bilibili.com/player.html?isOutside=true&bvid=" + encodeURIComponent(bid) + "&p=1&autoplay=0&danmaku=0&high_quality=1";
    mask.innerHTML = `<div class="bili-player-box" role="dialog" aria-modal="true">
        <div class="bili-player-head">
          <span class="bili-player-title">${esc(title || bid)}</span>
          <a class="bili-player-ext" href="https://www.bilibili.com/video/${esc(bid)}" target="_blank" rel="noopener">在B站打开 ↗</a>
          <button class="bili-player-close" aria-label="关闭">✕</button>
        </div>
        <div class="bili-player-frame">
          <iframe src="${src}" scrolling="no" frameborder="no" framespacing="0" allowfullscreen="true" referrerpolicy="no-referrer"></iframe>
        </div>
      </div>`;
    document.body.appendChild(mask);
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") close(); };
    function close() { destroyBiliPlayer(mask); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); }
    mask.querySelector(".bili-player-close").onclick = close;
    mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
    document.addEventListener("keydown", onKey);
  }

  /* ---------------- 论坛帖子内嵌视频（所有人可发） ----------------
     视频作为 forum_posts.videos(jsonb 数组) 的一部分存储，不单独建表。
     复用 normBvid + 双通道 fetchBiliMeta(Worker/jsonp) 自动识别元数据。 */

  // 视频卡片（论坛用，无删除按钮；点击弹出站内播放）
  function forumVideoCardHTML(v) {
    const cover = ovProxyImg(v.cover);
    const sub = [v.author, v.pubdate ? timeAgo(v.pubdate) : null].filter(Boolean).join(" · ");
    return `<div class="ov-cell post-video-cell" data-bvid="${esc(v.bvid)}" data-title="${esc(v.title || v.bvid)}" role="button" tabindex="0">
        <div class="ov-cover">
          ${cover ? `<img src="${cover}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : `<div class="ov-noimg">📺</div>`}
          <span class="bili-play">▶ 播放</span>
        </div>
        <div class="ov-meta">
          <div class="ov-title">${esc(v.title || ("B站视频 " + v.bvid))}</div>
          <div class="ov-sub">${esc(sub || "点击播放")}</div>
        </div>
      </div>`;
  }
  // 视频网格容器（带 🎬 标题）
  function videosHTML(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="post-videos"><div class="post-videos-title">🎬 视频</div><div class="post-videos-grid">${list.map(forumVideoCardHTML).join("")}</div></div>`;
  }
  // 独立遮罩的视频选择器：复用 normBvid + fetchBiliMeta(W/A 双通道)，所有人可用
  function openVideoPicker(initial, onPick) {
    const old = document.getElementById("video-picker-mask"); if (old) old.remove();
    let picked = Array.isArray(initial) ? initial.slice() : [];
    const mask = document.createElement("div");
    mask.id = "video-picker-mask"; mask.className = "video-picker-mask";
    const renderPicked = () => {
      const box = $("#vp-picked", mask);
      if (!box) return;
      box.innerHTML = picked.length
        ? picked.map((v, i) => `<div class="vp-item"><img src="${esc(ovProxyImg(v.cover))}" onerror="this.style.visibility='hidden'"><div class="vp-meta"><div class="vp-t">${esc(v.title || v.bvid)}</div><div class="vp-s">${esc(v.author || "")} · ${esc(v.bvid)}</div></div><button class="vp-x" data-i="${i}">✕</button></div>`).join("")
        : `<div class="vp-empty">还没有添加视频，填 BV 号或粘贴链接试试。</div>`;
      box.querySelectorAll(".vp-x").forEach(b => b.onclick = () => { picked.splice(+b.dataset.i, 1); renderPicked(); });
    };
    const close = () => { mask.remove(); document.body.style.overflow = ""; };
    mask.innerHTML = `<div class="video-picker-box" role="dialog" aria-modal="true">
        <div class="vp-head"><b>插入 B站视频</b><button class="vp-close" aria-label="关闭">✕</button></div>
        <div class="vp-body">
          <div class="cb-row"><span class="cb-label">BV 号 / 链接</span>
            <input id="vp-input" class="auth-input" placeholder="填 BV 号，如 BV1xxxx，或直接粘贴视频链接" /></div>
          <div class="auth-hint" id="vp-hint" style="font-size:12px;color:var(--text-faint);margin:-4px 0 8px">自动识别标题/作者/发布时间/封面；识别不到可手填。</div>
          <div class="cb-row"><span class="cb-label">标题</span><input id="vp-title" class="auth-input" placeholder="自动填充，可改" /></div>
          <div class="cb-row"><span class="cb-label">作者</span><input id="vp-author" class="auth-input" placeholder="自动填充，可改" /></div>
          <div class="cb-row"><span class="cb-label">发布时间</span><input id="vp-date" class="auth-input" placeholder="自动填充，可改" /></div>
          <button class="btn btn-ghost" id="vp-add" style="width:100%;justify-content:center;margin-bottom:12px">＋ 加入这条视频</button>
          <div class="vp-picked" id="vp-picked"></div>
        </div>
        <div class="vp-foot"><button class="btn btn-primary" id="vp-done" style="flex:1;justify-content:center">完成（${picked.length}）</button></div>
      </div>`;
    document.body.appendChild(mask);
    document.body.style.overflow = "hidden";
    const input = $("#vp-input", mask), hint = $("#vp-hint", mask), titleI = $("#vp-title", mask), authorI = $("#vp-author", mask), dateI = $("#vp-date", mask);
    let lastBvid = "", fetchedCover = null, fetchedPubISO = null;
    input.addEventListener("input", async () => {
      const bvid = normBvid(input.value);
      if (!bvid || bvid === lastBvid) return;
      lastBvid = bvid;
      hint.textContent = "正在识别…";
      const meta = await fetchBiliMeta(bvid);
      if (meta) {
        fetchedCover = meta.cover || null; fetchedPubISO = meta.pubdate || null;
        if (!titleI.value) titleI.value = meta.title || "";
        if (!authorI.value) authorI.value = meta.author || "";
        if (!dateI.value && meta.pubdate) dateI.value = new Date(meta.pubdate).toLocaleDateString("zh-CN");
        hint.textContent = "已自动识别，可修改后加入。";
      } else {
        hint.textContent = "未能自动识别，可手动填标题/作者/时间。";
      }
    });
    $("#vp-add", mask).onclick = () => {
      const bvid = normBvid(input.value);
      if (!bvid) { hint.textContent = "请先填 BV 号或粘贴含 BV 的视频链接。"; return; }
      let pubdate = fetchedPubISO;
      if (dateI.value.trim() && !isNaN(Date.parse(dateI.value.trim()))) pubdate = new Date(Date.parse(dateI.value.trim())).toISOString();
      picked.push({ bvid, title: titleI.value.trim() || null, author: authorI.value.trim() || null, pubdate, cover: fetchedCover || null });
      input.value = ""; titleI.value = ""; authorI.value = ""; dateI.value = ""; lastBvid = ""; fetchedCover = null; fetchedPubISO = null; hint.textContent = "已加入，可继续添加或点完成。";
      renderPicked();
      const done = $("#vp-done", mask); if (done) done.textContent = "完成（" + picked.length + "）";
    };
    $("#vp-done", mask).onclick = () => { onPick(picked.slice()); close(); };
    $("#vp-close", mask).onclick = close;
    mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
  }
  function ovCardHTML(v) {
    const cover = ovProxyImg(v.cover);
    const sub = [v.author, v.pubdate ? timeAgo(v.pubdate) : null].filter(Boolean).join(" · ");
    return `<div class="ov-cell" data-bvid="${esc(v.bvid)}" data-title="${esc(v.title || v.bvid)}" role="button" tabindex="0">
        <div class="ov-cover">
          ${cover ? `<img src="${cover}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : `<div class="ov-noimg">📺</div>`}
          <span class="bili-play">▶ 播放</span>
        </div>
        <div class="ov-meta">
          <div class="ov-title">${esc(v.title || ("B站视频 " + v.bvid))}</div>
          <div class="ov-sub">${esc(sub || "点击播放")}</div>
        </div>
        ${isWebmaster() ? `<button class="op-remove" data-id="${v.id}" title="删除">✕</button>` : ""}
      </div>`;
  }
  async function renderOwnerVideos(host) {
    if (!host) return;
    host.innerHTML = `<div class="loading">加载站长推荐视频…</div>`;
    if (!sb) { host.innerHTML = `<div class="empty">社区模块未初始化。</div>`; return; }
    const { data, error } = await sb.from("owner_videos").select("*").order("created_at", { ascending: false }).limit(30);
    if (error) {
      host.innerHTML = `<div class="cal-empty" style="grid-column:1/-1;padding:30px">推荐视频模块暂未启用（需先执行建表 SQL）。${isWebmaster() ? `<div style="margin-top:8px;font-size:11px;opacity:.7">错误：${esc(error.message)}</div>` : ""}</div>`;
      return;
    }
    const list = data || [];
    if (!list.length) {
      host.innerHTML = `<div class="cal-empty" style="grid-column:1/-1;padding:40px">站长还没推荐视频～` +
        (isWebmaster() ? `<div style="margin-top:12px"><button class="btn btn-primary" id="ov-add">＋ 添加推荐视频</button></div>` : ``) + `</div>`;
      const ba = $("#ov-add", host); if (ba) ba.onclick = openOwnerVideoAdder;
      return;
    }
    host.innerHTML = list.map(ovCardHTML).join("") +
      (isWebmaster() ? `<div style="grid-column:1/-1;text-align:center;margin-top:8px"><button class="btn btn-ghost" id="ov-add">＋ 添加 / 管理</button></div>` : "");
    // 点击卡片 → 站内内置播放
    host.querySelectorAll(".ov-cell").forEach(cell => {
      const open = () => openBiliPlayer(cell.dataset.bvid, cell.dataset.title);
      cell.addEventListener("click", (e) => { if (e.target.closest(".op-remove")) return; open(); });
      cell.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    host.querySelectorAll(".op-remove").forEach(b => b.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      await sb.from("owner_videos").delete().eq("id", +b.dataset.id);
      toast("已删除推荐视频"); renderOwnerVideos(host);
    });
    const ba = $("#ov-add", host); if (ba) ba.onclick = openOwnerVideoAdder;
  }
  function openOwnerVideoAdder() {
    if (!isWebmaster()) { toast("仅站长可操作"); return; }
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">添加站长推荐视频</div>
      <div class="cb-row"><span class="cb-label">BV 号</span>
        <input id="ov-bvid" class="auth-input" placeholder="填 BV 号，如 BV1xxxx（也可直接粘贴视频链接）" /></div>
      <div class="auth-hint" id="ov-hint" style="font-size:12px;color:var(--text-faint);margin:-4px 0 6px">填 BV 号或粘贴视频链接，自动识别标题/作者/发布时间/封面；识别不到可手填（不影响站内播放）。</div>
      <div class="cb-row"><span class="cb-label">标题</span>
        <input id="ov-title" class="auth-input" placeholder="自动填充，可改" /></div>
      <div class="cb-row"><span class="cb-label">作者</span>
        <input id="ov-author" class="auth-input" placeholder="自动填充，可改" /></div>
      <div class="cb-row"><span class="cb-label">发布时间</span>
        <input id="ov-date" class="auth-input" placeholder="自动填充，可改" /></div>
      <div class="auth-err" id="ov-err"></div>
      <div class="comm-actions"><button class="btn btn-primary" id="ov-save">添加</button></div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const bvInput = $("#ov-bvid"), titleI = $("#ov-title"), authorI = $("#ov-author"), dateI = $("#ov-date"), hint = $("#ov-hint"), err = $("#ov-err");
    let lastFetched = "", fetchedCover = null, fetchedPubISO = null;
    bvInput.addEventListener("input", async () => {
      const bvid = normBvid(bvInput.value);
      if (!bvid || bvid === lastFetched) return;
      lastFetched = bvid;
      hint.textContent = "正在拉取视频信息…";
      const meta = await fetchBiliMeta(bvid);
      if (meta) {
        fetchedCover = meta.cover || null; fetchedPubISO = meta.pubdate || null;
        if (!titleI.value) titleI.value = meta.title || "";
        if (!authorI.value) authorI.value = meta.author || "";
        if (!dateI.value && meta.pubdate) dateI.value = new Date(meta.pubdate).toLocaleDateString("zh-CN");
        hint.textContent = "已自动识别标题/作者/发布时间/封面，可修改后添加。";
      } else {
        hint.textContent = "未能自动识别，请手动填写标题/作者/发布时间后添加（不影响内置播放）。";
      }
    });
    $("#ov-save").onclick = async () => {
      const bvid = normBvid(bvInput.value);
      if (!bvid) { err.textContent = "请填写 BV 号（或粘贴含 BVxxxx 的视频链接）"; return; }
      const row = { bvid, title: titleI.value.trim() || null, author: authorI.value.trim() || null, cover: fetchedCover || null, added_by: USER.id };
      if (dateI.value.trim()) {
        const t = Date.parse(dateI.value.trim());
        if (!isNaN(t)) row.pubdate = new Date(t).toISOString();
      } else if (fetchedPubISO) {
        row.pubdate = fetchedPubISO;
      }
      const { error } = await sb.from("owner_videos").insert(row);
      if (error) { err.textContent = "添加失败：" + error.message; return; }
      toast("已添加推荐视频");
      const host = $("#owner-videos-grid"); if (host) renderOwnerVideos(host);
      closeComm();
    };
  }

  /* ---------------- 私信 / 站内信 ---------------- */
  async function refreshMsgDot() {
    const icon = $("#msg-icon"), dot = $("#msg-dot");
    if (!icon) return;
    if (!USER) { icon.hidden = true; return; }
    icon.hidden = false;
    if (!dot) return;
    try {
      const { data } = await sb.rpc("dm_unread_count");
      const n = data || 0;
      dot.hidden = n <= 0;
      dot.textContent = n > 99 ? "99+" : String(n || "");
    } catch (_) { dot.hidden = true; }
  }
  function openDMInbox() {
    if (!USER) { openIdentity(); return; }
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="loading">加载私信…</div>`;
    $("#comm-close").onclick = closeComm; mask.classList.add("open"); document.body.style.overflow = "hidden";
    const me = USER.id;
    sb.from("messages").select("*").or(`sender_id.eq.${me},receiver_id.eq.${me}`).order("created_at", { ascending: false }).limit(200)
      .then(async ({ data, error }) => {
        if (error) { modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button><div class="err">${esc(error.message)}</div>`; $("#comm-close").onclick = closeComm; return; }
        const convMap = {};
        (data || []).forEach(m => {
          const other = m.sender_id === me ? m.receiver_id : m.sender_id;
          if (!convMap[other]) convMap[other] = { other, last: m, unread: 0 };
          if (m.sender_id !== me && !m.read) convMap[other].unread++;
        });
        const convs = Object.values(convMap).sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
        const names = await fetchNames(convs.map(c => c.other));
        const header = `<button class="modal-close" id="comm-close">✕</button>
          <div class="comm-title">私信</div>`;
        if (!convs.length) {
          modal.innerHTML = header + `<div class="empty">还没有任何私信。去用户主页点「✉ 私信」即可发起聊天～</div>`;
        } else {
          modal.innerHTML = header + `<div class="dm-list">${convs.map(c => `
            <div class="dm-row" data-other="${c.other}">
              ${avatarHTML(names[c.other], c.other, "sm")}
              <div class="dm-row-meta">
                <div class="dm-row-name">${esc((names[c.other] && names[c.other].username) || "用户")}</div>
                <div class="dm-row-last">${esc((c.last.body || (c.last.images && c.last.images.length ? "[图片]" : "")).slice(0, 30))}</div>
              </div>
              ${c.unread ? `<span class="dm-unread">${c.unread}</span>` : ""}
            </div>`).join("")}</div>`;
          modal.querySelectorAll(".dm-row").forEach(r => r.onclick = () => openDMThread(r.dataset.other));
        }
        $("#comm-close").onclick = closeComm;
      });
  }
  async function openDMThread(otherId, onClose) {
    const mask = $("#comm-mask"), modal = $("#comm-modal");
    const names = await fetchNames([otherId]);
    const p = names[otherId] || {};
    modal.innerHTML = `<button class="modal-close" id="comm-close">✕</button>
      <div class="comm-title">💬 与 ${esc(p.username || "用户")} 的私信</div>
      <div class="dm-thread" id="dm-thread"><div class="loading">加载中…</div></div>
      <div class="dm-composer">
        <div class="ac-thumbs" id="dm-thumbs"></div>
        <div class="dm-bar">
          <label class="ac-imgbtn" title="插入图片">🖼️<input type="file" id="dm-file" accept="image/*" multiple hidden></label>
          <textarea id="dm-input" class="cb-textarea" placeholder="说点什么…"></textarea>
          <button class="btn btn-primary" id="dm-send">发送</button>
        </div>
      </div>`;
    $("#comm-close").onclick = () => { closeComm(); (onClose || openDMInbox)(); };
    try { await sb.rpc("dm_mark_read", { p_other: otherId }); } catch (_) {}
    refreshMsgDot();
    await renderDMThread(otherId);
    let dmImgs = [];
    const thumbs = $("#dm-thumbs"), file = $("#dm-file");
    function renderDMThumbs() {
      if (!thumbs) return;
      thumbs.innerHTML = dmImgs.map((f, i) => `<div class="ac-thumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="ac-thumb-x" data-i="${i}">✕</button></div>`).join("");
      thumbs.querySelectorAll(".ac-thumb-x").forEach(b => b.onclick = () => { dmImgs.splice(+b.dataset.i, 1); renderDMThumbs(); });
    }
    if (file) file.addEventListener("change", () => {
      for (const f of [...(file.files || [])]) {
        if (!f.type.startsWith("image/")) { toast("只能插入图片"); continue; }
        if (f.size > 5 * 1024 * 1024) { toast("单张图片不能超过 5MB"); continue; }
        if (dmImgs.length >= 6) { toast("最多插入 6 张图片"); break; }
        dmImgs.push(f);
      }
      file.value = ""; renderDMThumbs();
    });
    $("#dm-send").onclick = async () => {
      if (!USER) return;
      const v = ($("#dm-input") && $("#dm-input").value || "").trim();
      if (!v && !dmImgs.length) return;
      const btn = $("#dm-send"); btn.disabled = true; const old = btn.textContent;
      try {
        let imgUrls = [];
        if (dmImgs.length) { btn.textContent = "上传中…"; for (const f of dmImgs) imgUrls.push(await uploadCommentImage(f)); }
        const { error } = await sb.from("messages").insert({ sender_id: USER.id, receiver_id: otherId, body: v, images: imgUrls });
        if (error) { toast("发送失败：" + error.message); return; }
        $("#dm-input").value = ""; dmImgs = []; if (thumbs) thumbs.innerHTML = "";
        await renderDMThread(otherId);
      } catch (e) { toast("图片上传失败：" + (e.message || e)); }
      finally { btn.disabled = false; btn.textContent = old; }
    };
  }
  async function renderDMThread(otherId) {
    const host = $("#dm-thread"); if (!host) return;
    const { data, error } = await sb.from("messages").select("*")
      .or(`and(sender_id.eq.${USER.id},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${USER.id})`)
      .order("created_at", { ascending: true });
    if (error) { host.innerHTML = `<div class="err">${esc(error.message)}</div>`; return; }
    const names = await fetchNames([otherId, USER.id]);
    if (!data || !data.length) { host.innerHTML = `<div class="empty">还没有消息，发一条打个招呼吧～</div>`; return; }
    host.innerHTML = data.map(m => {
      const mine = m.sender_id === USER.id;
      const who = mine ? USER.id : otherId;
      const imgs = (m.images && m.images.length) ? `<div class="c-imgs">${m.images.map(u => `<img class="c-img" src="${esc(u)}" alt="配图" loading="lazy" onclick="window.__cbLightbox && window.__cbLightbox('${esc(u)}')">`).join("")}</div>` : "";
      return `<div class="dm-msg ${mine ? "mine" : ""}">
        ${avatarHTML(names[who], who, "xs")}
        <div class="dm-bubble">${m.body ? `<div class="dm-text">${esc(m.body)}</div>` : ""}${imgs}<div class="dm-time">${timeAgo(m.created_at)}</div></div>
      </div>`;
    }).join("");
    host.scrollTop = host.scrollHeight;
  }

  /* ---------------- 首页公告栏 ---------------- */
  // 公告栏布局状态：位置/大小存 Supabase（所有访客共享同一布局），本机 localStorage 仅作兜底
  let ANN_CURRENT_ID = null;
  let ANN_LAYOUT = null;
  // 渲染首页右侧公告栏：拉取最新启用的公告，站长/管理员显示编辑按钮
  function renderAnnouncement(panel) {
    if (!panel || !sb) { panel.innerHTML = '<div class="announce-empty">暂无公告</div>'; return; }
    // 先清空 loading
    panel.innerHTML = "";
    sb.from("announcements").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1)
      .maybeSingle().then(async ({ data: row }) => {
        if (!row) {
          ANN_CURRENT_ID = null; ANN_LAYOUT = null;
          panel.innerHTML = `<div class="announce-card"><div class="ac-head"><span class="ac-title">📢 公告</span></div>
            <div class="ac-body">暂无公告</div>${isAdmin() ? '<button class="ac-edit-btn" id="ac-edit-btn">编辑</button>' : ''}</div>`;
          bindAcEdit(); return;
        }
        // 记录当前公告 id 与布局（供拖动/缩放持久化到 Supabase）
        ANN_CURRENT_ID = row.id;
        ANN_LAYOUT = (row.pos_x != null || row.pos_y != null || row.width != null || row.height != null)
          ? { left: row.pos_x, top: row.pos_y, width: row.width, height: row.height } : null;
        let imgHtml = "";
        if (row.image_url) {
          imgHtml = `<img class="ac-img" src="${row.image_url}" alt="公告图片" onclick="if(window.__cbLightbox)__cbLightbox('${row.image_url}')" />`;
        }
        const timeStr = row.updated_at ? new Date(row.updated_at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
        panel.innerHTML = `<div class="announce-card">
          <div class="ac-head"><span class="ac-title">📢 公告</span>${isAdmin() ? '<button class="ac-edit-btn" id="ac-edit-btn">编辑</button>' : ''}</div>
          <div class="ac-body">${esc(row.content || "")}</div>
          ${imgHtml}
          <div class="ac-time">${timeStr}</div>
        </div>`;
        bindAcEdit();
        applyAnnounceLayout(panel); // 应用数据库中的布局（所有访客一致）
      }).catch(() => {
        panel.innerHTML = '<div class="announce-empty">加载失败，请刷新重试</div>';
      });
  }

  // 绑定公告编辑按钮
  function bindAcEdit() {
    const btn = document.getElementById("ac-edit-btn");
    if (btn) btn.onclick = () => openAnnouncementEditor();
  }

  // 打开公告编辑弹窗（仅管理员/站长可调用）
  // 关键：先同步创建并弹出弹窗，确保点击必有反应，再异步拉取已有内容回填。
  function openAnnouncementEditor() {
    if (!isAdmin()) { toast("仅站长/管理员可编辑公告"); return; }
    const overlay = document.createElement("div");
    overlay.className = "ann-editor-overlay";
    overlay.id = "ann-ov";
    overlay.onclick = e => { if (e.target === overlay) closeAnnEditor(); };
    overlay.innerHTML = `
      <div class="ann-editor" onclick="event.stopPropagation()">
        <h3>📢 编辑公告</h3>
        <label>公告内容（支持文字）</label>
        <textarea id="ann-text" placeholder="输入公告内容…"></textarea>
        <label>公告图片（选填）</label>
        <div class="ann-img-row">
          <input type="file" id="ann-file" accept="image/*" />
          <button type="button" class="btn btn-ghost" id="ann-rm-img" style="font-size:12px;padding:4px 8px;display:none;">删除图片</button>
        </div>
        <img class="ann-img-preview" id="ann-preview" style="display:none" />
        <div class="ann-actions">
          <button class="btn btn-ghost" id="ann-cancel">取消</button>
          <button class="btn btn-primary" id="ann-save">保存公告</button>
        </div>
        <div style="margin-top:10px;text-align:right"><span class="announce-reset" id="ann-reset">重置公告位置/大小</span></div>
      </div>`;
    document.body.appendChild(overlay);

    const fileInput = document.getElementById("ann-file");
    const preview = document.getElementById("ann-preview");
    const rmBtn = document.getElementById("ann-rm-img");
    fileInput.onchange = () => {
      if (fileInput.files[0]) {
        preview.src = URL.createObjectURL(fileInput.files[0]);
        preview.style.display = "block";
        rmBtn.style.display = "inline-block";
      }
    };
    rmBtn.onclick = () => { preview.src = ""; preview.style.display = "none"; fileInput.value = ""; rmBtn.style.display = "none"; };
    document.getElementById("ann-cancel").onclick = closeAnnEditor;
    document.getElementById("ann-save").onclick = saveAnnouncement;
    const resetLink = document.getElementById("ann-reset");
    if (resetLink) resetLink.onclick = () => { resetAnnounceLayout(document.getElementById("announce-panel")); closeAnnEditor(); toast("已重置公告位置/大小"); };

    // 异步拉取已有公告回填（不影响弹窗已显示）
    if (sb) {
      sb.from("announcements").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle()
        .then(({ data: r }) => {
          if (r) {
            const t = document.getElementById("ann-text"); if (t && r.content) t.value = r.content;
            if (r.image_url) { preview.src = r.image_url; preview.style.display = "block"; rmBtn.style.display = "inline-block"; }
          }
        }).catch(() => {});
    }
  }

  // 关闭编辑器
  function closeAnnEditor() {
    const ov = document.getElementById("ann-ov");
    if (ov) ov.remove();
  }

  // 保存公告（自动判断新增/更新：取最新一条启用公告，有则 update，无则 insert）
  async function saveAnnouncement() {
    const textEl = document.getElementById("ann-text");
    const fileEl = document.getElementById("ann-file");
    const preview = document.getElementById("ann-preview");
    const saveBtn = document.getElementById("ann-save");

    // 当前图片 URL：原图仍显示（非 blob）→ 沿用；用户选了新图 → 上传后覆盖
    let imgUrl = (preview.style.display !== "none" && preview.src && !preview.src.startsWith("blob:")) ? preview.src : "";

    if (fileEl && fileEl.files[0]) {
      saveBtn.textContent = "上传中…"; saveBtn.disabled = true;
      try {
        imgUrl = await uploadCommentImage(fileEl.files[0]);
      } catch (e) { toast("图片上传失败：" + (e.message || e)); saveBtn.textContent = "保存公告"; saveBtn.disabled = false; return; }
    }

    const bodyText = textEl.value.trim();
    saveBtn.textContent = "保存中…";
    try {
      const { data: cur } = await sb.from("announcements").select("id").eq("is_active", true).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (cur && cur.id) {
        await sb.from("announcements").update({ content: bodyText, image_url: imgUrl, updated_at: new Date().toISOString() }).eq("id", cur.id);
      } else {
        await sb.from("announcements").insert({
          content: bodyText, image_url: imgUrl, is_active: true,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        });
      }
      toast("公告已保存 ✅");
      closeAnnEditor();
      renderAnnouncement(document.getElementById("announce-panel"));
    } catch (e) {
      toast("保存失败：" + (e.message || e));
      saveBtn.textContent = "保存公告"; saveBtn.disabled = false;
    }
  }

  /* ---------------- 公告栏布局：拖动 / 缩放 / 持久化（仅站长/管理员，存 Supabase） ---------------- */
  const ANN_LAYOUT_KEY = "announce_layout"; // 本机兜底
  // 应用布局：优先用数据库中的 ANN_LAYOUT（所有访客一致），其次本机 localStorage 兜底
  // 防御：若保存的尺寸/位置非法（0、负数、过小、超出合理范围或数据损坏），则丢弃并回退到
  // CSS 默认（380×520 / right:4% / top:84px），并清除本机坏值——避免面板被压成 0 或移出屏幕后
  // 「永久消失」（一旦变成 0 尺寸，编辑/重置按钮也点不到，形成死循环）。
  const ANN_MIN_W = 240, ANN_MIN_H = 160, ANN_MAX_W = 1200, ANN_MAX_H = 1400, ANN_POS_LIMIT = 10000;
  // 移动端（窄屏）判定：公告栏在手机上改为静态全宽，不应用桌面悬浮布局
  function isMobileLayout() {
    try { return window.matchMedia("(max-width: 768px)").matches; } catch (e) { return false; }
  }
  function applyAnnounceLayout(panel) {
    if (!panel) return;
    if (isMobileLayout()) {
      // 移动端：清除桌面保存的内联定位，交给 CSS 媒体查询（position:static !important 全宽自适应高度）
      panel.style.position = "static";
      panel.style.left = "auto"; panel.style.top = "auto";
      panel.style.right = "auto"; panel.style.width = "auto"; panel.style.height = "auto";
      return;
    }
    let d = (ANN_LAYOUT && ANN_LAYOUT.left != null && ANN_LAYOUT.top != null && ANN_LAYOUT.width != null && ANN_LAYOUT.height != null)
      ? ANN_LAYOUT
      : (() => { try { const raw = localStorage.getItem(ANN_LAYOUT_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } })();
    const ok = d && Number.isFinite(+d.left) && Number.isFinite(+d.top)
      && +d.width >= ANN_MIN_W && +d.width <= ANN_MAX_W
      && +d.height >= ANN_MIN_H && +d.height <= ANN_MAX_H
      && Math.abs(+d.left) <= ANN_POS_LIMIT && Math.abs(+d.top) <= ANN_POS_LIMIT;
    if (!ok) {
      // 坏布局：清除内联样式 + 本机坏值，回退 CSS 默认，保证面板一定可见
      panel.style.left = "auto"; panel.style.top = "";
      panel.style.width = ""; panel.style.height = ""; panel.style.right = "4%";
      try { localStorage.removeItem(ANN_LAYOUT_KEY); } catch (e) {}
      return;
    }
    panel.style.right = "auto";
    panel.style.left = d.left + "px";
    panel.style.top = d.top + "px";
    panel.style.width = d.width + "px";
    panel.style.height = d.height + "px";
  }
  // 保存布局到 Supabase（写当前公告行）+ 本机兜底；仅站长/管理员可写
  async function saveAnnounceLayout(panel) {
    if (!panel || !isAdmin() || !sb) return;
    if (isMobileLayout()) return; // 移动端不持久化布局（面板为静态全宽，悬浮布局无意义）
    const r = panel.getBoundingClientRect();
    // 跳过畸形尺寸（如面板被压成 0/极小），避免把坏值写进数据库/本机，导致下次加载直接消失
    if (!(r.width >= 120 && r.height >= 100)) return;
    const p = panel.offsetParent ? panel.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    const layout = {
      pos_x: Math.round(r.left - p.left),
      pos_y: Math.round(r.top - p.top),
      width: Math.round(r.width),
      height: Math.round(r.height)
    };
    ANN_LAYOUT = { left: layout.pos_x, top: layout.pos_y, width: layout.width, height: layout.height };
    try { localStorage.setItem(ANN_LAYOUT_KEY, JSON.stringify(ANN_LAYOUT)); } catch (e) {}
    if (ANN_CURRENT_ID) {
      try { await sb.from("announcements").update(layout).eq("id", ANN_CURRENT_ID); }
      catch (e) { console.warn("保存公告布局失败", e); }
    }
  }
  // 重置为默认位置/大小（并清空数据库中的布局）
  async function resetAnnounceLayout(panel) {
    if (!panel) return;
    ANN_LAYOUT = null;
    try { localStorage.removeItem(ANN_LAYOUT_KEY); } catch (e) {}
    panel.style.right = "4%";
    panel.style.left = "auto";
    panel.style.top = "84px";
    panel.style.width = "380px";
    panel.style.height = "520px";
    if (isAdmin() && sb && ANN_CURRENT_ID) {
      try { await sb.from("announcements").update({ pos_x: null, pos_y: null, width: null, height: null }).eq("id", ANN_CURRENT_ID); }
      catch (e) { console.warn("重置公告布局失败", e); }
    }
  }
  // 仅在面板拖动/缩放结束后保存，避免高频写入
  let _annLayoutT = null;
  function scheduleSaveAnnounce(panel) {
    clearTimeout(_annLayoutT);
    _annLayoutT = setTimeout(() => saveAnnounceLayout(panel), 400);
  }
  function setupAnnounceLayout() {
    const panel = document.getElementById("announce-panel");
    if (!panel) return;
    applyAnnounceLayout(panel); // 应用上次保存的布局
    // 拖动：在公告标题栏按下（非按钮）即拖动；仅站长/管理员
    panel.addEventListener("mousedown", (e) => {
      if (!isAdmin()) return;
      if (isMobileLayout()) return; // 移动端不启用拖动（面板为静态全宽）
      const head = e.target.closest(".ac-head");
      if (!head) return;                 // 只有抓标题栏才能拖
      if (e.target.closest("button")) return; // 编辑按钮不触发拖动
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      panel.style.right = "auto";
      panel.style.left = rect.left + "px";
      panel.style.top = rect.top + "px";
      panel.classList.add("dragging");
      const move = (ev) => {
        panel.style.left = (ev.clientX - offX) + "px";
        panel.style.top = (ev.clientY - offY) + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        panel.classList.remove("dragging");
        saveAnnounceLayout(panel);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });
    // 缩放（CSS resize:both 原生缩放）结束后保存尺寸
    try {
      const ro = new ResizeObserver(() => scheduleSaveAnnounce(panel));
      ro.observe(panel);
    } catch (e) { /* 老浏览器无 ResizeObserver，忽略 */ }
  }

  /* ---------------- 导出 ---------------- */
  // 供聊天模块取当前登录用户的头像（社区里自己上传的那张），未登录返回 null
  function getCurrentUser() {
    if (!USER || !USER.profile) return null;
    return {
      avatar: USER.profile.avatar_url || "",       // Supabase Storage 公开 URL，无则用渐变首字母占位
      name: USER.profile.username || "我"
    };
  }

  window.Community = {
    init, isAuthed, openIdentity, renderCollectBox, renderMine, onModalOpen, renderForum, openReviewComposer,
    searchUsers, renderOwnerPicks, openProfile, toggleFollow, refreshMsgDot,
    renderAnnouncement, renderEpisodeBox,
    getUser: getCurrentUser,
    renderOwnerVideos, openOwnerVideoAdder, openBiliPlayer
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
