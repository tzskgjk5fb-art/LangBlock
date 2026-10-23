// Settings page and popup. Both pages share this script; elements that a page
// doesn't have are simply skipped.
(function () {
  "use strict";

  const LB = globalThis.LangBlock;
  const { api } = LB.storage;
  const $ = (id) => document.getElementById(id);
  const isPopup = document.body.classList.contains("page-popup");

  let settings = LB.sanitizeSettings(null);

  const sortedLanguages = [...LB.LANGUAGES].sort((a, b) => a.name.localeCompare(b.name));

  async function save() {
    settings = await LB.storage.saveSettings(settings);
    render();
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
    for (const code of settings.blocked) {
      const chip = el("span", { className: "chip" });
      chip.append(el("span", {}, LB.languageName(code)));
      const remove = el("button", { type: "button", className: "chip-x", title: "Stop blocking" }, "×");
      remove.setAttribute("aria-label", `Stop blocking ${LB.languageName(code)}`);
      remove.addEventListener("click", () => {
        settings.blocked = settings.blocked.filter((c) => c !== code);
        save();
      });
      chip.append(remove);
      chips.append(chip);
    }
    $("no-langs").hidden = settings.blocked.length > 0;
  }

  function renderList() {
    const list = $("lang-list");
    const q = $("lang-search").value.trim().toLowerCase();
    list.replaceChildren();
    const showAll = !isPopup || q || settings.blocked.length === 0;
    list.hidden = !showAll;
    if (!showAll) return;
    const blocked = new Set(settings.blocked);
    // Names that start with the query come first ("hin" -> Hindi before Chinese).
    const rank = (l) => (!q || l.code === q || l.name.toLowerCase().startsWith(q) ? 0 : 1);
    const matches = sortedLanguages
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.code === q)
      .sort((a, b) => rank(a) - rank(b));
    for (const lang of matches) {
      const li = el("li");
      const label = el("label", { className: "row" });
      const box = el("input", { type: "checkbox", checked: blocked.has(lang.code) });
      box.addEventListener("change", () => {
        const set = new Set(settings.blocked);
        if (box.checked) set.add(lang.code);
        else set.delete(lang.code);
        settings.blocked = [...set];
        save();
      });
      label.append(box, el("span", {}, lang.name), el("small", { className: "code" }, lang.code));
      li.append(label);
      list.append(li);
    }
    if (matches.length === 0) list.append(el("li", { className: "hint" }, "No matching language."));
  }

  function render() {
    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("is-off", !settings.enabled);
    renderChips();
    renderList();
    for (const box of document.querySelectorAll("[data-surface]")) {
      box.checked = !!settings.surfaces[box.dataset.surface];
    }
    for (const key of ["deepCheck", "blockDubbed", "hideUntilChecked"]) {
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
    for (const box of document.querySelectorAll("[data-surface]")) {
      box.addEventListener("change", () => {
        settings.surfaces = { ...settings.surfaces, [box.dataset.surface]: box.checked };
        save();
      });
    }
    for (const key of ["deepCheck", "blockDubbed", "hideUntilChecked"]) {
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
        const n = await LB.storage.clearCache();
        $("cache-msg").textContent = ` Forgot ${n} videos.`;
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
      status.textContent = "LangBlock is off.";
      return;
    }
    if (settings.blocked.length === 0) {
      status.textContent = "Pick a language below to start.";
      return;
    }
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      const stats = tab && (await api.tabs.sendMessage(tab.id, { type: "langblock:stats" }));
      if (!stats) throw new Error("no stats");
      if (!stats.active) status.textContent = "Not filtering on this page (see All settings).";
      else {
        const n = stats.hidden;
        status.textContent = `${n} video${n === 1 ? "" : "s"} hidden on this page` +
          (stats.pending ? `, ${stats.pending} still being checked.` : ".");
      }
    } catch {
      status.textContent = "Open YouTube and LangBlock filters it automatically.";
    }
  }

  async function init() {
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
