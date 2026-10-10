// First-run page: style choice, permission check and tips.
(async () => {
  'use strict';

  const api = globalThis.sbApi;
  const Settings = globalThis.SpiderBlockSettings;
  const $ = (id) => document.getElementById(id);
  const isSafari = api.runtime.getURL('').startsWith('safari-web-extension:');

  const settings = await Settings.load();
  for (const radio of document.querySelectorAll('input[name="style"]')) {
    radio.checked = radio.value === settings.style;
    radio.addEventListener('change', () => radio.checked && Settings.save({ style: radio.value }));
  }

  // Firefox and Safari may install extensions without access to websites.
  async function checkPermission() {
    let granted = true;
    try {
      granted = await api.permissions.contains({ origins: ['<all_urls>'] });
    } catch {
      // assume granted where the API is missing
    }
    $('permission').hidden = granted || isSafari;
    $('safari-permission').hidden = granted || !isSafari;
  }
  $('grant').addEventListener('click', async () => {
    await api.permissions.request({ origins: ['<all_urls>'] }).catch(() => {});
    checkPermission();
  });
  checkPermission();

  try {
    const commands = (await api.commands?.getAll()) || [];
    const shortcut = commands.find((c) => c.name === 'hide-all-images')?.shortcut;
    if (shortcut) $('shortcut').textContent = shortcut;
  } catch {
    // no keyboard shortcuts on this platform
  }

  $('settings').addEventListener('click', () => api.runtime.openOptionsPage());
  $('done').addEventListener('click', async () => {
    const tab = await api.tabs.getCurrent();
    if (tab?.id !== undefined) api.tabs.remove(tab.id);
    else window.close();
  });
})();
