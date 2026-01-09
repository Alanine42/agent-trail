/**
 * Trailmark Content Script
 *
 * Runs on every page. Handles:
 * - Text selection → floating toolbar
 * - Highlight creation → persist via local server
 * - Page load → fetch annotations → render highlights
 * - Highlight click → popover with comment/authorship
 */

(() => {
  const API = 'http://localhost:3773';
  let currentToolbar = null;
  let currentCommentInput = null;
  let currentPopover = null;
  let currentSelection = null;
  let pageAnnotations = [];

  // ============================================
  // Lifecycle
  // ============================================

  async function init() {
    // Load existing annotations for this page
    await loadAnnotations();

    // Listen for text selection
    document.addEventListener('mouseup', onMouseUp);

    // Dismiss toolbar/popover on click-away or escape
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
  }

  // ============================================
  // Load & Render Existing Annotations
  // ============================================

  async function loadAnnotations() {
    try {
      const resp = await fetch(`${API}/annotations?url=${encodeURIComponent(window.location.href)}`);
      if (!resp.ok) return;
      pageAnnotations = await resp.json();
      renderAllHighlights();
    } catch (e) {
      // Server not running — silent fail, extension still works for new highlights
      console.debug('[Trailmark] Server not reachable, skipping annotation load');
    }
  }

  function renderAllHighlights() {
    for (const anno of pageAnnotations) {
      renderHighlight(anno);
    }
  }

  function renderHighlight(annotation) {
    const selector = {
      exact: annotation.anchor_exact,
      prefix: annotation.anchor_prefix,
      suffix: annotation.anchor_suffix,
    };

    const range = Anchoring.anchor(selector);
    if (!range) {
      console.debug('[Trailmark] Could not anchor:', annotation.anchor_exact.substring(0, 50));
      return;
    }

    wrapRangeWithHighlight(range, annotation);
  }

  function wrapRangeWithHighlight(range, annotation) {
    // Calculate opacity based on temporal fade
    const opacity = calculateOpacity(annotation);

    // For simple cases (single text node), wrap directly
    // For complex ranges (spanning nodes), use multiple marks
    const marks = highlightRange(range, annotation.id, opacity);

    // Set data attributes
    for (const mark of marks) {
      if (annotation.comment) mark.setAttribute('data-has-comment', '');
      if (annotation.author_type === 'agent') mark.setAttribute('data-author', 'agent');
      mark.addEventListener('click', (e) => {
        e.stopPropagation();
        showPopover(annotation, mark);
      });
    }
  }

  function highlightRange(range, annotationId, opacity) {
    const marks = [];

    // If range is within a single text node — simple wrap
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      const mark = document.createElement('mark');
      mark.className = 'trailmark-highlight';
      mark.dataset.annotationId = annotationId;
      mark.style.setProperty('--trailmark-opacity', opacity.toFixed(2));
      range.surroundContents(mark);
      marks.push(mark);
      return marks;
    }

    // Complex range: iterate text nodes within the range and wrap each
    const textNodes = getTextNodesInRange(range);
    for (const { node, start, end } of textNodes) {
      const nodeRange = document.createRange();
      nodeRange.setStart(node, start);
      nodeRange.setEnd(node, end);

      const mark = document.createElement('mark');
      mark.className = 'trailmark-highlight';
      mark.dataset.annotationId = annotationId;
      mark.style.setProperty('--trailmark-opacity', opacity.toFixed(2));

      try {
        nodeRange.surroundContents(mark);
        marks.push(mark);
      } catch (e) {
        // surroundContents fails if range splits a non-text node
        // Fallback: just skip this segment
        console.debug('[Trailmark] Could not wrap node segment:', e.message);
      }
    }

    return marks;
  }

  function getTextNodesInRange(range) {
    const results = [];
    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT
    );

    let node;
    while ((node = walker.nextNode())) {
      if (!range.intersectsNode(node)) continue;

      let start = 0;
      let end = node.textContent.length;

      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;

      if (end > start) {
        results.push({ node, start, end });
      }
    }

    return results;
  }

  function calculateOpacity(annotation) {
    const refDate = annotation.refreshed_at || annotation.created_at;
    const daysSince = (Date.now() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0.15, 1.0 - (daysSince / 1825));
  }

  // ============================================
  // Text Selection → Toolbar
  // ============================================

  function onMouseUp(e) {
    // Small delay to let selection settle
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

      // Don't show toolbar if clicking inside our own UI
      if (e.target.closest('.trailmark-toolbar, .trailmark-comment-input, .trailmark-popover')) return;

      currentSelection = {
        text: selection.toString(),
        range: selection.getRangeAt(0).cloneRange(),
      };

      showToolbar(e.clientX, e.clientY);
    }, 10);
  }

  function showToolbar(x, y) {
    dismissAll();

    const toolbar = document.createElement('div');
    toolbar.className = 'trailmark-toolbar';

    // Highlight button
    const highlightBtn = document.createElement('button');
    highlightBtn.textContent = '🖍️';
    highlightBtn.title = 'Highlight';
    highlightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveHighlight(null);
    });

    // Comment button
    const commentBtn = document.createElement('button');
    commentBtn.textContent = '💬';
    commentBtn.title = 'Highlight + Comment';
    commentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCommentInput(x, y);
    });

    toolbar.appendChild(highlightBtn);
    toolbar.appendChild(commentBtn);

    // Position above the selection
    toolbar.style.left = `${x - 36}px`;
    toolbar.style.top = `${y - 50 + window.scrollY}px`;

    document.body.appendChild(toolbar);
    currentToolbar = toolbar;
  }

  // ============================================
  // Comment Input
  // ============================================

  function showCommentInput(x, y) {
    dismissAll();

    const container = document.createElement('div');
    container.className = 'trailmark-comment-input';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Add a note...';
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveHighlight(textarea.value.trim() || null);
      }
    });

    const actions = document.createElement('div');
    actions.className = 'trailmark-comment-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'trailmark-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissAll();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'trailmark-save';
    saveBtn.textContent = 'Save ⌘↵';
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveHighlight(textarea.value.trim() || null);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(textarea);
    container.appendChild(actions);

    container.style.left = `${x - 130}px`;
    container.style.top = `${y - 10 + window.scrollY}px`;

    document.body.appendChild(container);
    currentCommentInput = container;

    // Focus textarea
    setTimeout(() => textarea.focus(), 0);
  }

  // ============================================
  // Save Highlight
  // ============================================

  async function saveHighlight(comment) {
    if (!currentSelection) return;

    const { range } = currentSelection;
    const selector = Anchoring.rangeToSelector(range);

    const annotation = {
      url: window.location.href,
      page_title: document.title,
      anchor_exact: selector.exact,
      anchor_prefix: selector.prefix,
      anchor_suffix: selector.suffix,
      annotation_type: comment ? 'comment' : 'highlight',
      comment: comment,
      author_type: 'human',
      display_name: 'You',
    };

    dismissAll();

    try {
      const resp = await fetch(`${API}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotation),
      });

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

      const saved = await resp.json();
      pageAnnotations.push(saved);

      // Render the highlight immediately
      renderHighlight(saved);

      // Clear selection
      window.getSelection().removeAllRanges();

      showToast(comment ? 'Highlighted with comment' : 'Highlighted');
    } catch (e) {
      console.error('[Trailmark] Failed to save:', e);
      showToast('Failed to save — is the server running?');
    }
  }

  // ============================================
  // Popover (on highlight click)
  // ============================================

  function showPopover(annotation, mark) {
    dismissPopover();

    const popover = document.createElement('div');
    popover.className = 'trailmark-popover';

    // Header
    const header = document.createElement('div');
    header.className = 'trailmark-popover-header';

    const author = document.createElement('span');
    author.className = 'trailmark-popover-author';
    const icon = annotation.author_type === 'agent' ? '🤖' : '👤';
    author.textContent = `${icon} ${annotation.display_name || 'You'}`;

    const time = document.createElement('span');
    const date = new Date(annotation.created_at);
    time.textContent = date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });

    header.appendChild(author);
    header.appendChild(time);

    // Body
    const body = document.createElement('div');
    body.className = 'trailmark-popover-body';

    // Show task description for agent annotations
    if (annotation.task_description) {
      const task = document.createElement('div');
      task.style.cssText = 'font-size: 11px; color: #999; margin-bottom: 6px;';
      task.textContent = `Task: ${annotation.task_description}`;
      body.appendChild(task);
    }

    // Show annotation type badge for non-highlight types
    if (annotation.annotation_type && annotation.annotation_type !== 'highlight') {
      const typeBadge = document.createElement('span');
      typeBadge.className = 'trailmark-popover-type';
      typeBadge.dataset.type = annotation.annotation_type;
      typeBadge.textContent = annotation.annotation_type.replace('agent_', '').replace('_', ' ');
      body.appendChild(typeBadge);
    }

    if (annotation.comment) {
      const comment = document.createElement('p');
      comment.className = 'trailmark-popover-comment';
      comment.textContent = annotation.comment;
      body.appendChild(comment);
    } else {
      const empty = document.createElement('p');
      empty.style.cssText = 'color: #666; font-style: italic; margin: 0;';
      empty.textContent = 'No comment';
      body.appendChild(empty);
    }

    // Footer
    const footer = document.createElement('div');
    footer.className = 'trailmark-popover-footer';

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh ↻';
    refreshBtn.title = 'Reset opacity to full';
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshAnnotation(annotation, mark);
      dismissPopover();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'trailmark-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteAnnotation(annotation);
      dismissPopover();
    });

    footer.appendChild(refreshBtn);
    footer.appendChild(deleteBtn);

    popover.appendChild(header);
    popover.appendChild(body);
    popover.appendChild(footer);

    // Position below the highlight
    const rect = mark.getBoundingClientRect();
    popover.style.left = `${rect.left + window.scrollX}px`;
    popover.style.top = `${rect.bottom + window.scrollY + 6}px`;

    document.body.appendChild(popover);
    currentPopover = popover;
  }

  // ============================================
  // Actions
  // ============================================

  async function refreshAnnotation(annotation, mark) {
    try {
      await fetch(`${API}/annotations/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: annotation.id }),
      });

      // Update opacity visually
      const marks = document.querySelectorAll(`[data-annotation-id="${annotation.id}"]`);
      for (const m of marks) {
        m.style.setProperty('--trailmark-opacity', '0.30');
      }

      showToast('Refreshed');
    } catch (e) {
      console.error('[Trailmark] Refresh failed:', e);
    }
  }

  async function deleteAnnotation(annotation) {
    try {
      await fetch(`${API}/annotations/${annotation.id}`, { method: 'DELETE' });

      // Remove highlight marks from DOM
      const marks = document.querySelectorAll(`[data-annotation-id="${annotation.id}"]`);
      for (const mark of marks) {
        const parent = mark.parentNode;
        while (mark.firstChild) {
          parent.insertBefore(mark.firstChild, mark);
        }
        parent.removeChild(mark);
      }

      // Remove from local array
      pageAnnotations = pageAnnotations.filter(a => a.id !== annotation.id);

      showToast('Deleted');
    } catch (e) {
      console.error('[Trailmark] Delete failed:', e);
    }
  }

  // ============================================
  // UI Helpers
  // ============================================

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'trailmark-toast';
    toast.textContent = `✦ ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  function dismissAll() {
    dismissToolbar();
    dismissCommentInput();
    dismissPopover();
  }

  function dismissToolbar() {
    if (currentToolbar) {
      currentToolbar.remove();
      currentToolbar = null;
    }
  }

  function dismissCommentInput() {
    if (currentCommentInput) {
      currentCommentInput.remove();
      currentCommentInput = null;
    }
  }

  function dismissPopover() {
    if (currentPopover) {
      currentPopover.remove();
      currentPopover = null;
    }
  }

  function onMouseDown(e) {
    if (e.target.closest('.trailmark-toolbar, .trailmark-comment-input, .trailmark-popover')) return;
    dismissAll();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      dismissAll();
    }
  }

  // ============================================
  // Boot
  // ============================================

  init();
})();
