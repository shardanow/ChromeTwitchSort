(() => {
  'use strict';

  const DEFAULTS = {
    sortNewFirst: true,
    blockHeaders: true,
    viewerThreshold: 100,
    openInNewTab: true,
    scrollTopButton: true,
    scrollAllButton: true,
  };

  const CARD_IMAGE = '[data-test-selector="tw-card-image"]';
  const CARD_LINK = 'a[data-a-target^="card-"], a[href^="/directory/"]';
  const NEW_PILL_SELECTOR = '.game-card__new-pill, [class*="new-pill"]';
  const LOADER_SELECTOR = '[class*="loading-spinner" i], .tw-loading-spinner, [data-test-selector="loader"]';
  const MAX_SCROLL_STEPS = 600;
  const TOP_BUTTON_ID = 'tnt-scroll-top';
  const SCROLL_ALL_BUTTON_ID = 'tnt-scroll-all';
  const NEW_HEADER_ID = 'tnt-new-header';
  const REST_HEADER_ID = 'tnt-rest-header';
  const STYLE_ID = 'tnt-styles';

  let settings = { ...DEFAULTS };
  let active = false;
  let autoScrollRunning = false;
  let stopAutoScroll = false;
  let resortPending = false;
  let scrollerCache = null;
  let lastCardWidth = 0;

  function isDirectoryPage() {
    return location.pathname === '/directory' || location.pathname === '/directory/all';
  }

  function getCards() {
    const seen = new Set();
    const cards = [];
    for (const img of document.querySelectorAll(CARD_IMAGE)) {
      const card =
        img.closest(CARD_LINK) ||
        img.closest('[class*="ScTransformWrapper"]') ||
        img.parentElement;
      if (card && !seen.has(card)) {
        seen.add(card);
        cards.push(card);
      }
    }
    return cards;
  }

  function getContainer(cards) {
    if (!cards.length) return null;
    let node = cards[0].parentElement;
    while (node && !cards.every((c) => node.contains(c))) {
      node = node.parentElement;
    }
    return node;
  }

  function getGridItems(container, cards) {
    return cards.map((card) => {
      let node = card;
      while (node.parentElement && node.parentElement !== container) {
        node = node.parentElement;
      }
      return node.parentElement === container ? node : card;
    });
  }

  function isNewCard(item) {
    if (item.querySelector(NEW_PILL_SELECTOR)) return true;
    const pills = item.querySelectorAll('.tw-pill, [class*="pill"]');
    for (const pill of pills) {
      if (/^(НОВОЕ|NEW)$/i.test((pill.textContent || '').trim())) return true;
    }
    return false;
  }

  function createHeader(id, text) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'tnt-section-header';
    el.textContent = text;
    return el;
  }

  function removeHeaders() {
    for (const id of [NEW_HEADER_ID, REST_HEADER_ID]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
  }

  function resort() {
    const cards = getCards();
    if (cards.length < 2) return;
    const container = getContainer(cards);
    if (!container) return;
    const items = getGridItems(container, cards);
    const newItems = items.filter(isNewCard);
    if (!newItems.length) {
      removeHeaders();
      return;
    }
    const newSet = new Set(newItems);
    const desired = [...newItems, ...items.filter((it) => !newSet.has(it))];
    const withHeaders = settings.blockHeaders;

    const normalItem = items.find((it) => !newSet.has(it));
    let cardWidth = 0;
    if (normalItem) {
      const measured = normalItem.getBoundingClientRect().width;
      if (measured > 0) {
        cardWidth = Math.round(measured);
        lastCardWidth = cardWidth;
      }
    } else {
      cardWidth = lastCardWidth;
    }
    if (cardWidth > 0) {
      for (const item of newItems) {
        item.style.setProperty('max-width', cardWidth + 'px', 'important');
        item.style.setProperty('justify-self', 'start', 'important');
      }
    }

    let dirty = false;
    for (let i = 0; i < desired.length; i++) {
      if (desired[i] !== items[i]) {
        dirty = true;
        break;
      }
    }
    if (!dirty && !withHeaders) return;

    removeHeaders();

    const display = getComputedStyle(container).display;
    if (/grid|flex/.test(display)) {
      let order = 1;
      const setOrder = (el) => {
        el.style.order = String(order++);
      };
      if (withHeaders) {
        container.appendChild(createHeader(NEW_HEADER_ID, 'НОВОЕ'));
        setOrder(document.getElementById(NEW_HEADER_ID));
        newItems.forEach(setOrder);
        container.appendChild(createHeader(REST_HEADER_ID, 'Все категории'));
        setOrder(document.getElementById(REST_HEADER_ID));
        items.forEach((it) => {
          if (!newSet.has(it)) setOrder(it);
        });
      } else {
        desired.forEach(setOrder);
      }
    } else {
      desired.forEach((item) => container.appendChild(item));
      if (withHeaders) {
        container.insertBefore(createHeader(NEW_HEADER_ID, 'НОВОЕ'), newItems[0]);
        container.insertBefore(createHeader(REST_HEADER_ID, 'Все категории'), desired[newItems.length]);
      }
    }
  }

  function scheduleResort() {
    if (resortPending) return;
    resortPending = true;
    requestAnimationFrame(() => {
      resortPending = false;
      if (active && settings.sortNewFirst) resort();
    });
  }

  function parseViewers(text) {
    const m = String(text).match(
      /(\d[\d\u00A0\s.,]*)\s*(K|M|B|k|m|b|тыс\.?|млн\.?)?\s*(зрител|viewer)/i
    );
    if (!m) return null;
    const raw = m[1].replace(/\u00A0/g, ' ').trim();
    const suffix = (m[2] || '').toLowerCase().replace(/\./g, '');
    let value;
    if (suffix) {
      value = parseFloat(raw.replace(/\s+/g, '').replace(/,/g, '.'));
      if (suffix === 'k' || suffix === 'тыс') value *= 1000;
      else if (suffix === 'm' || suffix === 'млн') value *= 1000000;
      else if (suffix === 'b') value *= 1000000000;
    } else {
      value = parseFloat(raw.replace(/[\s,]/g, ''));
    }
    return Number.isFinite(value) ? value : null;
  }

  function lastGridItem() {
    const cards = getCards();
    if (!cards.length) return null;
    const container = getContainer(cards);
    if (!container) return null;
    const items = getGridItems(container, cards);
    return items[items.length - 1];
  }

  function onScrollEvent(e) {
    const target = e.target;
    let el = null;
    if (target === document) {
      el = document.scrollingElement || document.documentElement;
    } else if (target instanceof Element) {
      el = target;
    }
    if (
      el &&
      (!scrollerCache || !document.contains(scrollerCache) || el.scrollHeight > scrollerCache.scrollHeight)
    ) {
      scrollerCache = el;
    }
    updateScrollTopButton();
  }

  function getScroller() {
    if (scrollerCache && document.contains(scrollerCache)) return scrollerCache;
    let best = null;
    let bestHeight = 0;
    for (const el of document.querySelectorAll('div, main')) {
      const overflowY = getComputedStyle(el).overflowY;
      if (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 50 &&
        el.scrollHeight > bestHeight
      ) {
        best = el;
        bestHeight = el.scrollHeight;
      }
    }
    if (best) {
      scrollerCache = best;
      return best;
    }
    const scrolling = document.scrollingElement || document.documentElement;
    scrollerCache = scrolling;
    return scrolling;
  }

  function scrollToBottom() {
    const s = getScroller();
    if (s === document.scrollingElement || s === document.documentElement || s === document.body) {
      window.scrollTo(0, s.scrollHeight);
    } else {
      s.scrollTop = s.scrollHeight;
    }
    const images = document.querySelectorAll(CARD_IMAGE);
    if (images.length) {
      images[images.length - 1].scrollIntoView({ block: 'end', behavior: 'auto' });
    }
  }

  function scrollToTopAll() {
    const images = document.querySelectorAll(CARD_IMAGE);
    if (images.length) {
      images[0].scrollIntoView({ block: 'start', behavior: 'auto' });
    }
    const s = getScroller();
    if (s instanceof Element) {
      console.info(
        '[TwitchNewFirst] кнопка «наверх»: скроллер', s.tagName,
        '| class=', String(s.className).slice(0, 80),
        '| scrollTop=', s.scrollTop
      );
      s.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('div, main, section')) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') && el.scrollTop > 0) {
        el.scrollTop = 0;
      }
    }
  }

  function isLoaderVisible() {
    return !!document.querySelector(LOADER_SELECTOR);
  }

  function waitForLoad(maxMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      let lastHeight = 0;
      let stable = 0;
      const poll = () => {
        if (stopAutoScroll || !active) return resolve();
        const height = getScroller().scrollHeight;
        const loading = isLoaderVisible();
        if (!loading && height === lastHeight) stable++;
        else {
          stable = 0;
          lastHeight = height;
        }
        if (stable >= 2 || Date.now() - start > maxMs) return resolve();
        setTimeout(poll, 250);
      };
      poll();
    });
  }

  async function runAutoScroll() {
    if (autoScrollRunning || !active) return;
    autoScrollRunning = true;
    stopAutoScroll = false;
    updateScrollAllButton();
    let noGrowth = 0;
    let steps = 0;
    try {
      while (!stopAutoScroll && active && steps < MAX_SCROLL_STEPS) {
        const before = document.querySelectorAll(CARD_IMAGE).length;
        scrollToBottom();
        await waitForLoad(5000);
        const after = document.querySelectorAll(CARD_IMAGE).length;
        if (after > before) noGrowth = 0;
        else noGrowth++;
        if (noGrowth >= 3) {
          console.info('[TwitchNewFirst] Остановка: новые карточки больше не подгружаются');
          break;
        }
        if (settings.viewerThreshold > 0) {
          const item = lastGridItem();
          if (item) {
            const viewers = parseViewers(item.textContent || '');
            if (viewers !== null && viewers < settings.viewerThreshold) {
              console.info(
                `[TwitchNewFirst] Остановка: у последней категории ${viewers} зрителей (порог ${settings.viewerThreshold})`
              );
              break;
            }
          }
        }
        steps++;
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      autoScrollRunning = false;
      updateScrollAllButton();
    }
  }

  function onDocumentClick(e) {
    if (!active || !settings.openInNewTab) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest(CARD_LINK);
    if (!anchor) return;
    if (!anchor.matches('[data-a-target^="card-"]') && !anchor.querySelector(CARD_IMAGE)) return;
    const url = anchor.href;
    if (!url || !url.includes('/directory/')) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(url, '_blank');
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${TOP_BUTTON_ID} {
        position: fixed !important;
        right: 24px !important;
        bottom: 24px !important;
        z-index: 2147483647 !important;
        width: 48px !important;
        height: 48px !important;
        border-radius: 50% !important;
        border: none !important;
        cursor: pointer !important;
        background: #9146ff !important;
        color: #ffffff !important;
        font-size: 22px !important;
        line-height: 1 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
        padding: 0 !important;
        margin: 0 !important;
        transition: background .15s ease, transform .15s ease, opacity .15s ease !important;
      }
      #${TOP_BUTTON_ID}:hover {
        background: #772ce8 !important;
        transform: translateY(-2px) !important;
      }
      #${TOP_BUTTON_ID}.tnt-visible { display: flex !important; }

      #${SCROLL_ALL_BUTTON_ID} {
        position: fixed !important;
        right: 24px !important;
        bottom: 84px !important;
        z-index: 2147483647 !important;
        width: 48px !important;
        height: 48px !important;
        border-radius: 50% !important;
        border: none !important;
        cursor: pointer !important;
        background: #9146ff !important;
        color: #ffffff !important;
        font-size: 22px !important;
        line-height: 1 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4) !important;
        padding: 0 !important;
        margin: 0 !important;
        font-family: inherit !important;
        transition: background .15s ease, transform .15s ease !important;
      }
      #${SCROLL_ALL_BUTTON_ID}:hover {
        background: #772ce8 !important;
        transform: translateY(-2px) !important;
      }
      #${SCROLL_ALL_BUTTON_ID}.tnt-running { background: #3f3f46 !important; }
      #${SCROLL_ALL_BUTTON_ID}.tnt-running:hover { background: #53535f !important; }
      #${SCROLL_ALL_BUTTON_ID}.tnt-visible { display: flex !important; }

      .tnt-section-header {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        grid-column: 1 / -1 !important;
        width: 100% !important;
        padding: 12px 4px 8px !important;
        margin: 0 !important;
        font-size: 18px !important;
        font-weight: 700 !important;
        line-height: 1.2 !important;
        color: #efeff1 !important;
        box-sizing: border-box !important;
        font-family: inherit !important;
      }
      .tnt-section-header::before {
        content: '' !important;
        width: 10px !important;
        height: 10px !important;
        border-radius: 50% !important;
        flex: 0 0 auto !important;
      }
      #${NEW_HEADER_ID}::before { background: #00d97e !important; }
      #${REST_HEADER_ID}::before { background: #5c5c60 !important; }
    `;
    document.head.appendChild(style);
  }

  function ensureScrollTopButton() {
    injectStyles();
    if (document.getElementById(TOP_BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = TOP_BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Наверх';
    btn.textContent = '↑';
    btn.addEventListener('click', scrollToTopAll);
    document.body.appendChild(btn);
  }

  function ensureScrollAllButton() {
    injectStyles();
    if (document.getElementById(SCROLL_ALL_BUTTON_ID)) return;
    const btn = document.createElement('button');
    btn.id = SCROLL_ALL_BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Загрузить все';
    btn.textContent = '↓';
    btn.addEventListener('click', () => {
      if (autoScrollRunning) {
        stopAutoScroll = true;
      } else {
        runAutoScroll();
      }
    });
    document.body.appendChild(btn);
  }

  function updateScrollTopButton() {
    const btn = document.getElementById(TOP_BUTTON_ID);
    if (!btn) return;
    const visible = active && settings.scrollTopButton && getScroller().scrollTop > 300;
    btn.classList.toggle('tnt-visible', visible);
  }

  function updateScrollAllButton() {
    const btn = document.getElementById(SCROLL_ALL_BUTTON_ID);
    if (!btn) return;
    if (!active || !settings.scrollAllButton) {
      btn.classList.remove('tnt-visible', 'tnt-running');
      return;
    }
    if (autoScrollRunning) {
      btn.textContent = '■';
      btn.title = 'Остановить';
      btn.classList.add('tnt-visible', 'tnt-running');
    } else {
      btn.textContent = '↓';
      btn.title = 'Загрузить все';
      btn.classList.add('tnt-visible');
      btn.classList.remove('tnt-running');
    }
  }

  function clearOrders() {
    const cards = getCards();
    if (!cards.length) return;
    const container = getContainer(cards);
    if (!container) return;
    for (const item of getGridItems(container, cards)) {
      item.style.order = '';
      item.style.removeProperty('max-width');
      item.style.removeProperty('justify-self');
    }
    removeHeaders();
  }

  function onStorageChanged(changes, area) {
    if (area !== 'sync') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) settings[key] = changes[key].newValue;
    }
    if (changes.sortNewFirst || changes.blockHeaders) {
      if (settings.sortNewFirst) scheduleResort();
      else clearOrders();
    }
    if (changes.scrollAllButton && !settings.scrollAllButton) {
      stopAutoScroll = true;
    }
    updateScrollTopButton();
    updateScrollAllButton();
  }

  function activate() {
    if (active) return;
    active = true;
    ensureScrollTopButton();
    ensureScrollAllButton();
    scheduleResort();
    updateScrollTopButton();
    updateScrollAllButton();
  }

  function deactivate() {
    active = false;
    stopAutoScroll = true;
    updateScrollTopButton();
    updateScrollAllButton();
  }

  function startObserver() {
    const observer = new MutationObserver((records) => {
      if (!active || !settings.sortNewFirst) return;
      let relevant = false;
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches(`${CARD_IMAGE}, ${CARD_LINK}`)) {
            relevant = true;
            break;
          }
          if (node.querySelector && node.querySelector(CARD_IMAGE)) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (relevant) scheduleResort();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function watchUrl() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scrollerCache = null;
        lastCardWidth = 0;
        if (isDirectoryPage()) activate();
        else deactivate();
      }
    }, 500);
  }

  function init() {
    injectStyles();
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('scroll', onScrollEvent, { passive: true, capture: true });
    window.addEventListener('resize', () => scheduleResort());
    startObserver();
    watchUrl();
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      settings = { ...DEFAULTS, ...stored };
      chrome.storage.onChanged.addListener(onStorageChanged);
      ensureScrollTopButton();
      ensureScrollAllButton();
      updateScrollTopButton();
      updateScrollAllButton();
      if (isDirectoryPage()) activate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
