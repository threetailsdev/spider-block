// Settings page. Every control with data-key="<setting>" is saved as soon as it changes.
(async () => {
  'use strict';

  const api = globalThis.sbApi;
  const Settings = globalThis.SpiderBlockSettings;
  const $ = (id) => document.getElementById(id);

  const SENSITIVITY_HELP = {
    relaxed: 'Only hides images when the scan is quite sure. Fewer harmless pictures get hidden, but more spiders can slip through.',
    balanced: 'A good middle ground. Also looks closely at the corners of large photos for small spiders.',
    strict: 'Hides anything that might be a spider. Expect some harmless insects and objects to be hidden too.',
  };

  let settings = await Settings.load();

  let toastTimer = null;
  function toast(text = 'Saved') {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  async function save(partial) {
    await Settings.save(partial);
    toast();
  }

  function wordList(text) {
    return [...new Set(text.split(/[\n,]+/).map((w) => w.trim()).filter(Boolean))].slice(0, 200);
  }

  // ------------------------------------------------------------ bound controls

  function fill() {
    for (const control of document.querySelectorAll('[data-key]')) {
      const value = settings[control.dataset.key];
      if (control.type === 'checkbox') control.checked = !!value;
      else if (control.type === 'radio') control.checked = control.value === value;
      else if (control.tagName === 'TEXTAREA') {
        if (document.activeElement !== control) control.value = value.join('\n');
      } else control.value = value;
    }
    $('master-label').textContent = settings.enabled ? 'Protection on' : 'Protection off';
    $('sensitivity-help').textContent = SENSITIVITY_HELP[settings.sensitivity];
    $('sensitivity').disabled = !settings.useAI;
    renderSites();
  }

  for (const control of document.querySelectorAll('[data-key]')) {
    const key = control.dataset.key;
    if (control.tagName === 'TEXTAREA') {
      let timer = null;
      const commit = () => {
        clearTimeout(timer);
        const words = wordList(control.value);
        if (JSON.stringify(words) !== JSON.stringify(settings[key])) save({ [key]: words });
      };
      control.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(commit, 800);
      });
      control.addEventListener('change', commit);
    } else {
      control.addEventListener('change', () => {
        if (control.type === 'radio' && !control.checked) return;
        save({ [key]: control.type === 'checkbox' ? control.checked : control.value });
      });
    }
  }

  // ------------------------------------------------------------------- sites

  function renderSites() {
    const list = $('sites');
    list.replaceChildren();
    if (!settings.disabledSites.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'None. Spider Block protects every site.';
      list.append(empty);
      return;
    }
    for (const site of settings.disabledSites) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = site;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Protect again';
      remove.addEventListener('click', () => save({ disabledSites: settings.disabledSites.filter((s) => s !== site) }));
      item.append(name, remove);
      list.append(item);
    }
  }

  $('add-site').addEventListener('submit', (e) => {
    e.preventDefault();
    const host = Settings.normalizeHost($('site-input').value);
    if (!host || !host.includes('.')) {
      toast('Enter a website like example.com');
      return;
    }
    $('site-input').value = '';
    if (!settings.disabledSites.includes(host)) save({ disabledSites: [...settings.disabledSites, host] });
  });

  // ------------------------------------------------------------- corrections

  async function renderCorrections() {
    const { userVerdicts } = await api.storage.local.get('userVerdicts');
    const hidden = Object.keys(userVerdicts?.blocked || {}).length;
    const shown = Object.keys(userVerdicts?.allowed || {}).length;
    $('corrections-text').textContent =
      hidden || shown
        ? `You've hidden ${hidden} image${hidden === 1 ? '' : 's'} and marked ${shown} as not spiders.`
        : 'No corrections yet.';
    $('clear-corrections').disabled = !hidden && !shown;
  }

  $('clear-corrections').addEventListener('click', async () => {
    if (!confirm('Forget every image you hid or marked as not a spider?')) return;
    await api.storage.local.set({ userVerdicts: { blocked: {}, allowed: {} } });
    renderCorrections();
    toast('Corrections cleared');
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.userVerdicts) renderCorrections();
  });

  // ----------------------------------------------------------------- details

  async function showEngine() {
    try {
      const info = await api.runtime.sendMessage({ type: 'engine-info' });
      $('engine').textContent = info?.ok
        ? info.backend === 'wasm'
          ? 'Status: ready.'
          : 'Status: ready (slower mode; this browser blocks WebAssembly for extensions).'
        : `Status: not available (${info?.error || 'unknown error'}).`;
    } catch {
      $('engine').textContent = '';
    }
  }

  if (!(typeof Highlight === 'function' && globalThis.CSS?.highlights)) {
    $('redact-help').textContent += ' This browser does not support it yet.';
  }

  try {
    const commands = (await api.commands?.getAll()) || [];
    const shortcut = commands.find((c) => c.name === 'hide-all-images')?.shortcut;
    $('shortcut').textContent = shortcut || 'not set';
  } catch {
    // no keyboard shortcuts on this platform
  }

  $('version').textContent = api.runtime.getManifest().version;

  if (Settings.DONATE_URL) {
    $('donate-link').href = Settings.DONATE_URL;
    $('donate').hidden = false;
  }

  Settings.onChange((next) => {
    settings = next;
    fill();
  });
  fill();
  renderCorrections();
  showEngine();
})();
