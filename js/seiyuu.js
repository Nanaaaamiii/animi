/* ============================================================
   声优百科模块
   ============================================================ */
(function () {
  "use strict";
  const DATA = window.SEIYUU_DATA || [];
  let rendered = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function render() {
    if (rendered) return;
    rendered = true;

    const grid = document.getElementById("seiyuu-grid");
    const search = document.getElementById("seiyuu-search");
    const empty = document.getElementById("seiyuu-empty");
    const modal = document.getElementById("seiyuu-modal");
    const modalContent = document.getElementById("seiyuu-detail");
    const modalClose = document.getElementById("seiyuu-modal-close");

    if (!grid || !DATA.length) {
      if (empty) {
        empty.innerHTML = `<div class="icon">📦</div><p>声优数据尚未采集</p><p style="font-size:0.9rem;color:#94a3b8">请运行 <code>python collect_seiyuu.py</code> 采集数据</p>`;
        empty.style.display = "block";
      }
      return;
    }

    // 统计
    const totalAnimes = new Set();
    DATA.forEach(s => s.animes.forEach(a => totalAnimes.add(a.id)));
    const statSeiyuu = document.getElementById("stat-seiyuu");
    const statAnime = document.getElementById("stat-anime");
    if (statSeiyuu) statSeiyuu.textContent = DATA.length;
    if (statAnime) statAnime.textContent = totalAnimes.size;

    // 渲染列表
    function renderList(filter) {
      const keyword = (filter || "").toLowerCase();
      const filtered = DATA.filter(s => {
        if (!keyword) return true;
        return s.name.toLowerCase().includes(keyword) || (s.name_cn || "").toLowerCase().includes(keyword);
      });

      if (filtered.length === 0) {
        grid.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
      }
      if (empty) empty.style.display = "none";

      grid.innerHTML = filtered.slice(0, 100).map(s => {
        const displayName = s.name_cn || s.name;
        const previews = s.animes.slice(0, 5).map(a =>
          a.cover ? `<img src="${esc(a.cover)}" alt="" loading="lazy">` : ""
        ).join("");
        return `
          <div class="seiyuu-card" data-name="${encodeURIComponent(s.name)}">
            <div class="name">${esc(displayName)}</div>
            <div class="name-jp">${esc(s.name)}</div>
            <span class="count">${s.animes.length} 部作品</span>
            <div class="preview">${previews}</div>
          </div>
        `;
      }).join("");

      grid.querySelectorAll(".seiyuu-card").forEach(card => {
        card.onclick = () => {
          const name = decodeURIComponent(card.dataset.name);
          const seiyuu = DATA.find(s => s.name === name);
          if (seiyuu) showDetail(seiyuu);
        };
      });
    }

    // 显示详情
    function showDetail(seiyuu) {
      const displayName = seiyuu.name_cn || seiyuu.name;
      const animeList = seiyuu.animes.map(a => `
        <div class="seiyuu-anime-item">
          ${a.cover ? `<img src="${esc(a.cover)}" alt="${esc(a.title)}" loading="lazy">` : `<div style="width:100%;aspect-ratio:3/4;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:8px;margin-bottom:8px"></div>`}
          <div class="title">${esc(a.title)}</div>
          <div class="role">${esc(a.role)}</div>
        </div>
      `).join("");

      modalContent.innerHTML = `
        <div class="seiyuu-detail-header">
          <div class="name">${esc(displayName)}</div>
          <div class="name-jp">${esc(seiyuu.name)}</div>
          <span class="count">${seiyuu.animes.length} 部作品</span>
        </div>
        <div class="seiyuu-anime-list">${animeList}</div>
      `;
      if (modal) modal.classList.add("open");
    }

    // 关闭弹窗
    if (modalClose) modalClose.onclick = () => modal.classList.remove("open");
    if (modal) modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("open"); };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal) modal.classList.remove("open");
    });

    // 搜索
    let searchTimer;
    if (search) search.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderList(search.value.trim()), 200);
    };

    renderList();
  }

  window.Seiyuu = { render };
})();
