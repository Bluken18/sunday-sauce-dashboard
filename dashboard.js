// ── Sunday Sauce Admin Dashboard ─────────────────────────────────
// Vanilla JS — no frameworks. Chart.js for charts. Supabase JS v2 for data.

// ── Globals ──────────────────────────────────────────────────────
let allSessions = [];
let filteredSessions = [];
let sessionsPage = 0;
const PAGE_SIZE = 25;
const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// Chart instances (destroyed before re-render)
const charts = {};

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
  applyFilters();
  renderOverview();
  renderCosts();
  renderWhosCooking();
  renderErrors();
  populateFilterDropdowns();
}

// ── Navigation ───────────────────────────────────────────────────
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  const section = document.getElementById(id);
  if (section) section.classList.add('active');
  const link = document.querySelector(`.sidebar-nav a[href="#${id}"]`);
  if (link) link.classList.add('active');
}

async function signOut() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// Handle hash navigation
window.addEventListener('hashchange', () => {
  const id = window.location.hash.replace('#', '') || 'overview';
  showSection(id);
});
if (window.location.hash) {
  showSection(window.location.hash.replace('#', ''));
}

// ── Helpers ──────────────────────────────────────────────────────
function fmt$(n) { return '$' + (Number(n) || 0).toFixed(2); }
function fmt$6(n) { return '$' + (Number(n) || 0).toFixed(6); }
function fmtN(n) { return (Number(n) || 0).toLocaleString(); }
function fmtDuration(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' at '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtCrew(row) {
  if (!row.crew_count || row.crew_count <= 1) return 'Solo';
  const ages = (row.crew_members || [])
    .filter(m => m.age != null)
    .map(m => m.age)
    .sort((a, b) => a - b);
  if (ages.length) {
    return `${row.crew_count} people (ages ${ages.join(', ')})`;
  }
  return `${row.crew_count} people`;
}

function emptyState(msg) {
  return `<div class="empty-state"><div class="empty-icon">~</div><p>${msg}</p></div>`;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ── Filters ──────────────────────────────────────────────────────
function populateFilterDropdowns() {
  const recipes = [...new Set(allSessions.map(s => s.recipe_name).filter(Boolean))].sort();
  const sel = document.getElementById('filter-recipe');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Recipes</option>' +
    recipes.map(r => `<option value="${r}">${r}</option>`).join('');
  sel.value = current;

  const errTypes = [...new Set(
    allSessions.flatMap(s => (s.errors || []).map(e => e.type)).filter(Boolean)
  )].sort();
  const errSel = document.getElementById('filter-error-type');
  const errCurrent = errSel.value;
  errSel.innerHTML = '<option value="">All Error Types</option>' +
    errTypes.map(t => `<option value="${t}">${t}</option>`).join('');
  errSel.value = errCurrent;
}

function applyFilters() {
  const from = document.getElementById('filter-date-from').value;
  const to = document.getElementById('filter-date-to').value;
  const recipe = document.getElementById('filter-recipe').value;
  const type = document.getElementById('filter-type').value;

  filteredSessions = allSessions.filter(s => {
    if (from && s.created_at < from) return false;
    if (to && s.created_at < to + 'T00:00:00' === false && s.created_at > to + 'T23:59:59') return false;
    if (recipe && s.recipe_name !== recipe) return false;
    if (type && s.session_type !== type) return false;
    return true;
  });

  // Better date filtering
  if (from) {
    const fromDate = new Date(from + 'T00:00:00');
    filteredSessions = filteredSessions.filter(s => new Date(s.created_at) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to + 'T23:59:59');
    filteredSessions = filteredSessions.filter(s => new Date(s.created_at) <= toDate);
  }

  sessionsPage = 0;
  renderSessionsTable();
}

// Attach filter listeners
['filter-date-from', 'filter-date-to', 'filter-recipe', 'filter-type'].forEach(id => {
  document.getElementById(id).addEventListener('change', applyFilters);
});

// ── OVERVIEW ─────────────────────────────────────────────────────
function renderOverview() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const total = allSessions.length;
  const todayCount = allSessions.filter(s => (s.created_at || '').startsWith(today)).length;
  const weekCount = allSessions.filter(s => s.created_at >= weekAgo).length;
  const avgCost = total > 0 ? allSessions.reduce((a, s) => a + Number(s.total_cost_usd || 0), 0) / total : 0;
  const totalSpend = allSessions.reduce((a, s) => a + Number(s.total_cost_usd || 0), 0);
  const monthSpend = allSessions
    .filter(s => s.created_at >= monthStart)
    .reduce((a, s) => a + Number(s.total_cost_usd || 0), 0);
  const avgDuration = total > 0
    ? Math.round(allSessions.reduce((a, s) => a + (s.duration_seconds || 0), 0) / total)
    : 0;
  const completedCount = allSessions.filter(s => s.completed).length;
  const completionRate = total > 0 ? ((completedCount / total) * 100).toFixed(1) : '0.0';

  // Who's cooking stats
  const recipeCounts = {};
  const charCounts = {};
  allSessions.forEach(s => {
    if (s.recipe_name) recipeCounts[s.recipe_name] = (recipeCounts[s.recipe_name] || 0) + 1;
    if (s.character_name) charCounts[s.character_name] = (charCounts[s.character_name] || 0) + 1;
  });
  const topRecipe = Object.entries(recipeCounts).sort((a, b) => b[1] - a[1])[0];
  const topChar = Object.entries(charCounts).sort((a, b) => b[1] - a[1])[0];
  const kidsCount = allSessions.filter(s => s.has_kids).length;
  const kidsPct = total > 0 ? ((kidsCount / total) * 100).toFixed(1) : '0.0';
  const avgCrew = total > 0
    ? (allSessions.reduce((a, s) => a + (s.crew_count || 1), 0) / total).toFixed(1)
    : '1.0';

  const container = document.getElementById('overview-stats');
  if (total === 0) {
    container.innerHTML = emptyState('No sessions yet. Start cooking to see data here.');
    return;
  }

  container.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Sessions</div><div class="stat-value">${fmtN(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Sessions Today</div><div class="stat-value">${fmtN(todayCount)}</div></div>
    <div class="stat-card"><div class="stat-label">Sessions This Week</div><div class="stat-value">${fmtN(weekCount)}</div></div>
    <div class="stat-card"><div class="stat-label">Avg Session Cost</div><div class="stat-value">${fmt$(avgCost)}</div></div>
    <div class="stat-card"><div class="stat-label">Total Spend (All Time)</div><div class="stat-value">${fmt$(totalSpend)}</div></div>
    <div class="stat-card"><div class="stat-label">Total Spend (This Month)</div><div class="stat-value">${fmt$(monthSpend)}</div></div>
    <div class="stat-card"><div class="stat-label">Avg Duration</div><div class="stat-value">${fmtDuration(avgDuration)}</div></div>
    <div class="stat-card"><div class="stat-label">Completion Rate</div><div class="stat-value">${completionRate}%</div></div>
    <div class="stat-card"><div class="stat-label">Most Cooked Recipe</div><div class="stat-value" style="font-size:18px">${topRecipe ? topRecipe[0] : '—'}</div><div class="stat-sub">${topRecipe ? topRecipe[1] + ' sessions' : ''}</div></div>
    <div class="stat-card"><div class="stat-label">Most Popular Character</div><div class="stat-value" style="font-size:18px">${topChar ? topChar[0] : '—'}</div><div class="stat-sub">${topChar ? topChar[1] + ' sessions' : ''}</div></div>
    <div class="stat-card"><div class="stat-label">Sessions with Kids</div><div class="stat-value">${fmtN(kidsCount)}</div><div class="stat-sub">${kidsPct}% of total</div></div>
    <div class="stat-card"><div class="stat-label">Avg Crew Size</div><div class="stat-value">${avgCrew}</div></div>
  `;
}

// ── SESSIONS TABLE ───────────────────────────────────────────────
let sortCol = 'created_at';
let sortDir = 'desc';

function renderSessionsTable() {
  const wrapper = document.getElementById('sessions-table-wrapper');
  if (filteredSessions.length === 0) {
    wrapper.innerHTML = emptyState('No sessions match your filters.');
    document.getElementById('sessions-pagination').innerHTML = '';
    return;
  }

  // Sort
  const sorted = [...filteredSessions].sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const start = sessionsPage * PAGE_SIZE;
  const pageData = sorted.slice(start, start + PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

  const arrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  let html = `<table class="data-table" id="sessions-data-table">
    <thead><tr>
      <th onclick="sortSessions('created_at')">Date/Time${arrow('created_at')}</th>
      <th onclick="sortSessions('recipe_name')">Recipe${arrow('recipe_name')}</th>
      <th onclick="sortSessions('character_name')">Character${arrow('character_name')}</th>
      <th onclick="sortSessions('recipe_region')">Region${arrow('recipe_region')}</th>
      <th>Crew</th>
      <th onclick="sortSessions('session_type')">Type${arrow('session_type')}</th>
      <th onclick="sortSessions('duration_seconds')">Duration${arrow('duration_seconds')}</th>
      <th>Pre-gen</th>
      <th>TTS Chars</th>
      <th>Claude Turns</th>
      <th onclick="sortSessions('total_cost_usd')">Cost${arrow('total_cost_usd')}</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  for (const s of pageData) {
    const statusBadge = s.had_error
      ? '<span class="badge badge-error">Error</span>'
      : s.completed
        ? '<span class="badge badge-completed">Done</span>'
        : '<span class="badge badge-incomplete">Incomplete</span>';
    const typeBadge = s.session_type === 'free'
      ? '<span class="badge badge-free">Free</span>'
      : s.session_type === 'offer_code'
        ? '<span class="badge badge-free">Offer</span>'
        : '<span class="badge badge-paid">Paid</span>';

    html += `<tr class="expandable" onclick="toggleRow(this, '${s.session_id}')">
      <td>${fmtDate(s.created_at)}</td>
      <td>${s.recipe_name || '—'}</td>
      <td>${s.character_name || '—'}</td>
      <td>${s.recipe_region || '—'}</td>
      <td>${fmtCrew(s)}</td>
      <td>${typeBadge}</td>
      <td>${fmtDuration(s.duration_seconds)}</td>
      <td>${fmtN(s.pregen_clips_played)}</td>
      <td>${fmtN(s.elevenlabs_chars_used)}</td>
      <td>${fmtN(s.claude_turns)}</td>
      <td>${fmt$(s.total_cost_usd)}</td>
      <td>${statusBadge}</td>
    </tr>`;
  }

  html += '</tbody></table>';
  wrapper.innerHTML = html;

  // Pagination
  const pagEl = document.getElementById('sessions-pagination');
  pagEl.innerHTML = `
    <button onclick="changePage(-1)" ${sessionsPage === 0 ? 'disabled' : ''}>Prev</button>
    <span class="page-info">Page ${sessionsPage + 1} of ${totalPages}</span>
    <button onclick="changePage(1)" ${sessionsPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
  `;
}

function sortSessions(col) {
  if (sortCol === col) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortCol = col;
    sortDir = 'desc';
  }
  renderSessionsTable();
}

function changePage(delta) {
  sessionsPage += delta;
  renderSessionsTable();
}

function toggleRow(tr, sessionId) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('expanded-row')) {
    next.remove();
    return;
  }
  // Remove any other expanded row
  document.querySelectorAll('.expanded-row').forEach(r => r.remove());

  const s = allSessions.find(x => x.session_id === sessionId);
  if (!s) return;

  const errorsHtml = (s.errors || []).length > 0
    ? s.errors.map(e => `<div style="margin-bottom:4px;color:var(--red);">[${e.type}] ${e.message}</div>`).join('')
    : '<span style="color:var(--gray-400);">None</span>';

  const expandedTr = document.createElement('tr');
  expandedTr.className = 'expanded-row';
  expandedTr.innerHTML = `<td colspan="12">
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-label">Pre-gen Audio</div>
        <div class="detail-value">${fmtN(s.pregen_clips_played)} clips, $0.00</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Live TTS (ElevenLabs)</div>
        <div class="detail-value">${fmtN(s.elevenlabs_chars_used)} chars, ${fmt$(s.elevenlabs_cost_usd)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Claude API</div>
        <div class="detail-value">${fmtN(s.claude_turns)} turns, ${fmtN(s.claude_input_tokens)} in / ${fmtN(s.claude_output_tokens)} out, ${fmt$(s.claude_cost_usd)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Deepgram STT</div>
        <div class="detail-value">${Number(s.deepgram_audio_seconds || 0).toFixed(1)}s, ${fmt$(s.deepgram_cost_usd)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">LiveKit</div>
        <div class="detail-value">${fmtDuration(s.livekit_duration_seconds)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Crew</div>
        <div class="detail-value">${fmtCrew(s)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Device</div>
        <div class="detail-value">${s.device_model || '—'} / iOS ${s.ios_version || '—'} / v${s.app_version || '—'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">Errors</div>
        <div class="detail-value">${errorsHtml}</div>
      </div>
    </div>
  </td>`;
  tr.after(expandedTr);
}

