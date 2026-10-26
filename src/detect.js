// Pure detection logic. No DOM, no browser APIs, so it can be unit tested in
// Node and shared by the content script and the settings page.
(function (root) {
  "use strict";

  const LB = root.LangBlock;
  const { LANGUAGES, normalizeCode } = LB;

  // ---------------------------------------------------------------------
  // Script (writing system) analysis
  // ---------------------------------------------------------------------

  // Scripts with a Unicode property name. "Japanese" is a virtual script made
  // of Hiragana and Katakana, which only Japanese uses.
  const SCRIPT_TESTS = {
    Latin: /\p{Script=Latin}/u,
    Cyrillic: /\p{Script=Cyrillic}/u,
    Greek: /\p{Script=Greek}/u,
    Arabic: /\p{Script=Arabic}/u,
    Hebrew: /\p{Script=Hebrew}/u,
    Armenian: /\p{Script=Armenian}/u,
    Georgian: /\p{Script=Georgian}/u,
    Devanagari: /\p{Script=Devanagari}/u,
    Bengali: /\p{Script=Bengali}/u,
    Gurmukhi: /\p{Script=Gurmukhi}/u,
    Gujarati: /\p{Script=Gujarati}/u,
    Oriya: /\p{Script=Oriya}/u,
    Tamil: /\p{Script=Tamil}/u,
    Telugu: /\p{Script=Telugu}/u,
    Kannada: /\p{Script=Kannada}/u,
    Malayalam: /\p{Script=Malayalam}/u,
    Sinhala: /\p{Script=Sinhala}/u,
    Thai: /\p{Script=Thai}/u,
    Lao: /\p{Script=Lao}/u,
    Myanmar: /\p{Script=Myanmar}/u,
    Khmer: /\p{Script=Khmer}/u,
    Ethiopic: /\p{Script=Ethiopic}/u,
    Hangul: /\p{Script=Hangul}/u,
    Japanese: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
    Han: /\p{Script=Han}/u,
  };
  const SCRIPT_NAMES = Object.keys(SCRIPT_TESTS);
  const LETTER = /[\p{L}\p{M}]/u;

  // script -> language codes written in it
  const SCRIPT_LANGS = {};
  for (const lang of LANGUAGES) {
    (SCRIPT_LANGS[lang.script] ||= []).push(lang.code);
  }
  // Japanese titles often contain kanji, so Han is shared with Japanese.
  SCRIPT_LANGS.Han = ["zh", "ja"];

  function analyzeScripts(text) {
    const counts = {};
    let total = 0;
    for (const ch of String(text || "")) {
      if (!LETTER.test(ch)) continue;
      total++;
      for (const name of SCRIPT_NAMES) {
        if (SCRIPT_TESTS[name].test(ch)) {
          counts[name] = (counts[name] || 0) + 1;
          break;
        }
      }
    }
    // Combining marks (\p{M}) belong to their base script already, so any
    // letter we couldn't classify is simply ignored in the shares.
    return { total, counts };
  }

  // A writing system is "present" when it's a meaningful part of the text.
  // Titles like "Best phones under 20000 | हिंदी" mix scripts, so we look for
  // a few letters and a modest share rather than a majority.
  const SCRIPT_MIN_LETTERS = 3;
  const SCRIPT_MIN_SHARE = 0.1;

  // ---------------------------------------------------------------------
  // Text verdict (title, channel name, description snippet)
  // ---------------------------------------------------------------------

  /**
   * Decide from text alone whether a video is in a blocked language.
   * @param {string} text
   * @param {{isReliable:boolean, languages:{language:string, percentage:number}[]}|null} detection
   *        Result of i18n.detectLanguage(text), or null when unavailable.
   * @param {Set<string>} blocked normalized codes
   * @returns {{lang:string, source:string}|null}
   */
  function textVerdict(text, detection, blocked) {
    if (!text || !blocked || blocked.size === 0) return null;
    const { total, counts } = analyzeScripts(text);
    if (total === 0) return null;

    const detected = (detection && Array.isArray(detection.languages) ? detection.languages : [])
      .map((l) => ({ code: normalizeCode(l.language), pct: Number(l.percentage) || 0 }))
      .filter((l) => l.code && l.code !== "und");
    const reliable = !!(detection && detection.isReliable);
    const top = detected[0] || null;

    // 1. The browser's language detector says a blocked language is a big
    //    part of the text.
    for (const d of detected) {
      if (!blocked.has(d.code)) continue;
      if (reliable && d.pct >= 40) return { lang: d.code, source: "title" };
    }

    // 2. Writing system check. Works offline in every browser and handles
    //    short titles that the detector marks as unreliable.
    for (const script of SCRIPT_NAMES) {
      if (script === "Latin") continue;
      const n = counts[script] || 0;
      if (n < SCRIPT_MIN_LETTERS || n / total < SCRIPT_MIN_SHARE) continue;
      // Kanji next to kana is Japanese, not Chinese.
      if (script === "Han" && (counts.Japanese || 0) > 0) continue;
      const scriptLangs = SCRIPT_LANGS[script] || [];
      const hits = scriptLangs.filter((c) => blocked.has(c));
      if (hits.length === 0) continue;
      if (scriptLangs.length === 1) return { lang: hits[0], source: "script" };
      // Shared script (e.g. Devanagari: Hindi, Marathi, Nepali). Use the
      // detector to tell them apart when it has an opinion.
      const inScript = detected.find((d) => scriptLangs.includes(d.code));
      if (inScript) {
        if (blocked.has(inScript.code)) return { lang: inScript.code, source: "script" };
        if (reliable || inScript.pct >= 50) continue; // e.g. confidently Marathi
      }
      return { lang: hits[0], source: "script" };
    }

    // 3. Romanized text (e.g. Hinglish "hi-Latn"): only trust the detector
    //    when it is the top, reliable answer.
    if (top && reliable && blocked.has(top.code) && top.pct >= 60) {
      return { lang: top.code, source: "title" };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // YouTube player data
  // ---------------------------------------------------------------------

  const PLAYER_MARKER = /ytInitialPlayerResponse\s*=\s*\{/;

  /**
   * Find the end of a JSON object that starts at `start` (a "{").
   * Returns the index after the closing brace, or -1 if the text ends first.
   */
  function scanJsonObject(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (c === 92 /* \ */) i++;
        else if (c === 34 /* " */) inString = false;
        continue;
      }
      if (c === 34) inString = true;
      else if (c === 123 /* { */) depth++;
      else if (c === 125 /* } */) {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  /**
   * Pull ytInitialPlayerResponse out of (possibly partial) watch page HTML.
   * @returns {{status:"found", data:object}|{status:"incomplete"}|{status:"missing"}}
   */
  function extractPlayerResponse(html) {
    const m = PLAYER_MARKER.exec(html);
    if (!m) return { status: "missing" };
    const start = m.index + m[0].length - 1;
    const end = scanJsonObject(html, start);
    if (end === -1) return { status: "incomplete" };
    try {
      return { status: "found", data: JSON.parse(html.slice(start, end)) };
    } catch {
      return { status: "missing" };
    }
  }

  function uniq(list) {
    return [...new Set(list.filter(Boolean))];
  }

  // Audio track ids look like "hi.4" (original) or "en-US.3" (dubbed).
  function parseAudioTrackId(id, displayName) {
    if (typeof id !== "string" || !id) return null;
    const [langPart, kind] = id.split(".");
    const lang = normalizeCode(langPart);
    if (!lang) return null;
    const original = kind === "4" || /original/i.test(String(displayName || ""));
    return { lang, original };
  }

  /**
   * Reduce a player response to the few language signals LangBlock needs.
   * Only these are cached; nothing else from the response is kept.
   * @returns {{o:string|null, a:string[], s:string[]}}
   *   o = original spoken language, a = all audio track languages,
   *   s = auto-generated (speech recognition) caption languages
   */
  function signalsFromPlayerResponse(pr) {
    const tracks = [];
    const formats = (pr && pr.streamingData && pr.streamingData.adaptiveFormats) || [];
    for (const f of formats) {
      if (f && f.audioTrack) {
        const t = parseAudioTrackId(f.audioTrack.id, f.audioTrack.displayName);
        if (t) tracks.push(t);
      }
    }
    const capRenderer = pr && pr.captions && pr.captions.playerCaptionsTracklistRenderer;
    for (const at of (capRenderer && capRenderer.audioTracks) || []) {
      const t = parseAudioTrackId(at && at.audioTrackId, null);
      if (t) tracks.push(t);
    }
    const asr = [];
    for (const ct of (capRenderer && capRenderer.captionTracks) || []) {
      if (!ct) continue;
      const isAsr = ct.kind === "asr" || (typeof ct.vssId === "string" && ct.vssId.startsWith("a."));
      if (isAsr) asr.push(normalizeCode(ct.languageCode));
    }
    const original = tracks.find((t) => t.original);
    return {
      o: original ? original.lang : null,
      a: uniq(tracks.map((t) => t.lang)),
      s: uniq(asr),
    };
  }

  function descriptionFromPlayerResponse(pr) {
    const d = pr && pr.videoDetails && pr.videoDetails.shortDescription;
    return typeof d === "string" ? d.slice(0, 1500) : "";
  }

  /**
   * Decide from cached signals whether a video is in a blocked language.
   * @param {{o?:string|null, a?:string[], s?:string[], d?:string|null}} sig
   *   d = language the browser detected in the description, if any
   * @returns {{lang:string, source:string}|"clear"|null}
   *   "clear" = we know the spoken language and it isn't blocked
   *   null    = no usable signal
   */
  function spokenVerdict(sig, blocked, opts = {}) {
    if (!sig || !blocked || blocked.size === 0) return null;
    const audio = sig.a || [];
    const asr = sig.s || [];
    let spoken = null;
    let source = null;
    if (sig.o) {
      spoken = sig.o;
      source = "audio";
    } else if (audio.length === 1) {
      spoken = audio[0];
      source = "audio";
    } else if (asr.length > 0) {
      spoken = asr[0];
      source = "captions";
    }
    if (spoken) {
      if (blocked.has(spoken)) return { lang: spoken, source };
      if (opts.blockDubbed) {
        const dub = audio.find((l) => blocked.has(l));
        if (dub) return { lang: dub, source: "dub" };
      }
      return "clear";
    }
    if (opts.blockDubbed) {
      const dub = audio.find((l) => blocked.has(l));
      if (dub) return { lang: dub, source: "dub" };
    }
    if (sig.d && blocked.has(sig.d)) return { lang: sig.d, source: "description" };
    return null;
  }

  // ---------------------------------------------------------------------
  // Language named in the title ("in Hindi", "Class 1 - Urdu / Hindi")
  // ---------------------------------------------------------------------

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const nameMatchers = new Map(); // code -> RegExp
  function nameMatcher(code) {
    if (nameMatchers.has(code)) return nameMatchers.get(code);
    const lang = LB.LANGUAGE_BY_CODE[code];
    let re = null;
    if (lang) {
      const names = lang.name.split(" / ").map((n) => escapeRegExp(n.trim()));
      const name = `(?:${names.join("|")})`;
      // The name has to be used as a label for the video's language, not as
      // an adjective: "explained in Hindi", "(Hindi)", "| Hindi", "Hindi /
      // Urdu", "Hindi dubbed". "Life in Thai prison" or "French toast" don't
      // count, because a word follows the name.
      const notWord = "(?!\\s*[\\p{L}\\p{M}])";
      re = new RegExp(
        [
          `\\bin\\s+${name}${notWord}`,
          `[(\\[|/\\-\u2013\u2014:\u00b7\u2022]\\s*${name}${notWord}`,
          `\\b${name}\\s*/`,
          `\\b${name}\\s+(?:dub|dubbed|version|audio)\\b`,
        ].join("|"),
        "iu"
      );
    }
    nameMatchers.set(code, re);
    return re;
  }

  /**
   * A blocked language explicitly named as the video's language in its text.
   * @returns {{lang:string, source:"name"}|null}
   */
  function nameVerdict(text, blocked) {
    if (!text || !blocked) return null;
    for (const code of blocked) {
      const re = nameMatcher(code);
      if (re && re.test(text)) return { lang: code, source: "name" };
    }
    return null;
  }

  /**
   * Combine everything we know about a video.
   * 1. YouTube says it is spoken in a blocked language: hide.
   * 2. The title names a blocked language ("in Hindi"): hide, even when
   *    YouTube labels the speech as something close (e.g. Urdu).
   * 3. YouTube knows the spoken language and it isn't blocked: show. A
   *    French-looking title on a video spoken in English is not French.
   * 4. Otherwise the title's detected language decides.
   * @returns {{lang:string, source:string}|null} null = show the video
   */
  function finalVerdict(fromText, spoken, fromName) {
    if (spoken && spoken !== "clear") return spoken;
    if (fromName) return fromName;
    if (spoken === "clear") return null;
    return fromText || null;
  }

  /**
   * Spoken-language verdict for a playlist from the verdicts of the videos
   * it shows. Hidden when at least half of the videos with a known language
   * are in a blocked language.
   * @param {Array<{lang:string, source:string}|"clear"|null>} verdicts
   */
  function playlistVerdict(verdicts) {
    const known = verdicts.filter((v) => v !== null && v !== undefined);
    if (known.length === 0) return null;
    const hits = known.filter((v) => v !== "clear");
    return hits.length * 2 >= known.length ? hits[0] : "clear";
  }

  // Languages that sound almost the same when spoken, so YouTube may label a
  // video as either. The settings page suggests blocking them together.
  const RELATED_LANGUAGES = {
    hi: ["ur"],
    ur: ["hi"],
    ms: ["id"],
    id: ["ms"],
    sr: ["hr", "bs"],
    hr: ["sr", "bs"],
    bs: ["sr", "hr"],
  };

  /**
   * Language from a detectLanguage() result, if the detector is confident.
   */
  function confidentLanguage(detection, minPct = 60) {
    if (!detection || !detection.isReliable || !Array.isArray(detection.languages)) return null;
    const top = detection.languages[0];
    if (!top || (Number(top.percentage) || 0) < minPct) return null;
    const code = normalizeCode(top.language);
    return code && code !== "und" ? code : null;
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    blocked: [],
    surfaces: Object.freeze({ search: true, home: true, watch: true, channel: true }),
    deepCheck: true,
    blockDubbed: false,
    hideUntilChecked: false,
    action: "hide", // "hide" | "dim"
  });

  const KNOWN_CODES = new Set(LANGUAGES.map((l) => l.code));

  // Settings come from storage that a user (or sync) controls, so validate
  // every field instead of trusting its shape.
  function sanitizeSettings(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    const bool = (v, d) => (typeof v === "boolean" ? v : d);
    const surfaces = s.surfaces && typeof s.surfaces === "object" ? s.surfaces : {};
    return {
      enabled: bool(s.enabled, DEFAULT_SETTINGS.enabled),
      blocked: Array.isArray(s.blocked)
        ? uniq(s.blocked.map(normalizeCode).filter((c) => KNOWN_CODES.has(c)))
        : [],
      surfaces: {
        search: bool(surfaces.search, true),
        home: bool(surfaces.home, true),
        watch: bool(surfaces.watch, true),
        channel: bool(surfaces.channel, true),
      },
      deepCheck: bool(s.deepCheck, DEFAULT_SETTINGS.deepCheck),
      blockDubbed: bool(s.blockDubbed, DEFAULT_SETTINGS.blockDubbed),
      hideUntilChecked: bool(s.hideUntilChecked, DEFAULT_SETTINGS.hideUntilChecked),
      action: s.action === "dim" ? "dim" : "hide",
    };
  }

  // Which settings toggle applies to a YouTube page path.
  function surfaceForPath(pathname) {
    const p = String(pathname || "/");
    if (p.startsWith("/results")) return "search";
    if (p.startsWith("/watch")) return "watch";
    if (/^\/(@|channel\/|c\/|user\/)/.test(p)) return "channel";
    if (p.startsWith("/shorts")) return null; // never touch the Shorts player
    return "home"; // home page, feeds, subscriptions, playlists, etc.
  }

  // Video id from a link href ("/watch?v=ID&t=1", "/shorts/ID", full URLs).
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  function videoIdFromHref(href) {
    if (typeof href !== "string" || !href) return null;
    let url;
    try {
      url = new URL(href, "https://www.youtube.com");
    } catch {
      return null;
    }
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    let id = null;
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = /^\/shorts\/([^/?#]+)/.exec(url.pathname);
      if (m) id = m[1];
    }
    return id && ID_RE.test(id) ? id : null;
  }

  Object.assign(LB, {
    analyzeScripts,
    textVerdict,
    scanJsonObject,
    extractPlayerResponse,
    signalsFromPlayerResponse,
    descriptionFromPlayerResponse,
    spokenVerdict,
    nameVerdict,
    finalVerdict,
    playlistVerdict,
    RELATED_LANGUAGES,
    confidentLanguage,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    surfaceForPath,
    videoIdFromHref,
  });
})(globalThis);
