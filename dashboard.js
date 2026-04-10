// ── Sunday Sauce Admin Dashboard ─────────────────────────────────
// Vanilla JS · Chart.js · Supabase JS v2

// ── State ────────────────────────────────────────────────────────
let allSessions = [];
let currentRange = '30d';
let sessionsPage = 0;
const PAGE_SIZE = 25;
const REFRESH_MS = 5 * 60 * 1000;
const charts = {};

// Pricing (mirrors session_tracker.py)
const APPLE_COMMISSION = 0.15;
const PRICES = {
  ss_session_single: 4.99,
  ss_session_4pack: 3.99,
  ss_session_free: 0.00,
  ss_session_promo: 0.00,
};

// Sort state for sessions table
let sortCol = 'created_at';
let sortDir = 'desc';

// ── Init ─────────────────────────────────────────────────────────
(async () => {
  const ok = await requireAuth();
  if (!ok) return;
  await loadAllData();
  setInterval(loadAllData, REFRESH_MS);
})();

async function loadAllData() {
  try {
    const { data, error } = await supabase
      .from('session_analytics')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    allSessions = data || [];
  } catch (e) {
    console.error('Failed to load sessions:', e);
    allSessions = [];
  }
  populateFilterDropdowns();
  renderAll();
}

// ── Helpers ──────────────────────────────────────────────────────
function fmt$(n) { return '$' + (Number(n) || 0).toFixed(2); }
function fmtN(n) { return (Number(n) || 0).toLocaleString(); }
function fmtDur(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDateShort(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtCrew(s) {
  if (!s.crew_count || s.crew_count <= 1) return 'Solo';
  const ages = (s.crew_members || []).filter(m => m.age != null).map(m => m.age).sort((a, b) => a - b);
  return ages.length ? `${s.crew_count} people (${ages.join(', ')})` : `${s.crew_count} people`;
}
function emptyState(msg) {
  return `<div class="empty-state"><div class="empty-icon">~</div><p>${msg}</p></div>`;
}
function destroyChart(id) { if (charts[id]) { charts[id].destroy(); delete charts[id]; } }

function getType(s) {
  const pid = s.product_id;
  if (pid === 'ss_session_single') return 'single';
  if (pid === 'ss_session_4pack') return '4pack';
  if (pid === 'ss_session_promo') return 'promo';
  // Legacy: map session_type for rows without product_id
  if (!pid) {
    if (s.session_type === 'paid') return 'single';
    if (s.session_type === 'offer_code') return 'promo';
  }
  return 'free';
}

const TYPE_META = {
  single: { label: 'Single ($4.99)', cls: 'b-single', color: '#1565c0' },
  '4pack': { label: '4-pack ($3.99)', cls: 'b-4pack', color: '#6a1b9a' },
  free: { label: 'Free', cls: 'b-free', color: '#9e9e9e' },
  promo: { label: 'Promo code', cls: 'b-promo', color: '#e65100' },
};

function typeBadge(s) {
  const t = getType(s);
  const m = TYPE_META[t];
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

function profitHtml(val, isFree) {
  if (isFree) return '<span style="color:var(--muted)">n/a</span>';
  return val >= 0
    ? `<span class="profit-pos">+${fmt$(val)}</span>`
    : `<span class="profit-neg">-${fmt$(Math.abs(val))}</span>`;
}

function marginHtml(s) {
  const t = getType(s);
  if (t === 'free' || t === 'promo') return '<span style="color:var(--muted)">—</span>';
  const m = Number(s.margin_pct);
  if (!m && m !== 0) return '<span style="color:var(--muted)">—</span>';
  return `<span style="color:var(--green)">${m.toFixed(0)}%</span>`;
}

function netRev(s) { return Number(s.net_revenue_usd) || 0; }
function grossRev(s) { return Number(s.gross_revenue_usd) || 0; }
function profit(s) { return Number(s.profit_usd) || (netRev(s) - Number(s.total_cost_usd || 0)); }
function cost(s) { return Number(s.total_cost_usd) || 0; }

// ── Date Range Filter ────────────────────────────────────────────
function filterByRange(sessions) {
  if (currentRange === 'all') return sessions;
  const now = new Date();
  const days = { '7d': 7, '30d': 30, '90d': 90 }[currentRange] || 30;
  const cutoff = new Date(now - days * 86400000).toISOString();
  return sessions.filter(s => s.created_at >= cutoff);
}

function filterSessions(sessions) {
  let f = filterByRange(sessions);
  const typeVal = document.getElementById('filter-type')?.value;
  const recipeVal = document.getElementById('filter-recipe')?.value;
  const charVal = document.getElementById('filter-character')?.value;
  if (typeVal) f = f.filter(s => s.product_id === typeVal);
  if (recipeVal) f = f.filter(s => s.recipe_name === recipeVal);
  if (charVal) f = f.filter(s => s.character_name === charVal);
  return f;
}

document.getElementById('range-toggle').addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  currentRange = e.target.dataset.range;
  document.querySelectorAll('#range-toggle button').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  sessionsPage = 0;
  renderAll();
});

// ── Navigation ───────────────────────────────────────────────────
const TITLES = {
  overview: 'Overview', sessions: 'Sessions', revenue: 'Revenue & Profit',
  costs: 'Cost Breakdown', 'whos-cooking': "Who's Cooking", errors: 'Errors & Issues',
};

function showSection(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('sec-' + id);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
  document.getElementById('topbar-title').textContent = TITLES[id] || id;
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// ── Filter Dropdowns ─────────────────────────────────────────────
function populateFilterDropdowns() {
  const recipes = [...new Set(allSessions.map(s => s.recipe_name).filter(Boolean))].sort();
  const chars = [...new Set(allSessions.map(s => s.character_name).filter(Boolean))].sort();
  const rSel = document.getElementById('filter-recipe');
  const cSel = document.getElementById('filter-character');
  if (rSel) {
    const cur = rSel.value;
    rSel.innerHTML = '<option value="">All recipes</option>' + recipes.map(r => `<option value="${r}">${r}</option>`).join('');
    rSel.value = cur;
  }
  if (cSel) {
    const cur = cSel.value;
    cSel.innerHTML = '<option value="">All characters</option>' + chars.map(c => `<option value="${c}">${c}</option>`).join('');
    cSel.value = cur;
  }
}

// ── Render All ───────────────────────────────────────────────────
function renderAll() {
  const ranged = filterByRange(allSessions);
  const filtered = filterSessions(allSessions);
  renderOverview(ranged);
  renderSessions(filtered);
  renderRevenue(ranged);
  renderCosts(ranged);
  renderWhosCooking(ranged);
  renderErrors(ranged);
}

// ── OVERVIEW ─────────────────────────────────────────────────────
function renderOverview(data) {
  const el = document.getElementById('overview-stats');
  if (data.length === 0) {
    el.innerHTML = emptyState('No sessions yet. Start cooking to see data here.');
    document.getElementById('overview-legend').innerHTML = '';
    return;
  }

  const totalRev = data.reduce((a, s) => a + grossRev(s), 0);
  const totalNet = data.reduce((a, s) => a + netRev(s), 0);
  const totalCost = data.reduce((a, s) => a + cost(s), 0);
  const totalProfit = totalNet - totalCost;
  const marginPct = totalNet > 0 ? ((totalProfit / totalNet) * 100).toFixed(0) : '0';
  const paidSessions = data.filter(s => grossRev(s) > 0);
  const avgProfit = paidSessions.length > 0 ? (totalProfit / paidSessions.length) : 0;
  const completedPct = data.length > 0 ? ((data.filter(s => s.completed).length / data.length) * 100).toFixed(0) : '0';

  // Delta vs previous period
  const days = { '7d': 7, '30d': 30, '90d': 90 }[currentRange];
  let deltaStr = '';
  if (days) {
    const now = new Date();
    const prevCutoff = new Date(now - days * 2 * 86400000).toISOString();
    const curCutoff = new Date(now - days * 86400000).toISOString();
    const prevRev = allSessions.filter(s => s.created_at >= prevCutoff && s.created_at < curCutoff)
      .reduce((a, s) => a + grossRev(s), 0);
    const diff = totalRev - prevRev;
    deltaStr = diff >= 0 ? `+${fmt$(diff)} vs last period` : `${fmt$(diff)} vs last period`;
  }

  el.innerHTML = `
    <div class="stat-card dark"><div class="stat-label">Total revenue</div><div class="stat-value">${fmt$(totalRev)}</div><div class="stat-delta">${deltaStr}</div></div>
    <div class="stat-card green-card"><div class="stat-label">Net profit</div><div class="stat-value">${fmt$(totalProfit)}</div><div class="stat-delta" style="color:#2d7a3a">${marginPct}% margin</div></div>
    <div class="stat-card"><div class="stat-label">Total sessions</div><div class="stat-value">${fmtN(data.length)}</div></div>
    <div class="stat-card"><div class="stat-label">Avg profit/session</div><div class="stat-value">${fmt$(avgProfit)}</div><div class="stat-delta neu">paid sessions only</div></div>
    <div class="stat-card"><div class="stat-label">Completion rate</div><div class="stat-value">${completedPct}%</div></div>
  `;

  // Type legend
  const counts = { single: 0, '4pack': 0, free: 0, promo: 0 };
  const revByType = { single: 0, '4pack': 0, free: 0, promo: 0 };
  data.forEach(s => { const t = getType(s); counts[t]++; revByType[t] += grossRev(s); });
  document.getElementById('overview-legend').innerHTML = `
    <div class="type-pill"><span class="dot" style="background:#1565c0"></span><strong>Single</strong> $4.99 &middot; ${counts.single} sessions &middot; ${fmt$(revByType.single)} gross</div>
    <div class="type-pill"><span class="dot" style="background:#6a1b9a"></span><strong>4-pack</strong> $3.99/session &middot; ${counts['4pack']} sessions &middot; ${fmt$(revByType['4pack'])} gross</div>
    <div class="type-pill"><span class="dot" style="background:#9e9e9e"></span><strong>Free / promo</strong> $0.00 &middot; ${counts.free + counts.promo} sessions</div>
  `;

  // Revenue vs cost chart
  const dayMap = buildDailyMap(data);
  const labels = Object.keys(dayMap).map(fmtDateShort);
  const revData = Object.values(dayMap).map(d => d.rev);
  const costData = Object.values(dayMap).map(d => d.cost);
  const profitData = Object.values(dayMap).map(d => d.rev * (1 - APPLE_COMMISSION) - d.cost);

  destroyChart('overview');
  charts['overview'] = new Chart(document.getElementById('chart-overview'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Revenue', data: revData, borderColor: '#2d7a3a', tension: .35, pointRadius: 3, pointBackgroundColor: '#2d7a3a' },
        { label: 'Cost', data: costData, borderColor: '#c0392b', tension: .35, pointRadius: 3, pointBackgroundColor: '#c0392b', borderDash: [4, 3] },
        { label: 'Profit', data: profitData, borderColor: '#a5d6a7', tension: .35, pointRadius: 0, borderWidth: 1.5, borderDash: [2, 4] },
      ],
    },
    options: chartOpts('$'),
  });
}

