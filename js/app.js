/* ============================================================
   K-ON  —  交互逻辑
   SPA 视图切换 / 筛选 / 详情 / Motion.Lab 动效
   ============================================================ */
(function () {
  "use strict";
  const DATA = window.ANIME_DATA || [];
  const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const WEEK_EN = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  // 免 VPN：Bangumi 公开 API 经反代（基地址见 js/config.js 的 PROXY_BASE）
  const BGM_PROXY = window.APP_CONFIG.PROXY_BASE + "/bgm";
  // 动画资讯：B 站 UP 主（夏日幻听MCE / MCE汉化组）实时投稿 + 站内嵌入播放
  const BILI_UP_MID = 224267770;                 // 当前活跃账号 UID（旧号 7753700 已封禁）
  const BILI_UP_NAME = "夏日幻听MCE";
  const BILI_PROXY = window.APP_CONFIG.PROXY_BASE + "/bili"; // 反代 api.bilibili.com（实时刷新；失败回退静态 bili_feed.json）
  const NEWS_TABLE = "news";                     // Supabase 资讯表（RSS / Twitter 经 RSSHub 同步）

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
  // 评分人数阈值：低于该值视为「暂无评分」（评分人数过少的番评分不可信）
  const RATING_MIN_VOTES = 70;
  // 评分人数充足性：true=可信；false=暂无评分（排序置底 / 详情显示「暂无」）
  const ratingReliable = (a) => a && a.rating_count != null && a.rating_count >= RATING_MIN_VOTES;
  // 用于排序的评分值：暂无评分→ -1（最低）；否则取烘焙评分
  const rateValue = (a) => ratingReliable(a) ? (a.rating != null ? a.rating : -1) : -1;
  // 评分文案：暂无评分 / 普通分数
  const rateText = (a) => {
    if (!ratingReliable(a)) return "暂无";
    return (a.rating == null || a.rating <= 0) ? "暂无" : a.rating.toFixed(1);
  };
  const rateTxt = (r) => (r == null ? "—" : r.toFixed(1)); // 兼容旧调用（仅纯数值）

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
          <span class="rate">${star}${rateText(a)}</span>
          <div class="chip-row"><span class="chip">${(a.genres && a.genres[0]) || a.season || "—"}</span></div>
        </div>
      </div>
    </article>`;
  }

  /* ---------------- 视图切换 (SPA) ---------------- */
  const views = ["home", "calendar", "browse", "news", "game", "community", "mine"];
  function showView(name) {
    if (!views.includes(name)) name = "home";
    views.forEach(v => $("#view-" + v).classList.toggle("hidden", v !== name));
    $$(".nav-links a").forEach(a => a.classList.toggle("active", a.dataset.view === name));
    window.scrollTo({ top: 0, behavior: "smooth" });
    const root = $("#view-" + name);
    // 重放进入动画
    requestAnimationFrame(() => {
      $$(".reveal", root).forEach(el => el.classList.add("in"));
      ["card-grid", "cal-grid", "mine-grid", "game-root"].forEach(cls => { const g = $("." + cls, root); if (g) g.classList.add("in"); });
    });
    if (name === "calendar") { renderCalendar(); markToday(); }
    if (name === "mine") renderMine();
    if (name === "community" && window.Community) Community.renderForum();
    if (name === "game") renderGameRoot();
    if (name === "news") renderNews();
    setTimeout(refreshVisibleRatings, 350); // 视图切换后刷新可见卡片的实时评分
  }

  /* ---------------- 首页 ---------------- */
  // 当前季度（年 + 季）：用于「本季新番」展示本季度最热门番剧
  function currentQuarter() {
    const now = new Date();
    const m = now.getMonth() + 1;
    const s = m <= 2 ? "冬" : m <= 5 ? "春" : m <= 8 ? "夏" : "秋";
    return { year: now.getFullYear(), season: s };
  }
  function renderHome() {
    // 本季新番 → 本季度最热门番剧（按 评分人数/追番人数 回退到评分排序）
    const q = currentQuarter();
    let featured = DATA.filter(a => a.year === q.year && (a.season || "") === q.season);
    if (!featured.length) featured = DATA.filter(a => a.year >= q.year - 1); // 数据未覆盖本季时回退近一年
    featured = featured.sort((x, y) =>
      (y.rating_count || y.collect_count || 0) - (x.rating_count || x.collect_count || 0) ||
      (y.rating || 0) - (x.rating || 0)
    ).slice(0, 24);
    $("#featured-track").innerHTML = featured.map(a => cardHTML(a)).join("");
    enableDragScroll($("#featured-carousel"));

    // 站长推荐（由社区模块从 recommendations 表拉取；仅站长/管理员可编辑）
    if (window.Community) Community.renderOwnerPicks($("#picks-grid"));
    else $("#picks-grid").innerHTML = `<div class="cal-empty" style="grid-column:1/-1;padding:40px">站长推荐模块加载中…</div>`;

    // 动画小游戏入口卡
    const promo = [
      { icon: "🎯", t: "猜动画评分", d: "哪部番评分更高？50 题答对 30 题即通关", tag: "热门" },
    ];
    $("#game-promo").innerHTML = promo.map(p => `
      <div class="game-promo-card" data-view="game">
        <div class="gp-icon">${p.icon}</div>
        <div class="gp-body">
          <div class="gp-title">${p.t} <span class="gp-tag">${p.tag}</span></div>
          <div class="gp-desc">${p.d}</div>
        </div>
        <div class="gp-go">开始 →</div>
      </div>`).join("");
    bindTilt($("#game-promo")); bindRipple($("#game-promo"));

    // 首页卡片交互（本季轮播 / 编辑推荐）：用事件委托绑定点击，
    // 既兼容异步注入的「站长推荐」卡片，也规避拖拽 .dragging 导致的 pointer-events:none 吞点击
    ["#featured-carousel", "#picks-grid"].forEach(sel => { bindTilt($(sel)); bindCardOpen($(sel)); });

    renderCoverMarquee();
    // 首页右侧公告栏
    if (window.Community) Community.renderAnnouncement($("#announce-panel"));
    refreshVisibleRatings(); // 首页卡片渲染后同步实时评分
  }

  // 首页「热门番剧」封面滚动播放：从「本周放送表」(当前季度 + 有放送日 + 日本动画) 随机抽若干部，
  // 带封面 + 名字 + 评分，无缝循环滚动；数据未覆盖本季时回退到评分可靠的热门番剧。
  function renderCoverMarquee() {
    const track = $("#cover-track"); if (!track) return;
    const nowSeason = seasonOfDate(new Date());
    // 与放送时间表「每周放送」同口径：当前真实季度 + broadcastWeekday>0 + 日本动画 + 有封面
    let pool = DATA.filter(a =>
      a.year === nowSeason.year && a.season === nowSeason.season &&
      broadcastWeekday(a) > 0 && isJapanese(a) && a.cover &&
      ratingReliable(a) && a.rating > 0   // 排除「暂无评分」的作品
    );
    if (!pool.length) {
      // 数据未覆盖本季时回退：评分可靠 + 有封面的热门番剧
      pool = DATA.filter(a => ratingReliable(a) && a.rating > 0 && a.cover)
        .sort((x, y) => (y.rating || 0) - (x.rating || 0)).slice(0, 60);
    }
    if (!pool.length) { const m = $("#cover-marquee"); if (m) m.style.display = "none"; return; }
    const copy = pool.slice(), pick = [];
    const N = Math.min(8, copy.length);
    for (let i = 0; i < N; i++) pick.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
    const cell = (a) => `<div class="cover-cell" data-id="${a.id}">
        <div class="cover-img" style="background-image:url('${a.cover}')"></div>
        <div class="cover-cap">${esc(a.title)}</div>
        <div class="cover-rating">${star}${rateText(a)}</div>
      </div>`;
    // 复制一份用于无缝循环（动画位移 -50%）
    track.innerHTML = pick.map(cell).join("") + pick.map(cell).join("");
    track.querySelectorAll(".cover-cell").forEach(c => c.onclick = () => {
      if (window.openModal) openModal(parseInt(c.dataset.id, 10));
    });
  }

  /* ================= 动画小游戏：猜动画评分 =================
     规则：从动画库随机抽两部（无封面/无评分/年份异常已排除），让用户猜哪部评分更高。
     上线 50 题，答对 30 题通关；每人 5 次答错机会。用户可自选对比的年份区间。
     评分人数(<50)过滤：数据无该字段，改用浏览器实时拉取 Bangumi 的 rating.total，
     不足 50 人则换一部；离线/被拦截时静默回退烘焙评分（不强制过滤）。 */
  const GAME = { TOTAL: 50, PASS: 30, MAX_WRONG: 5, MIN_VOTES: 50 };
  const _metaCache = new Map();   // id -> {score,total}（仅缓存成功结果）
  // 实时评分元信息（分数 + 评分人数）
  function fetchMeta(a) {
    if (_metaCache.has(a.id)) return Promise.resolve(_metaCache.get(a.id));
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; if (v) _metaCache.set(a.id, v); resolve(v); };
      const to = setTimeout(() => finish(null), 2600);
      try {
        fetch(BGM_PROXY + "/subject/" + a.id, { headers: { "Accept": "application/json" } })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            clearTimeout(to);
            if (d && d.rating) finish({ score: (d.rating.score != null ? d.rating.score : a.rating), total: (d.rating.total != null ? d.rating.total : null) });
            else finish(null);
          })
          .catch(() => { clearTimeout(to); finish(null); });
      } catch (e) { clearTimeout(to); finish(null); }
    });
  }
  // 构建候选池：有封面 + 评分有效 + 年份在 [from,to] 且合理(>=1980)
  function buildGamePool(fromY, toY) {
    return DATA.filter(a =>
      a && a.cover && a.rating != null && a.rating > 0 &&
      a.year >= Math.max(1980, fromY) && a.year <= toY);
  }
  let _game = null;   // 当前对局状态
  let _gameSeq = 0;   // 对局序号，防止切换视图后旧题目异步渲染覆盖新界面
  function renderGameRoot() {
    const root = $("#game-root");
    if (!root) return;
    // 可选年份范围（数据里实际存在的合理年份）
    const yrs = [...new Set(DATA.map(a => a.year).filter(y => y >= 1980 && y <= 2026))].sort((x, y) => x - y);
    const yMin = yrs[0], yMax = yrs[yrs.length - 1];
    const opt = (y, sel) => `<option value="${y}" ${y === sel ? "selected" : ""}>${y}</option>`;
    root.innerHTML = `
      <div class="game-card-setup">
        <p class="game-lead">从动画库随机抽取两部番剧，凭直觉猜出谁评分更高。先选择要对比的年份区间：</p>
        <div class="game-setup-row">
          <label class="game-field">
            <span>起始年份</span>
            <select id="game-yfrom">${yrs.map(y => opt(y, yMin)).join("")}</select>
          </label>
          <span class="game-tilde">～</span>
          <label class="game-field">
            <span>结束年份</span>
            <select id="game-yto">${yrs.map(y => opt(y, yMax)).join("")}</select>
          </label>
          <button class="btn btn-primary game-start" id="game-start">开始游戏</button>
        </div>
        <p class="game-hint">仅使用有封面、评分人数 ≥ ${GAME.MIN_VOTES} 的番剧（评分人数实时取自 Bangumi）。</p>
      </div>`;
    $("#game-start").addEventListener("click", () => {
      let fromY = parseInt($("#game-yfrom").value, 10);
      let toY = parseInt($("#game-yto").value, 10);
      if (fromY > toY) { const t = fromY; fromY = toY; toY = t; }
      const pool = buildGamePool(fromY, toY);
      if (pool.length < 2) { alert("该年份区间内可用番剧不足 2 部，请扩大范围。"); return; }
      _game = { pool, fromY, toY, idx: 0, correct: 0, wrong: 0, pair: null, busy: false };
      _gameSeq++;
      renderQuestion();
    });
  }
  async function renderQuestion() {
    const root = $("#game-root"); if (!_game) return;
    if (isGameOver()) return;
    const seq = _gameSeq;
    _game.busy = true;
    root.innerHTML = `
      <div class="game-play-head">
        <p class="game-play-rules">凭直觉猜猜看：下面两部番，<b>哪一部评分更高</b>？答对 ${GAME.PASS} / ${GAME.TOTAL} 题即可通关，答错 ${GAME.MAX_WRONG} 次游戏结束。</p>
      </div>
      ${gameHUD()}
      <div class="game-arena" id="game-arena">
        <div class="game-load">准备题目中…</div>
      </div>`;
    let pair = null;
    for (let i = 0; i < 50 && !pair; i++) pair = await pickPair(_game.pool);
    if (seq !== _gameSeq) return;   // 已切换视图/重开，丢弃本次结果
    if (!pair) { root.innerHTML = `<div class="game-play-head"><p class="game-play-rules">凭直觉猜猜看：下面两部番，<b>哪一部评分更高</b>？</p></div>` + gameHUD() + `<div class="game-end"><h2>没有符合条件的番剧 😢</h2><button class="btn btn-ghost" onclick="if(window.renderGameRoot)renderGameRoot()">返回</button></div>`; return; }
    _game.pair = pair; _game.busy = false;
    const arena = $("#game-arena");
    arena.innerHTML = `
      <div class="game-vs-label">哪一部评分更高？</div>
      <div class="game-cards">
        ${gameCardHTML(pair.a, "L")}
        <div class="game-vs">VS</div>
        ${gameCardHTML(pair.b, "R")}
      </div>
      <div class="game-feedback" id="game-feedback"></div>`;
    bindGameCards();
  }
  function gameCardHTML(a, side) {
    return `
      <div class="game-card" data-side="${side}" data-id="${a.id}">
        <div class="game-cover" style="background-image:url('${a.cover}')"></div>
        <div class="game-title">${esc(a.title)}</div>
        <div class="game-sub">${esc(a.jp || "")}</div>
        <div class="game-reveal" data-side="${side}"></div>
      </div>`;
  }
  function bindGameCards() {
    $$("#game-arena .game-card").forEach(c => {
      c.addEventListener("click", () => {
        if (!_game || _game.busy || _game.pair.revealed) return;
        onAnswer(c.dataset.side);
      });
    });
  }
  function onAnswer(side) {
    const p = _game.pair; if (p.revealed) return;
    p.revealed = true;
    const sa = p.sa, sb = p.sb;
    const higherSide = sa === sb ? null : (sa > sb ? "L" : "R");
    const correct = (higherSide === side);
    if (correct) _game.correct++; else _game.wrong++;
    // 渲染揭晓
    $$("#game-arena .game-card").forEach(card => {
      const s = card.dataset.side;
      const sc = s === "L" ? sa : sb;
      const rev = card.querySelector(".game-reveal");
      rev.innerHTML = `<span class="game-rate">${rateTxt(sc)}</span>`;
      card.classList.add("revealed");
      if (s === higherSide) card.classList.add("win");
      else if (s !== side) card.classList.add("lose");
      else card.classList.add("pick-wrong");
    });
    const fb = $("#game-feedback");
    fb.className = "game-feedback " + (correct ? "ok" : "bad");
    fb.innerHTML = correct
      ? `✅ 答对了！${esc(p[higherSide === "L" ? "a" : "b"].title)} 评分更高`
      : `❌ 答错了。其实是 <b>${esc(p[higherSide === "L" ? "a" : "b"].title)}</b> 评分更高（${rateTxt(higherSide === "L" ? sa : sb)} vs ${rateTxt(higherSide === "L" ? sb : sa)}）`;
    // 更新 HUD
    const hud = $("#game-hud"); if (hud) hud.outerHTML = gameHUD();
    // 短暂展示后进入下一题 / 结算
    _game.busy = true;
    setTimeout(() => {
      _game.idx++;
      if (isGameOver()) { endGame(_game.correct >= GAME.PASS); return; }
      renderQuestion();
    }, correct ? 900 : 1500);
  }
  function isGameOver() {
    return _game.wrong >= GAME.MAX_WRONG || _game.correct >= GAME.PASS || _game.idx >= GAME.TOTAL;
  }
  function gameHUD() {
    if (!_game) return "";
    const hearts = Array.from({ length: GAME.MAX_WRONG }, (_, i) =>
      `<span class="heart ${i < (GAME.MAX_WRONG - _game.wrong) ? "" : "lost"}">${i < (GAME.MAX_WRONG - _game.wrong) ? "❤" : "🤍"}</span>`).join("");
    return `
      <div class="game-hud" id="game-hud">
        <div class="game-hud-item">第 <b>${Math.min(_game.idx + 1, GAME.TOTAL)}</b>/${GAME.TOTAL} 题</div>
        <div class="game-hud-item">答对 <b class="good">${_game.correct}</b>/${GAME.PASS}</div>
        <div class="game-hud-item game-lives">剩余错误 ${hearts}</div>
      </div>`;
  }
  // 随机抽取一对（评分接近、评分人数≥MIN_VOTES）
  async function pickPair(pool) {
    const a = pool[(Math.random() * pool.length) | 0];
    let b = pool[(Math.random() * pool.length) | 0], g = 0;
    while ((b.id === a.id || (b.rating != null && a.rating != null && b.rating === a.rating)) && g++ < 12) b = pool[(Math.random() * pool.length) | 0];
    const [ma, mb] = await Promise.all([fetchMeta(a), fetchMeta(b)]);
    const sa = ma && ma.score != null ? ma.score : a.rating;
    const sb = mb && mb.score != null ? mb.score : b.rating;
    const ta = ma ? ma.total : null, tb = mb ? mb.total : null;
    // 评分人数不足则换一部（仅当能确认人数时过滤；离线无法确认则放行）
    if (ta != null && ta < GAME.MIN_VOTES) return null;
    if (tb != null && tb < GAME.MIN_VOTES) return null;
    if (sa === sb) return null;   // 平局重抽，保证有胜负
    return { a, b, sa, sb, ma, mb, revealed: false };
  }
  function endGame(win) {
    const root = $("#game-root"); if (!_game) return;
    const total = _game.idx >= GAME.TOTAL ? GAME.TOTAL : _game.correct + _game.wrong;
    root.innerHTML = `
      <div class="game-end ${win ? "win" : "lose"}">
        <div class="game-end-emoji">${win ? "🏆" : "💔"}</div>
        <h2>${win ? "通关成功！" : (_game.wrong >= GAME.MAX_WRONG ? "错误次数用尽" : "挑战结束")}</h2>
        <p class="game-end-stat">答对 <b>${_game.correct}</b> / ${GAME.TOTAL} 题 · 错误 <b>${_game.wrong}</b> 次</p>
        <p class="game-end-sub">${win ? "你的番剧品味相当在线 🎉" : `再接再厉，答对 ${GAME.PASS} 题即可通关`}</p>
        <div class="game-end-actions">
          <button class="btn btn-primary" id="game-again">再来一局</button>
          <button class="btn btn-ghost" id="game-back">调整设置</button>
        </div>
      </div>`;
    $("#game-again").addEventListener("click", () => { _game.idx = 0; _game.correct = 0; _game.wrong = 0; renderQuestion(); });
    $("#game-back").addEventListener("click", () => { _game = null; renderGameRoot(); });
  }

  /* ---------------- 放送时间表（按季度 · 自动跟随真实日期） ---------------- */
  const SEASONS = ["冬", "春", "夏", "秋"];
  // 当前真实季度（与 data.js 的 year/season 标注口径一致：Dec 归入同年「冬」）
  function seasonOfDate(d) {
    const m = d.getMonth() + 1;
    const s = m <= 2 ? "冬" : m <= 5 ? "春" : m <= 8 ? "夏" : "秋";
    return { year: d.getFullYear(), season: s };
  }
  function seasonStep(sel, dir) {
    let i = SEASONS.indexOf(sel.season), y = sel.year;
    i += dir;
    if (i > 3) { i = 0; y++; } else if (i < 0) { i = 3; y--; }
    return { year: y, season: SEASONS[i] };
  }
  // 推算放送星期：优先用已标注 weekday，否则用首播日期的星期（周一=1..周日=7）
  function broadcastWeekday(a) {
    if (a.weekday > 0) return a.weekday;
    if (a.date && /^\d{4}-\d{2}-\d{2}/.test(a.date)) {
      const g = new Date(a.date + "T00:00:00");
      const w = g.getDay();
      return w === 0 ? 7 : w;
    }
    return 0;
  }
  // 是否「日本动画」：数据无国家字段，用排除法（只排除明显非日番，绝不误删日本番）。
  // 1) 原名 jp 为空 → 多为国产；2) 纯拉丁字母(无中日韩字) → 欧美卡通；
  // 3) 含简体中文独有字(如 传/记/忆/阴/们，日本用不同字形) → 国产动画。
  const _SIMPLIFIED_ONLY = /[传关图认让记亿阴东车灭办单查乐荣劳压佛册权观语说读对孙们侠灵陆苏]/;
  function isJapanese(a) {
    const jp = (a.jp || "").trim();
    if (!jp) return false;                              // 无原名 → 国产
    if (!/[\u4e00-\u9fff]/.test(jp)) return false;      // 纯欧美动画(蝙蝠侠/SpongeBob 等)
    if (_SIMPLIFIED_ONLY.test(jp)) return false;        // 含简体独有字 → 国产动画
    return true;
  }
  let calSel = seasonOfDate(new Date());   // 每季度模式下的选中季度
  let calMode = "week";                     // "week"=本周放送(锁定当前真实季度) | "season"=每季度(可翻季)
  let calExpanded = {};                     // 每日「展开全部」状态，key=星期(1-7)
  function renderCalendar() {
    const grid = $("#cal-grid");
    const nav = $("#cal-season-nav");
    // 每周模式：锁定今天所在季度；每季度模式：用可切换的 calSel
    const sel = calMode === "week" ? seasonOfDate(new Date()) : calSel;
    const nowSeason = seasonOfDate(new Date());
    const isCurrent = (sel.year === nowSeason.year && sel.season === nowSeason.season);
    // 切换器：仅每季度模式显示
    if (nav) {
      if (calMode === "season") {
        const prev = seasonStep(calSel, -1), next = seasonStep(calSel, 1);
        nav.style.display = "";
        nav.innerHTML = `
          <button class="cal-nav-btn" id="cal-prev">‹ 上季</button>
          <div class="cal-nav-cur">${calSel.year} 年 ${calSel.season}季</div>
          <button class="cal-nav-btn" id="cal-next">下季 ›</button>`;
        $("#cal-prev").onclick = () => { calSel = prev; calExpanded = {}; renderCalendar(); };
        $("#cal-next").onclick = () => { calSel = next; calExpanded = {}; renderCalendar(); };
      } else {
        nav.style.display = "none"; nav.innerHTML = "";
      }
    }
    const jpOnly = true;        // 每周 / 每季度 两种视图都只显示日本动画（含未开播/已完结，但排除国产与欧美卡通）
    const seasonTotal = DATA.filter(a => a.year === sel.year && a.season === sel.season && broadcastWeekday(a) > 0 && (!jpOnly || isJapanese(a))).length;
    const desc = $("#cal-desc");
    if (desc) desc.textContent = calMode === "week"
      ? `本周放送 · ${sel.year} 年 ${sel.season}季 · 共 ${seasonTotal} 部日本动画按周更新（含未开播，今天高亮）`
      : (isCurrent ? `当前真实季度 · 共 ${seasonTotal} 部日本动画按周放送；点「下季」可预览未来番剧`
                   : `${sel.year} 年 ${sel.season}季 · 共 ${seasonTotal} 部日本动画（点「下季/上季」切换）`);
    grid.innerHTML = WEEK.map((d, idx) => {
      const wd = idx + 1;
      // 选中季度的番剧，按放送星期归列（下季度数据一进来就显示）
      const list = DATA.filter(a => a.year === sel.year && a.season === sel.season && broadcastWeekday(a) === wd && (!jpOnly || isJapanese(a)))
                       .sort((x, y) => (y.rating || 0) - (x.rating || 0));
      const expanded = !!calExpanded[wd];
      const shown = expanded ? list : list.slice(0, 12);
      const overflow = list.length - 12;
      let moreHtml = "";
      if (list.length > 12) {
        moreHtml = expanded
          ? `<div class="cal-more" onclick="if(window.__toggleCalDay)window.__toggleCalDay(${wd})">收起 ▲</div>`
          : `<div class="cal-more" onclick="if(window.__toggleCalDay)window.__toggleCalDay(${wd})">＋${overflow} 部，点击展开全部</div>`;
      }
      const items = shown.length
        ? shown.map(a => `
            <div class="cal-item" data-id="${a.id}" onclick="if(window.openModal)openModal(${a.id})">
              <div class="cal-cover" style="background-image:url('${a.cover}'), ${cover(a.id)}; background-size:cover; background-position:center;"></div>
              <div class="cal-info">
                <div class="t">${esc(a.title)}</div>
                <div class="r">${star}${rateTxt(a.rating)}</div>
              </div>
            </div>`).join("") + moreHtml
        : `<div class="cal-empty">— 暂无 —</div>`;
      return `
      <div class="cal-col" data-wd="${wd}">
        <div class="cal-head"><span class="d">${d}</span><span class="c">${WEEK_EN[idx]} · ${list.length}</span></div>
        ${items}
      </div>`;
    }).join("");
    refreshVisibleRatings(); // 放送表卡片渲染后同步实时评分
  }
  // 每日「展开/收起全部」：供日历卡片下方的「＋N 部，点击展开全部」内联调用
  window.__toggleCalDay = function (wd) {
    calExpanded[wd] = !calExpanded[wd];
    renderCalendar();
  };
  function markToday() {
    const js = new Date().getDay();          // 0=Sun
    const wd = js === 0 ? 7 : js;            // 1=Mon..7=Sun
    // 仅在「每周」模式或当前季度下高亮今天列（翻到过往/未来季时不误导）
    const show = calMode === "week" || (calSel.year === seasonOfDate(new Date()).year && calSel.season === seasonOfDate(new Date()).season);
    $$("#cal-grid .cal-col").forEach(c => c.classList.toggle("today", show && +c.dataset.wd === wd));
  }
  function bindCalendarTabs() {
    const tabs = $("#cal-tabs"); if (!tabs) return;
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".cal-tab"); if (!b) return;
      calMode = b.dataset.mode;
      calExpanded = {};
      $$(".cal-tab", tabs).forEach(t => t.classList.toggle("active", t === b));
      renderCalendar(); markToday();
    });
  }

  /* ---------------- 浏览 / 筛选 ---------------- */
  // 排序：rating=评分 / date=放送时间 / collect=追番人数；dir=asc|desc 控制正序/倒序
  const state = { sort: "rating", dir: "desc", genre: "all", status: "all", q: "", mineFilter: "all" };
  const SORTS = [["rating", "评分"], ["date", "放送时间"], ["collect", "追番人数"]];
  function renderFilters() {
    $("#season-chips").innerHTML = SORTS.map(([k, label], i) =>
      `<button class="f-chip${i === 0 ? " active" : ""}" data-sort="${k}">${label}</button>`).join("");
    const dirBtn = $("#sort-dir");
    if (dirBtn) dirBtn.textContent = state.dir === "asc" ? "↑ 升序" : "↓ 降序";
    const allGenres = Array.from(new Set(DATA.flatMap(a => a.genres || []))).sort();
    $("#genre-chips").innerHTML = `<button class="f-chip active" data-genre="all">全部</button>` +
      allGenres.map(g => `<button class="f-chip" data-genre="${esc(g)}">${esc(g)}</button>`).join("");
    $("#status-chips").innerHTML = `<button class="f-chip active" data-status="all">全部</button>` +
      `<button class="f-chip" data-status="连载中">连载中</button>` +
      `<button class="f-chip" data-status="已完结">已完结</button>`;
  }
  // 排序函数（纯函数，不修改原数组）；dir 控制 升序/降序
  function sortBrowse(list) {
    const s = state.sort || "rating";
    // 基线比较器本身是「降序」（y 在前=高/新在前）；asc 需取反 → mul=-1，desc→mul=1
    const mul = state.dir === "asc" ? -1 : 1;
    const arr = list.slice();
    if (s === "date") arr.sort((x, y) => mul * (y.date || "").localeCompare(x.date || ""));
    else if (s === "collect") arr.sort((x, y) => mul * ((y.collect_count || y.rating_count || 0) - (x.collect_count || x.rating_count || 0) || (y.rating || 0) - (x.rating || 0)));
    else arr.sort((x, y) => mul * (rateValue(y) - rateValue(x))); // 评分：暂无评分置底（升序时置顶）
    return arr;
  }
  let _bList = [], _bShown = 0;
  const B_PAGE = 60;   // 每次渲染 60 张，避免一次性塞 1.5 万节点卡死
  function renderBrowse() {
    _bList = sortBrowse(DATA.filter(a => {
      if (state.genre !== "all" && !(a.genres || []).includes(state.genre)) return false;
      if (state.status !== "all" && a.status !== state.status) return false;
      if (state.q) {
        const q = state.q.toLowerCase();
        const hit = (a.title + a.jp + a.en).toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    }));
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
    refreshVisibleRatings(); // 动画库每批卡片渲染后同步实时评分
  }

  /* ---------------- 用户搜索下拉（昵称 / UID） ---------------- */
  function closeUserSearch() { const b = $("#user-search"); if (b) b.hidden = true; }
  function renderUserSearch(rows, q) {
    const box = $("#user-search"); if (!box) return;
    if (!rows || !rows.length) { box.hidden = true; return; }
    const av = (u) => u.avatar_url
      ? `<img class="us-av" src="${esc(u.avatar_url)}" alt="">`
      : `<span class="us-av" style="background:${cover(u.id)}">${esc((u.username || "U")[0] || "U")}</span>`;
    box.innerHTML = `<div class="us-head">用户 · 昵称 / UID 匹配「${esc(q)}」共 ${rows.length} 位</div>` +
      rows.map(u => `
        <div class="us-row" data-uid="${u.id}">
          ${av(u)}
          <div class="us-meta">
            <div class="us-name">${esc(u.username)}${u.role ? `<span class="role-badge role-owner">${esc(u.role)}</span>` : ""}${u.uid != null ? `<span class="c-uid">UID:${u.uid}</span>` : ""}</div>
          </div>
          ${u.isSelf ? "" : (u.following ? `<button class="us-follow following" data-act="unfollow">已关注</button>` : `<button class="us-follow" data-act="follow">＋ 关注</button>`)}
        </div>`).join("");
    box.hidden = false;
    box.querySelectorAll(".us-row").forEach(r => r.onclick = (e) => {
      if (e.target.closest(".us-follow")) return;
      const id = r.dataset.uid;
      closeUserSearch();
      if (window.Community) Community.openProfile(id);
    });
    box.querySelectorAll(".us-follow").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      const id = b.closest(".us-row").dataset.uid;
      if (!window.Community) return;
      await Community.toggleFollow(id);
      Community.searchUsers(q, (rs) => renderUserSearch(rs, q));
    });
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
        <div class="modal-rate">${star}<span data-count="0">${loading ? "…" : rateText(a)}</span></div>
        <div class="m-tags">${tags}</div>
        <div class="m-facts">
          <div class="m-fact"><div class="k">放送季度</div><div class="v">${val(a.year ? a.year + " " + (a.season || "") + "季" : "")}</div></div>
          <div class="m-fact"><div class="k">话数</div><div class="v">${ep}</div></div>
          <div class="m-fact"><div class="k">状态</div><div class="v">${val(a.status || "Bangumi")}</div></div>
          <div class="m-fact"><div class="k">首播</div><div class="v">${val(a.date)}</div></div>
          <div class="m-fact"><div class="k">制作公司</div><div class="v" id="m-studio">${val(a.studio)}</div></div>
          <div class="m-fact"><div class="k">监督</div><div class="v" id="m-director">${val(a.director)}</div></div>
        </div>
        <div class="m-summary"><h4>剧情简介</h4>${a.summary ? esc(a.summary) : (loading ? "正在从 Bangumi 加载…" : "（暂无简介）")}</div>
        <div class="collect-box" id="collect-box"></div>
        <div class="episode-box" id="episode-box"></div>
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
    if (window.Community) Community.renderEpisodeBox(a);
    if (window.Community) Community.onModalOpen(a);
    refreshLiveRating(a);   // 详情打开时实时拉取 Bangumi 最新评分（拉不到则用烘焙值）
  }

  // 从 Bangumi staff 中提取 监督(导演) 与 制作公司(动画制作)
  function extractStaff(d) {
    const staff = (d && d.staff) || [];
    let director = "", studio = "";
    for (const s of staff) {
      const jobs = s.jobs || [];
      if (!director && jobs.some(j => j === "导演" || j === "监督")) director = s.name;
      if (!studio && jobs.some(j => j === "动画制作" || j === "制作")) studio = s.name;
    }
    return { director, studio };
  }
  // 评分 / 制作阵容 实时刷新：客户端直连 Bangumi legacy 接口（免 token，responseGroup=large 含 staff）。
  // 若浏览器被 CORS 拦截或断网，静默回退到烘焙值，绝不报错。
  function refreshLiveRating(a) {
    if (!a || !a.id) return;
    const el = $("#modal .modal-rate span");
    const apply = (score) => {
      if (el && score != null && !isNaN(score)) {
        el.textContent = rateTxt(score);
        el.title = "Bangumi 实时评分";
      }
    };
    try {
      fetch(BGM_PROXY + "/subject/" + a.id + "?responseGroup=large", { headers: { "Accept": "application/json" } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && d.rating && d.rating.score != null) apply(d.rating.score);
          if (d && d.staff) {
            const { director, studio } = extractStaff(d);
            const sd = $("#m-studio"); if (sd && studio) sd.textContent = studio;
            const dd = $("#m-director"); if (dd && director) dd.textContent = director;
          }
        })
        .catch(() => {});
    } catch (e) { /* 离线或被拦截：保持烘焙值 */ }
  }

  // ---- 浏览卡片实时评分刷新（localStorage 缓存 + 限流，避免狂刷 Bangumi 接口）----
  // 详情弹窗已由 refreshLiveRating 每次打开实时拉取；此处补充：动画库 / 首页 / 放送表 等
  // 列表卡片在渲染后，把可见番剧的评分同步为 Bangumi 当前值（缓存 6h，限流 ~5 请求/秒）。
  const LIVE_KEY = "anime_live_v1";
  const LIVE_TTL = 6 * 3600 * 1000;
  let _liveCache = (() => { try { return JSON.parse(localStorage.getItem(LIVE_KEY)) || {}; } catch (e) { return {}; } })();
  let _liveQueue = [], _liveRunning = false;
  function _saveLive() { try { localStorage.setItem(LIVE_KEY, JSON.stringify(_liveCache)); } catch (e) {} }
  function applyLiveRate(id, score) {
    if (score == null || isNaN(score)) return;
    $$(`[data-id="${id}"]`).forEach(el => {
      if (!el.matches(".anime-card, .cal-item, .cover-cell")) return;
      const r = el.querySelector(".rate, .r, .cover-rating");
      if (r) { r.innerHTML = star + rateTxt(score); r.title = "Bangumi 实时评分"; r.classList.add("live"); }
    });
  }
  function refreshLiveRatings(ids) {
    const now = Date.now();
    const fresh = [], stale = [];
    ids.forEach(id => {
      const c = _liveCache[id];
      if (c && (now - c[1]) < LIVE_TTL) fresh.push([id, c[0]]);
      else stale.push(id);
    });
    fresh.forEach(([id, s]) => applyLiveRate(id, s));                         // 缓存命中：立即更新
    stale.slice(0, 80 - _liveQueue.length).forEach(id => _liveQueue.push(id)); // 待拉取队列上限 80
    if (!_liveRunning) drainLiveQueue();
  }
  function drainLiveQueue() {
    if (!_liveQueue.length) { _liveRunning = false; _saveLive(); return; }
    _liveRunning = true;
    const id = _liveQueue.shift();
    fetch(BGM_PROXY + "/subject/" + id + "?responseGroup=large", { headers: { "Accept": "application/json" } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.rating && d.rating.score != null) {
          _liveCache[id] = [d.rating.score, Date.now()];
          applyLiveRate(id, d.rating.score);
        }
      })
      .catch(() => {})
      .finally(() => setTimeout(drainLiveQueue, 200)); // ~5 请求/秒，避免触发 Bangumi 限流
  }
  function refreshVisibleRatings() {
    const ids = new Set();
    $$(".anime-card[data-id], .cal-item[data-id], .cover-cell[data-id]").forEach(el => {
      if (!el.querySelector(".rate, .r, .cover-rating")) return; // 仅当卡片确实展示评分
      const id = parseInt(el.dataset.id, 10);
      if (!isNaN(id)) ids.add(id);
    });
    if (ids.size) refreshLiveRatings([...ids]);
  }
  window.refreshVisibleRatings = refreshVisibleRatings; // 供异步渲染（社区/加载更多）后调用

  window.openModal = openModal;   // 顶层挂载，供社区/其它模块随时调用
  window.renderGameRoot = renderGameRoot;   // 顶层挂载，供游戏内「返回」按钮内联调用
  function closeModal() {
    const m = $("#modal-mask"); if (m) m.classList.remove("open");
    // 卸载 modal 内的 B站 iframe：仅隐藏(.open 移除)不会停止跨域 iframe 的音频，
    // 必须把 iframe 导航到 about:blank 并清空内容，否则关掉弹窗声音仍继续。
    const f = $("#modal iframe");
    if (f) {
      try { f.src = "about:blank"; } catch (e) {}
      try { if (f.contentWindow && f.contentWindow.stop) f.contentWindow.stop(); } catch (e) {}
      try { $("#modal").innerHTML = ""; } catch (e) {}
    }
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
    $$(".anime-card", root).forEach(el => {
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

  /* ---------------- 卡片点击打开详情（事件委托版） ----------------
     用容器级委托代替逐卡 bindRipple：
     - 兼容「站长推荐」等异步注入的卡片（bindRipple 在卡片插入前就跑、会漏绑）
     - 即使卡片因 .dragging 的 pointer-events:none 变成点击目标落在容器上，
       e.target.closest('.anime-card') 仍能沿 DOM 找到卡片，点击不会丢失 */
  function bindCardOpen(root) {
    if (!root || root.dataset.openBound) return; // 只挂一次，避免重复监听
    root.dataset.openBound = "1";
    root.addEventListener("click", (e) => {
      const card = e.target.closest(".anime-card");
      if (!card || !root.contains(card)) return;
      const id = +card.dataset.id;
      if (!id) return;
      // 点击波纹（视觉反馈）
      const r = card.getBoundingClientRect();
      const rip = document.createElement("span");
      rip.className = "ripple";
      const size = Math.max(r.width, r.height);
      rip.style.width = rip.style.height = size + "px";
      rip.style.left = (e.clientX - r.left) + "px";
      rip.style.top = (e.clientY - r.top) + "px";
      card.appendChild(rip);
      setTimeout(() => rip.remove(), 600);
      setTimeout(() => { if (window.openModal) openModal(id); }, 80);
    });
  }

  /* ---------------- 横向拖拽轮播 (drag-scroll) ---------------- */
  function enableDragScroll(wrap) {
    // 触屏设备用原生横向滚动（CSS overflow-x:auto + scroll-snap），不绑定鼠标拖拽，避免与手指滑动冲突
    if (window.matchMedia && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const track = $(".carousel-track", wrap);
    let down = false, startX = 0, sl = 0, dragging = false;
    wrap.addEventListener("mousedown", (e) => { down = true; startX = e.pageX; sl = wrap.scrollLeft; dragging = false; });
    window.addEventListener("mouseup", () => { down = false; dragging = false; wrap.classList.remove("dragging"); });
    wrap.addEventListener("mousemove", (e) => {
      if (!down) return;
      const dx = e.pageX - startX;
      // 仅在真实拖动（超过阈值）时才加 dragging：避免「单击」被 pointer-events:none 吞掉点击
      if (!dragging && Math.abs(dx) > 5) { dragging = true; wrap.classList.add("dragging"); }
      if (!dragging) return;
      e.preventDefault();
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
    // 仅保留「收录作品」计数（平均评分 / 高分番剧 已移除）
    countUp($("#stat-count"), DATA.length, 1400, 0);
    // 注册人数：异步从 Supabase 取 profiles 计数（代理不可达时静默回退「—」）
    loadUserCount();
  }

  /* 注册人数：查询 Supabase profiles 表行数。
     依赖 window.Community.sb（community.js 异步初始化），故先等待其就绪；
     若代理不可达（如国内无 VPN 访问 Cloudflare Worker），静默回退为「—」。 */
  async function loadUserCount() {
    const el = $("#stat-users");
    if (!el) return;
    let sb = window.Community && window.Community.sb;
    for (let i = 0; i < 25 && !sb; i++) {
      await new Promise(r => setTimeout(r, 100));
      sb = window.Community && window.Community.sb;
    }
    if (!sb) { el.textContent = "—"; return; }
    try {
      const { count, error } = await sb
        .from("profiles")
        .select("*", { count: "exact", head: true });
      if (error) { el.textContent = "—"; return; }
      countUp(el, count || 0, 1400, 0);
    } catch (e) {
      el.textContent = "—";
    }
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

  /* ---------------- 动画资讯 ---------------- */
  function fmtCount(n) {
    n = +n || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, "") + "万";
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "千";
    return String(n);
  }
  function timeAgo(ts) {
    if (!ts) return "";
    // Supabase 的 published_at 是 ISO 字符串（如 "2026-07-17T07:17:36Z"），
    // 而 B 站视频的 created 是数值型 Unix 时间戳。这里统一成数值再计算。
    if (typeof ts === "string") {
      const t = Date.parse(ts);
      if (!isNaN(t)) ts = Math.floor(t / 1000);
    }
    if (typeof ts !== "number" || isNaN(ts)) return "";
    const s = Math.floor(Date.now() / 1000) - ts;
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "分钟前";
    if (s < 86400) return Math.floor(s / 3600) + "小时前";
    const d = Math.floor(s / 86400);
    if (d === 1) return "昨天";
    if (d < 30) return d + "天前";
    if (d < 365) return Math.floor(d / 30) + "个月前";
    return Math.floor(d / 365) + "年前";
  }
  // 在站内用 B 站官方嵌入播放器观看（player.bilibili.com 允许跨站嵌入，无需 API）
  function openBiliPlayer(bvid, title) {
    const el = $("#modal");
    el.dataset.id = "";
    el.innerHTML = `<div class="modal-bili">
      <div class="modal-bili-head"><b>${esc(title)}</b><button class="modal-close" id="bili-modal-close" aria-label="关闭">✕</button></div>
      <div class="modal-bili-frame"><iframe src="https://player.bilibili.com/player.html?bvid=${esc(bvid)}&page=1&high_quality=1&danmaku=0&autoplay=0" allowfullscreen scrolling="no" frameborder="0"></iframe></div>
      <div class="modal-bili-foot"><a href="https://www.bilibili.com/video/${esc(bvid)}" target="_blank" rel="noopener">在 B 站打开 ↗</a></div>
    </div>`;
    const c = $("#bili-modal-close"); if (c) c.addEventListener("click", closeModal);
    $("#modal-mask").classList.add("open");
  }
  // UP 主视频：从静态 bili_feed.json 渲染（由 collect_bilibili.py 定时同步，
  // 经 GitHub Pages 直接可读，无需浏览器直连 B 站 API 或 Worker 反代——后者因
  // B 站对数据中心 IP 的风控(412 "request was banned")无法稳定拉取）。live=true
  // 时加缓存破坏串重新拉取已部署的最新快照，并提示数据更新时间。
  let biliAll = null;          // 全量视频（缓存）
  let biliPage = 0;            // 当前页（0 起）
  let lastBiliUpdate = 0;      // 快照更新时间（Unix 秒）
  const BILI_PAGE_SIZE = 10;
  async function renderNewsBili(live) {
    const grid = $("#news-bili"), empty = $("#news-bili-empty"), nameEl = $("#news-up-name");
    if (nameEl) nameEl.textContent = BILI_UP_NAME;
    const url = "bili_feed.json" + (live ? "?" + Date.now() : "");
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        biliAll = j.videos || null;
        if (j.up_name && nameEl) nameEl.textContent = j.up_name;
        lastBiliUpdate = j.updated_at || 0;
        biliPage = 0;
        paintBiliPage();
        if (live && lastBiliUpdate) {
          const d = new Date(lastBiliUpdate * 1000);
          const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
          toast(`已获取最新投稿（数据更新于 ${hh}:${mm}）`);
        }
        return;
      }
    } catch (e) { /* 忽略，保留上次缓存 */ }
    if (live) toast("暂时无法连接，已显示最近一次缓存");
  }
  // 仅重绘当前页（翻页时不重新拉数据）
  function paintBiliPage() {
    const grid = $("#news-bili"), empty = $("#news-bili-empty");
    const list = biliAll || [];
    if (!list.length) { if (empty) empty.hidden = false; if (grid) grid.innerHTML = ""; renderBiliPager(0); return; }
    if (empty) empty.hidden = true;
    const totalPages = Math.max(1, Math.ceil(list.length / BILI_PAGE_SIZE));
    if (biliPage >= totalPages) biliPage = totalPages - 1;
    if (biliPage < 0) biliPage = 0;
    const items = list.slice(biliPage * BILI_PAGE_SIZE, biliPage * BILI_PAGE_SIZE + BILI_PAGE_SIZE);
    grid.innerHTML = items.map(v => `
      <article class="bili-card" data-bvid="${esc(v.bvid)}">
        <div class="bili-cover">
          <img src="${esc(v.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">
          <span class="bili-play">▶ 播放</span>
          <span class="bili-len">${esc(v.length)}</span>
        </div>
        <div class="bili-meta">
          <div class="bili-title">${esc(v.title)}</div>
          <div class="bili-sub">${fmtCount(v.play)} 播放 · ${timeAgo(v.created)}</div>
        </div>
      </article>`).join("");
    $$("#news-bili .bili-card").forEach(c => c.addEventListener("click", () => openBiliPlayer(c.dataset.bvid, c.querySelector(".bili-title").textContent)));
    renderBiliPager(totalPages);
  }
  function renderBiliPager(totalPages) {
    const pager = $("#news-bili-pager"); if (!pager) return;
    if (!totalPages || totalPages <= 1) { pager.innerHTML = ""; return; }
    pager.innerHTML = `
      <button class="bili-pg-btn" id="bili-prev" ${biliPage <= 0 ? "disabled" : ""}>‹ 上一页</button>
      <span class="bili-pg-info">第 ${biliPage + 1} / ${totalPages} 页</span>
      <button class="bili-pg-btn" id="bili-next" ${biliPage >= totalPages - 1 ? "disabled" : ""}>下一页 ›</button>`;
    const prev = $("#bili-prev"), next = $("#bili-next");
    if (prev) prev.onclick = () => { if (biliPage > 0) { biliPage--; paintBiliPage(); } };
    if (next) next.onclick = () => { if (biliPage < totalPages - 1) { biliPage++; paintBiliPage(); } };
  }
  // 帖文动态：读 Supabase news 表（由 collect_news.py 从 Anime News Network 同步并翻译）
  // 帖文动态：一次性拉取后前端分页，每页 5 条（资讯流）
  let newsAll = [];
  let newsPage = 0;
  const NEWS_PAGE_SIZE = 5;
  async function renderNewsFeed() {
    const box = $("#news-feed"), empty = $("#news-feed-empty");
    if (!box) return;
    const sb = window.Community && window.Community.sb;
    if (!sb) { if (empty) empty.hidden = false; newsAll = []; paintNewsPage(); return; }
    try {
      const { data, error } = await sb.from(NEWS_TABLE).select("*").order("published_at", { ascending: false }).limit(200);
      if (error || !data || !data.length) { if (empty) empty.hidden = false; newsAll = []; paintNewsPage(); return; }
      newsAll = data; newsPage = 0;
      if (empty) empty.hidden = true;
      paintNewsPage();
    } catch (e) { if (empty) empty.hidden = false; newsAll = []; paintNewsPage(); }
  }
  function paintNewsPage() {
    const box = $("#news-feed"), pager = $("#news-feed-pager");
    const list = newsAll || [];
    if (!box) return;
    if (!list.length) { box.innerHTML = ""; if (pager) pager.innerHTML = ""; return; }
    const totalPages = Math.max(1, Math.ceil(list.length / NEWS_PAGE_SIZE));
    if (newsPage >= totalPages) newsPage = totalPages - 1;
    if (newsPage < 0) newsPage = 0;
    const items = list.slice(newsPage * NEWS_PAGE_SIZE, newsPage * NEWS_PAGE_SIZE + NEWS_PAGE_SIZE);
    box.innerHTML = items.map((n, i) => `
      <div class="news-item" data-idx="${newsPage * NEWS_PAGE_SIZE + i}">
        ${n.image ? `<img class="news-thumb" src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">` : ""}
        <div class="news-body">
          <div class="news-source">${esc(n.source || "资讯")}${n.author ? " · " + esc(n.author) : ""}</div>
          <div class="news-title">${esc(n.title_cn || n.title)}</div>
          ${n.summary_cn || n.summary ? `<div class="news-summary">${esc(n.summary_cn || n.summary)}</div>` : ""}
          <div class="news-time">${timeAgo(n.published_at)}</div>
        </div>
      </div>`).join("");
    box.querySelectorAll(".news-item").forEach(el => el.addEventListener("click", () => openNewsModal(newsAll[+el.dataset.idx])));
    if (!pager) return;
    if (totalPages <= 1) { pager.innerHTML = ""; return; }
    pager.innerHTML = `
      <button class="news-pg-btn" id="news-prev" ${newsPage <= 0 ? "disabled" : ""}>‹ 上一页</button>
      <span class="news-pg-info">第 ${newsPage + 1} / ${totalPages} 页</span>
      <button class="news-pg-btn" id="news-next" ${newsPage >= totalPages - 1 ? "disabled" : ""}>下一页 ›</button>`;
    const prev = $("#news-prev"), next = $("#news-next");
    if (prev) prev.onclick = () => { if (newsPage > 0) { newsPage--; paintNewsPage(); } };
    if (next) next.onclick = () => { if (newsPage < totalPages - 1) { newsPage++; paintNewsPage(); } };
  }
  // 点开资讯：站内弹窗展示中文，不再跳出到英文 ANN 站外
  function openNewsModal(n) {
    if (!n) return;
    const el = $("#modal");
    const hero = n.image ? `<div class="modal-news-hero" style="background-image:url('${esc(n.image)}')"></div>` : "";
    el.innerHTML = `
      <button class="modal-close" id="news-modal-close">✕</button>
      <div class="modal-news">
        ${hero}
        <div class="m-news-source">${esc(n.source || "资讯")}${n.author ? " · " + esc(n.author) : ""} · ${timeAgo(n.published_at)}</div>
        <div class="m-news-title">${esc(n.title_cn || n.title)}</div>
        ${n.title_cn && n.title && n.title_cn !== n.title ? `<div class="m-news-title-en">${esc(n.title)}</div>` : ""}
        <div class="m-news-summary">${esc(n.summary_cn || n.summary || "（暂无简介）")}</div>
        <div class="m-news-foot">
          ${n.url ? `<a class="news-origin" href="${esc(n.url)}" target="_blank" rel="noopener">查看原文 ↗</a>` : ""}
          <span class="m-news-note">译文由 AI 生成，仅供参考</span>
        </div>
      </div>`;
    const c = $("#news-modal-close"); if (c) c.addEventListener("click", closeModal);
    $("#modal-mask").classList.add("open");
    document.body.style.overflow = "hidden";
  }
  async function renderNews() {
    await renderNewsBili(false);   // 默认静态 JSON（定时同步，保证可用）
    // 站长推荐视频（仅站长可编辑，数据存 Supabase owner_videos 表）
    if (window.Community && window.Community.renderOwnerVideos) {
      const ov = $("#owner-videos-grid");
      if (ov) Community.renderOwnerVideos(ov);
    }
    renderNewsFeed();             // 帖文动态放在站长推荐视频下面
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    bindTheme();
    // 注入图标
    $(".search-box").insertAdjacentHTML("afterbegin", iconSearch);
    // 把卡片渲染函数交给社区模块，使「站长推荐」与动画库卡片样式一致
    if (window.Community) Community.cardHTML = cardHTML;
    renderHome();
    renderCalendar();
    bindCalendarTabs();
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
    // 动画资讯：点「刷新」重新拉取已部署的最新投稿快照（数据由后台定时同步）
    const nb = $("#news-refresh");
    if (nb) nb.addEventListener("click", () => { nb.disabled = true; nb.textContent = "刷新中…"; renderNewsBili(true).finally(() => { nb.disabled = false; nb.textContent = "↻ 刷新"; }); });
    // 帖文动态：点「刷新」即时重读 Supabase news 表（看后台爬虫最新同步的内容）
    const nfr = $("#news-feed-refresh");
    if (nfr) nfr.addEventListener("click", () => { nfr.disabled = true; const old = nfr.textContent; nfr.textContent = "刷新中…"; renderNewsFeed(); setTimeout(() => { nfr.disabled = false; nfr.textContent = old; }, 800); });
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

    // 移动端汉堡菜单：展开/收起 + 点链接自动收起 + 点外部关闭
    const navEl = document.querySelector("header.nav");
    const navToggle = $("#nav-toggle");
    if (navEl && navToggle) {
      navToggle.addEventListener("click", (e) => { e.stopPropagation(); navEl.classList.toggle("open"); });
      navEl.querySelectorAll(".nav-links a").forEach(a => a.addEventListener("click", () => navEl.classList.remove("open")));
      document.addEventListener("click", (e) => { if (navEl.classList.contains("open") && !navEl.contains(e.target)) navEl.classList.remove("open"); });
    }

    // 搜索（本地库快速筛选动画）+ 用户搜索下拉（昵称 / UID）
    const search = $("#global-search");
    let _usTimer = null;
    search.addEventListener("input", () => {
      const q = search.value.trim();
      state.q = q;
      showView("browse");
      renderBrowse();
      clearTimeout(_usTimer);
      _usTimer = setTimeout(() => {
        if (window.Community && q) Community.searchUsers(q, (rows) => renderUserSearch(rows, q));
        else closeUserSearch();
      }, 250);
    });
    search.addEventListener("focus", () => {
      const q = search.value.trim();
      if (q && window.Community) Community.searchUsers(q, (rows) => renderUserSearch(rows, q));
    });
    // 点击搜索框 / 下拉以外的区域关闭用户下拉
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-box") && !e.target.closest("#user-search")) closeUserSearch();
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

    // 排序交互（取代原「8★+」评分筛选）
    $("#season-chips").addEventListener("click", (e) => {
      const b = e.target.closest(".f-chip"); if (!b) return;
      $$(".f-chip", $("#season-chips")).forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      state.sort = b.dataset.sort;
      renderBrowse();
    });
    // 排序方向：升序 / 降序 切换
    const dirBtn = $("#sort-dir");
    if (dirBtn) dirBtn.addEventListener("click", () => {
      state.dir = state.dir === "asc" ? "desc" : "asc";
      dirBtn.textContent = state.dir === "asc" ? "↑ 升序" : "↓ 降序";
      renderBrowse();
    });
    $("#genre-chips").addEventListener("click", (e) => chipClick(e, "genre", "data-genre"));
    $("#status-chips").addEventListener("click", (e) => chipClick(e, "status", "data-status"));

    // 详情弹窗遮罩 / Esc 关闭（日历卡片已用内联 onclick，确保缓存旧脚本也能点开）
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
