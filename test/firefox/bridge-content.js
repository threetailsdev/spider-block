// Test-only, never shipped: relays window.postMessage({ sbTest }) from a test
// page to bridge-background.js and posts the answer back. Each command uses its
// own port, so an idle background is still free to stop between commands.
(function () {
  'use strict';
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data?.sbTest) return;
    const port = browser.runtime.connect({ name: 'sb-test' });
    port.onMessage.addListener((reply) => {
      port.disconnect();
      window.postMessage({ sbTestReply: reply }, '*');
    });
    port.postMessage(e.data.sbTest);
  });
})();
