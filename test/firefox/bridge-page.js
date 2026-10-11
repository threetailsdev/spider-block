// Test-only, never shipped: loaded first by each extension page in the test copy,
// so bridge-background.js can report the page's errors.
window.sbTestErrors = [];
addEventListener('error', (e) => window.sbTestErrors.push(e.message));
addEventListener('unhandledrejection', (e) => window.sbTestErrors.push(String(e.reason?.message || e.reason)));
{
  const original = console.error.bind(console);
  console.error = (...args) => {
    window.sbTestErrors.push(args.map(String).join(' '));
    original(...args);
  };
}
