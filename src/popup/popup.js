// Toolbar popup: what is happening on this page, and quick controls.
(async () => {
  'use strict';

  const api = globalThis.sbApi;
  const Settings = globalThis.SpiderBlockSettings;
  const $ = (id) => document.getElementById(id);

  let settings = await Settings.load();
  // ?tab=<id> shows the popup for a given tab (used to take screenshots).
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = forced ? [await api.tabs.get(forced)] : await api.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try {
    const url = new URL(tab?.url || '');
    if (/^https?:$/.test(url.protocol)) host = Settings.normalizeHost(url.hostname);
  } catch {
    // browser pages have no usable URL
  }

  async function pageState() {
    if (tab?.id === undefined) return null;
    try {
      return await api.tabs.sendMessage(tab.id, { type: 'get-state' }, { frameId: 0 });
    } catch {
      return null;
    }
  }

  async function hiddenCount(fallback) {
    try {
      const { count } = await api.runtime.sendMessage({ type: 'tab-count', tabId: tab.id });
      return Math.max(count || 0, fallback || 0);
    } catch {
      return fallback || 0;
    }
  }

  async function hasSiteAccess() {
    try {
      return await api.permissions.contains({ origins: ['<all_urls>'] });
    } catch {
      return true;
    }
  }

  function show(id, visible) {
    $(id).hidden = !visible;
  }

  async function render() {
    const state = await pageState();
    const status = state?.status && state.status !== 'loading' ? state.status : Settings.status(settings, host);
    $('enabled').checked = settings.enabled;
    show('page-override', false);
    show('resume', false);
    $('detail').textContent = '';
    $('panic').disabled = !state;
    $('site-toggle').disabled = !host || !state;
    show('site-toggle', status !== 'site');
    $('site-toggle').textContent = host ? `Turn off on ${host}` : 'Turn off on this site';
    $('panic').textContent = state?.panic ? 'Show images again' : 'Hide all images on this page';

    if (!state) {
      if (!(await hasSiteAccess())) {
        $('headline').textContent = 'Spider Block needs permission to protect websites.';
        $('detail').textContent = 'Your browser asks before extensions can see web pages.';
        $('resume').textContent = 'Allow on all websites';
        $('resume').dataset.action = 'grant';
        show('resume', true);
      } else {
        $('headline').textContent = "Spider Block can't run on this page.";
        $('detail').textContent = host
          ? 'Reload the page to start protecting it.'
          : tab?.url?.startsWith('file:')
            ? 'This is a file on your computer. Firefox does not let extensions into these; in Chrome or Edge, turn on "Allow access to file URLs" in the extension\'s details.'
            : 'Browser pages and extension stores are off-limits to all extensions.';
      }
      return;
    }

    if (status === 'off') {
      $('headline').textContent = 'Spider Block is off.';
      $('resume').textContent = 'Turn protection back on';
      $('resume').dataset.action = 'enable';
      show('resume', true);
    } else if (status === 'paused') {
      const until = new Date(settings.pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      $('headline').textContent = `Paused until ${until}.`;
      $('resume').textContent = 'Resume now';
      $('resume').dataset.action = 'unpause';
      show('resume', true);
    } else if (status === 'site') {
      $('headline').textContent = `Off on ${host}.`;
      $('resume').textContent = `Protect ${host} again`;
      $('resume').dataset.action = 'site-on';
      show('resume', true);
    } else if (state.pageSpidery && !state.pageOverride) {
      $('headline').textContent = 'This page seems to be about spiders.';
      $('detail').textContent = 'All of its images are hidden. Click one to see your options.';
      show('page-override', true);
    } else {
      const count = await hiddenCount(state.blocked);
      $('headline').textContent =
        count === 0 ? 'No spider images found here.' : `${count} image${count === 1 ? '' : 's'} hidden on this page.`;
      $('detail').textContent = `Protecting ${host}`;
    }
  }

  $('enabled').addEventListener('change', async (e) => {
    await Settings.save({ enabled: e.target.checked });
  });

  $('panic').addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: 'toggle-panic', tabId: tab.id });
    render();
  });

  $('site-toggle').addEventListener('click', async () => {
    if (!host) return;
    await Settings.save({ disabledSites: [...new Set([...settings.disabledSites, host])] });
  });

  for (const button of document.querySelectorAll('[data-pause]')) {
    button.addEventListener('click', async () => {
      await Settings.save({ pausedUntil: Date.now() + Number(button.dataset.pause) * 60000 });
    });
  }

  $('page-override').addEventListener('click', async () => {
    await api.tabs.sendMessage(tab.id, { type: 'page-override', on: true }).catch(() => {});
    render();
  });

  $('resume').addEventListener('click', async () => {
    switch ($('resume').dataset.action) {
      case 'enable':
        await Settings.save({ enabled: true });
        break;
      case 'unpause':
        await Settings.save({ pausedUntil: 0 });
        break;
      case 'site-on':
        await Settings.save({ disabledSites: settings.disabledSites.filter((s) => !Settings.siteListed([s], host)) });
        break;
      case 'grant':
        await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => {});
        render();
        break;
    }
  });

  $('open-options').addEventListener('click', (e) => {
    e.preventDefault();
    api.runtime.openOptionsPage();
    window.close();
  });

  try {
    const commands = (await api.commands?.getAll()) || [];
    const shortcut = commands.find((c) => c.name === 'hide-all-images')?.shortcut;
    if (shortcut) $('shortcut').textContent = `Hide all: ${shortcut}`;
  } catch {
    // shortcuts are not available everywhere (e.g. Firefox for Android)
  }

  Settings.onChange((next) => {
    settings = next;
    // Give the page a moment to apply the change before asking it again.
    setTimeout(render, 150);
  });
  render();
})();