// ── SESSIONS TABLE ───────────────────────────────────────────────
function renderSessions(data) {
  const wrapper = document.getElementById('sessions-table-wrapper');
  if (data.length === 0) {
    wrapper.innerHTML = emptyState('No sessions match your filters.');
    document.getElementById('sessions-pagination').innerHTML = '';
    return;
  }

  const sorted = [...data].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const start = sessionsPage * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const arrow = col => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  let html = `<div class="card" style="padding:0;overflow:hidden"><table class="sessions-table"><thead><tr>
    <th onclick="sortBy('created_at')">Date${arrow('created_at')}</th>
    <th onclick="sortBy('recipe_name')">Recipe &middot; Character${arrow('recipe_name')}</th>
    <th>Crew</th>
    <th onclick="sortBy('product_id')">Purchase type${arrow('product_id')}</th>
    <th onclick="sortBy('gross_revenue_usd')">Revenue${arrow('gross_revenue_usd')}</th>
    <th onclick="sortBy('total_cost_usd')">Cost${arrow('total_cost_usd')}</th>
    <th onclick="sortBy('profit_usd')">Profit${arrow('profit_usd')}</th>
    <th>Margin</th>
    <th>Status</th>
  </tr></thead><tbody>`;

  page.forEach((s, i) => {
    const t = getType(s);
    const isFree = t === 'free' || t === 'promo';
    const statusBadge = s.had_error ? '<span class="badge b-err">Error</span>'
      : s.completed ? '<span class="badge b-ok">OK</span>'
      : '<span class="badge b-free">...</span>';
    const revStr = isFree ? '<span style="color:var(--muted)">$0.00</span>' : `$${grossRev(s).toFixed(2)}`;
    const p = profit(s);
    const idx = start + i;

    html += `<tr onclick="toggleExpand('ex-${idx}')">
      <td style="white-space:nowrap">${fmtDate(s.created_at)}</td>
      <td>${s.recipe_name || '—'} &middot; <span style="color:var(--muted)">${s.character_name || '—'}</span></td>
      <td style="color:var(--muted);font-size:11px">${fmtCrew(s)}</td>
      <td>${typeBadge(s)}</td>
      <td style="font-weight:500">${revStr}</td>
      <td style="color:var(--muted)">$${cost(s).toFixed(2)}</td>
      <td>${profitHtml(p, isFree)}</td>
      <td>${marginHtml(s)}</td>
      <td>${statusBadge}</td>
    </tr>
    <tr class="expand-row" id="ex-${idx}"><td colspan="9"><div class="expand-inner">
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px;font-family:monospace">${s.session_id || '—'}</div>
      <div class="eb-grid">
        <div class="eb-item"><div class="eb-label">Pre-gen audio</div><div class="eb-val">$0.00</div><div class="eb-sub">${fmtN(s.pregen_clips_played)} clips</div></div>
        <div class="eb-item"><div class="eb-label">ElevenLabs TTS</div><div class="eb-val">$${Number(s.elevenlabs_cost_usd || 0).toFixed(3)}</div><div class="eb-sub">${fmtN(s.elevenlabs_chars_used)} chars</div></div>
        <div class="eb-item"><div class="eb-label">Claude API</div><div class="eb-val">$${Number(s.claude_cost_usd || 0).toFixed(3)}</div><div class="eb-sub">${fmtN(s.claude_turns)} turns</div></div>
        <div class="eb-item"><div class="eb-label">Deepgram STT</div><div class="eb-val">$${Number(s.deepgram_cost_usd || 0).toFixed(3)}</div><div class="eb-sub">${Number(s.deepgram_audio_seconds || 0).toFixed(1)}s audio</div></div>
        <div class="eb-item" style="background:${!isFree ? '#e8f5e9' : '#f5f5f5'};border-color:${!isFree ? '#c8e6c9' : '#e0e0e0'}">
          <div class="eb-label">Net profit</div>
          <div class="eb-val" style="color:${!isFree ? 'var(--green)' : 'var(--muted)'}">${!isFree ? '+' + fmt$(p) : 'n/a'}</div>
          <div class="eb-sub">${!isFree ? (Number(s.margin_pct) || 0).toFixed(0) + '% margin' : 'free session'}</div>
        </div>
      </div>
      ${!isFree ? `<div style="font-size:10px;color:var(--muted);margin-top:4px">Margin: <span style="color:var(--green);font-weight:500">${(Number(s.margin_pct) || 0).toFixed(0)}%</span></div><div class="profit-bar-wrap"><div class="profit-bar" style="width:${Math.max(0, Math.min(100, Number(s.margin_pct) || 0))}%"></div></div>` : ''}
    </div></td></tr>`;
  });

  html += '</tbody></table></div>';
  wrapper.innerHTML = html;

  document.getElementById('sessions-pagination').innerHTML = totalPages > 1 ? `
    <button onclick="changePage(-1)" ${sessionsPage === 0 ? 'disabled' : ''}>Prev</button>
    <span class="page-info">Page ${sessionsPage + 1} of ${totalPages}</span>
    <button onclick="changePage(1)" ${sessionsPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
  ` : '';
}

