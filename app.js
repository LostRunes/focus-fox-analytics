// Global App State
let supabaseClient = null;
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let allEvents = [];
let filteredEvents = [];
let currentPage = 1;
const pageSize = 10;
let loadGeneration = 0; // bumped on every fetchData so a stale load stops

// Chart Instances
let timelineChart = null;
let featuresChart = null;

// DOM Elements
const elBody = document.getElementById('events-table-body');
const elTotalEvents = document.getElementById('stat-total-events');
const elActiveUsers = document.getElementById('stat-active-users');
const elTopFeature = document.getElementById('stat-top-feature');
const elDbSplit = document.getElementById('stat-db-split');
const elSearchInput = document.getElementById('search-input');
const elFilterType = document.getElementById('filter-event-type');
const elFilterSource = document.getElementById('filter-source');
const elFilterPlatform = document.getElementById('filter-platform');
const elBtnRefresh = document.getElementById('btn-refresh');
const elBtnExport = document.getElementById('btn-export');
const elBtnPrev = document.getElementById('btn-prev');
const elBtnNext = document.getElementById('btn-next');
const elPaginationPages = document.getElementById('pagination-pages');
const elSpanStartRow = document.getElementById('span-start-row');
const elSpanEndRow = document.getElementById('span-end-row');
const elSpanTotalRows = document.getElementById('span-total-rows');
const elConnectionStatus = document.getElementById('connection-status');

// Modal Elements
const elModal = document.getElementById('metadata-modal');
const elModalClose = document.getElementById('btn-close-modal');
const elModalCode = document.getElementById('metadata-json-code');

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', async () => {
  await loadEnv();
  initSupabase();
  setupEventListeners();
  fetchData();
});

// Load variables from env.js or .env file
async function loadEnv() {
  // First check if window.ENV exists (loaded via env.js script)
  if (typeof window.ENV !== 'undefined' && window.ENV) {
    SUPABASE_URL = window.ENV.SUPABASE_2_URL || window.ENV.SUPABASE_URL || '';
    SUPABASE_ANON_KEY = window.ENV.SUPABASE_2_KEY || window.ENV.SUPABASE_KEY || '';
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      return;
    }
  }

  try {
    let response;
    try {
      response = await fetch('./.env');
      if (!response.ok) throw new Error();
    } catch (e) {
      response = await fetch('../.env');
    }
    if (!response || !response.ok) {
      throw new Error(`Failed to fetch .env file: ${response ? response.statusText : '404 Not Found'}`);
    }
    const text = await response.text();
    const env = {};
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const firstEqual = trimmed.indexOf('=');
      if (firstEqual === -1) continue;
      
      const key = trimmed.slice(0, firstEqual).trim();
      let value = trimmed.slice(firstEqual + 1).trim();
      
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    SUPABASE_URL = env.SUPABASE_2_URL || env.SUPABASE_URL || '';
    SUPABASE_ANON_KEY = env.SUPABASE_2_KEY || env.SUPABASE_KEY || '';
  } catch (error) {
    console.error('Error loading .env file:', error);
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      updateStatus('disconnected', '<i class="fa-solid fa-circle-xmark"></i> Env Load Error');
    }
  }
}

// Configure client connection
function initSupabase() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase URL or Key is missing from .env');
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    updateStatus('connected', '<i class="fa-solid fa-circle-check"></i> Connected');
  } catch (error) {
    console.error('Supabase initialization failed:', error);
    updateStatus('disconnected', '<i class="fa-solid fa-circle-xmark"></i> Connection Error');
  }
}

// Update the UI status badge
function updateStatus(status, htmlContent) {
  elConnectionStatus.className = `status-badge status-${status}`;
  elConnectionStatus.innerHTML = htmlContent;
}

// Setup all event listeners
function setupEventListeners() {
  elBtnRefresh.addEventListener('click', fetchData);
  elBtnExport.addEventListener('click', exportToCSV);
  
  elSearchInput.addEventListener('input', () => {
    currentPage = 1;
    filterAndRender();
  });
  
  elFilterType.addEventListener('change', () => {
    currentPage = 1;
    filterAndRender();
  });
  
  elFilterSource.addEventListener('change', () => {
    currentPage = 1;
    filterAndRender();
  });

  elFilterPlatform.addEventListener('change', () => {
    currentPage = 1;
    filterAndRender();
  });

  elBtnPrev.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });

  elBtnNext.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredEvents.length / pageSize);
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });

  // Modal events
  elModalClose.addEventListener('click', () => {
    elModal.style.display = 'none';
  });

  window.addEventListener('click', (event) => {
    if (event.target === elModal) {
      elModal.style.display = 'none';
    }
  });
}

