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
    "ytd-playlist-renderer",
    "ytd-radio-renderer",
    "ytd-grid-playlist-renderer",
    "ytd-compact-playlist-renderer",
    "ytd-compact-radio-renderer",
    "yt-lockup-view-model",
    "ytm-shorts-lockup-view-model",
    "ytm-shorts-lockup-view-model-v2",
    // mobile (m.youtube.com)
    "ytm-video-with-context-renderer",
    "ytm-compact-video-renderer",
    "ytm-video-card-renderer",
    "ytm-reel-item-renderer",
    "ytm-media-item",
    "ytm-compact-playlist-renderer",
  ];
  const CARD_SELECTOR = CARDS.join(",");
  const OUTER_SELECTOR = OUTER_CARDS.join(",");
  const LINK_SELECTOR = 'a[href*="/watch?v="], a[href*="/shorts/"]';
  const PLAYLIST_LINK_SELECTOR = 'a[href*="list="]';

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
  const MAX_PLAYLIST_VIDEOS = 3; // videos checked per playlist card
  const FETCH_TIMEOUT_MS = 15000;
  const RETRY_DELAY_MS = 20000;
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
  const failed = new Set(); // ids that errored twice this page load; not retried until reload
  const attempts = new Map(); // id -> failed attempts so far
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

  function playlistIdOf(el) {
    for (const a of el.querySelectorAll(PLAYLIST_LINK_SELECTOR)) {
      try {
        const list = new URL(a.getAttribute("href"), "https://www.youtube.com").searchParams.get("list");
        if (list && /^[A-Za-z0-9_-]{2,64}$/.test(list)) return list;
      } catch {
        /* ignore malformed links */
      }
    }
    return null;
  }

  // Distinct videos a card links to: one for a normal video, several for a
  // playlist card that lists its first videos.
  function cardVideoIds(el) {
    const ids = [];
    for (const a of el.querySelectorAll(LINK_SELECTOR)) {
      const id = LB.videoIdFromHref(a.getAttribute("href"));
      if (id && !ids.includes(id)) ids.push(id);
      if (ids.length >= MAX_PLAYLIST_VIDEOS) break;
    }
    return ids;
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
    const found = new Map(); // card -> { ids, key }
    for (const el of document.querySelectorAll(CARD_SELECTOR)) {
      // Skip inner cards of an outer wrapper; the wrapper is handled instead.
      const outer = el.parentElement && el.parentElement.closest(OUTER_SELECTOR);
      if (outer) continue;
      if (el.closest(IGNORE_SELECTOR)) continue;
      const ids = cardVideoIds(el);
      if (ids.length) {
        found.set(el, { ids, key: ids.join(" ") });
        continue;
      }
      // A playlist card that only links to the playlist page can still be
      // judged by its text.
      const list = playlistIdOf(el);
      if (list) found.set(el, { ids: [], key: "list:" + list });
    }
    const watching = currentWatchId();
    for (const a of document.querySelectorAll(LINK_SELECTOR)) {
      if (a.closest(CARD_SELECTOR) || a.closest(IGNORE_SELECTOR)) continue;
      const id = LB.videoIdFromHref(a.getAttribute("href"));
      if (!id || id === watching) continue;
      const card = genericCardFor(a, id);
      if (card && !found.has(card) && !card.querySelector(CARD_SELECTOR)) found.set(card, { ids: [id], key: id });
    }
    return found;
  }

  // The card's title(s), and the title with channel name and snippet.
  function cardText(card, isPlaylist) {
    const titles = [];
    const title = card.querySelector(TITLE_SELECTOR);
    if (title) titles.push(title.getAttribute("title") || title.textContent);
    else {
      const a = card.querySelector(LINK_SELECTOR + "[title]");
      if (a) titles.push(a.getAttribute("title"));
    }
    // Playlist cards list their first videos; their titles often say more
    // than the playlist title ("Class 1 - Urdu / Hindi").
    if (isPlaylist) {
      for (const a of card.querySelectorAll(LINK_SELECTOR)) titles.push(a.getAttribute("title") || a.textContent);
    }
    const channel = card.querySelector(CHANNEL_SELECTOR);
    const snippet = card.querySelector(SNIPPET_SELECTOR);
    const join = (parts) =>
      parts
        .filter(Boolean)
        .join(" \n ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000);
    return {
      title: join(titles),
      text: join([titles[0], channel && channel.textContent, snippet && snippet.textContent, ...titles.slice(1)]),
    };
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
      const how = {
        title: "whyTitle",
        script: "whyTitle",
        name: "whyTitle",
        audio: "whySpoken",
        captions: "whySpoken",
        dub: "whyDub",
        description: "whyDescription",
      };
      const name = LB.localName(verdict.lang);
      const why = how[verdict.source] ? `${name} (${LB.t(how[verdict.source])})` : name;
      card.setAttribute("data-langblock-why", LB.t("hiddenBy", [why]));
    } else {
      card.removeAttribute("data-langblock-why");
    }
  }

  // Troubleshooting label: what LangBlock found for this card.
  function describeSignals(sig) {
    if (!sig) return "not checked";
    if (sig.o) return `${LB.languageName(sig.o)} (original audio track)`;
    if (sig.s.length) return `${LB.languageName(sig.s[0])} (auto-captions)`;
    if (sig.a.length === 1) return `${LB.languageName(sig.a[0])} (audio track label)`;
    if (sig.d) return `${LB.languageName(sig.d)} (description)`;
    return "no language info from YouTube";
  }

  function describeDetection(text, detection) {
    const top = detection && Array.isArray(detection.languages) ? detection.languages[0] : null;
    if (!top) return "unknown";
    const name = LB.languageName(top.language);
    if (!LB.detectorTrusted(text, detection, top.language, top.percentage)) return `maybe ${name} (ignored)`;
    return `${name} ${Math.round(top.percentage)}%`;
  }

  function setDebug(card, state, verdict, info) {
    if (!settings.debug) {
      card.removeAttribute("data-langblock-debug");
      return;
    }
    const head = state === "blocked" ? `Hidden: ${LB.languageName(verdict.lang)} (${verdict.source})` : state === "pending" ? "Checking" : "Shown";
    const parts = [`LangBlock: ${head}`];
    if (info.kind) parts.push(info.kind);
    if (info.spoken) parts.push(`spoken: ${info.spoken}`);
    if (info.title) parts.push(`title: ${info.title}`);
    if (info.name) parts.push(`names ${LB.languageName(info.name.lang)}`);
    if (info.note) parts.push(info.note);
    card.setAttribute("data-langblock-debug", parts.join(" · "));
  }

  function filteringActive() {
    if (!settings.enabled || blocked.size === 0) return false;
    const surface = LB.surfaceForPath(location.pathname);
    return !!(surface && settings.surfaces[surface]);
  }

  async function evaluate(card, ids, key) {
    const token = (tokens.get(card) || 0) + 1;
    tokens.set(card, token);
    card.setAttribute("data-lb-ids", ids.join(" "));
    card.setAttribute("data-lb-key", key);

    if (!filteringActive()) {
      mark(card, null);
      card.removeAttribute("data-langblock-debug");
      return;
    }

    const isPlaylist = ids.length !== 1;
    const { text, title } = cardText(card, isPlaylist);
    const detection = await detect(text);
    if (tokens.get(card) !== token) return;

    const fromText = LB.textVerdict(text, detection, blocked);
    // Language names are matched against everything on the card, so a
    // playlist's listed videos ("Class 1 - Urdu / Hindi") count too.
    const fullText = (card.textContent || "").replace(/\s+/g, " ").slice(0, 3000);
    const fromName = LB.nameVerdict(text + " · " + fullText, blocked);
    const info = {
      kind: isPlaylist ? `playlist, ${ids.length} video${ids.length === 1 ? "" : "s"} found` : "",
      title: describeDetection(text, detection),
      name: fromName,
    };
    const decide = (state, verdict) => {
      mark(card, state, verdict);
      setDebug(card, state, verdict, info);
    };

    if (!settings.deepCheck || ids.length === 0) {
      const v = LB.finalVerdict(fromText, null, fromName);
      info.spoken = settings.deepCheck ? "no videos found on the card" : "check turned off";
      decide(v ? "blocked" : null, v);
      return;
    }

    const sigs = await Promise.all(ids.map(getCached));
    if (tokens.get(card) !== token) return;
    const spokenEach = sigs.map((sig) => (sig ? LB.spokenVerdict(sig, blocked, settings) : null));
    const spoken = isPlaylist ? LB.playlistVerdict(spokenEach) : spokenEach[0];
    const unknown = ids.filter((id, i) => !sigs[i] && !failed.has(id));
    info.spoken = ids
      .map((id, i) => (sigs[i] ? describeSignals(sigs[i]) : failed.has(id) ? "check failed" : "checking"))
      .join("; ");

    if (unknown.length === 0) {
      const outweighs = !!fromText && LB.titleOutweighsEnglish(title, fromText.lang, sigs);
      const v = LB.finalVerdict(fromText, spoken, fromName, outweighs);
      if (outweighs && v === fromText) info.note = "title outweighs YouTube's English label";
      decide(v ? "blocked" : null, v);
      return;
    }
    // Still waiting for some videos. Hide straight away if what we know so
    // far already says so, and let the spoken language confirm it. Hidden
    // cards never become visible, so queue their checks directly.
    const early = LB.finalVerdict(fromText, spoken && spoken !== "clear" ? spoken : null, fromName);
    if (early) {
      decide("blocked", early);
      unknown.forEach(enqueue);
      return;
    }
    decide("pending", null);
    if (settings.hideUntilChecked) unknown.forEach(enqueue);
    else visibility.observe(card);
  }

  function cardIds(card) {
    return (card.getAttribute("data-lb-ids") || "").split(" ").filter(Boolean);
  }

  // Deep checks only run for cards near the screen, so scrolling past a long
  // list doesn't cost a request per video.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibility.unobserve(entry.target);
        if (entry.target.getAttribute("data-langblock") !== "pending") continue;
        cardIds(entry.target).forEach(enqueue);
      }
    },
    { rootMargin: "800px 0px" }
  );

  function reevaluateId(id) {
    for (const card of document.querySelectorAll(`[data-lb-ids~="${CSS.escape(id)}"]`)) {
      evaluate(card, cardIds(card), card.getAttribute("data-lb-key") || id);
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
          else retryLater(id);
        })
        .catch(() => retryLater(id))
        .finally(() => {
          inFlight.delete(id);
          reevaluateId(id);
          pump();
        });
    }
  }

  // A check can fail on a slow connection or a hiccup at YouTube's end, so
  // give it one more go a little later before giving up on it.
  function retryLater(id) {
    const n = (attempts.get(id) || 0) + 1;
    attempts.set(id, n);
    if (n >= 2) failed.add(id);
    else setTimeout(() => enqueue(id), RETRY_DELAY_MS);
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
      const description = LB.descriptionFromPlayerResponse(pr);
      d = LB.confidentLanguage(description, await detect(description));
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
    root.toggleAttribute("data-langblock-debug", settings.debug);
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
    for (const [card, { ids, key }] of findCards()) {
      if (card.getAttribute("data-lb-key") === key && card.hasAttribute("data-lb-done")) continue;
      card.setAttribute("data-lb-done", "");
      evaluate(card, ids, key);
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
      attempts.clear();
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
