const COLOR_ICONS = {
  16: 'icons/icon16.png',
  48: 'icons/icon48.png',
  128: 'icons/icon128.png',
};

const GREY_ICONS = {
  16: 'icons/icon16g.png',
  48: 'icons/icon48g.png',
  128: 'icons/icon128g.png',
};

function isDirectoryUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === 'www.twitch.tv' && (u.pathname === '/directory' || u.pathname === '/directory/all');
  } catch {
    return false;
  }
}

function setIconForTab(tabId, url) {
  if (tabId === undefined) return;
  chrome.action.setIcon({ tabId, path: isDirectoryUrl(url) ? COLOR_ICONS : GREY_ICONS });
}

function updateIcon(tabId, url) {
  if (url !== undefined) {
    setIconForTab(tabId, url);
    return;
  }
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    setIconForTab(tabId, tab.url);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
    updateIcon(tabId, changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateIcon(tabId);
});

chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    setIconForTab(tab.id, tab.url);
  }
});
