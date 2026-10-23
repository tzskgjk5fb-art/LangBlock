// Opens the settings page once, right after install, so the user can pick
// which languages to block. LangBlock does nothing until they do.
(function () {
  "use strict";
  const api = globalThis.browser || globalThis.chrome;
  api.runtime.onInstalled.addListener((details) => {
    if (details && details.reason === "install") api.runtime.openOptionsPage();
  });
})();
