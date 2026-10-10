// Content script: runs in every page and frame. It finds images, decides whether
// they show spiders, and hides the ones that do.
//
// Each image gets a data-sb attribute that content.css styles:
//   (none) / pending  not checked yet; invisible while "hold until checked" is on
//   ok                checked, shown normally
//   blocked           hidden (data-sb-why says why)
//   revealed          hidden, then shown because the user asked
(() => {
  'use strict';

  const api = globalThis.sbApi;
  const Settings = globalThis.SpiderBlockSettings;
  const Terms = globalThis.SpiderBlockTerms;
  const Assets = globalThis.SpiderBlockAssets || { shield: '', scenes: [] };
  if (!api?.runtime?.id || !Settings || !Terms) return;

  // After an update or re-injection an older copy may still be attached to the page.
  const previous = globalThis.__spiderBlock;
  if (previous) {
    if (previous.alive()) return;
    previous.destroy();
  }

  const doc = document;
  const html = doc.documentElement;
  if (!html) return;

  const ATTR = 'data-sb';
  const WHY = 'data-sb-why';
  const KIND = 'data-sb-kind';
  const SCENE = 'data-sb-scene';
  const SHIELD = 'data-sb-shield';
  const MEDIA = 'img, input[type="image"], video, svg image';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_SIZE = 40; // smaller images are icons and are never scanned
  const CARD_LEVELS = 5;
  const CARD_CHARS = 400;
  const CARD_NODES = 400;
  const VERDICTS_MAX = 5000;
  const isTop = window === window.top;

  // Hide images straight away; they are revealed as soon as they are checked.
  // Removed again below if protection is off for this page.
  html.setAttribute(SHIELD, '');

  let settings = Settings.DEFAULTS;
  let matcher = Terms.createMatcher();
  let ready = false;
  let active = false;
  let destroyed = false;
  let siteHost = location.hostname;
  let pageSpidery = false;
  let pageOverride = false; // "only hide spider images on this page"
  let panic = false;
  let detectionKey = '';
  let userVerdicts = { blocked: {}, allowed: {} };
  let lastHref = location.href;
  let pauseTimer = null;

  const urlOf = new WeakMap(); // element -> image URL it was last checked with
  const scanCache = new Map(); // "crops|url" -> Promise<scan result>
  const shadowRoots = new Set();
  let cardCache = new WeakMap(); // element -> its text, or null when too big to be a "card"

  // ------------------------------------------------------------------ helpers

  function alive() {
    try {
      return !destroyed && !!api.runtime?.id;
    } catch {
      return false;
    }
  }

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // Long data: URLs are summarised so they can be used as keys.
  function keyFor(url) {
    return url.length > 300 ? `h${hash(url)}:${url.length}` : url;
  }

  function absolute(url) {
    if (!url) return '';
    try {
      return new URL(url, doc.baseURI).href;
    } catch {
      return url;
    }
  }

  function setFlag(el, name, on, value = '') {
    if (on) {
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    } else if (el.hasAttribute(name)) {
      el.removeAttribute(name);
    }
  }

  function* queryAll(selector) {
    yield* doc.querySelectorAll(selector);
    for (const root of shadowRoots) {
      if (!root.host.isConnected) {
        shadowRoots.delete(root);
        continue;
      }
      yield* root.querySelectorAll(selector);
    }
  }

  function send(msg, timeout = 120000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      const done = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      const failed = () => {
        if (!alive()) destroy();
        done(null);
      };
      try {
        Promise.resolve(api.runtime.sendMessage(msg)).then(done, failed);
      } catch {
        failed();
      }
    });
  }

  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'CODE']);
  const textFilter = {
    acceptNode: (n) => (n.nodeType === 1 && SKIP_TEXT.has(n.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  };

  // Text inside `node`, or null when the node is too big to be one "card".
  function boundedText(node) {
    if (cardCache.has(node)) return cardCache.get(node);
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, textFilter);
    let text = '';
    let visited = 0;
    let result = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (++visited > CARD_NODES) {
        result = null;
        break;
      }
      if (n.nodeType === 3) {
        text += n.data + ' ';
        if (text.length > CARD_CHARS) {
          result = null;
          break;
        }
      }
    }
    if (result !== null) result = text;
    cardCache.set(node, result);
    return result;
  }

  // ------------------------------------------------------------- what is it?

  function kindOf(el) {
    const tag = el.localName;
    if (tag === 'img' || tag === 'input') return 'img';
    if (tag === 'video') return 'video';
    if (tag === 'image' && el.namespaceURI === SVG_NS) return 'svg';
    return 'bg';
  }

  function cssUrl(bg) {
    if (!bg || bg === 'none') return '';
    const m = /url\((['"]?)(.*?)\1\)/.exec(bg);
    return m ? m[2] : '';
  }

  function backgroundUrl(el) {
    return cssUrl(getComputedStyle(el).backgroundImage);
  }

  function sourceOf(el, kind) {
    switch (kind) {
      case 'img':
        return el.currentSrc || el.src || '';
      case 'video':
        return el.poster || '';
      case 'svg':
        return absolute(el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '');
      default: {
        // While hidden, the computed background is our own cover, not the page's image.
        // The element's own style attribute still holds the page's background (outside
        // shadow DOM, where the cover is not set inline), so a lazy loader or slideshow
        // swapping it in is noticed.
        const state = el.getAttribute(ATTR);
        if ((state === 'blocked' || state === 'pending') && urlOf.has(el)) {
          const own = el.getRootNode() === doc ? cssUrl(el.style.backgroundImage) : '';
          return own ? absolute(own) : urlOf.get(el);
        }
        return absolute(backgroundUrl(el));
      }
    }
  }

  function isSmall(el, kind) {
    if (kind === 'img' && el.naturalWidth) return Math.min(el.naturalWidth, el.naturalHeight) < MIN_SIZE;
    if (kind === 'bg' || kind === 'svg') {
      const r = el.getBoundingClientRect();
      return r.width < MIN_SIZE || r.height < MIN_SIZE;
    }
    return false;
  }

  // Alt text, title, file name, caption and link around an image.
  function ownText(el, url) {
    const parts = [];
    for (const name of ['alt', 'title', 'aria-label']) {
      const v = el.getAttribute(name);
      if (v) parts.push(v);
    }
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) parts.push(doc.getElementById(id)?.textContent?.slice(0, 300) || '');
    }
    parts.push(Terms.textFromUrl(url));
    if (el.localName === 'img' && el.src && el.src !== url) parts.push(Terms.textFromUrl(el.src));
    const caption = el.closest('figure')?.querySelector('figcaption');
    if (caption) parts.push(caption.textContent.slice(0, 600));
    const link = el.closest('a[href]');
    if (link) {
      parts.push(link.getAttribute('title') || '', link.getAttribute('aria-label') || '', Terms.textFromUrl(link.href));
    }
    return parts.join('\n');
  }

  // Text of the small "card" around an image: a video tile with its title, a
  // news teaser with its headline, a post with its caption. A card holds this
  // one image (plus small ones such as a channel avatar), so a caption in a
  // gallery only counts for its own picture.
  function cardText(el) {
    let best = '';
    let node = el.parentElement;
    for (let i = 0; node && i < CARD_LEVELS; i++, node = node.parentElement) {
      if (node === doc.body || node === html) break;
      const text = boundedText(node);
      if (text === null || hasOtherLargeImage(node, el)) break;
      best = text;
    }
    return best;
  }

  function hasOtherLargeImage(node, el) {
    for (const other of node.querySelectorAll(MEDIA)) {
      if (other === el) continue;
      const w = other.naturalWidth || Number(other.getAttribute('width')) || 0;
      const h = other.naturalHeight || Number(other.getAttribute('height')) || 0;
      const small = (w > 0 && w < 100) || (h > 0 && h < 100);
      if (!small) return true;
    }
    return false;
  }

  function textMatch(el, url) {
    return matcher.find(ownText(el, url)) || matcher.find(cardText(el));
  }

  // ------------------------------------------------------------------ states

  let countTimer = null;
  function countChanged() {
    if (countTimer) return;
    countTimer = setTimeout(reportCount, 300);
  }

  let reportedCount = -1;
  function reportCount(reset = false) {
    countTimer = null;
    if (!alive()) return;
    let count = 0;
    for (const _ of queryAll(`[${ATTR}="blocked"]`)) count++;
    if (count === reportedCount && !reset) return;
    reportedCount = count;
    send({ type: 'count', count, reset }, 5000);
  }

  function setState(el, kind, state, why = null) {
    const unchanged = el.getAttribute(ATTR) === state && (el.getAttribute(WHY) || null) === why;
    setFlag(el, KIND, kind === 'bg', 'bg');
    setFlag(el, WHY, !!why, why || '');
    if (state === 'blocked') {
      el.setAttribute(SCENE, String(hash(urlOf.get(el) || '') % Math.max(1, Assets.scenes.length)));
      if (kind === 'video' && !el.paused) el.pause();
    }
    setFlag(el, ATTR, true, state);
    if (el.getRootNode() !== doc && !unchanged) applyInline(el, kind, state);
    countChanged();
  }

  function clearState(el) {
    for (const name of [ATTR, WHY, KIND, SCENE]) el.removeAttribute(name);
    if (el.getRootNode() !== doc) applyInline(el, kindOf(el), null);
    urlOf.delete(el);
  }

  // Page stylesheets do not reach inside shadow DOM, so elements there are
  // styled inline instead (and restored afterwards).
  const inlineSaved = new WeakMap();
  const ownStyle = new WeakMap(); // element -> style attribute as we last left it
  function applyInline(el, kind, state) {
    const saved = inlineSaved.get(el);
    if (saved) {
      for (const [prop, value, priority] of saved) el.style.setProperty(prop, value, priority);
      inlineSaved.delete(el);
    }
    const props = inlineProps(el, kind, state);
    if (props.length) {
      inlineSaved.set(el, props.map(([p]) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]));
      for (const [prop, value] of props) el.style.setProperty(prop, value, 'important');
    }
    ownStyle.set(el, el.getAttribute('style'));
  }

  function coverBackground() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const gradient = dark ? 'linear-gradient(135deg, #2c3f3a, #2a3a44)' : 'linear-gradient(135deg, #d4e7dd, #c2d8e2)';
    return `url("${Assets.shield}") center / clamp(14px, 32%, 56px) no-repeat, ${gradient}`;
  }

  function inlineProps(el, kind, state) {
    if (panic && kind !== 'bg') return [['visibility', 'hidden']];
    if (state === 'pending' && settings.holdUntilChecked) return kind === 'bg' ? [['background-image', 'none']] : [['opacity', '0']];
    if (state !== 'blocked') return [];
    const style = settings.style === 'blur' && kind === 'bg' ? 'cover' : settings.style;
    if (kind === 'svg') return style === 'blur' ? [['filter', 'blur(36px)']] : [['opacity', '0']];
    if (style === 'hide') return kind === 'bg' ? [['background-image', 'none']] : [['visibility', 'hidden']];
    if (style === 'blur') return [['filter', 'blur(36px) grayscale(0.6)'], ['clip-path', 'inset(0)']];
    const scene = Assets.scenes[Number(el.getAttribute(SCENE)) || 0];
    const background = style === 'scene' && scene ? `url("${scene}") center / cover no-repeat` : coverBackground();
    return kind === 'bg' ? [['background', background]] : [['background', background], ['object-position', '-99999px -99999px']];
  }

  function block(el, kind, why) {
    setState(el, kind, 'blocked', why);
  }

  // ------------------------------------------------------------- the checks

  // `again`: decide afresh even if the image has not changed.
  function process(el, again = false) {
    if (!ready || !active || destroyed) return;
    try {
      const kind = kindOf(el);
      const url = sourceOf(el, kind);
      const state = el.getAttribute(ATTR);
      if (!again && state && state !== 'pending' && urlOf.get(el) === url) return;
      if (kind === 'bg' && !url && !state) return;
      urlOf.set(el, url);
      decide(el, kind, url);
    } catch (err) {
      // Never leave an image hidden because of a bug here.
      setFlag(el, ATTR, true, 'ok');
      console.debug('Spider Block:', err);
    }
  }

  function decide(el, kind, url) {
    const key = keyFor(url);
    if (url && userVerdicts.allowed[key]) return setState(el, kind, 'ok');
    if (url && userVerdicts.blocked[key]) return block(el, kind, 'user');
    if (settings.useText && textMatch(el, url)) return block(el, kind, 'text');
    // Size is only known once the image has loaded; the load event comes back here.
    if (kind === 'img' && el.complete === false) return setState(el, kind, 'pending');
    if (!url || isSmall(el, kind)) return setState(el, kind, 'ok');
    if (pageSpidery && settings.spiderPages && !pageOverride) return block(el, kind, 'page');
    if (settings.useAI) return queueScan(el, kind);
    setState(el, kind, 'ok');
  }

  // Text near an already-checked image changed (e.g. a video title filled in late).
  function recheckText(el) {
    if (!settings.useText) return;
    const state = el.getAttribute(ATTR);
    if (state !== 'ok' && state !== 'pending') return;
    if (textMatch(el, urlOf.get(el) || '')) block(el, kindOf(el), 'text');
  }

  // New text mentioning spiders: re-check the images in the same small card.
  function textAdded(node) {
    if (!settings.useText) return;
    const text = node.nodeType === 3 ? node.data : boundedText(node);
    if (!text || !matcher.find(text)) return;
    let card = null;
    let el = node.nodeType === 3 ? node.parentElement : node;
    for (let i = 0; el && i < CARD_LEVELS; i++, el = el.parentElement) {
      if (el === doc.body || el === html || boundedText(el) === null) break;
      card = el;
    }
    if (!card) return;
    for (const media of card.querySelectorAll(MEDIA)) recheckText(media);
    for (const bg of card.querySelectorAll(`[${KIND}="bg"]`)) recheckText(bg);
  }

  // ------------------------------------------------------------ AI scanning

  // Images are scanned as they come near the screen, so the visible ones go first.
  let visibility = null;
  function visibilityObserver() {
    if (!visibility) {
      visibility = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            visibility.unobserve(entry.target);
            runScan(entry.target);
          }
        },
        { rootMargin: '800px 0px 800px 0px' },
      );
    }
    return visibility;
  }

  function queueScan(el, kind) {
    setState(el, kind, 'pending');
    visibilityObserver().observe(el);
  }

  async function runScan(el) {
    const kind = kindOf(el);
    const url = urlOf.get(el);
    if (!url || el.getAttribute(ATTR) !== 'pending') return;
    const result = await scanUrl(el, kind, url);
    if (!active || destroyed || urlOf.get(el) !== url || el.getAttribute(ATTR) !== 'pending') return;
    applyResult(el, kind, result);
  }

  function scanUrl(el, kind, url) {
    const crops = Settings.SENSITIVITY[settings.sensitivity].crops;
    const key = keyFor(url);
    const cacheKey = `${crops}|${key}`;
    let job = scanCache.get(cacheKey);
    if (!job) {
      job = (async () => {
        let res = null;
        if (!url.startsWith('blob:')) res = await send({ type: 'scan', key, url, crops });
        if (res?.ok) return res;
        // The extension could not download it (sign-in only, hotlink protection,
        // or an image made by the page): read the copy the page already has, if
        // the browser allows that.
        const dataUrl = capture(el, kind);
        if (dataUrl) {
          const second = await send({ type: 'scan', key: `capture:${key}`, url: '', dataUrl, crops });
          if (second?.ok) return second;
        }
        return res || { ok: false, error: 'unreadable' };
      })();
      scanCache.set(cacheKey, job);
      if (scanCache.size > 2000) scanCache.delete(scanCache.keys().next().value);
      // Remember answers, not failures (the background may just have restarted).
      job.then((res) => {
        if (!res?.ok && scanCache.get(cacheKey) === job) scanCache.delete(cacheKey);
      });
    }
    return job;
  }

  function capture(el, kind) {
    if (kind !== 'img' && kind !== 'video') return null;
    try {
      const w = el.naturalWidth || el.videoWidth || 0;
      const h = el.naturalHeight || el.videoHeight || 0;
      if (!w || !h) return null;
      const scale = Math.min(1, 512 / Math.max(w, h));
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext('2d').drawImage(el, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.9); // throws for other sites' images
    } catch {
      return null;
    }
  }

  const HARMLESS_ERRORS = new Set(['svg', 'unsupported-url']);

  function applyResult(el, kind, res) {
    if (!res?.ok) {
      if (settings.unscannable === 'cover' && !HARMLESS_ERRORS.has(res?.error)) return block(el, kind, 'unscannable');
      return setState(el, kind, 'ok');
    }
    const t = Settings.SENSITIVITY[settings.sensitivity];
    const spider =
      res.spider >= t.spider ||
      (settings.blockWebs && res.web >= t.web) ||
      (settings.blockOtherArachnids && res.arachnid >= t.arachnid);
    if (spider) return block(el, kind, 'ai');
    setState(el, kind, 'ok');
  }

  // ----------------------------------------------------- pages about spiders

  function pageHeadline() {
    const parts = [doc.title, Terms.textFromUrl(location.href)];
    const og = doc.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
    if (og) parts.push(og.getAttribute('content') || '');
    const h1 = doc.querySelector('h1');
    if (h1) parts.push(h1.textContent.slice(0, 300));
    return parts.join('\n');
  }

  function bodySample(max = 20000) {
    if (!doc.body) return '';
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, textFilter);
    let out = '';
    for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
      if (n.nodeType === 3) out += n.data + ' ';
    }
    return out;
  }

  function evaluatePage() {
    pageTimer = null;
    lastPageCheck = Date.now();
    if (!ready || !active) return;
    let spidery = false;
    if (settings.spiderPages) {
      const { pageMentions, pageDensity } = Settings.SENSITIVITY[settings.sensitivity];
      spidery = !!matcher.find(pageHeadline());
      if (!spidery) {
        const sample = bodySample();
        const mentions = matcher.count(sample);
        const words = Math.max(1, sample.split(/\s+/).length);
        spidery = mentions >= pageMentions && (mentions * 1000) / words >= pageDensity;
      }
    }
    if (spidery === pageSpidery) return;
    pageSpidery = spidery;
    recheckAll((el) => {
      const state = el.getAttribute(ATTR);
      return spidery ? state === 'ok' || state === 'pending' : el.getAttribute(WHY) === 'page';
    });
  }

  let pageTimer = null;
  let lastPageCheck = 0;
  function schedulePageCheck() {
    if (pageTimer) return;
    const wait = Math.max(0, 1500 - (Date.now() - lastPageCheck));
    pageTimer = setTimeout(evaluatePage, wait);
  }

  // ------------------------------------------------------------ DOM watching

  let pendingHosts = [];

  function collectShadowRoots(node) {
    const visit = (el) => {
      const root = el.shadowRoot;
      if (root) {
        if (!shadowRoots.has(root)) {
          shadowRoots.add(root);
          observer.observe(root, OBSERVE);
          scanTree(root);
        }
      } else if (el.localName.includes('-')) {
        pendingHosts.push(el); // custom elements may attach their shadow root later
      }
    };
    if (node.nodeType === 1) visit(node);
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) visit(el);
    if (pendingHosts.length) scheduleHostCheck();
  }

  let hostTimer = null;
  function scheduleHostCheck() {
    if (hostTimer) return;
    hostTimer = setTimeout(() => {
      hostTimer = null;
      const hosts = pendingHosts;
      pendingHosts = [];
      for (const el of hosts) {
        if (el.shadowRoot && !shadowRoots.has(el.shadowRoot) && el.isConnected) collectShadowRoots(el);
      }
    }, 250);
  }

  function scanTree(node) {
    if (node.nodeType === 1 && node.matches(MEDIA)) process(node);
    const media = node.querySelectorAll(MEDIA);
    for (const el of media) process(el);
    collectShadowRoots(node);
    queueBackgroundScan(node);
    if (redaction) redactTree(node);
    return media.length;
  }

  // CSS background images can only be found by asking every element for its
  // computed style, so that runs in small slices while the browser is idle.
  const backgroundQueue = [];
  let backgroundScheduled = false;
  const idle = globalThis.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 50));

  function queueBackgroundScan(node) {
    if (![1, 9, 11].includes(node.nodeType)) return;
    backgroundQueue.push({
      walker: doc.createTreeWalker(node, NodeFilter.SHOW_ELEMENT),
      first: node.nodeType === 1 ? node : null,
    });
    if (!backgroundScheduled) {
      backgroundScheduled = true;
      idle(runBackgroundScan);
    }
  }

  function runBackgroundScan(deadline) {
    backgroundScheduled = false;
    if (!active || destroyed) {
      backgroundQueue.length = 0;
      return;
    }
    while (backgroundQueue.length && deadline.timeRemaining() > 1) {
      const job = backgroundQueue[0];
      for (let i = 0; i < 200; i++) {
        const el = job.first || job.walker.nextNode();
        job.first = null;
        if (!el) {
          backgroundQueue.shift();
          break;
        }
        if (el === ui?.host || el.matches(MEDIA) || el.hasAttribute(ATTR)) continue;
        if (backgroundUrl(el)) process(el);
      }
    }
    if (backgroundQueue.length && !backgroundScheduled) {
      backgroundScheduled = true;
      idle(runBackgroundScan);
    }
  }

  const OBSERVE = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'poster', 'href', 'style', 'alt', 'title', 'aria-label'],
  };

  function onMutations(records) {
    if (!ready || !active || destroyed) return;
    cardCache = new WeakMap();
    let pageDirty = false;
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType === 1) {
            if (n === ui?.host) continue;
            if (!scanTree(n)) textAdded(n);
            if (n.nodeName === 'TITLE' || n.nodeName === 'H1') pageDirty = true;
          } else if (n.nodeType === 3) {
            textAdded(n);
            if (redaction) redactTree(n);
          }
        }
        if (r.target.nodeName === 'TITLE') pageDirty = true;
      } else if (r.type === 'characterData') {
        textAdded(r.target);
        if (redaction) redactTree(r.target);
        if (r.target.parentNode?.nodeName === 'TITLE') pageDirty = true;
      } else {
        attributeChanged(r.target, r.attributeName);
      }
    }
    if (location.href !== lastHref) {
      // Single-page apps change "page" without a reload.
      lastHref = location.href;
      pageOverride = false;
      pageDirty = true;
    }
    if (pageDirty || Date.now() - lastPageCheck > 3000) schedulePageCheck();
  }

  function attributeChanged(el, name) {
    if (el === html) return;
    switch (name) {
      case 'src':
      case 'srcset':
      case 'poster':
        if (el.matches(MEDIA)) process(el);
        else if (el.localName === 'source') el.parentElement?.querySelectorAll('img, video').forEach((media) => process(media));
        break;
      case 'href':
        if (el.localName === 'image') process(el);
        break;
      case 'style':
        if (ownStyle.has(el) && ownStyle.get(el) === el.getAttribute('style')) break; // our own change
        if (!el.matches(MEDIA) && (el.hasAttribute(ATTR) || el.style.backgroundImage.includes('url('))) process(el);
        break;
      default:
        // alt, title, aria-label
        if (el.matches(MEDIA)) recheckText(el);
    }
  }

  const observer = new MutationObserver(onMutations);
  observer.observe(doc, OBSERVE);

  // Every image load (including lazy-loaded and responsive images switching
  // source) comes through here. Load events do not bubble, so listen while capturing.
  function onMediaEvent(e) {
    const el = e.target;
    if (el?.localName === 'img') process(el);
  }
  doc.addEventListener('load', onMediaEvent, true);
  doc.addEventListener('error', onMediaEvent, true);

  function recheckAll(filter = null) {
    cardCache = new WeakMap();
    for (const el of queryAll(`[${ATTR}]`)) {
      if (el.getAttribute(ATTR) === 'revealed') continue;
      if (filter && !filter(el)) continue;
      // The remembered URL is kept: a hidden background's computed style is our cover.
      process(el, true);
    }
  }

  function fullScan() {
    cardCache = new WeakMap();
    scanTree(doc);
  }

  // ----------------------------------------------------------- word redaction

  const HIGHLIGHT = 'spider-block-words';
  let redaction = null;
  const NO_REDACT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT', 'SELECT', 'TITLE']);

  function redactTree(node) {
    const add = (t) => {
      const parent = t.parentNode;
      if (!parent || NO_REDACT.has(parent.nodeName) || parent.isContentEditable) return;
      for (const { index, length } of matcher.spans(t.data)) {
        const range = new Range();
        range.setStart(t, index);
        range.setEnd(t, index + length);
        redaction.add(range);
      }
    };
    if (node.nodeType === 3) return add(node);
    const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) add(t);
  }

  function updateRedaction() {
    const supported = typeof Highlight === 'function' && globalThis.CSS?.highlights;
    if (supported && active && settings.redactWords) {
      if (!redaction) {
        redaction = new Highlight();
        CSS.highlights.set(HIGHLIGHT, redaction);
      }
      redaction.clear();
      redactTree(doc.body || html);
      for (const root of shadowRoots) redactTree(root);
    } else if (redaction) {
      redaction.clear();
      CSS.highlights.delete(HIGHLIGHT);
      redaction = null;
    }
  }

  // --------------------------------------------------------------- settings

  async function topSiteHost() {
    if (isTop) return location.hostname;
    const origins = location.ancestorOrigins;
    if (origins?.length) {
      try {
        return new URL(origins[origins.length - 1]).hostname;
      } catch {
        // fall through
      }
    }
    const info = await send({ type: 'frame-info' }, 5000);
    try {
      return new URL(info?.tabUrl).hostname;
    } catch {
      return location.hostname;
    }
  }

  function applySettings(next) {
    settings = next;
    matcher = Terms.createMatcher({
      webs: next.blockWebs,
      arachnids: next.blockOtherArachnids,
      allowSpiderMan: next.allowSpiderMan,
      extraBlock: next.customBlockWords,
      extraAllow: next.customAllowWords,
    });
    const status = Settings.status(next, siteHost);
    clearTimeout(pauseTimer);
    if (status === 'paused') pauseTimer = setTimeout(() => applySettings(settings), next.pausedUntil - Date.now() + 100);

    const wasActive = active;
    active = status === 'on';
    setFlag(html, SHIELD, active && next.holdUntilChecked);
    setFlag(html, 'data-sb-style', active, next.style);
    setFlag(html, 'data-sb-reveal', active, next.reveal);

    // Only re-check images when something that affects detection changed.
    const key = JSON.stringify([
      next.useText, next.useAI, next.sensitivity, next.spiderPages, next.unscannable, next.blockWebs,
      next.blockOtherArachnids, next.allowSpiderMan, next.customBlockWords, next.customAllowWords,
    ]);
    if (!active) {
      deactivate();
    } else if (!wasActive) {
      evaluatePage();
      fullScan();
    } else if (key !== detectionKey) {
      pageSpidery = false;
      evaluatePage();
      recheckAll();
      fullScan();
    } else {
      // Appearance only: restyle the shadow DOM elements styled inline.
      for (const root of shadowRoots) {
        for (const el of root.querySelectorAll(`[${ATTR}]`)) applyInline(el, kindOf(el), el.getAttribute(ATTR));
      }
    }
    detectionKey = key;
    updateRedaction();
    if (ui?.panicBar) renderPanicBar();
  }

  function deactivate() {
    for (const el of [...queryAll(`[${ATTR}]`)]) clearState(el);
    visibility?.disconnect();
    visibility = null;
    pageSpidery = false;
    backgroundQueue.length = 0;
    closeReveal();
    countChanged();
  }

  function normalizeVerdicts(v) {
    return { blocked: { ...(v?.blocked || {}) }, allowed: { ...(v?.allowed || {}) } };
  }

  async function saveVerdict(url, verdict) {
    if (!url) return;
    const key = keyFor(url);
    const stored = normalizeVerdicts((await api.storage.local.get('userVerdicts')).userVerdicts);
    const [add, remove] = verdict === 'blocked' ? ['blocked', 'allowed'] : ['allowed', 'blocked'];
    delete stored[remove][key];
    stored[add][key] = Date.now();
    for (const list of [stored.blocked, stored.allowed]) {
      const keys = Object.keys(list);
      if (keys.length > VERDICTS_MAX) {
        keys.sort((a, b) => list[a] - list[b]);
        for (const k of keys.slice(0, keys.length - VERDICTS_MAX)) delete list[k];
      }
    }
    userVerdicts = stored;
    await api.storage.local.set({ userVerdicts: stored });
  }

  function onStorageChanged(changes, area) {
    if (area === 'local' && changes.userVerdicts && ready) {
      userVerdicts = normalizeVerdicts(changes.userVerdicts.newValue);
      if (active) {
        recheckAll((el) => {
          const key = keyFor(urlOf.get(el) || '');
          return !!(userVerdicts.allowed[key] || userVerdicts.blocked[key] || el.getAttribute(WHY) === 'user');
        });
      }
    }
  }

  // ---------------------------------------------------------- hide-all mode

  function setPanic(on) {
    panic = !!on;
    setFlag(html, 'data-sb-panic', panic);
    if (panic) for (const v of queryAll('video')) v.pause?.();
    for (const root of shadowRoots) {
      for (const el of root.querySelectorAll(MEDIA)) applyInline(el, kindOf(el), el.getAttribute(ATTR));
    }
    if (isTop) renderPanicBar();
  }

  // ------------------------------------------------------------ on-page UI

  let ui = null;
  let reveal = null;

  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .card {
      position: fixed; width: min(320px, calc(100vw - 16px)); padding: 16px; border-radius: 14px;
      background: #fbfdfc; color: #1d2b27; border: 1px solid #cfe0d8;
      box-shadow: 0 10px 30px rgba(20, 40, 35, .22); font-size: 14px; line-height: 1.45;
      pointer-events: auto; animation: rise .14s ease-out;
    }
    @keyframes rise { from { opacity: 0; transform: translateY(4px); } }
    .head { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 15px; margin-bottom: 4px; }
    .head svg { flex: none; }
    p { margin: 0 0 12px; color: #3d524b; }
    .row { display: flex; gap: 8px; }
    button {
      font: inherit; font-size: 14px; border-radius: 9px; padding: 8px 12px; cursor: pointer;
      border: 1px solid #b9cfc6; background: #fff; color: #1d2b27; flex: 1; position: relative; overflow: hidden;
    }
    button.primary { background: #2f6f5e; border-color: #2f6f5e; color: #fff; }
    button:focus-visible { outline: 3px solid #8cc7b4; outline-offset: 1px; }
    button .fill { position: absolute; inset: 0 auto 0 0; width: 0; background: rgba(255,255,255,.28); }
    button.holding .fill { width: 100%; transition: width var(--hold) linear; }
    .links { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
    .link {
      background: none; border: none; padding: 2px 0; text-align: left; color: #2f6f5e;
      text-decoration: underline; text-underline-offset: 2px; font-size: 13px; flex: none;
    }
    .bar {
      position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 12px;
      align-items: center; padding: 10px 12px 10px 16px; border-radius: 999px; background: #1f3a33; color: #fff;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); font-size: 14px; pointer-events: auto; white-space: nowrap;
    }
    .bar button { flex: none; background: #e6f2ed; color: #1d2b27; border: none; border-radius: 999px; padding: 6px 12px; }
    @media (prefers-color-scheme: dark) {
      .card { background: #1d2724; color: #e6efeb; border-color: #36504a; }
      p { color: #b9cbc4; }
      button { background: #24312d; color: #e6efeb; border-color: #4a655d; }
      button.primary { background: #4f9c86; border-color: #4f9c86; color: #0e1a17; }
      .link { color: #8fd0bb; }
    }
  `;

  function shieldIcon() {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    const body = doc.createElementNS(SVG_NS, 'path');
    body.setAttribute('fill', '#2f6f5e');
    body.setAttribute('d', 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3z');
    const tick = doc.createElementNS(SVG_NS, 'path');
    for (const [k, v] of Object.entries({ fill: 'none', stroke: '#fff', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', d: 'm8.5 12.2 2.4 2.4 4.8-5' })) tick.setAttribute(k, v);
    svg.append(body, tick);
    return svg;
  }

  function uiRoot() {
    if (ui?.host.isConnected) return ui.root;
    const host = doc.createElement('spider-block-ui');
    host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; pointer-events: none !important; display: block !important;';
    const root = host.attachShadow({ mode: 'closed' });
    // Constructed stylesheets are not affected by the page's style rules, but
    // Firefox content scripts cannot always adopt them; fall back to <style>.
    let styled = false;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(UI_CSS);
      root.adoptedStyleSheets = [sheet];
      styled = root.adoptedStyleSheets.length === 1;
    } catch {
      styled = false;
    }
    if (!styled) {
      const style = doc.createElement('style');
      style.textContent = UI_CSS;
      root.append(style);
    }
    html.append(host);
    ui = { host, root, panicBar: null };
    return root;
  }

  function make(tag, props = {}, children = []) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
      else node.setAttribute(k, v);
    }
    node.append(...children);
    return node;
  }

  const REASONS = {
    text: 'Words near this image mention spiders.',
    ai: 'Spider Block thinks this image shows a spider.',
    page: 'This page seems to be about spiders, so its images are hidden.',
    user: 'You chose to hide this image.',
    unscannable: "Spider Block couldn't check this image, so it stays covered.",
  };

  function openReveal(target, x, y) {
    closeReveal();
    const root = uiRoot();
    const kind = kindOf(target);
    const why = target.getAttribute(WHY) || 'ai';
    const url = urlOf.get(target) || sourceOf(target, kind);
    const link = target.closest?.('a[href]');

    const doReveal = () => {
      closeReveal();
      setState(target, kind, 'revealed', why);
    };

    const showButton = make('button', { class: 'primary', type: 'button' }, [make('span', { class: 'fill' }), make('span', { text: 'Show image' })]);
    if (settings.reveal === 'hold') {
      // Press and hold: a moment to change your mind.
      const HOLD_MS = 1500;
      showButton.lastChild.textContent = 'Hold to show';
      showButton.style.setProperty('--hold', `${HOLD_MS}ms`);
      let timer = null;
      const start = (e) => {
        if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
        if (e.type === 'keydown' && e.repeat) return;
        e.preventDefault();
        showButton.classList.add('holding');
        timer = setTimeout(doReveal, HOLD_MS);
      };
      const stop = () => {
        clearTimeout(timer);
        showButton.classList.remove('holding');
      };
      showButton.addEventListener('pointerdown', start);
      showButton.addEventListener('keydown', start);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'keyup', 'blur']) showButton.addEventListener(ev, stop);
    } else {
      showButton.addEventListener('click', doReveal);
    }

    const keepButton = make('button', { type: 'button', text: 'Keep hidden', on: { click: closeReveal } });
    const links = [];
    if (url) {
      links.push(
        make('button', {
          class: 'link',
          type: 'button',
          text: "Not a spider? Always show this image",
          on: {
            click: () => {
              closeReveal();
              setState(target, kind, 'ok');
              saveVerdict(url, 'allowed');
            },
          },
        }),
      );
    }
    if (why === 'page') {
      links.push(
        make('button', {
          class: 'link',
          type: 'button',
          text: 'Only hide images that look like spiders on this page',
          on: { click: () => (closeReveal(), setPageOverride(true)) },
        }),
      );
    }
    if (link) {
      links.push(
        make('button', {
          class: 'link',
          type: 'button',
          text: 'Open the link (the image stays hidden)',
          on: {
            click: () => {
              closeReveal();
              passThrough = true;
              link.click();
              passThrough = false;
            },
          },
        }),
      );
    }

    const card = make('div', { class: 'card', role: 'dialog', 'aria-label': 'Hidden image' }, [
      make('div', { class: 'head' }, []),
      make('p', { text: REASONS[why] || REASONS.ai }),
      make('div', { class: 'row' }, [keepButton, ...(settings.reveal === 'never' ? [] : [showButton])]),
      make('div', { class: 'links' }, links),
    ]);
    card.firstChild.append(shieldIcon(), 'Hidden by Spider Block');
    root.append(card);

    // Place next to the pointer, inside the viewport.
    if (!x && !y) {
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    card.style.left = `${Math.max(8, Math.min(x - w / 2, innerWidth - w - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(y + 12, innerHeight - h - 8))}px`;
    keepButton.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === 'Escape') closeReveal();
    };
    // The card lives in a closed shadow root, so outside listeners only see its host.
    const onOutside = (e) => {
      if (!e.composedPath().includes(ui.host)) closeReveal();
    };
    const startY = scrollY;
    const onScroll = () => {
      if (Math.abs(scrollY - startY) > 40) closeReveal();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onOutside, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    reveal = {
      card,
      cleanup() {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('scroll', onScroll);
      },
    };
  }

  function closeReveal() {
    if (!reveal) return;
    reveal.cleanup();
    reveal.card.remove();
    reveal = null;
  }

  function renderPanicBar() {
    if (!panic) {
      ui?.panicBar?.remove();
      if (ui) ui.panicBar = null;
      return;
    }
    const root = uiRoot();
    if (ui.panicBar) return;
    const bar = make('div', { class: 'bar', role: 'status' }, [
      make('span', { text: 'All images on this page are hidden' }),
      make('button', { type: 'button', text: 'Show them again', on: { click: () => send({ type: 'toggle-panic', on: false }) } }),
    ]);
    root.append(bar);
    ui.panicBar = bar;
  }

  function setPageOverride(on) {
    pageOverride = on;
    recheckAll((el) => (on ? el.getAttribute(WHY) === 'page' : true));
  }

  // ------------------------------------------------- clicks on hidden images

  let passThrough = false;
  const INTERACTIVE = 'button, input, select, textarea, [role="button"], [contenteditable]';

  function hiddenTarget(e) {
    const path = e.composedPath();
    const first = path[0];
    if (first?.nodeType === 1 && first.getAttribute(ATTR) === 'blocked') return first;
    if (first?.nodeType === 1 && first.closest(INTERACTIVE)) return null;
    // Many sites lay a transparent element over their images.
    if (e.clientX || e.clientY) {
      for (const node of doc.elementsFromPoint(e.clientX, e.clientY)) {
        if (node === ui?.host) continue;
        if (node.getAttribute(ATTR) === 'blocked' && node.getAttribute(KIND) !== 'bg') return node;
        const inner = node.shadowRoot?.elementsFromPoint?.(e.clientX, e.clientY) || [];
        for (const n of inner) if (n.getAttribute?.(ATTR) === 'blocked' && n.getAttribute(KIND) !== 'bg') return n;
      }
    }
    return null;
  }

  function onClick(e) {
    if (passThrough || !active || settings.reveal === 'never' || e.button !== 0) return;
    if (ui && e.composedPath().includes(ui.host)) return;
    const target = hiddenTarget(e);
    if (!target) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openReveal(target, e.clientX, e.clientY);
  }
  window.addEventListener('click', onClick, true);

  // Right-click menu: remember what was under the pointer.
  let lastContext = null;
  function onContextMenu(e) {
    lastContext = { x: e.clientX, y: e.clientY, node: e.composedPath()[0] };
  }
  doc.addEventListener('contextmenu', onContextMenu, true);

  function contextTarget(srcUrl) {
    const isCandidate = (n) => n?.nodeType === 1 && (n.matches(MEDIA) || n.hasAttribute(ATTR));
    if (isCandidate(lastContext?.node)) return lastContext.node;
    if (lastContext) {
      for (const n of doc.elementsFromPoint(lastContext.x, lastContext.y)) {
        if (n === ui?.host) continue;
        if (isCandidate(n)) return n;
        if (backgroundUrl(n)) return n;
      }
    }
    if (srcUrl) for (const n of queryAll(MEDIA)) if (sourceOf(n, kindOf(n)) === srcUrl) return n;
    return null;
  }

  function onMenu(action, srcUrl) {
    const target = contextTarget(srcUrl);
    if (!target) return;
    const kind = kindOf(target);
    const url = sourceOf(target, kind) || srcUrl;
    urlOf.set(target, url);
    if (action === 'hide') {
      block(target, kind, 'user');
      saveVerdict(url, 'blocked');
    } else {
      setState(target, kind, 'ok');
      saveVerdict(url, 'allowed');
    }
  }

  // --------------------------------------------------------------- messages

  function onMessage(msg, sender, sendResponse) {
    switch (msg?.type) {
      case 'get-state': {
        if (!isTop) return false;
        let blocked = 0;
        for (const _ of queryAll(`[${ATTR}="blocked"]`)) blocked++;
        sendResponse({
          status: ready ? Settings.status(settings, siteHost) : 'loading',
          host: siteHost,
          panic,
          pageSpidery: pageSpidery && settings.spiderPages,
          pageOverride,
          blocked,
        });
        return false;
      }
      case 'set-panic':
        setPanic(msg.on);
        sendResponse({ ok: true });
        return false;
      case 'page-override':
        setPageOverride(!!msg.on);
        sendResponse({ ok: true });
        return false;
      case 'menu':
        onMenu(msg.action, msg.srcUrl);
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  }
  api.runtime.onMessage.addListener(onMessage);
  api.storage.onChanged.addListener(onStorageChanged);
  const unwatchSettings = (() => {
    let stopped = false;
    Settings.onChange((next) => {
      if (!stopped && ready && !destroyed) applySettings(next);
    });
    return () => (stopped = true);
  })();

  // ---------------------------------------------------------------- lifecycle

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    // A pause ending later must not re-apply this copy's (stale) settings to the page.
    clearTimeout(pauseTimer);
    observer.disconnect();
    visibility?.disconnect();
    unwatchSettings();
    doc.removeEventListener('load', onMediaEvent, true);
    doc.removeEventListener('error', onMediaEvent, true);
    doc.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('click', onClick, true);
    try {
      api.runtime.onMessage.removeListener(onMessage);
      api.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      // the extension context is already gone
    }
    // Never leave images invisible; hidden spiders stay hidden.
    html.removeAttribute(SHIELD);
    for (const node of [...queryAll(`[${ATTR}="pending"]`)]) clearState(node);
    closeReveal();
    ui?.host.remove();
  }

  globalThis.__spiderBlock = { alive, destroy };

  async function start() {
    let loaded = Settings.DEFAULTS;
    try {
      const [s, local] = await Promise.all([Settings.load(), api.storage.local.get('userVerdicts')]);
      loaded = s;
      userVerdicts = normalizeVerdicts(local.userVerdicts);
      siteHost = await topSiteHost();
    } catch (err) {
      console.debug('Spider Block: using default settings', err);
    }
    if (destroyed) return;
    ready = true;
    applySettings(loaded);
    reportCount(isTop);
    if (active && settings.useAI) send({ type: 'warm-up' }, 5000);
  }

  doc.addEventListener('DOMContentLoaded', () => ready && active && evaluatePage(), { once: true });
  window.addEventListener('load', () => ready && active && evaluatePage(), { once: true });
  start();
})();
