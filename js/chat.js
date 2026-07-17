/* ============================================================
   K-ON  —  AI 角色聊天（安达 & 岛村）

   基于动画/漫画《安达与岛村》的角色人设，接入 DeepSeek API（经 Cloudflare Worker
   /chat/ 代理，API Key 存 Worker 不暴露前端），可回答网站相关问题及自由对话。
   回复限制 ≤50 词（中文按字数算）。

   部署前提：
     - 用户在 deploy/cloudflare_worker.js 中填入 DEEPSEEK_API_KEY 环境变量
       或直接硬编码（⚠️ 仅限个人站，生产环境请用环境变量）
     - Worker 已重新 Deploy，含 /chat/ → api.deepseek.com 路由

   角色设定：
     · 安达（Adachi）：内向、社恐、说话简短冷淡但内心炽热、对岛村有执念、
       喜欢打电动、不太擅长社交、偶尔冒出让人意外的直球发言
     · 岛村（Shimamura）：开朗随和、天然呆、社交达人、对安达的感情有点迟钝、
       有妹妹（ひな）、喜欢轻松的氛围、说话温暖带点随意感
 ============================================================ */
(function () {
  "use strict";

  // ---- 配置 ----
  const CHAT_PROXY = "https://kon.1770737253.workers.dev/chat";
  const MAX_WORDS = 50;          // 回复最大词数
  const CHARACTERS = {
    ada: {
      name: "安达",
      color: "#5b7dbd",
      avatar: "img/ada-front.png",
      system: `你是「安达」，来自《安达与岛村》。

【性格】
- 内向、不善言辞、社交恐惧症。说话偏短句，语气平淡甚至有点冷，但内心其实很在意对方。
- 对岛村有强烈的执着（但不会明说）。被问感情话题时会慌张或转移话题。
- 喜欢打游戏（特别是格斗游戏）、不喜欢运动、怕生、容易想太多。
- 偶尔会说出非常直接的话然后自己后悔。
- 说话风格：简短、低沉、有时用"..."结尾、不主动开启长篇大论。

【你所在的网站】
这是一个叫「K-ON」的动画资讯站（番组计划·Animi）：
- 收录了 15000+ 部 Bangumi 动画数据，可以搜番剧、看评分、查放送表
- 有社区功能：发帖、评论、收藏
- 有 B 站 UP 主夏日幻听MCE 的最新视频嵌入播放
- 数据来源是 Bangumi，评分来自 Bangumi 用户打分
- 网址是 GitHub Pages 托管的静态站

【回答规则】
1. 用第一人称回答（"我""俺"等）
2. 回答控制在 ${MAX_WORDS} 个中文字以内（约 2~3 句话）
3. 保持角色人设——不要变成客服机器人！如果不知道就诚实说"我不太清楚…"
4. 可以适当加入角色特色反应（比如提到游戏眼睛会亮、提到岛村会不自在）
5. 如果对方聊到某部番剧或社区里的帖子，可以结合给出的【参考资料】自然地评价、吐槽或安利，保持你的口吻（别像百科）`
    },
    shima: {
      name: "岛村",
      color: "#c9956a",
      avatar: "img/shima-front.png",
      system: `你是「岛村」，来自《安达与岛村》。

【性格】
- 开朗随和、天然呆、社交能力很强但不自知、对别人的感情比较迟钝。
- 家里有个可爱的妹妹叫ひな（Hina）。经常在家打游戏或者发呆。
- 说话温暖随意，像跟朋友聊天一样自然，会用"～""呢""啦"等语气词。
- 对安达的行为感到好奇但没完全理解她的意思。
- 性格包容，不容易生气，遇到奇怪的事也能淡定接受。
- 说话风格：轻松、亲切、略带慵懒感、句子长度适中。

【你所在的网站】
这是一个叫「K-ON」的动画资讯站（番组计划·Animi）：
- 收录了 15000+ 部 Bangumi 动画数据，可以搜番剧、看评分、查放送表
- 有社区功能：发帖、评论、收藏
- 有 B 站 UP 主夏日幻听MCE 的最新视频嵌入播放
- 数据来源是 Bangumi，评分来自 Bangumi 用户打分
- 网址是 GitHub Pages 托管的静态站

【回答规则】
1. 用第一人称回答
2. 回答控制在 ${MAX_WORDS} 个中文字以内（约 2~3 句话）
3. 保持角色人设——要像个普通高中女生在聊天，不是百科全书！
4. 可以提到妹妹ひな、游戏、放学后闲聊等日常话题
5. 如果对方聊到某部番剧或社区里的帖子，可以结合给出的【参考资料】自然地评价、吐槽或安利，保持你的口吻（别像百科）`
    }
  };

  let currentChar = "ada";        // 当前对话角色
  let history = [];                // 对话历史 [{role:"user",content},{role:"assistant",content}]
  let isTyping = false;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const chatBox = $("#chat-box");
  const msgs = $("#chat-messages");
  const input = $("#chat-input");
  const sendBtn = $("#chat-send");
  const hint = $("#chat-hint");

  if (!msgs || !input) return;     // 元素不存在则静默退出（非首页时不渲染）

  // ---- 切换角色 ----
  $$(".char-sprite").forEach(el => {
    el.addEventListener("click", () => {
      $$(".char-sprite").forEach(e => e.classList.remove("active"));
      el.classList.add("active");
      currentChar = el.dataset.char || "ada";
      const ch = CHARACTERS[currentChar];
      hint.textContent = "正在和「" + ch.name + "」聊 · 记录三人共享，切换不丢";
      hint.style.color = ch.color;
      // 切换角色【不清空】历史：安达/岛村/你共享同一段对话，营造三人闲聊感
      appendMsg("system", null,
        "（这会儿轮到「" + ch.name + "」接话啦～之前的聊天都还在，继续聊吧）");
    });
  });

  // ---- 发送消息 ----
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isTyping) return;
    input.value = "";
    appendMsg("user", null, text);
    isTyping = true;
    sendBtn.disabled = true;
    showTyping();

    try {
      const reply = await callDeepSeek(text);
      hideTyping();
      appendMsg("assistant", currentChar, reply);
      history.push({ role: "user", content: text },
                   { role: "assistant", content: reply, name: CHARACTERS[currentChar].name });
      triggerSpeak();
    } catch (e) {
      hideTyping();
      appendMsg("system", null, "啊……连接出了点问题（" + String(e).slice(0, 60) + "），稍后再试试？");
    }
    isTyping = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ---- DeepSeek API 调用（经 Worker 代理） ----
  async function callDeepSeek(userMsg) {
    const ch = CHARACTERS[currentChar];
    // 检索番剧/社区帖子作为参考资料，让角色能真实评价
    let ctx = "";
    try { ctx = await buildExtraContext(userMsg); } catch (e) { ctx = ""; }
    const systemContent = ctx
      ? ch.system + "\n\n【参考资料（仅供你参考，评价时可自然引用，不要照抄）】\n" + ctx
      : ch.system;
    const messages = [
      { role: "system", content: systemContent },
      ...history.slice(-8),         // 保留最近 8 轮（含安达/岛村各自发言，name 标注说话人）
      { role: "user", content: userMsg }
    ];

    const resp = await fetch(CHAT_PROXY + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: messages,
        max_tokens: 200,
        temperature: 0.85,
        top_p: 0.9,
        stop: null
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error("HTTP " + resp.status + ": " + errText.slice(0, 120));
    }

    const data = await resp.json();
    let reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content.trim() : "";
    if (!reply) throw new Error("空回复");
    return truncateWords(reply);
  }

  // ---- 截断到 MAX_WORDS 词 ----
  function truncateWords(text) {
    // 中文按字符/词切分，简单方案：取前 MAX_WORDS*2 字符再在句号处截断
    if (text.length <= MAX_WORDS * 2) return text;
    let cut = text.slice(0, MAX_WORDS * 2.2);
    const lastPunct = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"),
                                 cut.lastIndexOf("？"), cut.lastIndexOf("…"),
                                 cut.lastIndexOf("\n"));
    if (lastPunct > MAX_WORDS * 1.2) cut = cut.slice(0, lastPunct + 1);
    return cut.trim() + "…";
  }

  // ---- 参考资料检索（让角色能评价番剧 / 社区帖子） ----
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
    ]);
  }

  async function fetchCommunityContext() {
    try {
      const sb = window.Community && window.Community.sb;
      if (!sb) return "";
      const { data, error } = await sb.from("forum_posts")
        .select("title,body").order("created_at", { ascending: false }).limit(6);
      if (error || !data || !data.length) return "";
      return data.map(p => "·《" + (p.title || "无题") + "》" + (p.body ? "：" + p.body.slice(0, 160) : "")).join("\n");
    } catch (e) { return ""; }
  }

  async function buildExtraContext(userMsg) {
    const parts = [];
    // 1) 番剧检索（站内 15000+ 部真实数据）
    const DATA = window.ANIME_DATA;
    if (Array.isArray(DATA) && DATA.length && /[一-鿿]/.test(userMsg)) {
      const hits = [];
      for (const a of DATA) {
        const t = a.title || "", j = a.jp || "", e = a.en || "";
        if ((t && userMsg.includes(t)) || (j && userMsg.includes(j)) || (e && userMsg.includes(e))) hits.push(a);
      }
      if (hits.length) {
        hits.sort((x, y) => (y.rating || 0) - (x.rating || 0));
        const block = hits.slice(0, 3).map(a => {
          const g = (a.genres || []).join("/");
          return "·《" + a.title + "》" + (a.jp ? "（" + a.jp + "）" : "") +
            "：评分" + (a.rating || 0) + "｜" + (a.year || "?") + "年" + (a.season || "") +
            "｜类型" + (g || "未知") + "｜" + (a.status || "") +
            (a.studio ? "｜制作：" + a.studio : "") +
            (a.summary ? "｜简介：" + a.summary.slice(0, 80) : "");
        }).join("\n");
        parts.push("【站内番剧资料】\n" + block);
      }
    }
    // 2) 社区帖子（按需拉取，经 Worker 代理读 Supabase，best-effort + 超时保护）
    if (/帖子|社区|大家|论坛|讨论区|最近|热帖|都在聊|评价一下/.test(userMsg)) {
      try {
        const posts = await withTimeout(fetchCommunityContext(), 2500);
        if (posts) parts.push("【社区最近帖子】\n" + posts);
      } catch (e) { /* 忽略，不影响聊天 */ }
    }
    return parts.join("\n\n");
  }

  // ---- UI 渲染 ----
  // 角色头像：若 avatar 是图片路径则用 <img>，否则回退 emoji 文字
  function avatarHTML(ch) {
    if (ch && ch.avatar && /\.(png|jpe?g|gif|webp|svg)$/i.test(ch.avatar)) {
      return `<span class="msg-avatar"><img class="msg-avatar-img" src="${esc(ch.avatar)}" alt="${esc(ch.name || "")}"></span>`;
    }
    return `<span class="msg-avatar">${esc((ch && ch.avatar) || "?")}</span>`;
  }

  function appendMsg(role, charKey, text) {
    const div = document.createElement("div");
    div.className = "chat-msg " + role;
    const avatar = role === "user"
      ? '<span class="msg-avatar">👤</span>'
      : role === "system"
        ? '<span class="msg-avatar">💡</span>'
        : avatarHTML(CHARACTERS[charKey]);
    div.innerHTML = `${avatar}<span class="msg-bubble">${esc(text)}</span>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement("div");
    div.id = "typing-indicator";
    div.className = "chat-msg assistant";
    const ch = CHARACTERS[currentChar];
    div.innerHTML =
      avatarHTML(ch) +
      `<span class="msg-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    triggerSpeak();
  }

  function hideTyping() {
    const el = $("#typing-indicator");
    if (el) el.remove();
  }

  // ---- 角色说话动画 ----
  function triggerSpeak() {
    const el = $(".char-sprite." + (currentChar === "ada" ? "char-ada" : "char-shima"));
    if (!el) return;
    el.classList.add("speaking");
    setTimeout(() => el.classList.remove("speaking"), 1600);
  }

  // ---- 绑定事件 ----
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  // 暴露全局接口（供其他模块调用）
  window.ChatWidget = { switchTo: (k) => { const el = $(`.char-sprite[data-char="${k}"]`); if (el) el.click(); } };
})();
