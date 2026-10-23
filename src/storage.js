// Small wrapper over the extension storage API, shared by the content script
// and the settings page. Settings live in storage.sync (so they follow the
// user between their own devices when the browser supports it) and fall back
// to storage.local. The per-video language cache only ever lives in
// storage.local, on this device.
(function (root) {
  "use strict";

  const LB = root.LangBlock;
  const api = root.browser || root.chrome;

  const SETTINGS_KEY = "settings";
  const CACHE_CLEARED_KEY = "cacheClearedAt";
  const CACHE_PREFIX = "v:";

  function syncArea() {
    try {
      if (api.storage.sync) return api.storage.sync;
    } catch {
      /* some browsers throw when sync is unavailable */
    }
    return api.storage.local;
  }

  async function loadSettings() {
    let raw;
    try {
      raw = (await syncArea().get(SETTINGS_KEY))[SETTINGS_KEY];
    } catch {
      raw = undefined;
    }
    if (raw === undefined) {
      try {
        raw = (await api.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
      } catch {
        raw = undefined;
      }
    }
    return LB.sanitizeSettings(raw);
  }

  async function saveSettings(settings) {
    const clean = LB.sanitizeSettings(settings);
    try {
      await syncArea().set({ [SETTINGS_KEY]: clean });
    } catch {
      await api.storage.local.set({ [SETTINGS_KEY]: clean });
    }
    return clean;
  }

  function onSettingsChanged(callback) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" && area !== "local") return;
      if (changes[SETTINGS_KEY]) callback(LB.sanitizeSettings(changes[SETTINGS_KEY].newValue));
    });
  }

  async function clearCache() {
    const all = await api.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
    if (keys.length) await api.storage.local.remove(keys);
    await api.storage.local.set({ [CACHE_CLEARED_KEY]: Date.now() });
    return keys.length;
  }

  async function cacheSize() {
    const all = await api.storage.local.get(null);
    return Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX)).length;
  }

  LB.storage = {
    api,
    SETTINGS_KEY,
    CACHE_CLEARED_KEY,
    CACHE_PREFIX,
    loadSettings,
    saveSettings,
    onSettingsChanged,
    clearCache,
    cacheSize,
  };
})(globalThis);
