/* MAL vs Bangumi 评分/排名对比 — 嵌入 SPA 视图 */
(function(){
  "use strict";
  const DATA = (window.MAL_BGM_DATA || []).filter(x => x.mal_score && x.mal_rank);
  const CHART_DATA = DATA.filter(x => x.bgm_score != null);  // 图表只用有BGM评分的
  const PAGE_SIZE = 50;
  let chart = null, chartMode = 'score', initialized = false;
  let filtered = DATA.slice(), sortKey = 'bgm_rank', sortDir = 1, page = 1;
  let fuse = null;

  const $ = (s, r) => (r||document).querySelector(s);
  const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function cssVar(name){ return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  const scoreDiff = d => d.bgm_score != null ? +(d.mal_score - d.bgm_score).toFixed(2) : null;
  const rankDiff = d => d.bgm_rank != null ? d.bgm_rank - d.mal_rank : null;

  /* ---------------- 初始化入口 ---------------- */
  window.MalCompare = {
    render: function(){
      if (!initialized) init();
      renderChart();
    },
    destroy: function(){
      if (chart) { chart.destroy(); chart = null; }
    }
  };

  function init(){
    initialized = true;
    fuse = new Fuse(DATA, {
      keys: [{name:'title',weight:2},{name:'jp',weight:1.5},{name:'mal_title',weight:1.5},{name:'mal_title_en',weight:1}],
      threshold: 0.4, minMatchCharLength: 1, includeScore: true, ignoreLocation: true
    });

    // 统计
    const root = $('#view-mal');
    const malHigh = CHART_DATA.filter(d => scoreDiff(d) > 0).length;
    const bgmHigh = CHART_DATA.length - malHigh;
    const avgDiff = CHART_DATA.reduce((s,d)=>s+scoreDiff(d),0)/CHART_DATA.length;
    $('#stat-mal-count',root).textContent = DATA.length;
    $('#stat-mal-high',root).textContent = malHigh;
    $('#stat-bgm-high',root).textContent = bgmHigh;
    $('#stat-avg-diff',root).textContent = (avgDiff>0?'+':'')+avgDiff.toFixed(2);

    // 差异 TOP
    renderDiffTop('mal-high', root);
    $$('.mal-tab[data-list]',root).forEach(btn => btn.addEventListener('click', () => {
      $$('.mal-tab[data-list]',root).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDiffTop(btn.dataset.list, root);
    }));

    // 图表切换
    $$('.mal-tab[data-mode]',root).forEach(btn => btn.addEventListener('click', () => {
      $$('.mal-tab[data-mode]',root).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      chartMode = btn.dataset.mode;
      renderChart();
    }));

    // 搜索
    $('#mal-search',root).addEventListener('input', () => applySearch(root));

    // 分页
    $('#mal-pagination',root).addEventListener('click', e => {
      const btn = e.target.closest('.mal-page-btn');
      if (!btn || btn.disabled) return;
      const p = parseInt(btn.dataset.page, 10);
      if (p >= 1 && p <= Math.ceil(filtered.length / PAGE_SIZE)) { page = p; renderTable(root); }
    });

    // 排序（仅数字列，标题/封面不排序）
    $$('.mal-table th[data-key]',root).forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = 1; }
      $$('.mal-table th .arrow',root).forEach(a => a.textContent = '');
      (th.querySelector('.arrow')||{}).textContent = sortDir===1?'▲':'▼';
      sortData(); renderTable(root);
    }));

    sortData(); renderTable(root);
  }

  /* ---------------- 散点图 ---------------- */
  function chartDatasets(mode){
    const color = mode === 'score'
      ? d => scoreDiff(d) > 0 ? '#2e9d8a' : '#e8628a'
      : d => rankDiff(d) > 0 ? '#2e9d8a' : '#e8628a';
    return [{
      label: mode === 'score' ? '评分' : '排名',
      data: CHART_DATA.map(d => ({ x: mode==='score'?d.bgm_score:d.bgm_rank, y: mode==='score'?d.mal_score:d.mal_rank, d: d })),
      backgroundColor: CHART_DATA.map(d => color(d)), pointRadius: 4, pointHoverRadius: 7
    }];
  }
  function renderChart(){
    const canvas = $('#scatterChart');
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const text = cssVar('--text'), grid = cssVar('--border');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'scatter', data: { datasets: chartDatasets(chartMode) },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'),
            bodyColor: cssVar('--text-soft'), borderColor: cssVar('--border'), borderWidth: 1,
            callbacks: {
              title: items => items[0].raw.d.title,
              label: item => {
                const d = item.raw.d;
                return chartMode === 'score'
                  ? `Bangumi ${d.bgm_score}  /  MAL ${d.mal_score}  /  差 ${(d.mal_score-d.bgm_score).toFixed(2)}`
                  : `Bangumi #${d.bgm_rank}  /  MAL #${d.mal_rank}`;
              }
            }
          }
        },
        scales: {
          x: { type: chartMode==='score'?'linear':'logarithmic',
               title: {display:true,text:chartMode==='score'?'Bangumi 评分':'Bangumi 排名',color:text},
               grid: {color:grid}, ticks: {color:cssVar('--text-soft')} },
          y: { type: chartMode==='score'?'linear':'logarithmic',
               title: {display:true,text:chartMode==='score'?'MAL 评分':'MAL 排名',color:text},
               grid: {color:grid}, ticks: {color:cssVar('--text-soft')} }
        }
      }
    });
  }

  /* ---------------- 差异 TOP ---------------- */
  function renderDiffTop(kind, root){
    const list = kind === 'mal-high'
      ? CHART_DATA.slice().sort((a,b) => scoreDiff(b)-scoreDiff(a)).slice(0,30)
      : CHART_DATA.slice().sort((a,b) => scoreDiff(a)-scoreDiff(b)).slice(0,30);
    $('#diff-list',root).innerHTML = list.map(d => {
      const diff = scoreDiff(d), cls = diff>0?'pos':'neg', sign = diff>0?'+':'';
      return `<a class="mal-item" href="${esc(d.mal_url)}" target="_blank" rel="noopener">
        <img src="${esc(d.cover||'')}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="mal-item-info"><div class="mal-item-title">${esc(d.title||d.jp)}</div><div class="mal-item-sub">Bangumi ${d.bgm_score} · MAL ${d.mal_score}</div></div>
        <div class="mal-item-diff ${cls}">${sign}${diff.toFixed(2)}</div></a>`;
    }).join('');
  }

  /* ---------------- 列表 ---------------- */
  function getValue(d, key){
    if (key === 'score_diff') return scoreDiff(d);
    if (key === 'rank_diff') return rankDiff(d);
    if (key === 'title') return (d.title||d.jp||'').toLowerCase();
    return d[key];
  }
  function sortData(){
    filtered.sort((a,b) => { const va=getValue(a,sortKey), vb=getValue(b,sortKey); return va<vb?-sortDir:va>vb?sortDir:0; });
  }
  function applySearch(root){
    const q = $('#mal-search',root).value.trim();
    if (!q) filtered = DATA.slice();
    else filtered = fuse.search(q).map(r => r.item);
    page = 1; sortData(); renderTable(root);
  }
  function renderTable(root){
    const tbody = $('#mal-tbody',root), empty = $('#mal-empty',root);
    const totalPages = Math.ceil(filtered.length/PAGE_SIZE);
    const items = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
    $('#mal-count',root).textContent = `共 ${filtered.length} 部 · 第 ${page}/${totalPages} 页`;
    empty.hidden = filtered.length > 0;
    ($('#mal-table',root)||{}).style.display = filtered.length ? '' : 'none';

    tbody.innerHTML = items.map(d => {
      const sd=scoreDiff(d), rd=rankDiff(d);
      const sc=sd!=null&&sd>0?'pos':sd!=null&&sd<0?'neg':'', rc=rd!=null&&rd>0?'pos':rd!=null&&rd<0?'neg':'';
      const sdSign=sd!=null&&sd>0?'+':'';
      const rdSign=rd!=null&&rd>0?'+':'';
      return `<tr>
        <td class="cover-cell"><img src="${esc(d.cover||'')}" alt="" loading="lazy" onerror="this.style.display='none'"></td>
        <td class="cell-title"><div class="name"><a href="${esc(d.bgm_url)}" target="_blank" rel="noopener">${esc(d.title||d.jp)}</a></div><div class="alt">${esc(d.mal_title||d.mal_title_en||d.jp)}</div></td>
        <td class="cell-score">${d.bgm_score!=null?d.bgm_score:'—'}</td><td class="cell-score">${d.mal_score}</td>
        <td class="diff-val ${sc}">${sd!=null?sdSign+sd.toFixed(2):'—'}</td>
        <td>${d.bgm_rank!=null?'#'+d.bgm_rank:'—'}</td><td>#${d.mal_rank}</td>
        <td class="diff-val ${rc}">${rd!=null?rdSign+rd:'—'}</td></tr>`;
    }).join('');

    const pg = $('#mal-pagination',root);
    if (totalPages <= 1) { pg.innerHTML = ''; return; }
    let html = '', mb = 7;
    let sp = Math.max(1, page - Math.floor(mb/2));
    let ep = Math.min(totalPages, sp + mb - 1);
    if (ep - sp < mb - 1) sp = Math.max(1, ep - mb + 1);
    html += `<button class="mal-page-btn" data-page="1" ${page===1?'disabled':''}>«</button>`;
    html += `<button class="mal-page-btn" data-page="${page-1}" ${page===1?'disabled':''}>‹</button>`;
    for (let p=sp; p<=ep; p++) html += `<button class="mal-page-btn ${p===page?'active':''}" data-page="${p}">${p}</button>`;
    html += `<button class="mal-page-btn" data-page="${page+1}" ${page===totalPages?'disabled':''}>›</button>`;
    html += `<button class="mal-page-btn" data-page="${totalPages}" ${page===totalPages?'disabled':''}>»</button>`;
    pg.innerHTML = html;
  }
})();
