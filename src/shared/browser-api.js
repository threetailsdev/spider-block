// One handle for the WebExtension APIs in every browser. Firefox and Safari expose
// the promise-based `browser` namespace; Chrome and Edge expose `chrome`, whose
// Manifest V3 methods also return promises when no callback is passed.
globalThis.sbApi = globalThis.browser ?? globalThis.chrome;