// ── EXPORT CSV ───────────────────────────────────────────────────
function exportCSV() {
  if (filteredSessions.length === 0) return;
  const headers = [
    'Date', 'Recipe', 'Character', 'Region', 'Crew', 'Type', 'Duration (s)',
    'Pre-gen Clips', 'TTS Chars', 'TTS Cost', 'Claude Turns', 'Claude In Tokens',
    'Claude Out Tokens', 'Claude Cost', 'Deepgram Seconds', 'Deepgram Cost',
    'Total Cost', 'Completed', 'Has Kids', 'Errors'
  ];
  const rows = filteredSessions.map(s => [
    s.created_at, s.recipe_name, s.character_name, s.recipe_region, fmtCrew(s),
    s.session_type, s.duration_seconds, s.pregen_clips_played,
    s.elevenlabs_chars_used, s.elevenlabs_cost_usd, s.claude_turns,
    s.claude_input_tokens, s.claude_output_tokens, s.claude_cost_usd,
    s.deepgram_audio_seconds, s.deepgram_cost_usd, s.total_cost_usd,
    s.completed, s.has_kids, (s.errors || []).length
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sunday-sauce-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ── COST BREAKDOWN ───────────────────────────────────────────────
function renderCosts() {
  if (allSessions.length === 0) {
    document.getElementById('cost-comparison-body').innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:var(--gray-400);padding:20px;">No data yet</td></tr>';
    document.getElementById('margin-results').innerHTML = '';
    return;
  }

  // Build daily aggregates for last 30 days
  const now = new Date();
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }

  const dailyData = {};
  days.forEach(d => { dailyData[d] = { tts: 0, claude: 0, deepgram: 0, total: 0 }; });
  allSessions.forEach(s => {
    const day = (s.created_at || '').slice(0, 10);
    if (dailyData[day]) {
      dailyData[day].tts += Number(s.elevenlabs_cost_usd || 0);
      dailyData[day].claude += Number(s.claude_cost_usd || 0);
      dailyData[day].deepgram += Number(s.deepgram_cost_usd || 0);
      dailyData[day].total += Number(s.total_cost_usd || 0);
    }
  });

  const labels = days.map(d => fmtDateShort(d));
  const brandColors = {
    tts: '#c0392b',
    claude: '#1a1a1a',
    deepgram: '#a09888',
  };

  // Daily total line chart
  destroyChart('daily-cost');
  const ctx1 = document.getElementById('chart-daily-cost').getContext('2d');
  charts['daily-cost'] = new Chart(ctx1, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Total Cost',
        data: days.map(d => dailyData[d].total),
        borderColor: brandColors.tts,
        backgroundColor: 'rgba(192, 57, 43, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => '$' + v.toFixed(2) } }
      }
    }
  });

  // Stacked bar chart
  destroyChart('stacked-cost');
  const ctx2 = document.getElementById('chart-stacked-cost').getContext('2d');
  charts['stacked-cost'] = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'TTS', data: days.map(d => dailyData[d].tts), backgroundColor: brandColors.tts },
        { label: 'Claude', data: days.map(d => dailyData[d].claude), backgroundColor: brandColors.claude },
        { label: 'Deepgram', data: days.map(d => dailyData[d].deepgram), backgroundColor: brandColors.deepgram },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { callback: v => '$' + v.toFixed(2) } }
      }
    }
  });

  // Pie chart: overall distribution
  const totalTTS = allSessions.reduce((a, s) => a + Number(s.elevenlabs_cost_usd || 0), 0);
  const totalClaude = allSessions.reduce((a, s) => a + Number(s.claude_cost_usd || 0), 0);
  const totalDeepgram = allSessions.reduce((a, s) => a + Number(s.deepgram_cost_usd || 0), 0);

  destroyChart('cost-pie');
  const ctx3 = document.getElementById('chart-cost-pie').getContext('2d');
  charts['cost-pie'] = new Chart(ctx3, {
    type: 'doughnut',
    data: {
      labels: ['ElevenLabs TTS', 'Claude API', 'Deepgram STT'],
      datasets: [{
        data: [totalTTS, totalClaude, totalDeepgram],
        backgroundColor: [brandColors.tts, brandColors.claude, brandColors.deepgram],
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ctx.label + ': ' + fmt$(ctx.raw) } }
      }
    }
  });

  // Month-over-month comparison
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  const thisMonthSessions = allSessions.filter(s => s.created_at >= thisMonth);
  const lastMonthSessions = allSessions.filter(s => s.created_at >= lastMonth && s.created_at <= lastMonthEnd);

  const sumField = (arr, field) => arr.reduce((a, s) => a + Number(s[field] || 0), 0);

  const components = [
    { name: 'ElevenLabs TTS', field: 'elevenlabs_cost_usd' },
    { name: 'Claude API', field: 'claude_cost_usd' },
    { name: 'Deepgram STT', field: 'deepgram_cost_usd' },
    { name: 'Total', field: 'total_cost_usd' },
  ];

  const tbody = document.getElementById('cost-comparison-body');
  tbody.innerHTML = components.map(c => {
    const thisVal = sumField(thisMonthSessions, c.field);
    const lastVal = sumField(lastMonthSessions, c.field);
    const change = lastVal > 0 ? (((thisVal - lastVal) / lastVal) * 100).toFixed(1) : '—';
    const isTotal = c.name === 'Total';
    return `<tr class="${isTotal ? 'total-row' : ''}">
      <td>${c.name}</td><td>${fmt$(thisVal)}</td><td>${fmt$(lastVal)}</td>
      <td>${typeof change === 'string' && change === '—' ? '—' : (change > 0 ? '+' : '') + change + '%'}</td>
    </tr>`;
  }).join('');

  recalcMargin();
}