// Fetch unified data (Supabase first, then Neon DB in background)
async function fetchData() {
  if (!supabaseClient) return;
  
  updateStatus('loading', '<i class="fa-solid fa-circle-notch fa-spin"></i> Fetching active logs...');
  elBody.innerHTML = `
    <tr>
      <td colspan="7" class="loading-placeholder">
        <i class="fa-solid fa-spinner fa-spin"></i> Fetching active analytics events...
      </td>
    </tr>
  `;
  
  const gen = ++loadGeneration;
  allEvents = [];
  filteredEvents = [];
  currentPage = 1;

  try {
    // 1. Load every Supabase event, rendering progressively as days arrive
    let lastRender = 0;
    const { total, failedPages } = await loadAllSupabaseEvents(supabaseClient, {
      isCancelled: () => gen !== loadGeneration,
      onRows: (rows, loaded, expected) => {
        if (gen !== loadGeneration) return;
        for (const row of rows) allEvents.push(row);
        const pct = expected ? Math.min(99, Math.floor((loaded / expected) * 100)) : 0;
        updateStatus('loading', `<i class="fa-solid fa-circle-notch fa-spin"></i> Loading ${loaded.toLocaleString()} / ${expected.toLocaleString()} (${pct}%)`);
        if (Date.now() - lastRender > 2000) {
          lastRender = Date.now();
          sortAndRender();
        }
      },
    });
    if (gen !== loadGeneration) return;

    sortAndRender();
    if (failedPages > 0) {
      updateStatus('disconnected', `<i class="fa-solid fa-triangle-exclamation"></i> Loaded ${allEvents.length.toLocaleString()} of ${total.toLocaleString()} (${failedPages} page(s) failed, press Refresh)`);
    } else {
      updateStatus('connected', `<i class="fa-solid fa-circle-check"></i> Connected (${allEvents.length.toLocaleString()} Supabase events)`);
    }

    // 2. Fetch Neon DB logs in the background asynchronously
    fetchNeonData();
  } catch (error) {
    console.error('Error fetching Supabase data:', error);
    const errorMsg = error.message || (typeof error === 'object' ? JSON.stringify(error) : error);
    updateStatus('disconnected', `<i class="fa-solid fa-triangle-exclamation"></i> Fetch Failed`);
    elBody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-placeholder" style="color: #F44336;">
          <i class="fa-solid fa-circle-xmark"></i> Failed to retrieve analytics.<br>
          <span style="font-size: 12px; font-family: monospace; opacity: 0.8;">Details: ${escapeHtml(errorMsg)}</span>
        </td>
      </tr>
    `;
  }
}

// Newest first. PostgREST returns ISO-8601 UTC strings, which sort correctly as
// plain strings and avoid parsing dates millions of times on 250k+ rows.
function compareNewestFirst(a, b) {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

function sortAndRender() {
  allEvents.sort(compareNewestFirst);
  filterAndRender();
}

// PostgREST returns at most 1000 rows per request, so split the full range into
// one-day slices, fetch several slices in parallel, and page inside each slice
// with a (created_at, id) cursor so rows sharing a timestamp are never skipped.
async function loadAllSupabaseEvents(client, { onRows, isCancelled, concurrency = 6 }) {
  const VIEW = 'v_supabase_analytics';
  const PAGE = 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const [{ count, error: countError }, { data: oldest, error: oldestError }] = await Promise.all([
    client.from(VIEW).select('id', { count: 'exact', head: true }),
    client.from(VIEW).select('created_at').order('created_at', { ascending: true }).limit(1),
  ]);
  if (countError) throw countError;
  if (oldestError) throw oldestError;
  const total = count || 0;
  if (!oldest || oldest.length === 0) return { total, failedPages: 0 };

  // Newest day first, so recent data shows up first
  const slices = [];
  const startMs = Date.parse(oldest[0].created_at);
  for (let end = Date.now() + 60 * 1000; end > startMs; end -= DAY_MS) {
    slices.push([new Date(Math.max(end - DAY_MS, startMs)).toISOString(), new Date(end).toISOString()]);
  }

  let loaded = 0;
  let failedPages = 0;

  async function fetchPage(from, to, cursor) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let q = client.from(VIEW).select('*')
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE);
      if (cursor) {
        q = q.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
      }
      const { data, error } = await q;
      if (!error) return data || [];
      console.warn(`Page ${from}..${to} failed (attempt ${attempt + 1}):`, error);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    return null;
  }

  async function loadSlice([from, to]) {
    let cursor = null;
    while (!isCancelled()) {
      const rows = await fetchPage(from, to, cursor);
      if (rows === null) { failedPages++; return; }
      if (rows.length === 0) return;
      loaded += rows.length;
      onRows(rows, loaded, Math.max(total, loaded));
      if (rows.length < PAGE) return;
      cursor = rows[rows.length - 1];
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, slices.length) }, async () => {
    while (next < slices.length && !isCancelled()) {
      await loadSlice(slices[next++]);
    }
  });
  await Promise.all(workers);
  return { total, failedPages };
}

// Asynchronously fetch Neon DB events and merge them
async function fetchNeonData() {
  try {
    updateStatus('loading', '<i class="fa-solid fa-circle-notch fa-spin"></i> Loading Neon DB Archives...');
    
    const { data: neonData, error } = await supabaseClient
      .from('v_neon_analytics')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;

    if (neonData && neonData.length > 0) {
      // Merge events, keeping only unique records
      const existingIds = new Set(allEvents.map(e => e.id));
      const uniqueNeon = neonData.filter(e => !existingIds.has(e.id));
      
      allEvents = [...allEvents, ...uniqueNeon];
      
      // Sort combined array descending by date
      allEvents.sort(compareNewestFirst);
      
      filterAndRender();
    }
    
    updateStatus('connected', '<i class="fa-solid fa-circle-check"></i> Connected');
  } catch (error) {
    console.warn('Neon DB background fetch failed/timed out (expected on cold start):', error);
    updateStatus('connected', '<i class="fa-solid fa-circle-check"></i> Connected (Neon Offline/Waking)');
  }
}

// Perform client-side filter, search and update charts + table
function filterAndRender() {
  const searchQuery = elSearchInput.value.toLowerCase().trim();
  const selectedType = elFilterType.value;
  const selectedSource = elFilterSource.value;
  const selectedPlatform = elFilterPlatform.value;

  filteredEvents = allEvents.filter(event => {
    // 1. Search Query mapping
    const matchSearch = !searchQuery || 
      (event.event_name && event.event_name.toLowerCase().includes(searchQuery)) ||
      (event.event_type && event.event_type.toLowerCase().includes(searchQuery)) ||
      (event.screen_name && event.screen_name.toLowerCase().includes(searchQuery)) ||
      (event.username && event.username.toLowerCase().includes(searchQuery)) ||
      (event.display_name && event.display_name.toLowerCase().includes(searchQuery)) ||
      (event.email && event.email.toLowerCase().includes(searchQuery));

    // 2. Type Filter
    const matchType = selectedType === 'all' || event.event_type === selectedType;

    // 3. Source Filter
    const matchSource = selectedSource === 'all' || event.source === selectedSource;

    // 4. Platform Filter
    const matchPlatform = selectedPlatform === 'all' || (event.platform || 'app') === selectedPlatform;

    return matchSearch && matchType && matchSource && matchPlatform;
  });

  updateStats();
  updateCharts();
  renderTable();
}

// Calculate summary stats
function updateStats() {
  // 1. Total events
  elTotalEvents.innerText = filteredEvents.length.toLocaleString();

  // 2. Active users
  const uniqueUsers = new Set();
  const uniqueDesktopUsers = new Set();
  const uniqueAppUsers = new Set();
  filteredEvents.forEach(e => {
    if (e.user_id) {
      uniqueUsers.add(e.user_id);
      if (e.platform === 'desktop') {
        uniqueDesktopUsers.add(e.user_id);
      } else {
        uniqueAppUsers.add(e.user_id);
      }
    }
  });
  elActiveUsers.innerHTML = `${uniqueUsers.size.toLocaleString()} <span style="font-size: 11px; font-weight: 500; opacity: 0.8; display: block; margin-top: 4px;">(${uniqueDesktopUsers.size} Desktop / ${uniqueAppUsers.size} Mobile)</span>`;

  // 3. Most used feature
  const featureCounts = {};
  filteredEvents.forEach(e => {
    if (e.event_name) {
      featureCounts[e.event_name] = (featureCounts[e.event_name] || 0) + 1;
    }
  });
  
  let topFeature = 'None';
  let maxCount = 0;
  for (const [feat, count] of Object.entries(featureCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topFeature = feat;
    }
  }
  elTopFeature.innerText = topFeature.replaceAll('_', ' ');

  // 4. DB source split
  let supabaseCount = 0;
  let neonCount = 0;
  filteredEvents.forEach(e => {
    if (e.source === 'supabase') supabaseCount++;
    else if (e.source === 'neon') neonCount++;
  });
  elDbSplit.innerHTML = `<span style="color: var(--neon-color);">${neonCount}</span> / <span style="color: var(--primary-color);">${supabaseCount}</span>`;
}

// Render dynamic charts
function updateCharts() {
  // --- 1. Timeline Chart (Events over time) ---
  const dailyData = {};
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  filteredEvents.forEach(e => {
    if (e.created_at) {
      const dateStr = dayFormat.format(new Date(e.created_at));
      dailyData[dateStr] = (dailyData[dateStr] || 0) + 1;
    }
  });

  // Sort daily dates (reverse of created_at desc order)
  const timelineLabels = Object.keys(dailyData).reverse();
  const timelineValues = timelineLabels.map(label => dailyData[label]);

  if (timelineChart) timelineChart.destroy();
  
  const ctxTimeline = document.getElementById('timelineChart').getContext('2d');
  
  // Custom orange gradient for background
  const gradientOrange = ctxTimeline.createLinearGradient(0, 0, 0, 300);
  gradientOrange.addColorStop(0, 'rgba(255, 159, 10, 0.4)');
  gradientOrange.addColorStop(1, 'rgba(255, 159, 10, 0.0)');

  timelineChart = new Chart(ctxTimeline, {
    type: 'line',
    data: {
      labels: timelineLabels.slice(-30), // Last 30 days
      datasets: [{
        label: 'Event Count',
        data: timelineValues.slice(-30),
        borderColor: '#FF9F0A',
        borderWidth: 3,
        pointBackgroundColor: '#FF9F0A',
        pointBorderColor: '#FFFFFF',
        pointBorderWidth: 1.5,
        pointRadius: 4,
        pointHoverRadius: 6,
        backgroundColor: gradientOrange,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#A0A5C0', font: { family: 'Outfit' } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#A0A5C0', font: { family: 'Outfit' } }
        }
      }
    }
  });

  // --- 2. Feature Type Distribution (Doughnut) ---
  const typeCounts = {
    'feature_use': 0,
    'page_entry': 0,
    'page_view': 0,
    'auth': 0,
    'app_lifecycle': 0,
    'other': 0
  };

  filteredEvents.forEach(e => {
    if (e.event_type in typeCounts) {
      typeCounts[e.event_type]++;
    } else {
      typeCounts['other']++;
    }
  });

  const doughnutLabels = ['Feature Use', 'Page Entry', 'Page View', 'Auth', 'Lifecycle', 'Other'];
  const doughnutValues = [
    typeCounts['feature_use'],
    typeCounts['page_entry'],
    typeCounts['page_view'],
    typeCounts['auth'],
    typeCounts['app_lifecycle'],
    typeCounts['other']
  ];

  if (featuresChart) featuresChart.destroy();
  
  const ctxFeatures = document.getElementById('featuresChart').getContext('2d');
  featuresChart = new Chart(ctxFeatures, {
    type: 'doughnut',
    data: {
      labels: doughnutLabels,
      datasets: [{
        data: doughnutValues,
        backgroundColor: [
          '#B388FF', // purple
          '#80CBC4', // teal
          '#90CAF9', // blue
          '#A5D6A7', // green
          '#F48FB1', // pink
          '#6C7085'  /* grey */
        ],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#A0A5C0',
            font: { family: 'Outfit', size: 11 },
            boxWidth: 12,
            padding: 10
          }
        }
      },
      cutout: '65%'
    }
  });
}

// Render data table with paginated data
function renderTable() {
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageItems = filteredEvents.slice(startIdx, endIdx);

  // Update Footer Counters
  elSpanTotalRows.innerText = filteredEvents.length;
  elSpanStartRow.innerText = filteredEvents.length === 0 ? 0 : startIdx + 1;
  elSpanEndRow.innerText = Math.min(endIdx, filteredEvents.length);

  if (pageItems.length === 0) {
    elBody.innerHTML = `
      <tr>
        <td colspan="7" class="loading-placeholder">
          <i class="fa-solid fa-magnifying-glass"></i> No events match your filters and search.
        </td>
      </tr>
    `;
    updatePaginationControls(0);
    return;
  }

  let html = '';
  pageItems.forEach((e, i) => {
    // 1. Date conversion
    const localDate = e.created_at 
      ? new Date(e.created_at).toLocaleString() 
      : '-';

    // 2. User display details
    // DB-sourced strings are user-controlled: escape before innerHTML
    const uName = escapeHtml(e.username || 'anonymous');
    const dName = escapeHtml(e.display_name || 'Guest User');
    const email = escapeHtml(e.email || 'no-email@session');
    const avatarLetter = escapeHtml((e.display_name || 'U').charAt(0).toUpperCase());

    // 3. Badges mapping
    const typeClass = `badge-type-${escapeHtml(e.event_type || 'other').replace('_', '').replace('view', 'page').replace('entry', 'page')}`;
    const cleanType = escapeHtml((e.event_type || 'other').replaceAll('_', ' '));

    const sourceClass = `badge-source-${escapeHtml(e.source)}`;
    const cleanSource = e.source === 'supabase' ? 'Supabase' : 'Neon DB';

    const platformClass = `badge-platform-${escapeHtml(e.platform || 'app')}`;
    const cleanPlatform = e.platform === 'desktop' ? 'Desktop' : 'Mobile';
    const platformIcon = e.platform === 'desktop' ? '<i class="fa-solid fa-desktop"></i>' : '<i class="fa-solid fa-mobile-screen-button"></i>';

    // 4. Row rendering
    html += `
      <tr>
        <td style="white-space: nowrap; font-weight: 500;">${localDate}</td>
        <td>
          <div class="user-info-cell">
            <div class="user-avatar">${avatarLetter}</div>
            <div class="user-text">
              <span class="user-name">${dName} <small style="color: var(--text-dark); font-weight: 500;">(@${uName})</small></span>
              <span class="user-email">${email}</span>
            </div>
          </div>
        </td>
        <td><span class="badge ${typeClass}">${cleanType}</span></td>
        <td style="font-family: monospace; font-weight: 600; color: #E91E63;">${escapeHtml(e.event_name || '-')}</td>
        <td style="color: var(--text-muted); font-family: monospace;">${escapeHtml(e.screen_name || '-')}</td>
        <td>
          <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
            <span class="badge ${platformClass}">${platformIcon} ${cleanPlatform}</span>
            <span class="badge ${sourceClass}">${cleanSource}</span>
          </div>
        </td>
        <td>
          <button class="btn-action" onclick="showEventMetadata(${startIdx + i})">
            <i class="fa-solid fa-code"></i> View JSON
          </button>
        </td>
      </tr>
    `;
  });

  elBody.innerHTML = html;
  
  const totalPages = Math.ceil(filteredEvents.length / pageSize);
  updatePaginationControls(totalPages);
}

// Manage pagination elements
function updatePaginationControls(totalPages) {
  elBtnPrev.disabled = currentPage === 1;
  elBtnNext.disabled = currentPage >= totalPages || totalPages === 0;

  let pagesHtml = '';
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);

  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pagesHtml += `
      <div class="page-num ${i === currentPage ? 'active' : ''}" onclick="goToPage(${i})">
        ${i}
      </div>
    `;
  }

  elPaginationPages.innerHTML = pagesHtml;
}

function goToPage(page) {
  currentPage = page;
  renderTable();
}

// Display Metadata Modal dialog
window.showMetadataModal = function(metadataJsonStr) {
  try {
    const rawObj = JSON.parse(metadataJsonStr);
    const prettyJson = JSON.stringify(rawObj, null, 2);
    elModalCode.innerText = prettyJson;
    elModal.style.display = 'block';
  } catch (err) {
    elModalCode.innerText = '{}';
    elModal.style.display = 'block';
  }
};

// Look up by row index instead of inlining JSON into an onclick string
// (entity-decoded quotes in metadata could break out of the JS literal).
window.showEventMetadata = function(idx) {
  const ev = filteredEvents[idx];
  elModalCode.innerText = JSON.stringify((ev && ev.metadata) || {}, null, 2);
  elModal.style.display = 'block';
};

// Export records as CSV download
function exportToCSV() {
  if (filteredEvents.length === 0) return;
  
  const headers = ['id', 'user_id', 'username', 'display_name', 'email', 'event_type', 'event_name', 'screen_name', 'platform', 'source', 'created_at', 'metadata'];
  
  const csvRows = [
    headers.join(','),
    ...filteredEvents.map(e => {
      return headers.map(header => {
        let val = e[header];
        if (header === 'metadata') {
          val = JSON.stringify(val || {});
        }
        // Escape quotes
        const escaped = ('' + (val ?? '')).replace(/"/g, '""');
        return `"${escaped}"`;
      }).join(',');
    })
  ];

  // Blob instead of a data: URI, which browsers cap far below 250k+ rows
  const url = URL.createObjectURL(new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `focus_fox_analytics_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Helper to escape HTML characters
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
