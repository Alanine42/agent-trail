/**
 * Trailmark Side Panel
 *
 * Displays annotation library with search and filtering.
 * Click annotation → navigates to source page.
 */

const API = 'http://localhost:3773';

let allAnnotations = [];
let currentFilter = 'all';
let searchQuery = '';

// ============================================
// Load
// ============================================

async function loadAnnotations() {
  const statusEl = document.getElementById('status');
  try {
    const resp = await fetch(`${API}/annotations?limit=500`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allAnnotations = await resp.json();
    statusEl.textContent = `Connected · ${allAnnotations.length} annotations`;
    statusEl.className = 'status ok';
    render();
  } catch (e) {
    statusEl.textContent = 'Server not running — start with: python3 server.py';
    statusEl.className = 'status error';
    allAnnotations = [];
    render();
  }
}

// ============================================
// Filter & Search
// ============================================

function getFiltered() {
  let filtered = allAnnotations;

  // Author filter
  if (currentFilter === 'human') {
    filtered = filtered.filter(a => a.author_type === 'human');
  } else if (currentFilter === 'agent') {
    filtered = filtered.filter(a => a.author_type === 'agent');
  }

  // Text search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(a => {
      const text = [
        a.anchor_exact,
        a.comment,
        a.page_title,
        a.url,
        a.task_description,
        a.micro_intent,
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(q);
    });
  }

  return filtered;
}

// ============================================
// Render
// ============================================

function render() {
  const container = document.getElementById('annotations');
  const countEl = document.getElementById('count');
  const filtered = getFiltered();

  countEl.textContent = `${filtered.length} of ${allAnnotations.length}`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="icon">✦</div>
        <strong>No annotations yet</strong>
        <p>Highlight text on any page to get started</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  for (const anno of filtered) {
    const card = document.createElement('div');
    card.className = 'anno-card';

    const date = new Date(anno.created_at);
    const dateStr = date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });

    const icon = anno.author_type === 'agent' ? '🤖' : '👤';
    const displayName = anno.display_name || 'You';

    const typeBadge = (anno.annotation_type && anno.annotation_type !== 'highlight' && anno.annotation_type !== 'comment')
      ? `<span class="anno-type">${anno.annotation_type.replace('agent_', '')}</span>`
      : '';

    card.innerHTML = `
      <div class="anno-meta">
        <span class="anno-author">${icon} ${displayName}${typeBadge}</span>
        <span class="anno-date">${dateStr}</span>
      </div>
      <div class="anno-text">"${escapeHtml(truncate(anno.anchor_exact, 120))}"</div>
      ${anno.comment ? `<div class="anno-comment">${escapeHtml(anno.comment)}</div>` : ''}
      <div class="anno-source">${escapeHtml(anno.page_title || anno.url)}</div>
    `;

    // Click → open page
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: anno.url });
    });

    container.appendChild(card);
  }
}

// ============================================
// Event Listeners
// ============================================

// Search
document.getElementById('search').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  render();
});

// Filters
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    render();
  });
});

// ============================================
// Helpers
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '…' : str;
}

// ============================================
// Boot
// ============================================

loadAnnotations();

// Refresh when panel becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadAnnotations();
});