function sortBy(col) {
  if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortCol = col; sortDir = 'desc'; }
  renderAll();
}

function changePage(d) { sessionsPage += d; renderAll(); }

function toggleExpand(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── REVENUE & PROFIT ─────────────────────────────────────────────
function renderRevenue(data) {
  const el = document.getElementById('revenue-stats');
  if (data.length === 0) {
    el.innerHTML = emptyState('No data yet.');
    document.getElementById('revenue-avg-table').innerHTML = '';
    return;
  }

  const gross = data.reduce((a, s) => a + grossRev(s), 0);
  const appleCut = data.reduce((a, s) => a + Number(s.apple_cut_usd || 0), 0);
  const net = gross - appleCut;
  const totalCostVal = data.reduce((a, s) => a + cost(s), 0);
  const netProfit = net - totalCostVal;

  el.innerHTML = `
    <div class="stat-card dark"><div class="stat-label">Gross revenue</div><div class="stat-value">${fmt$(gross)}</div><div class="stat-delta">before Apple cut</div></div>
    <div class="stat-card"><div class="stat-label">After Apple 15%</div><div class="stat-value">${fmt$(net)}</div><div class="stat-delta neu">${fmt$(appleCut)} to Apple</div></div>
    <div class="stat-card"><div class="stat-label">Session costs</div><div class="stat-value">${fmt$(totalCostVal)}</div><div class="stat-delta neg">TTS + Claude + STT</div></div>
    <div class="stat-card green-card"><div class="stat-label">Net profit</div><div class="stat-value">${fmt$(netProfit)}</div><div class="stat-delta" style="color:#2d7a3a">${net > 0 ? ((netProfit / net) * 100).toFixed(1) : '0'}% margin</div></div>
  `;

  // Revenue by type bar chart
  const dayMap = buildDailyMap(data);
  const labels = Object.keys(dayMap).map(fmtDateShort);
  const singleRev = Object.values(dayMap).map(d => d.single);
  const packRev = Object.values(dayMap).map(d => d.pack);

  document.getElementById('revenue-chart-meta').textContent = `last ${currentRange === 'all' ? 'all time' : currentRange}`;

  destroyChart('revenue-by-type');
  charts['revenue-by-type'] = new Chart(document.getElementById('chart-revenue-by-type'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Single', data: singleRev, backgroundColor: '#1565c0', borderRadius: 2 },
        { label: '4-pack', data: packRev, backgroundColor: '#6a1b9a', borderRadius: 2 },
      ],
    },
    options: { ...chartOpts('$'), scales: { x: { stacked: true, ...chartAxisX() }, y: { stacked: true, ...chartAxisY('$') } } },
  });

  // Type pie
  const counts = { single: 0, '4pack': 0, free: 0 };
  data.forEach(s => { const t = getType(s); if (t === 'promo') counts.free++; else counts[t] = (counts[t] || 0) + 1; });

  destroyChart('type-pie');
  charts['type-pie'] = new Chart(document.getElementById('chart-type-pie'), {
    type: 'doughnut',
    data: {
      labels: ['Single', '4-pack', 'Free/Promo'],
      datasets: [{ data: [counts.single, counts['4pack'], counts.free], backgroundColor: ['#1565c0', '#6a1b9a', '#e0e0e0'], borderWidth: 2, borderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { display: false } } },
  });

  // Avg revenue table
  const singleSessions = data.filter(s => getType(s) === 'single');
  const packSessions = data.filter(s => getType(s) === '4pack');
  const avgSingle = singleSessions.length > 0 ? (singleSessions.reduce((a, s) => a + netRev(s), 0) / singleSessions.length) : 0;
  const avgPack = packSessions.length > 0 ? (packSessions.reduce((a, s) => a + netRev(s), 0) / packSessions.length) : 0;

  document.getElementById('revenue-avg-table').innerHTML = `
    <div class="cost-summary-row"><span class="label">Avg revenue — single</span><span class="val">${fmt$(avgSingle)} net</span></div>
    <div class="cost-summary-row"><span class="label">Avg revenue — 4-pack</span><span class="val">${fmt$(avgPack)} net</span></div>
    <div class="cost-summary-row"><span class="label">Avg revenue — free</span><span class="val" style="color:var(--muted)">$0.00</span></div>
  `;

  calcMargin();
}