function recalcMargin() {
  const price = parseFloat(document.getElementById('margin-price').value) || 0;
  const commission = parseFloat(document.getElementById('margin-commission').value) || 0;
  const total = allSessions.length;
  const avgCost = total > 0 ? allSessions.reduce((a, s) => a + Number(s.total_cost_usd || 0), 0) / total : 0;

  const netRevenue = price * (1 - commission / 100);
  const grossMargin = netRevenue - avgCost;

  document.getElementById('margin-results').innerHTML = `
    <div class="stat-card"><div class="stat-label">Net Revenue / Session</div><div class="stat-value">${fmt$(netRevenue)}</div></div>
    <div class="stat-card"><div class="stat-label">Avg Cost / Session</div><div class="stat-value">${fmt$(avgCost)}</div></div>
    <div class="stat-card"><div class="stat-label">Gross Margin / Session</div><div class="stat-value" style="color:${grossMargin >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt$(grossMargin)}</div></div>
    <div class="stat-card"><div class="stat-label">Margin %</div><div class="stat-value">${netRevenue > 0 ? ((grossMargin / netRevenue) * 100).toFixed(1) + '%' : '—'}</div></div>
  `;
}

// ── WHO'S COOKING ────────────────────────────────────────────────
function renderWhosCooking() {
  const container = document.getElementById('whos-cooking-stats');
  if (allSessions.length === 0) {
    container.innerHTML = emptyState('No sessions yet.');
    document.getElementById('pairings-table-wrapper').innerHTML = '';
    return;
  }

  const total = allSessions.length;
  const kidsCount = allSessions.filter(s => s.has_kids).length;
  const kidsPct = total > 0 ? ((kidsCount / total) * 100).toFixed(1) : '0.0';
  const soloCount = allSessions.filter(s => !s.crew_count || s.crew_count <= 1).length;
  const twoCount = allSessions.filter(s => s.crew_count === 2).length;
  const threePlusCount = allSessions.filter(s => s.crew_count >= 3).length;

  container.innerHTML = `
    <div class="stat-card"><div class="stat-label">Sessions with Kids</div><div class="stat-value">${fmtN(kidsCount)}</div><div class="stat-sub">${kidsPct}% of total</div></div>
    <div class="stat-card"><div class="stat-label">Solo Sessions</div><div class="stat-value">${fmtN(soloCount)}</div></div>
    <div class="stat-card"><div class="stat-label">2-Person Sessions</div><div class="stat-value">${fmtN(twoCount)}</div></div>
    <div class="stat-card"><div class="stat-label">3+ Person Sessions</div><div class="stat-value">${fmtN(threePlusCount)}</div></div>
  `;

  // Recipe bar chart
  const recipeCounts = {};
  allSessions.forEach(s => {
    if (s.recipe_name) recipeCounts[s.recipe_name] = (recipeCounts[s.recipe_name] || 0) + 1;
  });
  const topRecipes = Object.entries(recipeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  destroyChart('recipe-bar');
  const ctx1 = document.getElementById('chart-recipe-bar').getContext('2d');
  charts['recipe-bar'] = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: topRecipes.map(r => r[0]),
      datasets: [{ data: topRecipes.map(r => r[1]), backgroundColor: '#c0392b' }]
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // Character bar chart
  const charCounts = {};
  allSessions.forEach(s => {
    if (s.character_name) charCounts[s.character_name] = (charCounts[s.character_name] || 0) + 1;
  });
  const topChars = Object.entries(charCounts).sort((a, b) => b[1] - a[1]);

  destroyChart('character-bar');
  const ctx2 = document.getElementById('chart-character-bar').getContext('2d');
  charts['character-bar'] = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: topChars.map(c => c[0]),
      datasets: [{ data: topChars.map(c => c[1]), backgroundColor: '#1a1a1a' }]
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // Cuisine/region bar chart
  const cuisineCounts = {};
  allSessions.forEach(s => {
    const key = s.recipe_cuisine || s.recipe_region || 'Unknown';
    cuisineCounts[key] = (cuisineCounts[key] || 0) + 1;
  });
  const topCuisines = Object.entries(cuisineCounts).sort((a, b) => b[1] - a[1]);

  destroyChart('cuisine-bar');
  const ctx3 = document.getElementById('chart-cuisine-bar').getContext('2d');
  charts['cuisine-bar'] = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: topCuisines.map(c => c[0]),
      datasets: [{ data: topCuisines.map(c => c[1]), backgroundColor: '#a09888' }]
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });

  // Crew size pie chart
  destroyChart('crew-pie');
  const ctx4 = document.getElementById('chart-crew-pie').getContext('2d');
  charts['crew-pie'] = new Chart(ctx4, {
    type: 'doughnut',
    data: {
      labels: ['Solo', '2 people', '3+ people'],
      datasets: [{
        data: [soloCount, twoCount, threePlusCount],
        backgroundColor: ['#c0392b', '#1a1a1a', '#a09888'],
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } }
    }
  });

  // Recipe x Character pairings table
  const pairings = {};
  allSessions.forEach(s => {
    if (s.recipe_name && s.character_name) {
      const key = `${s.recipe_name}|||${s.character_name}`;
      pairings[key] = (pairings[key] || 0) + 1;
    }
  });
  const sortedPairings = Object.entries(pairings)
    .map(([key, count]) => {
      const [recipe, character] = key.split('|||');
      return { recipe, character, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  if (sortedPairings.length === 0) {
    document.getElementById('pairings-table-wrapper').innerHTML = emptyState('No pairings yet.');
    return;
  }

  document.getElementById('pairings-table-wrapper').innerHTML = `
    <table class="data-table">
      <thead><tr><th>Recipe</th><th>Character</th><th>Sessions</th></tr></thead>
      <tbody>${sortedPairings.map(p =>
        `<tr><td>${p.recipe}</td><td>${p.character}</td><td>${p.count}</td></tr>`
      ).join('')}</tbody>
    </table>`;
}

// ── ERRORS ───────────────────────────────────────────────────────
function renderErrors() {
  const errFilter = document.getElementById('filter-error-type').value;
  const errorSessions = allSessions.filter(s => s.had_error);
  const wrapper = document.getElementById('errors-table-wrapper');

  if (errorSessions.length === 0) {
    wrapper.innerHTML = emptyState('No errors recorded. Nice!');
    return;
  }

  // Flatten errors from all sessions
  let errorRows = [];
  errorSessions.forEach(s => {
    (s.errors || []).forEach(e => {
      if (errFilter && e.type !== errFilter) return;
      errorRows.push({
        date: fmtDate(s.created_at),
        session_id: s.session_id,
        recipe: s.recipe_name || '—',
        type: e.type,
        message: e.message,
        context: JSON.stringify(e.context || {}),
      });
    });
  });

  if (errorRows.length === 0) {
    wrapper.innerHTML = emptyState('No errors match this filter.');
    return;
  }

  wrapper.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Date</th><th>Session ID</th><th>Recipe</th>
        <th>Error Type</th><th>Message</th><th>Context</th>
      </tr></thead>
      <tbody>${errorRows.map(e =>
        `<tr class="error-row">
          <td>${e.date}</td>
          <td style="font-size:11px;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${e.session_id}</td>
          <td>${e.recipe}</td>
          <td><span class="badge badge-error">${e.type}</span></td>
          <td style="white-space:normal;max-width:300px;">${e.message}</td>
          <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;">${e.context}</td>
        </tr>`
      ).join('')}</tbody>
    </table>`;
}

document.getElementById('filter-error-type').addEventListener('change', renderErrors);
