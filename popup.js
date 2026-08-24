const DEFAULTS = {
  sortNewFirst: true,
  blockHeaders: true,
  viewerThreshold: 100,
  openInNewTab: true,
  scrollTopButton: true,
  scrollAllButton: true,
};

const checkboxIds = ['sortNewFirst', 'blockHeaders', 'scrollAllButton', 'openInNewTab', 'scrollTopButton'];
const els = Object.fromEntries(
  [...checkboxIds, 'viewerThreshold'].map((id) => [id, document.getElementById(id)])
);
const statusEl = document.getElementById('status');

function save(key, value) {
  chrome.storage.sync.set({ [key]: value }, () => {
    statusEl.textContent = 'Сохранено';
    setTimeout(() => {
      statusEl.textContent = '';
    }, 1200);
  });
}

function applySettings(values) {
  for (const id of checkboxIds) {
    els[id].checked = !!values[id];
  }
  els.viewerThreshold.value = values.viewerThreshold;
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  applySettings({ ...DEFAULTS, ...stored });
});

for (const id of checkboxIds) {
  els[id].addEventListener('change', () => {
    save(id, els[id].checked);
  });
}

els.viewerThreshold.addEventListener('change', () => {
  const value = Math.max(0, parseInt(els.viewerThreshold.value, 10) || 0);
  els.viewerThreshold.value = value;
  save('viewerThreshold', value);
});
