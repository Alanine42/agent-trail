/**
 * Trailmark Anchoring Library
 *
 * Implements W3C TextQuoteSelector: given (exact, prefix, suffix),
 * find and highlight the matching text in the DOM.
 *
 * Inspired by Hypothesis anchoring module. Simplified for V1.
 */

const Anchoring = (() => {

  /**
   * Get all text content from the page body as a single string,
   * along with a mapping from string offsets back to DOM text nodes.
   */
  function extractTextWithMapping(root = document.body) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip script, style, and hidden elements
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.offsetParent === null && parent.style.position !== 'fixed') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let fullText = '';

    let node;
    while ((node = walker.nextNode())) {
      nodes.push({
        node,
        start: fullText.length,
        length: node.textContent.length,
      });
      fullText += node.textContent;
    }

    return { fullText, nodes };
  }

  /**
   * Normalize text for fuzzy matching: collapse whitespace, lowercase.
   */
  function normalize(text) {
    return text.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * Find the best match for a TextQuoteSelector in the page text.
   * Returns { start, end } character offsets into fullText, or null.
   */
  function findMatch(fullText, selector) {
    const { exact, prefix, suffix } = selector;

    // Try exact match first
    const exactNorm = normalize(exact);
    const fullNorm = normalize(fullText);

    let candidates = [];
    let searchStart = 0;

    while (true) {
      const idx = fullNorm.indexOf(exactNorm, searchStart);
      if (idx === -1) break;
      candidates.push(idx);
      searchStart = idx + 1;
    }

    if (candidates.length === 0) {
      // Try substring match (first 60 chars of exact)
      const partial = exactNorm.substring(0, 60);
      searchStart = 0;
      while (true) {
        const idx = fullNorm.indexOf(partial, searchStart);
        if (idx === -1) break;
        candidates.push(idx);
        searchStart = idx + 1;
      }
    }

    if (candidates.length === 0) return null;

    // If only one candidate, use it
    if (candidates.length === 1) {
      return resolveCandidate(candidates[0], exactNorm.length, fullText, fullNorm);
    }

    // Multiple candidates — use prefix/suffix to disambiguate
    const prefixNorm = prefix ? normalize(prefix) : '';
    const suffixNorm = suffix ? normalize(suffix) : '';

    let bestIdx = candidates[0];
    let bestScore = -1;

    for (const idx of candidates) {
      let score = 0;

      if (prefixNorm) {
        const before = fullNorm.substring(Math.max(0, idx - prefixNorm.length - 20), idx);
        if (before.includes(prefixNorm)) score += 2;
        else if (before.includes(prefixNorm.substring(prefixNorm.length - 30))) score += 1;
      }

      if (suffixNorm) {
        const after = fullNorm.substring(idx + exactNorm.length, idx + exactNorm.length + suffixNorm.length + 20);
        if (after.includes(suffixNorm)) score += 2;
        else if (after.includes(suffixNorm.substring(0, 30))) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    return resolveCandidate(bestIdx, exactNorm.length, fullText, fullNorm);
  }

  /**
   * Map a normalized-text offset back to the original fullText offset.
   * Returns { start, end } in original text coordinates.
   */
  function resolveCandidate(normIdx, normLength, fullText, fullNorm) {
    // Map normalized index back to original text index
    // Walk through original text, counting normalized characters
    let normPos = 0;
    let origStart = null;
    let origEnd = null;
    let inWhitespace = false;

    for (let i = 0; i < fullText.length && origEnd === null; i++) {
      const ch = fullText[i];
      const isWS = /\s/.test(ch);

      if (isWS) {
        if (!inWhitespace) {
          // This whitespace maps to a single space in normalized form
          if (normPos === normIdx) origStart = i;
          normPos++;
          if (origStart !== null && normPos >= normIdx + normLength) origEnd = i + 1;
        }
        inWhitespace = true;
      } else {
        if (normPos === normIdx) origStart = i;
        normPos++;
        if (origStart !== null && normPos >= normIdx + normLength) origEnd = i + 1;
        inWhitespace = false;
      }
    }

    if (origStart === null) return null;
    if (origEnd === null) origEnd = fullText.length;

    return { start: origStart, end: origEnd };
  }

  /**
   * Given character offsets into fullText, find the corresponding DOM range.
   */
  function offsetsToRange(nodes, start, end) {
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;

    for (const entry of nodes) {
      const entryEnd = entry.start + entry.length;

      if (!startNode && start < entryEnd) {
        startNode = entry.node;
        startOffset = start - entry.start;
      }

      if (end <= entryEnd) {
        endNode = entry.node;
        endOffset = end - entry.start;
        break;
      }
    }

    if (!startNode || !endNode) return null;

    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      return range;
    } catch (e) {
      console.warn('[Trailmark] Failed to create range:', e);
      return null;
    }
  }

  /**
   * Create a TextQuoteSelector from a DOM Range.
   */
  function rangeToSelector(range, contextChars = 100) {
    const exact = range.toString();
    const { fullText, nodes } = extractTextWithMapping();

    // Find where this range falls in the full text
    const tempRange = document.createRange();
    let rangeStart = 0;

    for (const entry of nodes) {
      if (entry.node === range.startContainer) {
        rangeStart = entry.start + range.startOffset;
        break;
      }
    }

    const prefix = fullText.substring(
      Math.max(0, rangeStart - contextChars),
      rangeStart
    );
    const suffix = fullText.substring(
      rangeStart + exact.length,
      rangeStart + exact.length + contextChars
    );

    return { exact, prefix, suffix };
  }

  /**
   * Anchor a TextQuoteSelector to the DOM and return a Range.
   */
  function anchor(selector) {
    const { fullText, nodes } = extractTextWithMapping();
    const match = findMatch(fullText, selector);
    if (!match) return null;
    return offsetsToRange(nodes, match.start, match.end);
  }

  return { anchor, rangeToSelector, extractTextWithMapping };
})();

// Expose for content script
if (typeof window !== 'undefined') {
  window.Anchoring = Anchoring;
}
