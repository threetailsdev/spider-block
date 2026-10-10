// Background script: scans images for the content scripts, and owns the toolbar
// badge, right-click menu and keyboard shortcut.
//
// Chrome and Edge run this file as a service worker and load its dependencies
// here. Firefox and Safari run it as a background page whose manifest lists the
// same files.
/* global importScripts */
if (typeof importScripts === 'function' && typeof window === 'undefined') {
  importScripts(
    '../vendor/tf-core.min.js',
    '../vendor/tf-backend-cpu.min.js',
    '../vendor/tf-converter.min.js',
    '../vendor/tf-backend-wasm.min.js',
    '../shared/browser-api.js',
    '../shared/settings.js',
    'classifier.js',
    'image-loader.js',
  );
}

(function () {
  'use strict';

  const api = globalThis.sbApi;
  const Settings = globalThis.SpiderBlockSettings;
  const Classifier = globalThis.SpiderBlockClassifier;
  const Images = globalThis.SpiderBlockImages;

  const IS_FIREFOX = api.runtime.getURL('').startsWith('moz-extension:');
  const BADGE_COLOR = '#2f6f5e';

  // ---------------------------------------------------------------- scanning

  const CACHE_MAX = 3000;
  const cache = new Map(); // "crops|url" -> scores, oldest first
  const inflight = new Map();
  const MAX_PARALLEL = 2;
  let running = 0;
  const waiting = [];

  function remember(key, value) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  async function withSlot(fn) {
    if (running >= MAX_PARALLEL) await new Promise((resolve) => waiting.push(resolve));
    running++;
    try {
      return await fn();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  // In 'adaptive' mode the four corner views are only checked when the whole
  // image and its centre show any hint of a spider. On ImageNet samples this
  // skips them for 98% of ordinary photos without missing any spider.
  const CORNER_GATE = 0.005;

  async function scanImage(source, mode) {
    const started = Date.now();
    const bitmap = await Images.load(source);
    try {
      const first = Images.toPixels(bitmap, 'first');
      const scores = await Classifier.score(first.pixels, first.count);
      let views = first.count;
      const hint = Math.max(scores.spider, scores.web, scores.arachnid);
      if (mode === 'five' || (mode === 'adaptive' && hint >= CORNER_GATE)) {
        const corners = Images.toPixels(bitmap, 'corners');
        if (corners.count) {
          const more = await Classifier.score(corners.pixels, corners.count);
          for (const k of ['spider', 'web', 'arachnid']) scores[k] = Math.max(scores[k], more[k]);
          views += corners.count;
        }
      }
      return { ok: true, ...scores, views, ms: Date.now() - started };
    } finally {
      bitmap.close?.();
    }
  }

  function scan({ key, url, dataUrl, crops = 'adaptive' }) {
    const cacheKey = `${crops}|${key || url}`;
    if (cache.has(cacheKey)) {
      const hit = cache.get(cacheKey);
      remember(cacheKey, hit);
      return Promise.resolve({ ...hit, cached: true });
    }
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);
    const job = withSlot(() => scanImage(dataUrl || url, crops))
      .then((result) => {
        remember(cacheKey, result);
        return result;
      })
      .catch((err) => ({ ok: false, error: err instanceof Images.ScanError ? err.message : String(err?.message || err) }))
      .finally(() => inflight.delete(cacheKey));
    inflight.set(cacheKey, job);
    return job;
  }

  // ------------------------------------------------------------------- badge

  const tabCounts = new Map(); // tabId -> Map(frameId -> hidden image count)
  let showBadge = true;

  // The browser stops this script when it is idle (service worker / event page),
  // so the counts are also kept in session storage. Otherwise a frame reporting
  // after a restart would replace the whole tab's count with its own.
  const session = api.storage.session;
  const countsLoaded = (async () => {
    try {
      const { tabCounts: saved } = (await session?.get('tabCounts')) || {};
      for (const [tabId, frames] of Object.entries(saved || {})) {
        tabCounts.set(Number(tabId), new Map(Object.entries(frames).map(([frameId, n]) => [Number(frameId), n])));
      }
    } catch {
      // start counting from zero
    }
  })();

  function saveCounts() {
    const data = {};
    for (const [tabId, frames] of tabCounts) data[tabId] = Object.fromEntries(frames);
    session?.set({ tabCounts: data }).catch(() => {});
  }

  function tabTotal(tabId) {
    let total = 0;
    for (const n of tabCounts.get(tabId)?.values() || []) total += n;
    return total;
  }

  function updateBadge(tabId) {
    const total = tabTotal(tabId);
    const text = showBadge && total > 0 ? String(total > 999 ? '999+' : total) : '';
    api.action.setBadgeText({ tabId, text }).catch(() => {});
  }

  async function setCount(sender, msg) {
    const tabId = sender.tab?.id;
    if (tabId === undefined || tabId < 0) return;
    await countsLoaded;
    // A fresh top-level page starts a new count for the tab.
    if (msg.reset && sender.frameId === 0) tabCounts.delete(tabId);
    if (!tabCounts.has(tabId)) tabCounts.set(tabId, new Map());
    tabCounts.get(tabId).set(sender.frameId ?? 0, Math.max(0, msg.count | 0));
    saveCounts();
    updateBadge(tabId);
  }

  api.tabs.onRemoved.addListener(async (tabId) => {
    await countsLoaded;
    if (tabCounts.delete(tabId)) saveCounts();
  });

  // Grey toolbar icon while protection is switched off or paused.
  let resumeTimer = null;
  function iconSet(name) {
    const sizes = [16, 32, 48, 128];
    return Object.fromEntries(sizes.map((s) => [s, `/images/${name}-${s}.png`]));
  }
  async function refreshGlobalState() {
    const settings = await Settings.load();
    showBadge = settings.showBadge;
    const now = Date.now();
    const off = !settings.enabled || settings.pausedUntil > now;
    api.action.setIcon({ path: iconSet(off ? 'icon-off' : 'icon') }).catch(() => {});
    api.action.setTitle({
      title: !settings.enabled ? 'Spider Block (off)' : settings.pausedUntil > now ? 'Spider Block (paused)' : 'Spider Block',
    }).catch(() => {});
    clearTimeout(resumeTimer);
    if (settings.enabled && settings.pausedUntil > now) {
      resumeTimer = setTimeout(refreshGlobalState, Math.min(settings.pausedUntil - now + 500, 2 ** 31 - 1));
    }
    for (const tabId of tabCounts.keys()) updateBadge(tabId);
  }

  // ----------------------------------------------------- hide-all ("panic")

  async function topFrameState(tabId) {
    try {
      return await api.tabs.sendMessage(tabId, { type: 'get-state' }, { frameId: 0 });
    } catch {
      return null; // no content script here (browser pages, the web store, ...)
    }
  }

  async function togglePanic(tabId, on) {
    if (tabId === undefined) return { ok: false };
    if (on === undefined) {
      const state = await topFrameState(tabId);
      if (!state) return { ok: false };
      on = !state.panic;
    }
    // No frameId: every frame of the tab gets it.
    await api.tabs.sendMessage(tabId, { type: 'set-panic', on }).catch(() => {});
    return { ok: true, panic: on };
  }

  async function activeTabId() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab?.id;
  }

  api.commands?.onCommand.addListener(async (command, tab) => {
    if (command === 'hide-all-images') togglePanic(tab?.id ?? (await activeTabId()));
  });

  // -------------------------------------------------------------- right-click

  const MENU = {
    hide: 'sb-hide-image',
    show: 'sb-show-image',
    panic: 'sb-hide-all',
  };

  async function createMenus() {
    if (!api.contextMenus) return; // e.g. Firefox for Android
    await api.contextMenus.removeAll();
    const ignoreError = () => void api.runtime.lastError;
    const where = ['image', 'video', 'link', 'page', 'frame'];
    api.contextMenus.create({ id: MENU.hide, title: 'Hide this image', contexts: where }, ignoreError);
    api.contextMenus.create({ id: MENU.show, title: "This isn't a spider (always show it)", contexts: where }, ignoreError);
    api.contextMenus.create({ id: MENU.panic, title: 'Hide or show all images on this page', contexts: where }, ignoreError);
  }

  api.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab || tab.id < 0) return;
    if (info.menuItemId === MENU.panic) {
      togglePanic(tab.id);
      return;
    }
    const action = info.menuItemId === MENU.hide ? 'hide' : info.menuItemId === MENU.show ? 'show' : null;
    if (!action) return;
    api.tabs
      .sendMessage(tab.id, { type: 'menu', action, srcUrl: info.srcUrl || '' }, { frameId: info.frameId ?? 0 })
      .catch(() => {});
  });

  // ---------------------------------------------------------------- install

  // Chrome and Edge only run content scripts on pages loaded after install, so
  // protect the tabs that are already open. (Firefox does this by itself.)
  async function protectOpenTabs() {
    if (IS_FIREFOX || !api.scripting) return;
    const [script] = api.runtime.getManifest().content_scripts || [];
    if (!script) return;
    const tabs = await api.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    await Promise.all(
      tabs.map(async (tab) => {
        try {
          const target = { tabId: tab.id, allFrames: true };
          if (script.css?.length) await api.scripting.insertCSS({ target, files: script.css });
          await api.scripting.executeScript({ target, files: script.js });
        } catch {
          // Pages we may not touch (web store, discarded tabs) are skipped.
        }
      }),
    );
  }

  api.runtime.onInstalled.addListener(async (details) => {
    await createMenus().catch(() => {});
    if (details.reason === 'install') {
      api.tabs.create({ url: api.runtime.getURL('welcome/welcome.html') }).catch(() => {});
    }
    protectOpenTabs().catch(() => {});
  });

  api.runtime.onStartup?.addListener(() => {
    createMenus().catch(() => {});
  });

  // --------------------------------------------------------------- messages

  async function handle(msg, sender) {
    switch (msg?.type) {
      case 'scan':
        return scan(msg);
      case 'count':
        await setCount(sender, msg);
        return { ok: true };
      case 'frame-info':
        // Lets an embedded frame know which site it is shown on.
        return { tabUrl: sender.tab?.url || '' };
      case 'tab-count':
        await countsLoaded;
        return { count: tabTotal(msg.tabId) };
      case 'toggle-panic':
        // From the popup (names a tab) or from a page's own "show them again" bar.
        return togglePanic(msg.tabId ?? sender.tab?.id, msg.on);
      case 'warm-up':
        Classifier.init().catch(() => {});
        return { ok: true };
      case 'engine-info': {
        try {
          const { backend } = await Classifier.init();
          return { ok: true, backend };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }
      default:
        return { ok: false, error: 'unknown-message' };
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true; // the response is sent asynchronously
  });

  Settings.onChange(() => refreshGlobalState());
  refreshGlobalState().catch(() => {});
  api.action.setBadgeBackgroundColor({ color: BADGE_COLOR }).catch(() => {});
  api.action.setBadgeTextColor?.({ color: '#ffffff' })?.catch?.(() => {});
})();
