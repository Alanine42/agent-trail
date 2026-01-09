/**
 * Trailmark Background Service Worker
 *
 * Handles:
 * - Side panel toggle on extension icon click
 * - Badge count updates
 */

const API = 'http://localhost:3773';

// Open side panel on extension icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Update badge when tab changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  await updateBadge(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) await updateBadge(tab.id, tab.url);
});

async function updateBadge(tabId, url) {
  try {
    const resp = await fetch(`${API}/annotations?url=${encodeURIComponent(url)}`);
    if (!resp.ok) return;
    const annotations = await resp.json();
    const count = annotations.length;

    chrome.action.setBadgeText({
      tabId,
      text: count > 0 ? String(count) : '',
    });
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: '#FFD54F',
    });
  } catch (e) {
    // Server not running
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}