function calcMargin() {
  const gross = parseFloat(document.getElementById('mc-type').value) || 0;
  const apple = parseFloat(document.getElementById('mc-apple').value) || 15;
  const costVal = parseFloat(document.getElementById('mc-cost').value) || 0;
  const net = gross * (1 - apple / 100);
  const prof = net - costVal;
  const marg = gross > 0 ? Math.round((prof / net) * 100) : 0;

  document.getElementById('mc-results').innerHTML = `
    <div class="mc-res-item"><div class="mc-res-label">Gross revenue</div><div class="mc-res-val">${fmt$(gross)}</div></div>
    <div class="mc-res-item"><div class="mc-res-label">After Apple</div><div class="mc-res-val">${fmt$(net)}</div></div>
    <div class="mc-res-item"><div class="mc-res-label">Minus session cost</div><div class="mc-res-val">${gross > 0 ? fmt$(prof) : 'n/a'}</div></div>
    <div class="mc-res-item"><div class="mc-res-label">Margin</div><div class="mc-res-val ${gross > 0 && marg > 80 ? 'green' : gross === 0 ? '' : 'red'}">${gross > 0 ? marg + '%' : 'n/a'}</div></div>
  `;
}

// ── COST BREAKDOWN ───────────────────────────────────────────────
function renderCosts(data) {
  const el = document.getElementById('costs-stats');
  if (data.length === 0) {
    el.innerHTML = emptyState('No data yet.');
    return;
  }

  const tts = data.reduce((a, s) => a + Number(s.elevenlabs_cost_usd || 0), 0);
  const claude = data.reduce((a, s) => a + Number(s.claude_cost_usd || 0), 0);
  const dg = data.reduce((a, s) => a + Number(s.deepgram_cost_usd || 0), 0);
  const total = tts + claude + dg;
  const ttsPct = total > 0 ? ((tts / total) * 100).toFixed(0) : '0';
  const claudePct = total > 0 ? ((claude / total) * 100).toFixed(0) : '0';
  const dgPct = total > 0 ? ((dg / total) * 100).toFixed(0) : '0';

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">ElevenLabs TTS</div><div class="stat-value">${fmt$(tts)}</div><div class="stat-delta">${ttsPct}% of total</div></div>
    <div class="stat-card"><div class="stat-label">Claude API</div><div class="stat-value">${fmt$(claude)}</div><div class="stat-delta">${claudePct}% of total</div></div>
    <div class="stat-card"><div class="stat-label">Deepgram STT</div><div class="stat-value">${fmt$(dg)}</div><div class="stat-delta">${dgPct}% of total</div></div>
    <div class="stat-card dark"><div class="stat-label">Total</div><div class="stat-value">${fmt$(total)}</div><div class="stat-delta">${fmtN(data.length)} sessions</div></div>
  `;

  document.getElementById('cost-chart-meta').textContent = `last ${currentRange === 'all' ? 'all time' : currentRange}`;

  // Stacked cost bar
  const dayMap = buildDailyMap(data);
  const labels = Object.keys(dayMap).map(fmtDateShort);

  destroyChart('cost-stacked');
  charts['cost-stacked'] = new Chart(document.getElementById('chart-cost-stacked'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'ElevenLabs', data: Object.values(dayMap).map(d => d.tts), backgroundColor: '#c0392b' },
        { label: 'Claude', data: Object.values(dayMap).map(d => d.claude), backgroundColor: '#1a1a1a' },
        { label: 'Deepgram', data: Object.values(dayMap).map(d => d.dg), backgroundColor: '#bdbdbd' },
      ],
    },
    options: { ...chartOpts('$'), scales: { x: { stacked: true, ...chartAxisX() }, y: { stacked: true, ...chartAxisY('$') } } },
  });

  // Cost pie
  document.getElementById('cost-pie-legend').innerHTML = `
    <span class="leg-item"><span class="leg-dot" style="background:#c0392b"></span>TTS ${ttsPct}%</span>
    <span class="leg-item"><span class="leg-dot" style="background:#1a1a1a"></span>Claude ${claudePct}%</span>
    <span class="leg-item"><span class="leg-dot" style="background:#9e9e9e"></span>Deepgram ${dgPct}%</span>
  `;

  destroyChart('cost-pie');
  charts['cost-pie'] = new Chart(document.getElementById('chart-cost-pie'), {
    type: 'doughnut',
    data: {
      labels: ['ElevenLabs', 'Claude', 'Deepgram'],
      datasets: [{ data: [tts, claude, dg], backgroundColor: ['#c0392b', '#1a1a1a', '#bdbdbd'], borderWidth: 2, borderColor: '#fff' }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { display: false } } },
  });
}

// ── WHO'S COOKING ────────────────────────────────────────────────
function renderWhosCooking(data) {
  const el = document.getElementById('whos-stats');
  if (data.length === 0) {
    el.innerHTML = emptyState('No data yet.');
    return;
  }

  const total = data.length;
  const avgCrew = (data.reduce((a, s) => a + (s.crew_count || 1), 0) / total).toFixed(1);
  const soloPct = ((data.filter(s => !s.crew_count || s.crew_count <= 1).length / total) * 100).toFixed(0);
  const kidsPct = ((data.filter(s => s.has_kids).length / total) * 100).toFixed(0);
  const kidsCount = data.filter(s => s.has_kids).length;

  // Top pairing
  const pairings = {};
  data.forEach(s => {
    if (s.recipe_name && s.character_name) {
      const key = `${s.recipe_name}|||${s.character_name}`;
      pairings[key] = (pairings[key] || 0) + 1;
    }
  });
  const topPairing = Object.entries(pairings).sort((a, b) => b[1] - a[1])[0];
  const topPairLabel = topPairing ? topPairing[0].split('|||').join(' · ') : '—';
  const topPairCount = topPairing ? topPairing[1] : 0;

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Avg crew size</div><div class="stat-value">${avgCrew}</div></div>
    <div class="stat-card"><div class="stat-label">Solo sessions</div><div class="stat-value">${soloPct}%</div></div>
    <div class="stat-card"><div class="stat-label">With kids</div><div class="stat-value">${kidsPct}%</div><div class="stat-delta">${kidsCount} sessions</div></div>
    <div class="stat-card dark"><div class="stat-label">Top pairing</div><div class="stat-value" style="font-size:15px;margin-top:3px">${topPairLabel}</div><div class="stat-delta" style="color:#7ec88a">${topPairCount} sessions</div></div>
  `;

  // Recipe bar chart
  const recipeCounts = {};
  data.forEach(s => { if (s.recipe_name) recipeCounts[s.recipe_name] = (recipeCounts[s.recipe_name] || 0) + 1; });
  const topRecipes = Object.entries(recipeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  destroyChart('recipe-bar');
  charts['recipe-bar'] = new Chart(document.getElementById('chart-recipe-bar'), {
    type: 'bar',
    data: { labels: topRecipes.map(r => r[0]), datasets: [{ data: topRecipes.map(r => r[1]), backgroundColor: '#1a1a1a', borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 }, color: '#9e9e9e' } }, y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#1a1a1a' } } } },
  });

  // Character bar chart
  const charCounts = {};
  data.forEach(s => { if (s.character_name) charCounts[s.character_name] = (charCounts[s.character_name] || 0) + 1; });
  const topChars = Object.entries(charCounts).sort((a, b) => b[1] - a[1]);
  const charColors = ['#c0392b', '#1a1a1a', '#7a756c', '#bdbdbd', '#1565c0', '#6a1b9a', '#e65100', '#2d7a3a', '#795548', '#9e9e9e', '#00695c'];

  destroyChart('character-bar');
  charts['character-bar'] = new Chart(document.getElementById('chart-character-bar'), {
    type: 'bar',
    data: { labels: topChars.map(c => c[0]), datasets: [{ data: topChars.map(c => c[1]), backgroundColor: topChars.map((_, i) => charColors[i % charColors.length]), borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#1a1a1a' } }, y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 }, color: '#9e9e9e' } } } },
  });
}

// ── ERRORS & ISSUES ──────────────────────────────────────────────
function renderErrors(data) {
  const el = document.getElementById('errors-stats');
  const errorSessions = data.filter(s => s.had_error);

  if (data.length === 0) {
    el.innerHTML = emptyState('No data yet.');
    document.getElementById('errors-table-wrapper').innerHTML = '';
    return;
  }

  // Categorize errors
  let ttsErrors = 0, claudeErrors = 0, revenueLost = 0;
  errorSessions.forEach(s => {
    (s.errors || []).forEach(e => {
      const t = (e.type || '').toLowerCase();
      if (t.includes('elevenlabs') || t.includes('tts')) ttsErrors++;
      if (t.includes('claude') || t.includes('llm')) claudeErrors++;
    });
    if (!s.completed && grossRev(s) > 0) revenueLost += grossRev(s);
  });

  const errorRate = data.length > 0 ? ((errorSessions.length / data.length) * 100).toFixed(1) : '0';
  const abandonedPaid = errorSessions.filter(s => !s.completed && grossRev(s) > 0).length;

  el.innerHTML = `
    <div class="stat-card"><div class="stat-label">Sessions with errors</div><div class="stat-value">${errorSessions.length}</div><div class="stat-delta neg">${errorRate}% error rate</div></div>
    <div class="stat-card"><div class="stat-label">ElevenLabs timeouts</div><div class="stat-value">${ttsErrors}</div></div>
    <div class="stat-card"><div class="stat-label">Claude API errors</div><div class="stat-value">${claudeErrors}</div></div>
    <div class="stat-card"><div class="stat-label">Revenue lost to errors</div><div class="stat-value">${fmt$(revenueLost)}</div><div class="stat-delta neg">${abandonedPaid} abandoned paid session${abandonedPaid !== 1 ? 's' : ''}</div></div>
  `;

  const wrapper = document.getElementById('errors-table-wrapper');
  if (errorSessions.length === 0) {
    wrapper.innerHTML = emptyState('No errors recorded. Nice!');
    return;
  }

  let rows = [];
  errorSessions.forEach(s => {
    (s.errors || []).forEach(e => {
      const isFree = getType(s) === 'free' || getType(s) === 'promo';
      const recovered = s.completed;
      let riskHtml;
      if (isFree) {
        riskHtml = '<span style="color:var(--muted)">n/a</span>';
      } else if (recovered) {
        riskHtml = '<span style="color:var(--green);font-weight:500">$0 lost</span>';
      } else {
        riskHtml = `<span style="color:var(--red);font-weight:500">${fmt$(grossRev(s))} lost</span>`;
      }
      rows.push(`<tr class="error-row">
        <td style="white-space:nowrap">${fmtDate(s.created_at)}</td>
        <td style="font-family:monospace;font-size:10px;color:var(--muted);max-width:100px;overflow:hidden;text-overflow:ellipsis">${s.session_id || '—'}</td>
        <td>${s.recipe_name || '—'} &middot; ${s.character_name || '—'}</td>
        <td>${typeBadge(s)}</td>
        <td>${riskHtml}</td>
        <td><span class="badge b-err">${e.type || 'Unknown'}</span></td>
        <td>${recovered ? '<span class="badge b-ok">Yes</span>' : '<span class="badge b-err">No</span>'}</td>
      </tr>`);
    });
  });

  wrapper.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><table class="sessions-table">
    <thead><tr><th>Date</th><th>Session ID</th><th>Recipe</th><th>Purchase type</th><th>Revenue at risk</th><th>Error type</th><th>Recovered</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

// ── EXPORT CSV ───────────────────────────────────────────────────
function exportCSV() {
  const data = filterSessions(allSessions);
  if (data.length === 0) return;
  const headers = ['Date', 'Recipe', 'Character', 'Crew', 'Product ID', 'Gross Revenue', 'Apple Cut', 'Net Revenue', 'Total Cost', 'Profit', 'Margin %', 'TTS Cost', 'Claude Cost', 'Deepgram Cost', 'Completed', 'Has Kids', 'Errors'];
  const rows = data.map(s => [
    s.created_at, s.recipe_name, s.character_name, fmtCrew(s), s.product_id,
    s.gross_revenue_usd, s.apple_cut_usd, s.net_revenue_usd, s.total_cost_usd,
    s.profit_usd, s.margin_pct, s.elevenlabs_cost_usd, s.claude_cost_usd,
    s.deepgram_cost_usd, s.completed, s.has_kids, (s.errors || []).length,
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sunday-sauce-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ── Chart Helpers ────────────────────────────────────────────────
function buildDailyMap(data) {
  const days = {};
  // Determine range
  const rangeDays = { '7d': 7, '30d': 30, '90d': 90 }[currentRange];
  const numDays = rangeDays || (data.length > 0 ? Math.ceil((Date.now() - new Date(data[data.length - 1].created_at)) / 86400000) + 1 : 30);
  const limitedDays = Math.min(numDays, 90); // Cap at 90 for chart readability

  for (let i = limitedDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days[d] = { rev: 0, cost: 0, tts: 0, claude: 0, dg: 0, single: 0, pack: 0 };
  }

  data.forEach(s => {
    const day = (s.created_at || '').slice(0, 10);
    if (days[day]) {
      days[day].rev += grossRev(s);
      days[day].cost += cost(s);
      days[day].tts += Number(s.elevenlabs_cost_usd || 0);
      days[day].claude += Number(s.claude_cost_usd || 0);
      days[day].dg += Number(s.deepgram_cost_usd || 0);
      const t = getType(s);
      if (t === 'single') days[day].single += grossRev(s);
      if (t === '4pack') days[day].pack += grossRev(s);
    }
  });

  return days;
}

function chartOpts(prefix) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: chartAxisY(prefix), x: chartAxisX() },
  };
}

function chartAxisY(prefix) {
  return {
    grid: { color: 'rgba(0,0,0,.04)' },
    ticks: { font: { size: 10 }, color: '#9e9e9e', callback: v => prefix + v.toFixed(prefix === '$' ? 2 : 0) },
  };
}

function chartAxisX() {
  return {
    grid: { display: false },
    ticks: { font: { size: 9 }, color: '#9e9e9e', maxRotation: 45, autoSkip: true, maxTicksLimit: 15 },
  };
}
