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
  const CACHE_TTL_UNPLAYABLE = 3600 * 1000; // 1 hour: YouTube held back the details
  const MAX_CONCURRENT = 3;
  const MAX_PLAYLIST_VIDEOS = 3; // videos checked per playlist card
  const STALL_TIMEOUT_MS = 10000; // give up on a page that sends nothing for this long
  const FETCH_TIMEOUT_MS = 30000; // or that takes longer than this in all
  // Waits before trying a failed check again. After the last one the video is
  // left alone until the next YouTube page.
  const RETRY_DELAYS_MS = [2000, 8000, 30000, 90000];
  const MAX_HTML_BYTES = 4 * 1024 * 1024;
  // Cache entries from before 1.0.10 trusted the caption language even for
  // music and very short clips. Videos they hid that way are checked again.
  const CACHE_VERSION = 2;

  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------

  let settings = LB.sanitizeSettings(null);
  let blocked = new Set();
  const signals = new Map(); // videoId -> cached language signals
  const tokens = new WeakMap(); // card -> evaluation counter, to drop stale async results
  const queue = []; // video ids waiting for a deep check, oldest first
  const queued = new Set();
  const inFlight = new Set();
  const onScreen = new Set(); // ids of waiting cards that are on screen now; checked first
  const failed = new Set(); // ids whose every try failed; tried again on the next YouTube page
  const attempts = new Map(); // id -> failed tries so far
  const waiting = new Set(); // ids waiting a moment before their next try
  const lastError = new Map(); // id -> why the last try failed, for the troubleshooting label
  const refreshing = new Set(); // ids remembered by an older version, checked again once
  const seenText = new WeakMap(); // card -> its text when last evaluated
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
    if (state !== "pending") {
      visibility.unobserve(card);
      screenWatch.unobserve(card);
      for (const id of cardIds(card)) onScreen.delete(id);
    }
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
        tags: "whyTags",
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
    const name = LB.languageName;
    let main = "no language info from YouTube";
    if (sig.o) main = `${name(sig.o)} (original audio track)`;
    else if (sig.s.length && !sig.x) main = `${name(sig.s[0])} (auto-captions)`;
    else if (sig.a.length === 1) main = `${name(sig.a[0])} (audio track label)`;
    else if (sig.d) main = `${name(sig.d)} (description)`;
    else if (sig.u) main = "YouTube held back the details, will look again later";
    else if (sig.s.length) main = "unknown";
    if (sig.s.length && sig.x) {
      main += `, ${name(sig.s[0])} auto-captions not trusted (music or a short clip, and nothing else says ${name(sig.s[0])})`;
    }
    if (sig.n && sig.n.length) {
      main += sig.n.length > LB.MAX_TAGGED_LANGUAGES
        ? `, tags name ${sig.n.length} languages (ignored)`
        : `, tags name ${sig.n.map(name).join(" and ")}`;
    }
    return main;
  }

  function describeWaiting(id) {
    if (failed.has(id)) return `check failed (${lastError.get(id) || "unknown error"}), will try again on the next page`;
    const n = attempts.get(id);
    return n ? `checking, try ${n + 1} of ${RETRY_DELAYS_MS.length + 1} (last: ${lastError.get(id)})` : "checking";
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
    if (card.getAttribute("data-lb-key") !== key) for (const id of cardIds(card)) onScreen.delete(id);
    card.setAttribute("data-lb-ids", ids.join(" "));
    card.setAttribute("data-lb-key", key);
    const isPlaylist = ids.length !== 1;
    const { text, title } = cardText(card, isPlaylist);
    seenText.set(card, text);

    if (!filteringActive()) {
      mark(card, null);
      card.removeAttribute("data-langblock-debug");
      return;
    }

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
    info.spoken = ids.map((id, i) => (sigs[i] ? describeSignals(sigs[i]) : describeWaiting(id))).join("; ");

    if (unknown.length === 0) {
      const outweighs = !!fromText && LB.titleOutweighsEnglish(title, fromText.lang, sigs);
      const v = LB.finalVerdict(fromText, spoken, fromName, outweighs);
      if (outweighs && v === fromText) info.note = "title outweighs YouTube's English label";
      decide(v ? "blocked" : null, v);
      if (v && v.source === "captions") {
        // Hidden by the caption language on an older check: look once more.
        ids.forEach((id, i) => sigs[i] && sigs[i].v < CACHE_VERSION && refresh(id));
      } else if (!v && sigs.some((sig) => sig && sig.n === null)) {
        // Remembered by a version that didn't read tags yet: look once more
        // when the card comes near the screen.
        visibility.observe(card);
      }
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
    // Rewatch from scratch, so the observers report the card's current ids.
    screenWatch.unobserve(card);
    screenWatch.observe(card);
    if (settings.hideUntilChecked) unknown.forEach(enqueue);
    else visibility.observe(card);
  }

  function cardIds(card) {
    return (card.getAttribute("data-lb-ids") || "").split(" ").filter(Boolean);
  }

  // Which waiting cards are on screen right now, so those are checked first.
  // Created before `visibility`, so it hears about a card first.
  const screenWatch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      for (const id of cardIds(entry.target)) {
        if (entry.isIntersecting) onScreen.add(id);
        else onScreen.delete(id);
      }
    }
  });

  // Deep checks only run for cards near the screen, so scrolling past a long
  // list doesn't cost a request per video.
  const visibility = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        visibility.unobserve(entry.target);
        const state = entry.target.getAttribute("data-langblock");
        if (state === "pending") cardIds(entry.target).forEach(enqueue);
        else if (!state) cardIds(entry.target).forEach((id) => signals.get(id)?.n === null && refresh(id));
      }
    },
    { rootMargin: "800px 0px" }
  );

  function cardWith(id) {
    return document.querySelector(`[data-lb-ids~="${CSS.escape(id)}"]`);
  }

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
    const ttl = entry.u && !known ? CACHE_TTL_UNPLAYABLE : known ? CACHE_TTL_KNOWN : CACHE_TTL_UNKNOWN;
    if (Date.now() - entry.t > ttl) return null;
    const codes = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === "string") : []);
    const clean = {
      o: typeof entry.o === "string" ? entry.o : null,
      a: codes(entry.a),
      s: codes(entry.s),
      d: typeof entry.d === "string" ? entry.d : null,
      n: Array.isArray(entry.n) ? codes(entry.n) : null, // null: checked before tags were read
      u: entry.u ? 1 : 0,
      x: entry.x ? 1 : 0,
      v: typeof entry.v === "number" ? entry.v : 1,
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
    if (signals.has(id) || failed.has(id) || waiting.has(id)) return;
    queueCheck(id);
  }

  function queueCheck(id) {
    if (queued.has(id) || inFlight.has(id)) return;
    queued.add(id);
    queue.push(id);
    schedulePump();
  }

  // Start checks once the current batch of cards is queued, so the on-screen
  // ones among them can go first.
  let pumpScheduled = false;
  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(() => {
      pumpScheduled = false;
      pump();
    }, 0);
  }

  function refresh(id) {
    if (refreshing.has(id)) return;
    refreshing.add(id);
    queueCheck(id);
  }

  // Videos on screen go first, then the rest in the order they came.
  function nextId() {
    const i = queue.findIndex((id) => onScreen.has(id));
    return queue.splice(i === -1 ? 0 : i, 1)[0];
  }

  let pumpTimer = 0;
  function pump() {
    while (inFlight.size < MAX_CONCURRENT && queue.length) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) {
        clearTimeout(pumpTimer);
        pumpTimer = setTimeout(pump, wait);
        return;
      }
      const id = nextId();
      queued.delete(id);
      if (signals.has(id) && !refreshing.has(id)) {
        reevaluateId(id);
        continue;
      }
      if (!cardWith(id)) continue; // its card is gone, e.g. after moving to another page
      inFlight.add(id);
      fetchSignals(id)
        .catch(() => ({ why: "unexpected error" }))
        .then(async (res) => {
          if (res.sig) {
            attempts.delete(id);
            lastError.delete(id);
            await putCached(id, res.sig);
          } else if (res.again) {
            setTimeout(() => queueCheck(id), 0); // waits for the pause YouTube asked for
          } else if (!signals.has(id)) {
            retryLater(id, res.why);
          }
        })
        .finally(() => {
          inFlight.delete(id);
          reevaluateId(id);
          pump();
        });
    }
  }

  // A check can fail on a slow connection or a hiccup at YouTube's end, so
  // try again a few times, waiting longer each time.
  function retryLater(id, why) {
    const n = (attempts.get(id) || 0) + 1;
    attempts.set(id, n);
    lastError.set(id, why || "unknown error");
    if (n > RETRY_DELAYS_MS.length) {
      failed.add(id);
      return;
    }
    const delay = RETRY_DELAYS_MS[n - 1] * (1 + Math.random() * 0.25);
    waiting.add(id);
    setTimeout(() => {
      waiting.delete(id);
      enqueue(id);
    }, delay);
  }

  // Reads the watch page as a stream and stops as soon as the embedded player
  // data (ytInitialPlayerResponse) is complete, which is usually well before
  // the end of the page.
  async function readPlayerResponse(url) {
    const controller = new AbortController();
    let stall = 0;
    const alive = () => {
      clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };
    const total = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    alive();
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
      if (!res.ok || !res.body) return { status: "failed", why: `YouTube answered ${res.status}` };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const state = {};
      let html = "";
      let result = { status: "missing" };
      for (;;) {
        const { done, value } = await reader.read();
        alive();
        if (value) html += decoder.decode(value, { stream: true });
        if (value) result = LB.extractPlayerResponse(html, state);
        if (result.status === "found" || done || html.length > MAX_HTML_BYTES) break;
      }
      reader.cancel().catch(() => {});
      if (result.status === "found") return result;
      return { status: "failed", why: result.status === "incomplete" ? "page cut off" : "no video data on the page" };
    } catch {
      return { status: "failed", why: controller.signal.aborted ? "timed out" : "network error" };
    } finally {
      clearTimeout(stall);
      clearTimeout(total);
    }
  }

  /**
   * Check one video.
   * @returns {Promise<{sig:object}|{again:true}|{why:string}>}
   */
  async function fetchSignals(id) {
    // bpctr/has_verified skip the "this video may be inappropriate" interstitial.
    const path = `/watch?v=${encodeURIComponent(id)}&bpctr=9999999999&has_verified=1`;
    let result = await readPlayerResponse(location.origin + path);
    if (result.status === "failed" && location.hostname !== "www.youtube.com") {
      result = await readPlayerResponse("https://www.youtube.com" + path);
    }
    if (result.status === "retry") return { again: true };
    if (result.status !== "found") return { why: result.why };
    const pr = result.data;
    const sig = LB.signalsFromPlayerResponse(pr);
    const description = LB.descriptionFromPlayerResponse(pr);
    const tagText = LB.tagTextFromPlayerResponse(pr);
    // On music and very short clips, speech recognition only counts when the
    // title, channel name, description or tags point to the same language.
    let x = 0;
    if (sig.s.length && !sig.o && LB.captionsNeedSupport(pr)) {
      const vd = pr.videoDetails || {};
      const title = typeof vd.title === "string" ? vd.title : "";
      const author = typeof vd.author === "string" ? vd.author : "";
      const text = [title, author, description, tagText].filter(Boolean).join(" · ");
      const detections = [await detect(title), await detect(description)];
      if (!LB.languageSupported(sig.s[0], text, detections, sig.a)) x = 1;
    }
    // When YouTube has no usable audio or caption language, fall back to the
    // language of the full description.
    let d = null;
    if (!sig.o && sig.a.length === 0 && (sig.s.length === 0 || x)) {
      d = LB.confidentLanguage(description, await detect(description));
    }
    // Only language codes are kept, never the tags themselves.
    const n = LB.namedLanguages(tagText);
    // "Sign in to confirm you're not a bot" and similar pages leave the
    // language fields out. Look again in an hour rather than in three days.
    const status = pr && pr.playabilityStatus && pr.playabilityStatus.status;
    const u = status && status !== "OK" ? 1 : 0;
    return { sig: { o: sig.o, a: sig.a, s: sig.s, d, n, u, x, v: CACHE_VERSION, t: Date.now() } };
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
      // Look again when YouTube fills in a card's title after its link.
      const same =
        card.getAttribute("data-lb-key") === key &&
        card.hasAttribute("data-lb-done") &&
        seenText.get(card) === cardText(card, ids.length !== 1).text;
      if (same) continue;
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
  // A new YouTube page is a fresh start for checks that kept failing.
  window.addEventListener("yt-navigate-finish", () => {
    for (const id of failed) attempts.delete(id);
    failed.clear();
    rescanAll();
  });
  window.addEventListener("popstate", scheduleScan);

  LB.storage.loadSettings().then((s) => {
    setSettings(s);
    pruneCache();
  });
})();
