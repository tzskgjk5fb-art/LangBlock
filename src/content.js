// Content script for youtube.com. Finds video cards, works out their language
// and hides the ones in a blocked language. Everything runs on this device;
// the only network requests are to YouTube itself, for the watch page of a
// video LangBlock hasn't seen before (see fetchSignals).
(function () {
  "use strict";

  const LB = globalThis.LangBlock;
  const { api } = LB.storage;

  // -------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------

  // Known video card elements. Outer wrappers come first so a grid cell is
  // hidden as a whole rather than leaving an empty gap.
  const OUTER_CARDS = ["ytd-rich-item-renderer", "ytm-rich-item-renderer"];
  const CARDS = [
    ...OUTER_CARDS,
    // desktop
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-reel-item-renderer",
    "ytd-movie-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    // mobile (m.youtube.com)
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "ytm-video-card-renderer",
    "ytm-reel-item-renderer",
    "ytm-media-item",
  ];
  const CARD_SELECTOR = CARDS.join(",");
  const OUTER_SELECTOR = OUTER_CARDS.join(",");
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"]';

  // Areas whose links are never video cards we should hide.
  const IGNORE_SELECTOR = [
    "#movie_player",
    "ytd-player",
    "ytd-watch-metadata",
    "ytd-comments",
    "#comments",
    "ytd-playlist-panel-renderer",
    "ytd-engagement-panel-section-list-renderer",
    "ytd-guide-renderer",
    "tp-yt-app-drawer",
    "ytd-miniplayer",
    "ytm-slim-video-metadata-section-renderer",
    "ytm-comment-section-renderer",
  ].join(",");

  const TITLE_SELECTOR = [
    "#video-title",
    "#video-title-link",
    ".yt-lockup-metadata-view-model__title",
    ".yt-lockup-metadata-view-model-wiz__title",
    ".shortsLockupViewModelHostMetadataTitle",
    ".media-item-headline",
    ".compact-media-item-headline",
    "h3",
    "h4",
  ].join(",");
  const CHANNEL_SELECTOR = [
    "ytd-channel-name #text",
    "#channel-name #text",
    ".yt-content-metadata-view-model__metadata-text",
    ".yt-content-metadata-view-model-wiz__metadata-text",
    ".media-item-byline",
  ].join(",");
  const SNIPPET_SELECTOR = ".metadata-snippet-text, #description-text, .metadata-snippet-container";

  const CACHE_TTL_KNOWN = 60 * 24 * 3600 * 1000; // 60 days: a video's language doesn't change
  const CACHE_TTL_UNKNOWN = 3 * 24 * 3600 * 1000; // 3 days: captions may appear later
  const MAX_CONCURRENT = 2;
  const FETCH_TIMEOUT_MS = 15000;
  const MAX_HTML_BYTES = 4 * 1024 * 1024;

  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------

  let settings = LB.sanitizeSettings(null);
  let blocked = new Set();
  const signals = new Map(); // videoId -> cached language signals
  const tokens = new WeakMap(); // card -> evaluation counter, to drop stale async results
  const queue = []; // video ids waiting for a deep check
  const queued = new Set();
  const inFlight = new Set();
  const failed = new Set(); // ids that errored this page load; not retried until reload
  let pausedUntil = 0;

  // -------------------------------------------------------------------
  // Language detection helpers
  // -------------------------------------------------------------------

  const detectMemo = new Map();
  const hasDetector = !!(api.i18n && typeof api.i18n.detectLanguage === "function");

  async function detect(text) {
    if (!hasDetector || !text) return null;
    if (detectMemo.has(text)) return detectMemo.get(text);
    let result = null;
    try {
      result = await api.i18n.detectLanguage(text);
    } catch {
      result = null;
    }
    if (detectMemo.size > 2000) detectMemo.clear();
    detectMemo.set(text, result);
    return result;
  }

  // -------------------------------------------------------------------
  // Finding cards
  // -------------------------------------------------------------------

  function firstVideoId(el) {
    for (const a of el.querySelectorAll(LINK_SELECTOR)) {
      const id = LB.videoIdFromHref(a.getAttribute("href"));
      if (id) return id;
    }
    return null;
  }

  // For links outside any known card (YouTube renamed an element), climb to
  // the largest ancestor that still only links to this one video and has an
  // image. That is the card, whatever YouTube calls it.
  function genericCardFor(link, id) {
    let card = null;
    let node = link.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      if (node === document.body || node.tagName === "YTD-APP" || node.tagName === "YTM-APP") break;
      let single = true;
      for (const a of node.querySelectorAll(LINK_SELECTOR)) {
        const other = LB.videoIdFromHref(a.getAttribute("href"));
        if (other && other !== id) {
          single = false;
          break;
        }
      }
      if (!single) break;
      card = node;
    }
    return card && card.querySelector("img, yt-image, yt-thumbnail-view-model") ? card : null;
  }

  function currentWatchId() {
    try {
      return new URL(location.href).searchParams.get("v");
    } catch {
      return null;
    }
  }

  function findCards() {
    const found = new Map(); // card -> id
    for (const el of document.querySelectorAll(CARD_SELECTOR)) {
      // Skip inner cards of an outer wrapper; the wrapper is handled instead.
      const outer = el.parentElement && el.parentElement.closest(OUTER_SELECTOR);
      if (outer) continue;
      if (el.closest(IGNORE_SELECTOR)) continue;
      const id = firstVideoId(el);
      if (id) found.set(el, id);
    }
    const watching = currentWatchId();
    for (const a of document.querySelectorAll(LINK_SELECTOR)) {
      if (a.closest(CARD_SELECTOR) || a.closest(IGNORE_SELECTOR)) continue;
      const id = LB.videoIdFromHref(a.getAttribute("href"));
      if (!id || id === watching) continue;
      const card = genericCardFor(a, id);
      if (card && !found.has(card) && !card.querySelector(CARD_SELECTOR)) found.set(card, id);
    }
    return found;
  }

  function cardText(card) {
    const parts = [];
    const title = card.querySelector(TITLE_SELECTOR);
    if (title) parts.push(title.getAttribute("title") || title.textContent);
    else {
      const a = card.querySelector(LINK_SELECTOR + "[title]");
      if (a) parts.push(a.getAttribute("title"));
    }
    const channel = card.querySelector(CHANNEL_SELECTOR);
    if (channel) parts.push(channel.textContent);
    const snippet = card.querySelector(SNIPPET_SELECTOR);
    if (snippet) parts.push(snippet.textContent);
    return parts
      .filter(Boolean)
      .join(" \n ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
  }

  // -------------------------------------------------------------------
  // Marking cards
  // -------------------------------------------------------------------

  function mark(card, state, verdict) {
    if (state !== "pending") visibility.unobserve(card);
    if (state === null) {
      card.removeAttribute("data-langblock");
      card.removeAttribute("data-langblock-why");
      return;
    }
    card.setAttribute("data-langblock", state);
    if (verdict) {
      const how = { title: "title", script: "title", audio: "spoken", captions: "spoken", dub: "dubbed audio", description: "description" };
      const why = LB.languageName(verdict.lang) + (how[verdict.source] ? ` (${how[verdict.source]})` : "");
      card.setAttribute("data-langblock-why", `Hidden by LangBlock: ${why}`);
    } else {
      card.removeAttribute("data-langblock-why");
    }
  }

  function filteringActive() {
    if (!settings.enabled || blocked.size === 0) return false;
    const surface = LB.surfaceForPath(location.pathname);
    return !!(surface && settings.surfaces[surface]);
  }

  async function evaluate(card, id) {
    const token = (tokens.get(card) || 0) + 1;
    tokens.set(card, token);
    card.setAttribute("data-lb-id", id);

    if (!filteringActive()) {
      mark(card, null);
      return;
    }

    const text = cardText(card);
    const detection = await detect(text);
    if (tokens.get(card) !== token) return;

    const fromText = LB.textVerdict(text, detection, blocked);
    if (!settings.deepCheck) {
      mark(card, fromText ? "blocked" : null, fromText);
      return;
    }

    const sig = await getCached(id);
    if (tokens.get(card) !== token) return;
    if (sig) {
      const v = LB.finalVerdict(fromText, LB.spokenVerdict(sig, blocked, settings));
      mark(card, v ? "blocked" : null, v);
      return;
    }
    if (failed.has(id)) {
      mark(card, fromText ? "blocked" : null, fromText);
      return;
    }
    if (fromText) {
      // Hide straight away, then let the spoken language confirm it. Hidden
      // cards never become visible, so queue the check directly.
      mark(card, "blocked", fromText);
      enqueue(id);
      return;
    }
    mark(card, "pending");
    if (settings.hideUntilChecked) enqueue(id);
    else visibility.observe(card);
  }

  // Deep checks only run for cards near the screen, so scrolling past a long
  // list doesn't cost a request per video.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibility.unobserve(entry.target);
        if (entry.target.getAttribute("data-langblock") !== "pending") continue;
        const id = entry.target.getAttribute("data-lb-id");
        if (id) enqueue(id);
      }
    },
    { rootMargin: "800px 0px" }
  );

  function reevaluateId(id) {
    for (const card of document.querySelectorAll(`[data-lb-id="${CSS.escape(id)}"]`)) {
      evaluate(card, id);
    }
  }

  // -------------------------------------------------------------------
  // Cache (storage.local, this device only)
  // -------------------------------------------------------------------

  async function getCached(id) {
    if (signals.has(id)) return signals.get(id);
    const key = LB.storage.CACHE_PREFIX + id;
    let entry;
    try {
      entry = (await api.storage.local.get(key))[key];
    } catch {
      entry = undefined;
    }
    if (!entry || typeof entry !== "object" || typeof entry.t !== "number") return null;
    const known = entry.o || (entry.a && entry.a.length) || (entry.s && entry.s.length);
    const ttl = known ? CACHE_TTL_KNOWN : CACHE_TTL_UNKNOWN;
    if (Date.now() - entry.t > ttl) return null;
    const clean = {
      o: typeof entry.o === "string" ? entry.o : null,
      a: Array.isArray(entry.a) ? entry.a.filter((x) => typeof x === "string") : [],
      s: Array.isArray(entry.s) ? entry.s.filter((x) => typeof x === "string") : [],
      d: typeof entry.d === "string" ? entry.d : null,
      t: entry.t,
    };
    signals.set(id, clean);
    return clean;
  }

  async function putCached(id, sig) {
    signals.set(id, sig);
    try {
      await api.storage.local.set({ [LB.storage.CACHE_PREFIX + id]: sig });
    } catch {
      /* storage full or unavailable: the in-memory copy still works */
    }
  }

  async function pruneCache() {
    try {
      const { lastPrune = 0 } = await api.storage.local.get("lastPrune");
      if (Date.now() - lastPrune < 24 * 3600 * 1000) return;
      const all = await api.storage.local.get(null);
      const stale = Object.keys(all).filter((k) => {
        if (!k.startsWith(LB.storage.CACHE_PREFIX)) return false;
        const e = all[k];
        return !e || typeof e.t !== "number" || Date.now() - e.t > CACHE_TTL_KNOWN;
      });
      if (stale.length) await api.storage.local.remove(stale);
      await api.storage.local.set({ lastPrune: Date.now() });
    } catch {
      /* best effort */
    }
  }

  // -------------------------------------------------------------------
  // Deep check: read the language fields from YouTube's watch page
  // -------------------------------------------------------------------

  function enqueue(id) {
    if (queued.has(id) || inFlight.has(id) || signals.has(id) || failed.has(id)) return;
    queued.add(id);
    queue.push(id);
    pump();
  }

  function pump() {
    while (inFlight.size < MAX_CONCURRENT && queue.length) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) {
        setTimeout(pump, wait);
        return;
      }
      const id = queue.shift();
      queued.delete(id);
      if (signals.has(id)) {
        reevaluateId(id);
        continue;
      }
      inFlight.add(id);
      fetchSignals(id)
        .then(async (sig) => {
          if (sig === "retry") setTimeout(() => enqueue(id), 0);
          else if (sig) await putCached(id, sig);
          else failed.add(id);
        })
        .catch(() => failed.add(id))
        .finally(() => {
          inFlight.delete(id);
          reevaluateId(id);
          pump();
        });
    }
  }

  // Reads the watch page as a stream and stops as soon as the embedded player
  // data (ytInitialPlayerResponse) is complete, which is usually well before
  // the end of the page.
  async function readPlayerResponse(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        credentials: "same-origin",
        redirect: "follow",
        signal: controller.signal,
      });
      if (res.status === 429) {
        pausedUntil = Date.now() + 5 * 60 * 1000; // YouTube asked us to slow down
        return { status: "retry" };
      }
      if (!res.ok || !res.body) return { status: "missing" };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let html = "";
      let result = { status: "missing" };
      for (;;) {
        const { done, value } = await reader.read();
        if (value) html += decoder.decode(value, { stream: true });
        if (done || html.length > MAX_HTML_BYTES) break;
        result = LB.extractPlayerResponse(html);
        if (result.status === "found") break;
      }
      reader.cancel().catch(() => {});
      if (result.status !== "found") result = LB.extractPlayerResponse(html);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchSignals(id) {
    // bpctr/has_verified skip the "this video may be inappropriate" interstitial.
    const path = `/watch?v=${encodeURIComponent(id)}&bpctr=9999999999&has_verified=1`;
    let result = await readPlayerResponse(location.origin + path);
    if (result.status === "retry") return "retry";
    if (result.status !== "found" && location.hostname !== "www.youtube.com") {
      result = await readPlayerResponse("https://www.youtube.com" + path);
    }
    if (result.status !== "found") return null;
    const pr = result.data;
    const sig = LB.signalsFromPlayerResponse(pr);
    // When YouTube has no audio or caption language, fall back to the
    // language of the full description.
    let d = null;
    if (!sig.o && sig.a.length === 0 && sig.s.length === 0) {
      d = LB.confidentLanguage(await detect(LB.descriptionFromPlayerResponse(pr)));
    }
    return { o: sig.o, a: sig.a, s: sig.s, d, t: Date.now() };
  }

  // -------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------

  function applyDocumentFlags() {
    const root = document.documentElement;
    root.setAttribute("data-langblock-mode", settings.action);
    root.toggleAttribute("data-langblock-hide-pending", settings.hideUntilChecked);
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      scan();
    }, 120);
  }

  function scan() {
    for (const [card, id] of findCards()) {
      if (card.getAttribute("data-lb-id") === id && card.hasAttribute("data-lb-done")) continue;
      card.setAttribute("data-lb-done", "");
      evaluate(card, id);
    }
  }

  function rescanAll() {
    for (const card of document.querySelectorAll("[data-lb-done]")) card.removeAttribute("data-lb-done");
    scan();
  }

  function setSettings(next) {
    settings = next;
    blocked = new Set(settings.blocked);
    applyDocumentFlags();
    rescanAll();
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[LB.storage.CACHE_CLEARED_KEY]) {
      signals.clear();
      failed.clear();
      rescanAll();
    }
  });
  LB.storage.onSettingsChanged(setSettings);

  // The popup asks how many videos are hidden on this page.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender || sender.id !== api.runtime.id || !msg || msg.type !== "langblock:stats") return;
    sendResponse({
      hidden: document.querySelectorAll('[data-langblock="blocked"]').length,
      pending: document.querySelectorAll('[data-langblock="pending"]').length,
      active: filteringActive(),
    });
  });

  // YouTube is a single page app and recycles card elements, so watch for
  // new nodes and for links whose href changes.
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href"],
  });
  window.addEventListener("yt-navigate-finish", rescanAll);
  window.addEventListener("popstate", scheduleScan);

  LB.storage.loadSettings().then((s) => {
    setSettings(s);
    pruneCache();
  });
})();
