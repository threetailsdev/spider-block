// Test-only, never shipped: lets the Firefox end-to-end tests reach the
// extension's APIs. WebDriver may not open moz-extension:// pages, so a test page
// talks to this through bridge-content.js instead.
(function () {
  'use strict';
  const logs = [];
  // Changes each time Firefox starts the background again after stopping it.
  const runId = Math.random();
  // When each run started, kept while the browser runs.
  const starts = browser.storage.session
    .get('sbTestStarts')
    .then(({ sbTestStarts = [] }) => browser.storage.session.set({ sbTestStarts: [...sbTestStarts, Date.now()] }));
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      logs.push(`${level}: ${args.map((a) => a?.stack || String(a)).join(' ')}`);
      original(...args);
    };
  }
  self.addEventListener('error', (e) => logs.push(`error: ${e.message}`));
  self.addEventListener('unhandledrejection', (e) => logs.push(`rejection: ${e.reason?.stack || e.reason}`));

  const commands = {
    set: (args) => browser.storage.sync.set(args),
    get: () => browser.storage.sync.get(null),
    reset: async () => {
      await browser.storage.sync.clear();
      await browser.storage.local.clear();
    },
    'tab-message': (args, tabId) => browser.tabs.sendMessage(tabId, args.msg, args.options),
    badge: (args, tabId) => browser.action.getBadgeText({ tabId }),
    title: () => browser.action.getTitle({}),
    tabs: async () => (await browser.tabs.query({})).map((t) => t.url),
    open: async (args) => (await browser.tabs.create({ url: browser.runtime.getURL(args.path) })).id,
    logs: () => logs.splice(0),
    'run-id': () => runId,
    starts: async () => {
      await starts;
      return (await browser.storage.session.get('sbTestStarts')).sbTestStarts;
    },
    // Extension pages open in tabs, by path such as "options/options.html".
    views: () => browser.extension.getViews({ type: 'tab' }).map((w) => ({ path: pathOf(w), errors: w.sbTestErrors })),
    click: (args) => view(args.path).document.querySelector(args.selector).click(),
    text: (args) => view(args.path).document.querySelector(args.selector)?.textContent,
    close: (args) => view(args.path).close(),
  };

  const pathOf = (w) => w.location.pathname.slice(1);
  function view(path) {
    const found = browser.extension.getViews({ type: 'tab' }).find((w) => pathOf(w) === path);
    if (!found) throw new Error(`${path} is not open`);
    return found;
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'sb-test') return;
    port.onMessage.addListener(async ({ id, cmd, args }) => {
      try {
        port.postMessage({ id, value: await commands[cmd](args || {}, port.sender.tab.id) });
      } catch (err) {
        port.postMessage({ id, error: String(err?.message || err) });
      }
    });
  });
})();
