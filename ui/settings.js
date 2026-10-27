// Settings page and popup. Both pages share this script; elements that a page
// doesn't have are simply skipped.
(function () {
  "use strict";

  const LB = globalThis.LangBlock;
  const { api } = LB.storage;
  const $ = (id) => document.getElementById(id);
  const isPopup = document.body.classList.contains("page-popup");

  const t = LB.t;

  let settings = LB.sanitizeSettings(null);

  // Lower case without accents, so "espanol" finds "español".
  const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const capitalize = (text) => text.charAt(0).toLocaleUpperCase(LB.UI_LOCALE) + text.slice(1);

  // Names in the user's language for display, and every name a language
  // can be searched by.
  const sortedLanguages = LB.LANGUAGES.map((l) => {
    const local = capitalize(LB.localName(l.code));
    return { code: l.code, name: local, search: [local, l.name].map(fold) };
  }).sort((a, b) => a.name.localeCompare(b.name, LB.UI_LOCALE));
  const displayName = (code) => {
    const lang = sortedLanguages.find((l) => l.code === code);
    return lang ? lang.name : LB.languageName(code);
  };
  // More chips than this would fill the page, so a summary is shown instead.
  const MAX_CHIPS = 12;

  // The browser's own language, which "Block all" leaves unblocked.
  const ownLanguage = (() => {
    let ui = "";
    try {
      ui = api.i18n.getUILanguage();
    } catch {
      ui = "";
    }
    for (const tag of [ui, ...(navigator.languages || []), navigator.language]) {
      const code = LB.normalizeCode(tag);
      if (code && LB.LANGUAGE_BY_CODE[code]) return code;
    }
    return null;
  })();
  const allButOwn = sortedLanguages.map((l) => l.code).filter((c) => c !== ownLanguage);

  let undo = null; // blocked list from before the last "Block all"/"Unblock all"

  async function save() {
    settings = await LB.storage.saveSettings(settings);
    render();
  }

  // Individual picks replace the bulk action's Undo.
  function setBlocked(codes) {
    undo = null;
    settings.blocked = codes;
    save();
  }

  function bulkSet(codes, message) {
    undo = { blocked: settings.blocked.slice(), message };
    settings.blocked = codes;
    save();
  }

  function localize() {
    document.documentElement.lang = (t("@@ui_locale") || "en").replace("_", "-");
    document.documentElement.dir = t("@@bidi_dir") === "rtl" ? "rtl" : "ltr";
    for (const node of document.querySelectorAll("[data-i18n]")) {
      node.textContent = t(node.dataset.i18n);
    }
    for (const attr of ["placeholder", "title", "aria-label"]) {
      for (const node of document.querySelectorAll(`[data-i18n-${attr}]`)) {
        node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
      }
    }
  }

  function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderChips() {
    const chips = $("chips");
    chips.replaceChildren();
    if (settings.blocked.length > MAX_CHIPS) {
      const blocked = new Set(settings.blocked);
      const open = sortedLanguages.filter((l) => !blocked.has(l.code)).map((l) => l.name);
      const counts = [String(blocked.size), String(sortedLanguages.length)];
      const text = open.length > 0 && open.length <= 5
        ? t("blockingSummaryExcept", [...counts, open.join(", ")])
        : t("blockingSummary", counts);
      chips.append(el("span", { className: "summary" }, text));
      $("no-langs").hidden = true;
      return;
    }
    for (const code of settings.blocked) {
      const chip = el("span", { className: "chip" });
      chip.append(el("span", {}, displayName(code)));
      const remove = el("button", { type: "button", className: "chip-x", title: t("stopBlocking", [displayName(code)]) }, "×");
      remove.setAttribute("aria-label", t("stopBlocking", [displayName(code)]));
      remove.addEventListener("click", () => setBlocked(settings.blocked.filter((c) => c !== code)));
      chip.append(remove);
      chips.append(chip);
    }
    $("no-langs").hidden = settings.blocked.length > 0;
  }

  function renderList() {
    const list = $("lang-list");
    const q = fold($("lang-search").value.trim());
    list.replaceChildren();
    const showAll = !isPopup || q || settings.blocked.length === 0;
    list.hidden = !showAll;
    if (!showAll) return;
    const blocked = new Set(settings.blocked);
    // Names that start with the query come first ("hin" -> Hindi before Chinese).
    const rank = (l) => (!q || l.code === q || l.search.some((n) => n.startsWith(q)) ? 0 : 1);
    const matches = sortedLanguages
      .filter((l) => !q || l.code === q || l.search.some((n) => n.includes(q)))
      .sort((a, b) => rank(a) - rank(b));
    for (const lang of matches) {
      const li = el("li");
      const label = el("label", { className: "row" });
      const box = el("input", { type: "checkbox", checked: blocked.has(lang.code) });
      box.addEventListener("change", () => {
        const set = new Set(settings.blocked);
        if (box.checked) set.add(lang.code);
        else set.delete(lang.code);
        setBlocked([...set]);
      });
      label.append(box, el("span", {}, lang.name), el("small", { className: "code" }, lang.code));
      li.append(label);
      list.append(li);
    }
    if (matches.length === 0) list.append(el("li", { className: "hint" }, t("noMatch")));
  }

  function renderBulk() {
    const blocked = new Set(settings.blocked);
    const blockAll = $("block-all");
    if (ownLanguage) {
      blockAll.hidden = false;
      blockAll.textContent = t("blockAllExcept", [LB.localName(ownLanguage)]);
      blockAll.disabled = blocked.size === allButOwn.length && allButOwn.every((c) => blocked.has(c));
    }
    $("unblock-all").disabled = blocked.size === 0;

    const msg = $("bulk-msg");
    msg.replaceChildren();
    msg.hidden = !undo;
    if (!undo) return;
    const back = el("button", { type: "button", className: "link" }, t("undo"));
    back.addEventListener("click", () => setBlocked(undo.blocked));
    msg.append(undo.message, back);
  }

  function render() {
    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("is-off", !settings.enabled);
    renderChips();
    renderBulk();
    renderList();
    for (const box of document.querySelectorAll("[data-surface]")) {
      box.checked = !!settings.surfaces[box.dataset.surface];
    }
    for (const key of ["deepCheck", "blockDubbed", "hideUntilChecked", "debug"]) {
      if ($(key)) $(key).checked = settings[key];
    }
    for (const radio of document.querySelectorAll('input[name="action"]')) {
      radio.checked = radio.value === settings.action;
    }
  }

  function bind() {
    $("enabled").addEventListener("change", (e) => {
      settings.enabled = e.target.checked;
      save();
    });
    $("lang-search").addEventListener("input", renderList);
    $("block-all").addEventListener("click", () =>
      bulkSet(allButOwn, t("blockedAllMsg", [LB.localName(ownLanguage)]))
    );
    $("unblock-all").addEventListener("click", () => bulkSet([], t("unblockedAllMsg")));
    for (const box of document.querySelectorAll("[data-surface]")) {
      box.addEventListener("change", () => {
        settings.surfaces = { ...settings.surfaces, [box.dataset.surface]: box.checked };
        save();
      });
    }
    for (const key of ["deepCheck", "blockDubbed", "hideUntilChecked", "debug"]) {
      if (!$(key)) continue;
      $(key).addEventListener("change", (e) => {
        settings[key] = e.target.checked;
        save();
      });
    }
    for (const radio of document.querySelectorAll('input[name="action"]')) {
      radio.addEventListener("change", () => {
        if (radio.checked) {
          settings.action = radio.value;
          save();
        }
      });
    }
    if ($("clear-cache")) {
      $("clear-cache").addEventListener("click", async () => {
        await LB.storage.clearCache();
        $("cache-msg").textContent = " " + t("cacheCleared");
        refreshCacheCount();
      });
    }
    if ($("open-options")) {
      $("open-options").addEventListener("click", () => {
        api.runtime.openOptionsPage();
        window.close();
      });
    }
  }

  async function refreshCacheCount() {
    if ($("cache-count")) $("cache-count").textContent = String(await LB.storage.cacheSize());
  }

  function setupDonate() {
    const link = $("donate");
    if (!link) return;
    let url = null;
    try {
      url = LB.DONATION_URL ? new URL(LB.DONATION_URL) : null;
    } catch {
      url = null;
    }
    if (url && url.protocol === "https:") {
      link.href = url.href;
      link.hidden = false;
    }
  }

  // Popup only: ask the YouTube tab how many videos it has hidden.
  async function showStatus() {
    const status = $("status");
    if (!status) return;
    if (!settings.enabled) {
      status.textContent = t("statusOff");
      return;
    }
    if (settings.blocked.length === 0) {
      status.textContent = t("statusPick");
      return;
    }
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const stats = tab && (await api.tabs.sendMessage(tab.id, { type: "langblock:stats" }));
      if (!stats) throw new Error("no stats");
      if (!stats.active) status.textContent = t("statusInactive");
      else {
        status.textContent = t("statusHidden", [String(stats.hidden)]) +
          (stats.pending ? " · " + t("statusPending", [String(stats.pending)]) : "");
      }
    } catch {
      status.textContent = t("statusOpenYoutube");
    }
  }

  async function init() {
    localize();
    settings = await LB.storage.loadSettings();
    bind();
    render();
    setupDonate();
    refreshCacheCount();
    showStatus();
    if ($("version")) $("version").textContent = "v" + api.runtime.getManifest().version;
    LB.storage.onSettingsChanged((next) => {
      settings = next;
      render();
    });
  }

  init();
})();
