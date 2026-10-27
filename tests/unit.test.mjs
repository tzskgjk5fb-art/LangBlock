// Unit tests for the pure detection logic (src/languages.js, src/detect.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ URL });
for (const f of ["src/languages.js", "src/detect.js"]) {
  vm.runInContext(readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const LB = ctx.LangBlock;
const set = (...codes) => new Set(codes);
const det = (isReliable, ...pairs) => ({
  isReliable,
  languages: pairs.map(([language, percentage]) => ({ language, percentage })),
});

test("normalizeCode handles regions, scripts and old codes", () => {
  assert.equal(LB.normalizeCode("en-US"), "en");
  assert.equal(LB.normalizeCode("hi-Latn"), "hi");
  assert.equal(LB.normalizeCode("pt_BR"), "pt");
  assert.equal(LB.normalizeCode("iw"), "he");
  assert.equal(LB.normalizeCode("in"), "id");
  assert.equal(LB.normalizeCode("tl"), "fil");
  assert.equal(LB.normalizeCode(""), null);
  assert.equal(LB.normalizeCode(undefined), null);
});

test("Devanagari title is blocked for Hindi even without a detector", () => {
  const v = LB.textVerdict("आज का मौसम कैसा है", null, set("hi"));
  assert.deepEqual({ ...v }, { lang: "hi", source: "script" });
});

test("mixed English title with a Hindi word is blocked", () => {
  const v = LB.textVerdict("Best phones under 20000 | हिंदी", null, set("hi"));
  assert.equal(v && v.lang, "hi");
});

test("Marathi title is not blocked when only Hindi is blocked and detector says Marathi", () => {
  const v = LB.textVerdict("आमची मुंबई खूप छान आहे", det(true, ["mr", 97]), set("hi"));
  assert.equal(v, null);
});

test("detector result for Hindi blocks", () => {
  const v = LB.textVerdict("aaj ka mausam kaisa hai bhai dekho yeh video", det(true, ["hi-Latn", 90]), set("hi"));
  assert.equal(v && v.lang, "hi");
});

test("Latin-alphabet titles need everyday words of the detected language", () => {
  // Chrome's detector really does say Maltese, 100%, reliable, for this one.
  const brand = "Adobe Premiere Pro Tutorials · Editors Keys · Playlist";
  assert.equal(LB.detectorTrusted(brand, det(true, ["mt", 100]), "mt", 100), true, "no word list: six words are enough");
  assert.equal(LB.textVerdict(brand, det(true, ["it", 100]), set("it")), null);
  assert.equal(LB.textVerdict("Adobe Premiere Pro CC Course GFXMentor", det(true, ["it", 100]), set("it")), null);
  assert.equal(LB.textVerdict("Dan and Phil play UNO", det(true, ["id", 95]), set("id")), null, "one stray hit isn't enough");
  const italian = "Come preparare la vera pasta alla carbonara romana";
  assert.equal(LB.textVerdict(italian, det(true, ["it", 98]), set("it")).lang, "it");
  assert.equal(LB.textVerdict(italian, det(false, ["it", 98]), set("it")), null, "unsure detector");
  assert.equal(LB.textVerdict(italian, det(true, ["it", 70]), set("it")), null, "below 80%");
  assert.equal(LB.textVerdict("Les meilleurs moments de la saison", det(true, ["fr", 100]), set("fr")).lang, "fr");
  assert.equal(LB.textVerdict("Cómo hacer una paella valenciana", det(true, ["es", 100]), set("es")).lang, "es");
});

test("other writing systems keep the lighter detector rule", () => {
  assert.equal(LB.detectorTrusted("Новое видео", det(true, ["ru", 50]), "ru", 50), true);
  assert.equal(LB.detectorTrusted("Новое видео", det(false, ["ru", 99]), "ru", 99), false);
});

test("description language needs the same evidence", () => {
  assert.equal(LB.confidentLanguage("Adobe Premiere Pro Tutorials", det(true, ["it", 100])), null);
  const desc = "In questo video vi mostro come fare la pasta fresca in casa, passo per passo.";
  assert.equal(LB.confidentLanguage(desc, det(true, ["it", 99])), "it");
  assert.equal(LB.confidentLanguage("", null), null);
});

test("spokenVerdict: auto-captions beat a lone audio track's label", () => {
  assert.deepEqual({ ...LB.spokenVerdict({ o: null, a: ["en"], s: ["hi"] }, set("hi")) }, { lang: "hi", source: "captions" });
  assert.equal(LB.spokenVerdict({ o: null, a: ["en"], s: [] }, set("hi")), "clear");
});

test("English title is not blocked", () => {
  assert.equal(LB.textVerdict("How to cook pasta", det(true, ["en", 99]), set("hi")), null);
  assert.equal(LB.textVerdict("How to cook pasta", null, set("hi")), null);
});

test("unreliable short detection does not block Latin text", () => {
  assert.equal(LB.textVerdict("Vlog 23", det(false, ["hi", 80]), set("hi")), null);
});

test("unique scripts map to one language", () => {
  assert.equal(LB.textVerdict("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ ਜੀ", null, set("pa")).lang, "pa");
  assert.equal(LB.textVerdict("안녕하세요 여러분", null, set("ko")).lang, "ko");
  assert.equal(LB.textVerdict("สวัสดีครับ ทุกคน", null, set("th")).lang, "th");
  assert.equal(LB.textVerdict("こんにちは皆さん", null, set("ja")).lang, "ja");
});

test("Japanese kanji is not mistaken for Chinese", () => {
  assert.equal(LB.textVerdict("今日は東京で美味しいラーメンを食べました", null, set("zh")), null);
  assert.equal(LB.textVerdict("今天我们去北京吃烤鸭", null, set("zh")).lang, "zh");
});

test("a few stray letters of another script are ignored", () => {
  // two Devanagari letters in a long English title
  assert.equal(LB.textVerdict("A very long English title about cooking pasta at home ॐ", null, set("hi")), null);
});

test("nothing blocked means nothing is hidden", () => {
  assert.equal(LB.textVerdict("आज का मौसम", null, set()), null);
});

const playerResponse = (opts) => ({
  videoDetails: { shortDescription: opts.desc || "" },
  streamingData: {
    adaptiveFormats: (opts.audio || []).map(([id, displayName]) => ({
      mimeType: "audio/mp4",
      audioTrack: { id, displayName, audioIsDefault: false },
    })),
  },
  captions: opts.captions
    ? {
        playerCaptionsTracklistRenderer: {
          captionTracks: opts.captions.map(([languageCode, kind]) => ({
            languageCode,
            kind,
            vssId: (kind === "asr" ? "a." : ".") + languageCode,
          })),
        },
      }
    : undefined,
});

test("signals: auto-caption language", () => {
  const sig = LB.signalsFromPlayerResponse(playerResponse({ captions: [["en", undefined], ["hi", "asr"]] }));
  assert.deepEqual({ ...sig, a: [...sig.a], s: [...sig.s] }, { o: null, a: [], s: ["hi"] });
});

test("signals: original audio track among dubs", () => {
  const sig = LB.signalsFromPlayerResponse(
    playerResponse({
      audio: [
        ["en.3", "English (United States)"],
        ["hi.4", "Hindi original"],
        ["es.3", "Spanish"],
      ],
    })
  );
  assert.equal(sig.o, "hi");
  assert.deepEqual([...sig.a], ["en", "hi", "es"]);
});

test("spokenVerdict: blocks by original audio, then captions", () => {
  assert.deepEqual({ ...LB.spokenVerdict({ o: "hi", a: ["hi", "en"], s: [] }, set("hi")) }, { lang: "hi", source: "audio" });
  assert.deepEqual({ ...LB.spokenVerdict({ o: null, a: [], s: ["hi"] }, set("hi")) }, { lang: "hi", source: "captions" });
  assert.equal(LB.spokenVerdict({ o: null, a: [], s: ["en"] }, set("hi")), "clear");
  assert.equal(LB.spokenVerdict({ o: null, a: [], s: [] }, set("hi")), null);
});

test("spokenVerdict: original audio beats auto-captions of a dub", () => {
  assert.equal(LB.spokenVerdict({ o: "en", a: ["en", "hi"], s: ["hi"] }, set("hi")), "clear");
});

test("spokenVerdict: dubbed tracks only block when asked", () => {
  const sig = { o: "en", a: ["en", "hi"], s: ["en"] };
  assert.equal(LB.spokenVerdict(sig, set("hi"), { blockDubbed: false }), "clear");
  assert.deepEqual({ ...LB.spokenVerdict(sig, set("hi"), { blockDubbed: true }) }, { lang: "hi", source: "dub" });
});

test("spokenVerdict: description is the last resort", () => {
  assert.deepEqual({ ...LB.spokenVerdict({ o: null, a: [], s: [], d: "hi" }, set("hi")) }, { lang: "hi", source: "description" });
  assert.equal(LB.spokenVerdict({ o: null, a: [], s: ["en"], d: "hi" }, set("hi")), "clear");
});

test("finalVerdict: spoken language outranks the title", () => {
  const fr = { lang: "fr", source: "title" };
  assert.equal(LB.finalVerdict(fr, "clear"), null);
  assert.deepEqual({ ...LB.finalVerdict(fr, null) }, fr);
  assert.deepEqual({ ...LB.finalVerdict(null, { lang: "fr", source: "captions" }) }, { lang: "fr", source: "captions" });
  assert.equal(LB.finalVerdict(null, null), null);
  assert.equal(LB.finalVerdict(null, "clear"), null);
});

test("nameVerdict: language named as the video's language", () => {
  const hi = set("hi");
  assert.equal(LB.nameVerdict("Premiere Pro Class 1 - Urdu / Hindi 22:21", hi).lang, "hi");
  assert.equal(LB.nameVerdict("Full tutorial in Hindi", hi).lang, "hi");
  assert.equal(LB.nameVerdict("iPhone 17 review (Hindi)", hi).lang, "hi");
  assert.equal(LB.nameVerdict("Hindi/Urdu tutorial", hi).lang, "hi");
  assert.equal(LB.nameVerdict("Avengers Hindi Dubbed", hi).lang, "hi");
  assert.equal(LB.nameVerdict("Hindi vs Urdu explained", hi), null);
  assert.equal(LB.nameVerdict("Learn Hindi fast", hi), null);
  assert.equal(LB.nameVerdict("French toast recipe", set("fr")), null);
  assert.equal(LB.nameVerdict("Life in Thai prison", set("th")), null);
  assert.equal(LB.nameVerdict("Street food | Thai", set("th")).lang, "th");
});

test("finalVerdict: a named language outranks a spoken 'clear'", () => {
  const name = { lang: "hi", source: "name" };
  const spokenHi = { lang: "hi", source: "captions" };
  assert.deepEqual({ ...LB.finalVerdict(null, "clear", name) }, name);
  assert.deepEqual({ ...LB.finalVerdict(null, spokenHi, name) }, spokenHi);
  assert.equal(LB.finalVerdict({ lang: "fr", source: "title" }, "clear", null), null);
});

test("playlistVerdict: hidden when at least half the known videos are blocked", () => {
  const hi = { lang: "hi", source: "captions" };
  assert.deepEqual({ ...LB.playlistVerdict([hi, "clear"]) }, hi);
  assert.deepEqual({ ...LB.playlistVerdict([hi, null, null]) }, hi);
  assert.equal(LB.playlistVerdict(["clear", "clear", hi]), "clear");
  assert.equal(LB.playlistVerdict([null, null]), null);
});

test("extractPlayerResponse handles partial and full pages", () => {
  const json = JSON.stringify({ a: "x}{\"y", nested: { b: [1, { c: "}" }] } });
  const html = `<html><script>var foo = 1;var ytInitialPlayerResponse = ${json};var meta = {};</script></html>`;
  const r = LB.extractPlayerResponse(html);
  assert.equal(r.status, "found");
  assert.equal(r.data.nested.b[1].c, "}");
  assert.equal(LB.extractPlayerResponse(html.slice(0, html.indexOf("nested"))).status, "incomplete");
  assert.equal(LB.extractPlayerResponse("<html>nothing</html>").status, "missing");
});

test("videoIdFromHref", () => {
  assert.equal(LB.videoIdFromHref("/watch?v=dQw4w9WgXcQ&t=10s"), "dQw4w9WgXcQ");
  assert.equal(LB.videoIdFromHref("/shorts/abcdefghijk"), "abcdefghijk");
  assert.equal(LB.videoIdFromHref("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(LB.videoIdFromHref("https://evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(LB.videoIdFromHref("/watch?v=bad"), null);
  assert.equal(LB.videoIdFromHref("/playlist?list=PL123"), null);
});

test("surfaceForPath", () => {
  assert.equal(LB.surfaceForPath("/results"), "search");
  assert.equal(LB.surfaceForPath("/"), "home");
  assert.equal(LB.surfaceForPath("/feed/subscriptions"), "home");
  assert.equal(LB.surfaceForPath("/watch"), "watch");
  assert.equal(LB.surfaceForPath("/@somechannel/videos"), "channel");
  assert.equal(LB.surfaceForPath("/shorts/abcdefghijk"), null);
});

test("sanitizeSettings rejects junk", () => {
  const s = LB.sanitizeSettings({ enabled: "yes", blocked: ["hi-IN", "xx", 5, "hi"], action: "explode", surfaces: { search: false } });
  assert.equal(s.enabled, true);
  assert.deepEqual([...s.blocked], ["hi"]);
  assert.equal(s.action, "hide");
  assert.equal(s.surfaces.search, false);
  assert.equal(s.surfaces.home, true);
  assert.equal(s.deepCheck, true);
});

// The Chrome Web Store rejects a package when any locale lacks the name.
test("every translation has the same messages and placeholders as English", () => {
  const dir = path.join(root, "_locales");
  const read = (loc) => JSON.parse(readFileSync(path.join(dir, loc, "messages.json"), "utf8"));
  const en = read("en");
  const holders = (m) => (m.message.match(/\$[A-Z]+\$/g) || []).map((p) => p.toLowerCase()).sort();
  for (const loc of readdirSync(dir)) {
    const msgs = read(loc);
    for (const key of Object.keys(en)) {
      assert.ok(msgs[key], `${loc} is missing ${key}`);
      assert.deepEqual(holders(msgs[key]), holders(en[key]), `${loc}/${key} placeholders`);
      for (const p of holders(msgs[key])) {
        assert.ok(msgs[key].placeholders && msgs[key].placeholders[p.slice(1, -1)], `${loc}/${key} defines ${p}`);
      }
    }
    for (const key of Object.keys(msgs)) assert.ok(en[key], `${loc} has unknown key ${key}`);
    assert.ok(msgs.extDescription.message.length <= 132, `${loc} description too long for the stores`);
  }
});
