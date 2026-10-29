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

    // 1. The browser's language detector is sure a blocked language is a
    //    big part of the text. Covers romanized text too (Hinglish "hi-Latn").
    for (const d of detected) {
      if (!blocked.has(d.code)) continue;
      if (detectorTrusted(text, detection, d.code, d.pct, { total, counts })) return { lang: d.code, source: "title" };
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
    return null;
  }

  // Everyday words (articles, prepositions, pronouns) of Latin-alphabet
  // languages. Brand and product names don't contain them, real sentences
  // do. Words that are also common in English titles ("come", "die", "men",
  // "op", "her", "may") are left out of the other languages. Hindi and Urdu
  // are for romanized text.
  const COMMON_WORDS = {
    en: "the and of to for with you your this that how what why who are was is it in on my from by not do can will be at an",
    es: "de del el la los las que qué por para con una unos como cómo más pero muy este esta esto también cuando donde dónde mis al se es su mi tu nos",
    fr: "le la les de des du et un une est avec dans sur pas qui que au aux ce cette ces mon ma mes ta tes nous vous il ils elle elles je sont très pourquoi à où mais ou sans chez en leur leurs quoi quand",
    pt: "de da das que para uma não mais como por em na nos nas ao aos se é meu minha seu sua você vocês muito também quando onde isso isto esse essa este esta até sem já pra ele ela eles ou mas",
    it: "di del della dei delle degli il la le gli che per con una un non sono nel nella alla al è ma più anche questo questa perché cosa mio mia suo sua ci si da dal dalla tra fra ho molto quando",
    de: "der das und ist nicht ein eine einen einem einer den dem des zu auf für von ich wir ihr sie es auch wie wird sind oder aber mein meine dein noch nur bei aus nach über vom zum zur sehr warum wenn dass kein keine",
    nl: "de het een en dat niet te voor zijn ik je jij wij maar ook als aan bij om uit naar nog wat waarom mijn deze dit er heb hebben wordt geen",
    id: "yang dan di ke dari ini itu untuk dengan tidak tak ada akan saya aku kamu kita kami mereka dia apa bagaimana cara juga sudah belum bisa lagi atau pada dalam karena sangat banget gak nggak jadi buat sama punya mau",
    ms: "yang dan di ke dari ini itu untuk dengan tidak tak ada akan saya aku kamu kita kami mereka dia apa bagaimana cara juga sudah belum boleh lagi atau pada dalam kerana sangat jadi buat sama punya mahu nak",
    fil: "ang ng mga sa na ay ko mo ka ako ikaw siya kami tayo sila ito iyan yan yung kung para lang din rin naman po ba pa nang kay ni paano bakit ano mayroon wala",
    tr: "ve bir bu şu için ile da de mi mı mu mü ne çok daha gibi ama sen siz onlar var yok nasıl neden niye kadar olan oldu değil diye şey ki",
    vi: "và của là có không những các một cho với được này đã người khi trong để thì mà cũng như sẽ tôi bạn anh em chị gì sao làm nào rất đến từ về ra đi ở",
    pl: "się nie na jest że co jak ale po od za dla czy tak już jestem mój moja ta tym jego jej są oraz przez bez przy tylko bardzo kiedy dlaczego gdzie mnie mi ich tego",
    ro: "și si în de la cu pe un să sa nu din pentru mai ce este sunt sau dar ca că al ale lui ei el noi voi foarte când unde cel cea acest această fără",
    sw: "na ya wa kwa ni za la katika hii huu hiyo yangu yako yake sana lakini kama au pia mimi wewe yeye sisi nini vipi jinsi kwenye hapa leo kuhusu wakati bila cha vya",
    sv: "och att det som en på är för med av den inte jag du vi de har om ett så hur varför mina din kan ska vad när från eller också mycket",
    da: "og det er en på af med den de som jeg ikke har om et så hvordan hvorfor din kan skal hvad når fra eller også meget vi du der bliver",
    no: "og det er en på av med den de som jeg ikke har om et så hvordan hvorfor din kan skal hva når fra eller også mye veldig vi du der",
    fi: "ja ei se että kun mutta tai kanssa minä sinä hän te ne mitä miten miksi kuinka tämä tuo joka jos niin myös vain oli ovat olen ole minun sinun hyvin paljon kaikki",
    cs: "je se na že jak ale jsem jsou co po od za už tak ta být má mám není nebo když proč kde který která které jeho její jsme také velmi moc bez při",
    hu: "az és hogy nem egy meg de ez azt ezt csak már még mi ki mert vagy hogyan miért nagyon minden nekem neki lesz kell ha itt ott aki ami amit sem majd",
    hi: "hai hain kya nahi nahin aur bhi mein yeh ye woh wo kaise kaisa kaisi kyun kyon kab kahan kar karo kare karte diya liya gaya raha rahe rahi hota hoti tha thi ka ki ke ko se ho hum tum aap apna apni mera meri tera teri wala wali bhai yaar ji bahut sab kuch ab phir aaj",
  };
  COMMON_WORDS.ur = COMMON_WORDS.hi;
  const COMMON_WORD_SETS = {};
  for (const [code, words] of Object.entries(COMMON_WORDS)) COMMON_WORD_SETS[code] = new Set(words.split(" "));

  /**
   * Whether the detector saying `code` at `pct` percent is solid enough to
   * act on. The detector is easily fooled by short Latin-alphabet titles
   * ("Adobe Premiere Pro CC Course" comes out as Italian, "Elden Ring DLC
   * Boss Guide" as Norwegian), so there it has to be sure, at least 80%, and
   * the text needs two everyday words of that language (or six words in all
   * for languages without a word list). Other writing systems narrow the
   * options a lot, so less is needed.
   */
  function detectorTrusted(text, detection, code, pct, scripts = analyzeScripts(text)) {
    if (!detection || !detection.isReliable || !scripts.total) return false;
    if ((scripts.counts.Latin || 0) / scripts.total < 0.5) return pct >= 40;
    if (pct < 80) return false;
    const words = new Set((String(text).normalize("NFC").match(/[\p{L}\p{M}]+/gu) || []).map((w) => w.toLowerCase()));
    const common = COMMON_WORD_SETS[normalizeCode(code)];
    if (!common) return [...words].filter((w) => w.length >= 3).length >= 6;
    let hits = 0;
    for (const w of words) if (common.has(w) && ++hits >= 2) return true;
    return false;
  }

  // ---------------------------------------------------------------------
  // YouTube player data
  // ---------------------------------------------------------------------

  const PLAYER_MARKER = /ytInitialPlayerResponse\s*=\s*\{/g;

  /**
   * Find the end of a JSON object that starts at `pos.i` (a "{").
   * Returns the index after the closing brace, or -1 if the text ends first.
   * `pos` keeps the scan's place, so the next call only reads what was added.
   */
  function scanJsonObject(text, pos) {
    let { i, depth, inString } = pos;
    for (; i < text.length; i++) {
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
    Object.assign(pos, { i, depth, inString });
    return -1;
  }

  /**
   * Pull ytInitialPlayerResponse out of (possibly partial) watch page HTML.
   * While the page streams in, pass the same `state` object each time with
   * the longer text, and only the new part is read.
   * @returns {{status:"found", data:object}|{status:"incomplete"}|{status:"missing"}}
   */
  function extractPlayerResponse(html, state = {}) {
    if (state.start === undefined) {
      PLAYER_MARKER.lastIndex = state.from || 0;
      const m = PLAYER_MARKER.exec(html);
      if (!m) {
        state.from = Math.max(0, html.length - 64); // the marker may be split across chunks
        return { status: "missing" };
      }
      state.start = m.index + m[0].length - 1;
      state.pos = { i: state.start, depth: 0, inString: false };
    }
    const end = scanJsonObject(html, state.pos);
    if (end === -1) return { status: "incomplete" };
    try {
      return { status: "found", data: JSON.parse(html.slice(state.start, end)) };
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

  // The uploader's tags and the description's hashtags. Videos that YouTube
  // labels English but that are spoken in Hinglish are often tagged
  // "premiere pro tutorial in hindi" or "#hindi".
  function tagTextFromPlayerResponse(pr) {
    const vd = (pr && pr.videoDetails) || {};
    const tags = Array.isArray(vd.keywords) ? vd.keywords.filter((k) => typeof k === "string") : [];
    const description = typeof vd.shortDescription === "string" ? vd.shortDescription : "";
    const hashtags = description.match(/#[\p{L}\p{M}\p{N}_]+/gu) || [];
    return [...tags.slice(0, 100), ...hashtags.slice(0, 50)].join(", ").slice(0, 5000);
  }

  /**
   * Every language a text names, by the same rules as for titles. Used for
   * tags, so only language codes need to be remembered.
   */
  function namedLanguages(text) {
    if (!text) return [];
    return LANGUAGES.filter((l) => nameVerdict(text, [l.code])).map((l) => l.code);
  }

  // Tags naming more languages than this are search bait ("in hindi, in
  // tamil, in telugu…"), not the video's language.
  const MAX_TAGGED_LANGUAGES = 2;

  /**
   * A blocked language the tags name, when nothing better says otherwise.
   * The original audio track among several is trusted over tags.
   */
  function tagVerdict(sig, blocked) {
    const named = (sig && Array.isArray(sig.n) && sig.n) || [];
    if (!sig || sig.o || named.length === 0 || named.length > MAX_TAGGED_LANGUAGES) return null;
    const hit = named.find((c) => blocked.has(c));
    return hit ? { lang: hit, source: "tags" } : null;
  }

  /**
   * Decide from cached signals whether a video is in a blocked language.
   * @param {{o?:string|null, a?:string[], s?:string[], d?:string|null, n?:string[], x?:number}} sig
   *   d = language the browser detected in the description, if any
   *   n = languages the tags and hashtags name
   *   x = 1 when the caption language (s) went unconfirmed, so it's ignored
   * @returns {{lang:string, source:string}|"clear"|null}
   *   "clear" = we know the spoken language and it isn't blocked
   *   null    = no usable signal
   */
  function spokenVerdict(sig, blocked, opts = {}) {
    if (!sig || !blocked || blocked.size === 0) return null;
    const audio = sig.a || [];
    const { lang: spoken, source } = spokenLanguage(sig);
    if (spoken) {
      if (blocked.has(spoken)) return { lang: spoken, source };
      if (opts.blockDubbed) {
        const dub = audio.find((l) => blocked.has(l));
        if (dub) return { lang: dub, source: "dub" };
      }
      // English is YouTube's default label, and it is often wrong for
      // Hinglish and similar mixes. Tags naming a blocked language win over it.
      return (spoken === "en" && tagVerdict(sig, blocked)) || "clear";
    }
    if (opts.blockDubbed) {
      const dub = audio.find((l) => blocked.has(l));
      if (dub) return { lang: dub, source: "dub" };
    }
    if (sig.d && blocked.has(sig.d)) return { lang: sig.d, source: "description" };
    return tagVerdict(sig, blocked);
  }

  /**
   * The spoken language YouTube gives for a video, and where it came from.
   * The "original" track among several is the most reliable. Next comes
   * YouTube's speech recognition, unless it was marked unconfirmed (`x`, see
   * captionsNeedSupport). A lone audio track's language is only what the
   * creator picked, which is sometimes wrong (Urdu videos labelled English),
   * so it comes last.
   * @returns {{lang:string|null, source:string|null}}
   */
  function spokenLanguage(sig) {
    const audio = (sig && sig.a) || [];
    const asr = (sig && sig.s) || [];
    if (sig && sig.o) return { lang: sig.o, source: "audio" };
    if (asr.length > 0 && !sig.x) return { lang: asr[0], source: "captions" };
    if (audio.length === 1) return { lang: audio[0], source: "audio" };
    return { lang: null, source: null };
  }

  /**
   * Share of the text's letters written in `code`'s own writing system, for
   * languages that don't use the Latin alphabet (0 for those that do).
   */
  function scriptShare(text, code) {
    const { n, total } = scriptLetters(text, code);
    return total ? n / total : 0;
  }

  // Letters of the text in `code`'s own writing system (0 for the Latin
  // alphabet), and all letters.
  function scriptLetters(text, code) {
    const lang = LB.LANGUAGE_BY_CODE[normalizeCode(code)];
    if (!lang || lang.script === "Latin") return { n: 0, total: 0 };
    const { total, counts } = analyzeScripts(text);
    let n = counts[lang.script] || 0;
    // Japanese mixes kana with kanji; kanji next to kana isn't Chinese.
    if (lang.code === "ja" && n > 0) n += counts.Han || 0;
    if (lang.code === "zh" && counts.Japanese) n = 0;
    return { n, total };
  }

  // ---------------------------------------------------------------------
  // How far to trust YouTube's speech recognition
  // ---------------------------------------------------------------------

  // YouTube's speech recognition names a language even for music and very
  // short clips with little or no speech, and then the guess can be anything:
  // an 11-second bass clip without a word spoken came back as Thai. For those
  // videos the caption language only counts when something else about the
  // video points to the same language.
  const SHORT_CLIP_SECONDS = 30;

  /** Whether a video's caption language needs backing up (music, or short). */
  function captionsNeedSupport(pr) {
    const vd = (pr && pr.videoDetails) || {};
    const mf = (pr && pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
    const seconds = Number(vd.lengthSeconds || mf.lengthSeconds) || 0;
    const music = mf.category === "Music" || !!vd.musicVideoType;
    return music || (seconds > 0 && seconds < SHORT_CLIP_SECONDS);
  }

  /**
   * Whether anything besides speech recognition points to `code`: an audio
   * track label, letters of its writing system, its name, two of its everyday
   * words, or the browser's detector putting it first.
   * @param {string} code the language YouTube's speech recognition gave
   * @param {string} text the video's title, channel name, description and tags
   * @param {Array} detections detectLanguage() results for parts of that text
   * @param {string[]} audio the video's audio track languages
   */
  function languageSupported(code, text, detections = [], audio = []) {
    code = normalizeCode(code);
    if (!code) return false;
    if (audio.includes(code)) return true;
    if (scriptLetters(text, code).n >= SCRIPT_MIN_LETTERS) return true;
    if (nameVerdict(text, [code])) return true;
    const common = COMMON_WORD_SETS[code];
    if (common) {
      const words = new Set((String(text).normalize("NFC").match(/[\p{L}\p{M}]+/gu) || []).map((w) => w.toLowerCase()));
      let hits = 0;
      for (const w of words) if (common.has(w) && ++hits >= 2) return true;
    }
    return detections.some((d) => {
      const top = d && Array.isArray(d.languages) ? d.languages[0] : null;
      return !!top && normalizeCode(top.language) === code;
    });
  }

  // ---------------------------------------------------------------------
  // Language named in the title ("in Hindi", "Class 1 - Urdu / Hindi")
  // ---------------------------------------------------------------------

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // A language's name for itself, when that isn't in the Latin alphabet:
  // "हिन्दी", "اردو", "മലയാളം". Latin ones ("Indonesia", "Deutsch") are
  // ordinary words in English titles, so they are left out.
  function nativeNames(lang) {
    const names = new Set(lang.native || []);
    try {
      const own = new Intl.DisplayNames([lang.code], { type: "language" }).of(lang.code);
      if (own && own !== lang.code) names.add(own);
    } catch {
      // no Intl data for this language
    }
    return [...names].filter((n) => !/\p{Script=Latin}/u.test(n));
  }

  // Names that only ever mean the language. "Hindi song", "Bangla Tutorial"
  // and "Tutorial Hindi (2026)" are all Hindi or Bangla videos, so these
  // count wherever they stand. Names that double as everyday adjectives
  // ("French toast", "Korean BBQ", "Tamil Nadu", "Punjabi food") don't.
  const ALWAYS_THE_LANGUAGE = new Set(
    ["Hindi", "Hinglish", "Urdu", "Bangla", "Malayalam", "Telugu", "Kannada", "Marathi", "Odia", "Oriya",
      "Assamese", "Pashto", "Sinhala", "Tagalog", "Swahili", "Kiswahili", "Farsi", "Amharic"].map((n) => n.toLowerCase())
  );

  const nameMatchers = new Map(); // code -> { label, native, always, anywhere } RegExps
  function nameMatcher(code) {
    if (nameMatchers.has(code)) return nameMatchers.get(code);
    const lang = LB.LANGUAGE_BY_CODE[code];
    let re = null;
    if (lang) {
      const plain = [...lang.name.split(" / "), ...(lang.alt || [])].map((n) => n.trim());
      const names = plain.map(escapeRegExp);
      const name = `(?:${names.join("|")})`;
      const alwaysNames = plain.filter((n) => ALWAYS_THE_LANGUAGE.has(n.toLowerCase())).map(escapeRegExp);
      const always = alwaysNames.length ? new RegExp(`\\b(?:${alwaysNames.join("|")})\\b`, "iu") : null;
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
      // Written in its own script the name is a clear label wherever it
      // stands, as long as it's a whole word ("اردو / हिंदी", "【中文】",
      // but not "中文字幕").
      const own = nativeNames(lang).map(escapeRegExp);
      const native = own.length
        ? new RegExp(`(?<![\\p{L}\\p{M}])(?:${own.join("|")})(?![\\p{L}\\p{M}])`, "iu")
        : null;
      // "Basics Malayalam Tutorial" next to Malayalam script: the name counts
      // anywhere when the text is also written in that language's script.
      const anywhere = lang.script !== "Latin" ? new RegExp(`\\b${name}\\b`, "iu") : null;
      re = { label: re, native, always, anywhere, script: lang.script };
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
    let scripts = null;
    for (const code of blocked) {
      const m = nameMatcher(code);
      if (!m) continue;
      if (m.label.test(text) || (m.native && m.native.test(text)) || (m.always && m.always.test(text))) {
        return { lang: code, source: "name" };
      }
      if (m.anywhere && m.anywhere.test(text)) {
        scripts ||= analyzeScripts(text).counts;
        if ((scripts[m.script] || 0) >= SCRIPT_MIN_LETTERS) return { lang: code, source: "name" };
      }
    }
    return null;
  }

  /**
   * Combine everything we know about a video.
   * 1. YouTube says it is spoken in a blocked language: hide.
   * 2. The title names a blocked language ("in Hindi"): hide, even when
   *    YouTube labels the speech as another language.
   * 3. YouTube knows the spoken language and it isn't blocked: show. A
   *    French-looking title on a video spoken in English is not French.
   *    Except that English is YouTube's default label, and many videos
   *    spoken in other languages carry it. A title written largely in a
   *    blocked language's own script (`titleOutweighsEnglish`) wins over it.
   * 4. Otherwise the title's detected language decides.
   * @returns {{lang:string, source:string}|null} null = show the video
   */
  function finalVerdict(fromText, spoken, fromName, titleOutweighsEnglish = false) {
    if (spoken && spoken !== "clear") return spoken;
    if (fromName) return fromName;
    if (spoken === "clear" && !(titleOutweighsEnglish && fromText)) return null;
    return fromText || null;
  }

  // How much of a title has to be in a blocked language's script to outweigh
  // YouTube's "English" label: "ഇതിലും എളുപ്പത്തിൽ Premiere Pro പഠിക്കാൻ
  // പറ്റില്ല | Basics Malayalam Tutorial" is about 43%.
  const TITLE_OUTWEIGHS_ENGLISH_SHARE = 0.4;

  /**
   * Whether a title in `lang`'s script should win over YouTube saying every
   * video on the card is spoken in English.
   */
  function titleOutweighsEnglish(title, lang, sigs) {
    if (!lang || !sigs.length) return false;
    if (!sigs.every((sig) => sig && spokenLanguage(sig).lang === "en")) return false;
    return scriptShare(title, lang) >= TITLE_OUTWEIGHS_ENGLISH_SHARE;
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


  /**
   * Top language of a detectLanguage() result for `text`, when it is solid
   * enough to act on.
   */
  function confidentLanguage(text, detection, minPct = 60) {
    const top = detection && Array.isArray(detection.languages) ? detection.languages[0] : null;
    const pct = top ? Number(top.percentage) || 0 : 0;
    if (pct < minPct || !detectorTrusted(text, detection, top.language, pct)) return null;
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
    debug: false, // label every video with what LangBlock found
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
      debug: bool(s.debug, DEFAULT_SETTINGS.debug),
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
    detectorTrusted,
    scanJsonObject,
    extractPlayerResponse,
    signalsFromPlayerResponse,
    descriptionFromPlayerResponse,
    tagTextFromPlayerResponse,
    namedLanguages,
    tagVerdict,
    MAX_TAGGED_LANGUAGES,
    spokenVerdict,
    spokenLanguage,
    scriptShare,
    captionsNeedSupport,
    languageSupported,
    SHORT_CLIP_SECONDS,
    nameVerdict,
    finalVerdict,
    titleOutweighsEnglish,
    playlistVerdict,
    confidentLanguage,
    DEFAULT_SETTINGS,
    sanitizeSettings,
    surfaceForPath,
    videoIdFromHref,
  });
})(globalThis);
