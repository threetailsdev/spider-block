// Settings shared by the background script, content script and extension pages.
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    enabled: true,
    pausedUntil: 0, // timestamp (ms); protection is off until then

    // How images are found
    useText: true, // spider words in alt text, captions, file names, titles
    useAI: true, // on-device image recognition
    sensitivity: 'balanced', // 'relaxed' | 'balanced' | 'strict'
    holdUntilChecked: true, // keep images invisible until they have been checked
    spiderPages: true, // on pages that are about spiders, hide every image
    unscannable: 'show', // 'show' | 'cover': images the AI could not check

    // What counts as a spider
    blockWebs: false,
    blockOtherArachnids: false, // scorpions, ticks, mites
    allowSpiderMan: true,
    customBlockWords: [],
    customAllowWords: [],

    // How hidden images look and behave
    style: 'cover', // 'cover' | 'scene' | 'hide' | 'blur'
    reveal: 'ask', // 'ask' | 'hold' | 'never'
    redactWords: false, // cover spider words in page text
    showBadge: true,

    disabledSites: [], // hostnames where protection is off
  });

  // How the AI scan works at each sensitivity. `crops` is which views of the image
  // are checked: 'center' = whole image + zoomed centre; 'five' = also its four
  // corners (finds small spiders in large photos); 'adaptive' = corners only when
  // the first views show a hint of a spider. Thresholds are the summed probability
  // of the model's spider classes. A page counts as being about spiders when its
  // text mentions them at least `pageMentions` times and at least `pageDensity`
  // times per 1,000 words (so a long news front page with one spider story does
  // not qualify, but a short post about a spider in the bath does).
  const SENSITIVITY = Object.freeze({
    relaxed: { crops: 'center', spider: 0.45, web: 0.35, arachnid: 0.45, pageMentions: 8, pageDensity: 6 },
    balanced: { crops: 'adaptive', spider: 0.3, web: 0.2, arachnid: 0.3, pageMentions: 4, pageDensity: 3 },
    strict: { crops: 'five', spider: 0.12, web: 0.1, arachnid: 0.15, pageMentions: 2, pageDensity: 1 },
  });

  const api = () => root.sbApi;

  async function storageArea() {
    // storage.sync follows the user between devices where the browser supports it.
    try {
      await api().storage.sync.get('enabled');
      return api().storage.sync;
    } catch {
      return api().storage.local;
    }
  }

  async function load() {
    const area = await storageArea();
    const stored = await area.get(Object.keys(DEFAULTS));
    return normalize(stored);
  }

  function normalize(stored) {
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (stored && stored[key] !== undefined && typeof stored[key] === typeof DEFAULTS[key]) out[key] = stored[key];
    }
    if (!SENSITIVITY[out.sensitivity]) out.sensitivity = DEFAULTS.sensitivity;
    return out;
  }

  async function save(partial) {
    const area = await storageArea();
    await area.set(partial);
  }

  // Listen for changes made from any page; calls back with the full new settings.
  function onChange(callback) {
    api().storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' && areaName !== 'local') return;
      if (!Object.keys(changes).some((k) => k in DEFAULTS)) return;
      load().then(callback);
    });
  }

  function normalizeHost(host) {
    return String(host || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/[/:?#].*$/, '')
      .replace(/^www\./, '');
  }

  // "example.com" in the list also covers "news.example.com".
  function siteListed(list, host) {
    const h = normalizeHost(host);
    if (!h) return false;
    return list.some((entry) => {
      const e = normalizeHost(entry);
      return e && (h === e || h.endsWith('.' + e));
    });
  }

  // Why protection is (in)active for a host: 'on' | 'off' | 'paused' | 'site'.
  function status(settings, host, now = Date.now()) {
    if (!settings.enabled) return 'off';
    if (settings.pausedUntil && settings.pausedUntil > now) return 'paused';
    if (siteListed(settings.disabledSites, host)) return 'site';
    return 'on';
  }

  root.SpiderBlockSettings = Object.freeze({
    DEFAULTS,
    SENSITIVITY,
    load,
    save,
    onChange,
    normalize,
    normalizeHost,
    siteListed,
    status,
  });
})(globalThis);
