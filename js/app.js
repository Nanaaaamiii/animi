/* ============================================================
   番组计划 · Animi  —  交互逻辑
   SPA 视图切换 / 筛选 / 详情 / Motion.Lab 动效
   ============================================================ */
(function () {
  "use strict";
  const DATA = window.ANIME_DATA || [];
  const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const WEEK_EN = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  // 封面渐变色板（按 id 取色，保证稳定 & 美观）
  const PALETTES = [
    ["#ff9a9e", "#f6416c"], ["#a18cd1", "#fbc2eb"], ["#fbc687", "#e96d71"],
    ["#84fab0", "#8fd3f4"], ["#f6d365", "#fda085"], ["#5ee7df", "#b490ca"],
    ["#ff8fab", "#c56fff"], ["#43e97b", "#38f9d7"], ["#fa709a", "#fee140"],
    ["#30cfd0", "#330867"], ["#a8edea", "#fed6e3"], ["#ff758c", "#ff7eb3"],
    ["#c2e9fb", "#a1c4fd"], ["#f093fb", "#f5576c"], ["#4facfe", "#00f2fe"],
    ["#ffecd2", "#fcb69f"]
  ];
  const cover = (id) => {
    const [a, b] = PALETTES[id % PALETTES.length];
    return `linear-gradient(135deg, ${a}, ${b})`;
  };
  const bigChar = (a) => (a.jp && a.jp.trim()[0]) || (a.title && a.title[0]) || "★";
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const rateTxt = (r) => (r == null ? "—" : r.toFixed(1));

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const star = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77 5.82 21l1.18-6.88-5-4.87 7.1-1.01z"/></svg>';
  const iconSearch = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>';
  const iconSun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const iconMoon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';

  /* ---------------- 卡片渲染 ---------------- */
  function cardHTML(a, rank) {
    const statusCls = a.status === "连载中" ? "on" : "end";
    return `
    <article class="anime-card tilt" data-id="${a.id}">
      <div class="cover" style="background-image:${cover(a.id)}">
        <img class="img" src="${a.cover}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <div class="ov"></div>
        ${rank ? `<div class="rank-badge">#${rank}</div>` : ""}
        <div class="status-tag ${statusCls}">${a.status}</div>
      </div>
      <div class="meta">
        <div class="title">${esc(a.title)}</div>
        <div class="sub">${a.date} · ${a.status}</div>
        <div class="row">
          <span class="rate">${star}${rateTxt(a.rating)}</span>
          <div class="chip-row"><span class="chip">${(a.genres && a.genres[0]) || a.season || "—"}</span></div>
        </div>
      </div>
    </article>`;
  }

  /* ---------------- 视图切换 (SPA) ---------------- */
  const views = ["home", "calendar", "browse", "rank", "community", "mine"];
  function showView(name) {
    if (!views.includes(name)) name = "home";
    views.forEach(v => $("#view-" + v).classList.toggle("hidden", v !== name));
    $$(".nav-links a").forEach(a => a.classList.toggle("active", a.dataset.view === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const root = $("#view-" + name);
    // 重放进入动画
    requestAnimationFrame(() => {
      $$(".reveal", root).forEach(el => el.classList.add("in"));
      ["card-grid", "cal-grid", "rank-list", "mine-grid"].forEach(cls => { const g = $("." + cls, root); if (g) g.classList.add("in"); });
    });
    if (name === "calendar") markToday();
    if (name === "mine") renderMine();
    if (name === "community" && window.Community) Community.renderForum();
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    // 本季新番（2024 各季）作横向轮播
    const featured = DATA.filter(a => a.year >= 2024).sort((x, y) => y.rating - x.rating);
    $("#featured-track").innerHTML = featured.map(a => cardHTML(a)).join("");
    enableDragScroll($("#featured-carousel"));

    // 编辑推荐
    const picks = [...DATA].sort((x, y) => y.rating - x.rating).slice(0, 8);
    $("#picks-grid").innerHTML = picks.map(a => cardHTML(a)).join("");

    // 人气榜预览（Top 5）
    const top = [...DATA].sort((x, y) => y.rating - x.rating).slice(0, 5);
    $("#top5").innerHTML = top.map((a, i) => rankItemHTML(a, i + 1)).join("");

    // 首页卡片交互（本季轮播 / 编辑推荐 / 人气榜）
    ["#featured-carousel", "#picks-grid", "#top5"].forEach(sel => { bindTilt($(sel)); bindRipple($(sel)); });
  }

  /* ---------------- 排行榜 ---------------- */
  function rankItemHTML(a, no) {
    return `
    <div class="rank-item" data-id="${a.id}">
      <div class="rank-no">${no}</div>
      <div class="rank-thumb" style="background-image:url('${a.cover}'), ${cover(a.id)}"></div>
      <div class="rank-info">
        <div class="t">${esc(a.title)}</div>
        <div class="s">${esc(a.jp)}${a.season ? " · " + a.season + "季" : ""}</div>
        <div class="chip-row" style="margin-top:6px"><span class="chip">${a.status}</span></div>
      </div>
      <div class="rank-rate">${star}${rateTxt(a.rating)}</div>
    </div>`;
  }
  function renderRank() {
    const top = [...DATA].sort((x, y) => y.rating - x.rating).slice(0, 20);
    $("#rank-list").innerHTML = top.map((a, i) => rankItemHTML(a, i + 1)).join("");
  }

  /* ---------------- 放送时间表 ---------------- */
  function renderCalendar() {
    const grid = $("#cal-grid");
    grid.innerHTML = WEEK.map((d, idx) => {
      const wd = idx + 1;
      // 本周放送：只显示「正在连载」且在该星期放送的番剧
      const list = DATA.filter(a => a.weekday === wd && a.status === "连载中").sort((x, y) => y.rating - x.rating);
      const items = list.length
        ? list.map(a => `
            <div class="cal-item" data-id="${a.id}">
              <div class="cal-cover" style="background-image:url('${a.cover}'), ${cover(a.id)}; background-size:cover; background-position:center;"></div>
              <div class="cal-info">
                <div class="t">${esc(a.title)}</div>
                <div class="r">${star}${rateTxt(a.rating)}</div>
              </div>
            </div>`).join("")
        : `<div class="cal-empty">— 暂无 —</div>`;
      return `
      <div class="cal-col" data-wd="${wd}">
        <div class="cal-head"><span class="d">${d}</span><span class="c">${WEEK_EN[idx]} · ${list.length}</span></div>
        ${items}
      </div>`;
    }).join("");
  }
  function markToday() {
    const js = new Date().getDay();          // 0=Sun
    const wd = js === 0 ? 7 : js;            // 1=Mon..7=Sun
    $$("#cal-grid .cal-col").forEach(c => c.classList.toggle("today", +c.dataset.wd === wd));
  }

  /* ---------------- 浏览 / 筛选 ---------------- */
  const state = { rating: "all", genre: "all", status: "all", q: "", mineFilter: "all" };
  function renderFilters() {
    $("#season-chips").innerHTML = `<button class="f-chip active" data-rating="all">全部</button>` +
      ["8", "7", "6"].map(r => `<button class="f-chip" data-rating="${r}">${r}★+</button>`).join("");
    const allGenres = Array.from(new Set(DATA.flatMap(a => a.genres || []))).sort();
    $("#genre-chips").innerHTML = `<button class="f-chip active" data-genre="all">全部</button>` +
      allGenres.map(g => `<button class="f-chip" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
    $("#status-chips").innerHTML = `<button class="f-chip active" data-status="all">全部</button>` +
      `<button class="f-chip" data-status="连载中">连载中</button>` +
      `<button class="f-chip" data-status="已完结">已完结</button>`;
  }
  let _bList = [], _bShown = 0;
  const B_PAGE = 60;   // 每次渲染 60 张，避免一次性塞 1.5 万节点卡死
  function renderBrowse() {
    _bList = DATA.filter(a => {
      if (state.rating !== "all" && !(a.rating != null && a.rating >= +state.rating)) return false;
      if (state.genre !== "all" && !(a.genres || []).includes(state.genre)) return false;
      if (state.status !== "all" && a.status !== state.status) return false;
      if (state.q) {
        const q = state.q.toLowerCase();
        const hit = (a.title + a.jp + a.en).toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    }).sort((x, y) => (y.rating || 0) - (x.rating || 0));
    _bShown = 0;
    const g = $("#browse-grid");
    $("#browse-count").textContent = `共 ${_bList.length} 部`;
    if (!_bList.length) {
      g.innerHTML = `<div class="cal-empty" style="grid-column:1/-1;padding:60px">没有匹配的动画，换个条件试试～</div>`;
      const mw = $("#browse-more-wrap"); if (mw) mw.style.display = "none";
      return;
    }
    g.innerHTML = "";
    appendBrowse();
    g.classList.remove("in"); void g.offsetWidth; g.classList.add("in");
  }
  function appendBrowse() {
    const next = _bList.slice(_bShown, _bShown + B_PAGE);
    if (!next.length) return;
    _bShown += next.length;
    $("#browse-grid").insertAdjacentHTML("beforeend", next.map(a => cardHTML(a)).join(""));
    // 只对新追加的卡片重新绑定交互即可，但简单起见整体重绑（幂等）
    bindTilt($("#browse-grid"));
    bindRipple($("#browse-grid"));
    const mw = $("#browse-more-wrap"), mb = $("#browse-more");
    if (mw) mw.style.display = _bShown < _bList.length ? "" : "none";
    if (mb) mb.textContent = `加载更多（${_bShown} / ${_bList.length}）`;
  }

  /* ---------------- 详情弹窗（支持本地 + Bangumi 实时） ---------------- */
  function renderModalShell(a, loading) {
    const tags = (a.genres && a.genres.length)
      ? a.genres.map(g => `<span class="chip">${g}</span>`).join("")
      : `<span class="chip">${WEEK[((a.weekday || 1) - 1)]}放送</span><span class="chip">${a.status || "Bangumi"}</span>`;
    const val = (v) => (v && String(v).trim()) ? esc(v) : "—";
    const ep = a.episodes ? a.episodes + " 话" : (a.status || "—");
    $("#modal").innerHTML = `
      <button class="modal-close" id="modal-close">✕</button>
      <div class="modal-hero">
        <div class="img" style="background-image:url('${a.cover}'), ${cover(a.id)}; background-size:cover;"></div>
        <div class="ov"></div>
      </div>
      <div class="modal-body">
        <div class="m-title">${esc(a.title)}</div>
        <div class="m-jp">${esc(a.jp)}${a.en ? " · " + esc(a.en) : ""}</div>
        <div class="modal-rate">${star}<span data-count="0">${loading ? "…" : rateTxt(a.rating)}</span></div>
        <div class="m-tags">${tags}</div>
        <div class="m-facts">
          <div class="m-fact"><div class="k">放送季度</div><div class="v">${val(a.year ? a.year + " " + (a.season || "") + "季" : "")}</div></div>
          <div class="m-fact"><div class="k">话数</div><div class="v">${ep}</div></div>
          <div class="m-fact"><div class="k">状态</div><div class="v">${val(a.status || "Bangumi")}</div></div>
          <div class="m-fact"><div class="k">首播</div><div class="v">${val(a.date)}</div></div>
          <div class="m-fact"><div class="k">制作公司</div><div class="v">${val(a.studio)}</div></div>
          <div class="m-fact"><div class="k">监督</div><div class="v">${val(a.director)}</div></div>
        </div>
        <div class="m-summary"><h4>剧情简介</h4>${a.summary ? esc(a.summary) : (loading ? "正在从 Bangumi 加载…" : "（暂无简介）")}</div>
        <div class="collect-box" id="collect-box"></div>
      </div>`;
    $("#modal-close").onclick = closeModal;
    if (!loading && a.rating != null) countUp($("#modal .modal-rate span"), parseFloat(a.rating) || 0, 900, 1);
  }

  function openModal(id) {
    const a = DATA.find(x => x.id === id);
    if (!a) return;
    renderModalShell(a, false);
    $("#modal-mask").classList.add("open");
    document.body.style.overflow = "hidden";
    setupCollectBox(a);
    if (window.Community) Community.onModalOpen(a);
  }
  window.openModal = openModal;   // 顶层挂载，供社区/其它模块随时调用
  function closeModal() {
    const m = $("#modal-mask"); if (m) m.classList.remove("open");
    document.body.style.overflow = "";
  }

  /* ---------------- 说明 ----------------
     本站为静态部署，动画资料在构建时由 Bangumi 真实数据烘焙进 js/data.js，
     无需运行时联网 / 代理，任何网络与地区均可直接打开。 */

  /* ---------------- 账号 / 收藏 / 评分 / 评论（纯前端 localStorage） ---------------- */
  const AUTH_KEY = "anime_auth_v1";
  const STAR = "★";
  const STATUS = { want: "想看", doing: "在看", done: "看过", hold: "搁置", drop: "抛弃" };
  const STATUS_ORDER = ["want", "doing", "done", "hold", "drop"];

  function loadAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || { users: {}, session: null }; }
    catch (e) { return { users: {}, session: null }; }
  }
  function saveAuth(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }
  function hashPW(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }
  function currentUser() { return loadAuth().session; }
  function getUser(name) { return loadAuth().users[name] || null; }
  function getCollection(animeId) {
    const u = currentUser(); if (!u) return null;
    const usr = getUser(u); if (!usr) return null;
    return (usr.collections && usr.collections[String(animeId)]) || null;
  }
  function writeCollection(animeId, patch) {
    const auth = loadAuth(); const u = auth.session; if (!u || !auth.users[u]) return false;
    const col = auth.users[u].collections; const key = String(animeId);
    col[key] = Object.assign({}, col[key] || { status: "want", rating: 0, comment: "" }, patch, { updated: Date.now() });
    saveAuth(auth); return true;
  }
  function removeCollection(animeId) {
    const auth = loadAuth(); const u = auth.session; if (!u) return;
    if (auth.users[u] && auth.users[u].collections) delete auth.users[u].collections[String(animeId)];
    saveAuth(auth);
  }

  function toast(msg) {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove("show"), 1600);
  }

  function renderAuthButton() {
    const u = currentUser(); const btn = $("#auth-btn");
    if (u) { btn.innerHTML = `👤 ${esc(u)} <span style="opacity:.55;font-size:11px">▾</span>`; btn.classList.add("logged"); }
    else { btn.textContent = "登录 / 注册"; btn.classList.remove("logged"); }
  }
  function setAuthTab(tab) {
    $$(".auth-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    $("#auth-submit").textContent = tab === "login" ? "登录" : "注册";
    $("#auth-submit").dataset.tab = tab;
  }
  function openAuthModal(tab) {
    setAuthTab(tab || "login");
    $("#auth-err").textContent = "";
    $("#auth-user").value = ""; $("#auth-pass").value = "";
    $("#auth-mask").classList.add("open");
    setTimeout(() => $("#auth-user").focus(), 50);
  }
  function closeAuthModal() { $("#auth-mask").classList.remove("open"); }
  function doAuth() {
    const tab = $("#auth-submit").dataset.tab;
    const name = $("#auth-user").value.trim();
    const pw = $("#auth-pass").value;
    const err = $("#auth-err");
    if (name.length < 2) { err.textContent = "用户名至少 2 个字符"; return; }
    if (pw.length < 4) { err.textContent = "密码至少 4 位"; return; }
    const auth = loadAuth();
    if (tab === "reg") {
      if (auth.users[name]) { err.textContent = "用户名已被注册"; return; }
      auth.users[name] = { pw: hashPW(pw), collections: {} };
      auth.session = name;
    } else {
      const usr = auth.users[name];
      if (!usr) { err.textContent = "用户不存在，请先注册"; return; }
      if (usr.pw !== hashPW(pw)) { err.textContent = "密码错误"; return; }
      auth.session = name;
    }
    saveAuth(auth); closeAuthModal(); renderAuthButton();
    if (!$("#view-mine").classList.contains("hidden")) renderMine();
    if ($("#modal-mask").classList.contains("open")) {
      const id = +($("#modal").dataset.id || 0);
      const a = DATA.find(x => x.id === id); if (a) setupCollectBox(a);
    }
    toast(tab === "reg" ? "注册成功，已登录" : "登录成功");
  }

  function setupCollectBox(a) {
    const box = $("#collect-box"); if (!box) return;
    $("#modal").dataset.id = a.id;
    if (!window.Community || !Community.isAuthed()) {
      box.innerHTML = `<div class="cb-login"><span>进入社区后即可收藏、评分、写评论。</span>
        <button class="btn btn-primary" id="cb-login" style="padding:9px 18px">进入社区 / 设置昵称</button></div>`;
      const b = $("#cb-login", box); if (b) b.onclick = () => Community.openIdentity();
      return;
    }
    Community.renderCollectBox(a, box);
  }

  function mineCardHTML(a, c) {
    return `
    <article class="anime-card tilt" data-id="${a.id}">
      <div class="cover" style="background-image:${cover(a.id)}">
        <img class="img" src="${a.cover}" alt="${esc(a.title)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        <div class="ov"></div>
        <div class="status-tag on">${STATUS[c.status] || ""}</div>
      </div>
      <div class="meta">
        <div class="title">${esc(a.title)}</div>
        <div class="sub">${c.rating ? "我的评分 " + c.rating + "/10" : "未评分"}</div>
        ${c.comment ? `<div class="mine-comment">${esc(c.comment)}</div>` : ""}
      </div>
    </article>`;
  }

  function renderMine() {
    if (window.Community) Community.renderMine();
  }

  /* ---------------- 数字滚动 (count-up) ---------------- */
  function countUp(el, target, dur = 1200, dec = 0) {
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = (from + (target - from) * e).toFixed(dec);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------------- 3D 倾斜 (three-d-tilt) ---------------- */
  function bindTilt(root) {
    $$(".tilt", root).forEach(el => {
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = `perspective(700px) rotateY(${x * 14}deg) rotateX(${-y * 14}deg) translateY(-4px)`;
      });
      el.addEventListener("mouseleave", () => { el.style.transform = ""; });
    });
  }

  /* ---------------- 点击波纹 (ripple-click) ---------------- */
  function bindRipple(root) {
    $$(".anime-card, .rank-item", root).forEach(el => {
      el.addEventListener("click", (e) => {
        const r = el.getBoundingClientRect();
        const rip = document.createElement("span");
        rip.className = "ripple";
        const size = Math.max(r.width, r.height);
        rip.style.width = rip.style.height = size + "px";
        rip.style.left = (e.clientX - r.left) + "px";
        rip.style.top = (e.clientY - r.top) + "px";
        el.appendChild(rip);
        setTimeout(() => rip.remove(), 600);
        const id = +el.dataset.id;
        setTimeout(() => openModal(id), 80);
      });
    });
  }

  /* ---------------- 横向拖拽轮播 (drag-scroll) ---------------- */
  function enableDragScroll(wrap) {
    const track = $(".carousel-track", wrap);
    let down = false, startX = 0, sl = 0, moved = 0;
    wrap.addEventListener("mousedown", (e) => { down = true; startX = e.pageX; sl = wrap.scrollLeft; moved = 0; wrap.classList.add("dragging"); });
    window.addEventListener("mouseup", () => { down = false; wrap.classList.remove("dragging"); });
    wrap.addEventListener("mousemove", (e) => {
      if (!down) return;
      e.preventDefault();
      const dx = e.pageX - startX;
      moved += Math.abs(dx);
      wrap.scrollLeft = sl - dx;
    });
    // 滚轮横向
    wrap.addEventListener("wheel", (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { wrap.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
  }

  /* ---------------- 滚动进度 (scroll-progress) ---------------- */
  function bindScrollProgress() {
    const bar = $(".scroll-progress .bar");
    window.addEventListener("scroll", () => {
      const h = document.documentElement;
      const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
      bar.style.width = (p * 100) + "%";
    }, { passive: true });
  }

  /* ---------------- 滚动揭示 (scroll-reveal) ---------------- */
  function bindReveal() {
    const io = new IntersectionObserver((es) => {
      es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    $$(".reveal").forEach(el => io.observe(el));
  }

  /* ---------------- Hero 粒子背景 (flow-field 风格) ---------------- */
  function heroParticles() {
    const cv = $("#hero-canvas");
    const ctx = cv.getContext("2d");
    let w, h, pts, raf;
    function resize() { w = cv.width = cv.offsetWidth; h = cv.height = cv.offsetHeight; }
    function init() {
      pts = [];
      const n = Math.min(90, Math.floor(w * h / 16000));
      for (let i = 0; i < n; i++) pts.push({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0 });
    }
    let t = 0;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      t += 0.003;
      const dark = document.body.classList.contains("dark");
      pts.forEach((p, i) => {
        const a = Math.sin(p.x * 0.008 + t) * 3.14 + Math.cos(p.y * 0.008 - t);
        p.x += Math.cos(a) * 0.45; p.y += Math.sin(a) * 0.45;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        // 连线
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j]; const dx = p.x - q.x, dy = p.y - q.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 13000) {
            ctx.strokeStyle = dark ? `rgba(180,150,255,${0.10 - d2 / 130000})` : `rgba(240,145,153,${0.12 - d2 / 110000})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
        }
        ctx.fillStyle = dark ? "rgba(200,170,255,.55)" : "rgba(245,150,170,.6)";
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 7); ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    }
    resize(); init(); draw();
    window.addEventListener("resize", () => { cancelAnimationFrame(raf); resize(); init(); draw(); });
  }

  /* ---------------- Hero 打字机 (typewriter) ---------------- */
  function heroTypewriter() {
    const el = $("#hero-tw");
    const lines = ["发现下一部让你心动的番剧。", "每周放送表，准时追更新。", "评分 · 标签 · 制作阵容，一目了然。", "按季度、类型、状态，精准筛选。"];
    let li = 0, ci = 0, del = false;
    setInterval(() => {
      const text = lines[li];
      ci += del ? -1 : 1;
      el.textContent = text.slice(0, ci);
      if (!del && ci >= text.length) { del = true; setTimeout(() => {}, 1400); }
      else if (del && ci <= 0) { del = false; li = (li + 1) % lines.length; }
    }, 75);
  }

  /* ---------------- Hero 统计数字 ---------------- */
  function heroStats() {
    const rated = DATA.filter(a => a.rating != null);
    const avg = rated.reduce((s, a) => s + a.rating, 0) / (rated.length || 1);
    const high = DATA.filter(a => a.rating != null && a.rating >= 7).length;
    countUp($("#stat-count"), DATA.length, 1400, 0);
    countUp($("#stat-avg"), avg, 1400, 1);
    countUp($("#stat-season"), high, 1400, 0);
  }

  /* ---------------- 暗色模式 ---------------- */
  function bindTheme() {
    const saved = localStorage.getItem("anime-theme");
    if (saved === "dark") document.body.classList.add("dark");
    updateThemeIcon();
    $("#theme-toggle").addEventListener("click", () => {
      document.body.classList.toggle("dark");
      localStorage.setItem("anime-theme", document.body.classList.contains("dark") ? "dark" : "light");
      updateThemeIcon();
    });
  }
  function updateThemeIcon() {
    const dark = document.body.classList.contains("dark");
    $("#theme-toggle").innerHTML = dark ? iconSun : iconMoon;
  }

  /* ---------------- 磁吸按钮 (magnetic-button) ---------------- */
  function bindMagnetic() {
    $$(".magnetic").forEach(btn => {
      btn.addEventListener("mousemove", (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.35;
        const y = (e.clientY - r.top - r.height / 2) * 0.35;
        btn.style.transform = `translate(${x}px, ${y}px)`;
      });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    bindTheme();
    // 注入图标
    $(".search-box").insertAdjacentHTML("afterbegin", iconSearch);
    renderHome();
    renderCalendar();
    renderRank();
    renderFilters();
    renderBrowse();

    // 目录分页：点击「加载更多」+ 滚动接近底部自动追加
    const moreBtn = $("#browse-more");
    if (moreBtn) moreBtn.addEventListener("click", appendBrowse);
    let _bLock = false;
    window.addEventListener("scroll", () => {
      if (_bLock || !_bList.length || _bShown >= _bList.length) return;
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 700;
      if (nearBottom) { _bLock = true; appendBrowse(); setTimeout(() => { _bLock = false; }, 120); }
    }, { passive: true });

    bindScrollProgress();
    bindReveal();
    bindMagnetic();
    heroParticles();
    heroTypewriter();
    heroStats();

    // 导航（含顶部 / 品牌 / 页脚所有 data-view 链接）
    $$("[data-view]").forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      const v = a.dataset.view;
      if (v === "mine" && !(window.Community && Community.isAuthed())) { Community.openIdentity(); return; }
      showView(v);
    }));
    // 移动端：hero 按钮跳转到浏览
    $$(".to-browse").forEach(b => b.addEventListener("click", (e) => { e.preventDefault(); showView("browse"); }));
    $("#section-more-rank").addEventListener("click", (e) => { e.preventDefault(); showView("rank"); });

    // 移动端汉堡菜单：展开/收起 + 点链接自动收起 + 点外部关闭
    const navEl = document.querySelector("header.nav");
    const navToggle = $("#nav-toggle");
    if (navEl && navToggle) {
      navToggle.addEventListener("click", (e) => { e.stopPropagation(); navEl.classList.toggle("open"); });
      navEl.querySelectorAll(".nav-links a").forEach(a => a.addEventListener("click", () => navEl.classList.remove("open")));
      document.addEventListener("click", (e) => { if (navEl.classList.contains("open") && !navEl.contains(e.target)) navEl.classList.remove("open"); });
    }

    // 搜索（本地库快速筛选）
    const search = $("#global-search");
    search.addEventListener("input", () => {
      state.q = search.value.trim();
      showView("browse");
      renderBrowse();
    });

    // 动画库说明
    const bh = $("#browse-hint");
    if (bh) bh.textContent = `收录 ${DATA.length} 部 Bangumi 真实动画 · 按 评分 / 类型 / 状态 筛选`;

    // 社区模块在 community.js 中自初始化（DOMContentLoaded）

    // 我的：按状态筛选
    $("#mine-filter").addEventListener("click", (e) => {
      const btn = e.target.closest(".f-chip"); if (!btn) return;
      window.__mineFilter = btn.dataset.f;
      if (window.Community) Community.renderMine();
    });

    // 筛选交互
    $("#season-chips").addEventListener("click", (e) => chipClick(e, "rating", "data-rating"));
    $("#genre-chips").addEventListener("click", (e) => chipClick(e, "genre", "data-genre"));
    $("#status-chips").addEventListener("click", (e) => chipClick(e, "status", "data-status"));

    // 日历 / 排行 点击
    $("#cal-grid").addEventListener("click", (e) => { const it = e.target.closest(".cal-item"); if (it) openModal(+it.dataset.id); });
    $("#rank-list").addEventListener("click", (e) => { const it = e.target.closest(".rank-item"); if (it) openModal(+it.dataset.id); });
    $("#top5").addEventListener("click", (e) => { const it = e.target.closest(".rank-item"); if (it) openModal(+it.dataset.id); });
    $("#modal-mask").addEventListener("click", (e) => { if (e.target.id === "modal-mask") closeModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    showView("home");
  }

  function chipClick(e, key, attr) {
    const btn = e.target.closest(".f-chip");
    if (!btn) return;
    const group = btn.parentElement;
    $$(".f-chip", group).forEach(c => c.classList.remove("active"));
    btn.classList.add("active");
    state[key] = btn.getAttribute(attr);
    renderBrowse();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
