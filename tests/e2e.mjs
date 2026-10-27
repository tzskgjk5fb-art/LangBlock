// End-to-end test: loads the unpacked extension into Chromium and serves fake
// YouTube pages (search results and watch pages) through request interception,
// then checks which videos get hidden.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = process.env.EXT_DIR ? path.resolve(process.env.EXT_DIR) : root;
const shots = path.join(root, "docs", "screenshots");
mkdirSync(shots, { recursive: true });

// id -> what the watch page says about the video
const VIDEOS = {
  hiTitle0001: { title: "आज का मौसम कैसा रहेगा", pr: { captions: [["hi", "asr"]] } },
  hiTitleEnSp: { title: "फ़िल्म समीक्षा: नई फ़िल्म कैसी है", pr: { captions: [["en", "asr"]] } },
  hiTitleNone: { title: "मेरा नया गाना सुनिए दोस्तों", pr: {} },
  hiTitleMrSp: { title: "आज का मौसम कैसा रहेगा", pr: { captions: [["mr", "asr"]] } },
  enTitleHiBt: { title: "My trip to Delhi vlog part 2 | दिल्ली", pr: { captions: [["en", "asr"]] } },
  hiAsr000001: { title: "iPhone 17 review after 30 days", pr: { captions: [["hi", "asr"], ["en", ""]] } },
  enAsr000001: { title: "How to cook pasta like an Italian", pr: { captions: [["en", "asr"]] } },
  hiOrig00001: { title: "Funny cat compilation 2026", pr: { audio: [["en.3", "English"], ["hi.4", "Hindi original"]] } },
  enOrigDub01: { title: "Space documentary", pr: { audio: [["en.4", "English original"], ["hi.3", "Hindi"]] } },
  hiDesc00001: {
    title: "My vlog episode 12",
    pr: { desc: "आज हम अपने दोस्तों के साथ बाजार गए और बहुत सारी चीजें खरीदीं। यह वीडियो देखने के लिए धन्यवाद, कृपया चैनल को सब्सक्राइब करें और अपने दोस्तों के साथ साझा करें।" },
  },
  genericHi01: { title: "Mystery card layout", pr: { captions: [["hi", "asr"]] } },
  lateHi00001: { title: "Added later", pr: { captions: [["hi", "asr"]] } },
  flakyHi0001: { title: "Weekend cooking vlog", pr: { captions: [["hi", "asr"]] } },
  brokenVid01: { title: "Always fails", pr: {} },
  lateTitle01: { title: "", pr: {} },
  oldCacheHi1: { title: "Photoshop basics for beginners", pr: { captions: [["en", "asr"]], keywords: ["photoshop in hindi"] } },
  // Spoken in Hinglish, but YouTube labels it English; only the tags say Hindi
  enAsrTagHi1: {
    title: "Premier Pro Tutorial for Beginners 2026 - Everything You Need To Know!",
    pr: {
      captions: [["en", "asr"]],
      keywords: ["premiere pro tutorial", "premiere pro tutorial in hindi"],
      desc: "Hey everyone! Drop your doubts in the comments.\n#premierepro #hindi",
    },
  },
  enAsrTagSpm: {
    title: "Video editing basics",
    pr: { captions: [["en", "asr"]], keywords: ["editing in hindi", "editing in tamil", "editing in telugu"] },
  },
  recycledEn1: { title: "Recycled card", pr: { captions: [["en", "asr"]] } },
  recycledHi1: { title: "Recycled card", pr: { captions: [["hi", "asr"]] } },
  // playlists
  plHiVid0001: { title: "Lesson 1", pr: { captions: [["hi", "asr"]] } },
  plHiVid0002: { title: "Lesson 2", pr: { captions: [["hi", "asr"]] } },
  plUrVid0001: { title: "Before you Start Learning Premiere Class 1 - Urdu / Hindi", pr: { captions: [["ur", "asr"]] } },
  plUrVid0002: { title: "Project Window - Premiere Class 2 - Urdu / Hindi", pr: { captions: [["ur", "asr"]] } },
  plEnVid0001: { title: "Intro to editing", pr: { captions: [["en", "asr"]] } },
  plEnVid0002: { title: "Cutting basics", pr: { captions: [["en", "asr"]] } },
};

// A playlist card the way YouTube's newer layout shows it in search: the
// thumbnail opens the first video in the playlist, and the first two videos
// are listed under the title.
function playlistCard(name, title, first, second) {
  return `<yt-lockup-view-model id="card-${name}" class="card">
    <a href="/watch?v=${first}&list=PL${name}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"><span>22:18</span></a>
    <h3><a href="/playlist?list=PL${name}" title="${title}">${title}</a></h3>
    <div class="yt-content-metadata-view-model__metadata-text">Some Channel · Playlist</div>
    <a href="/watch?v=${first}&list=PL${name}">${VIDEOS[first].title} · 22:21</a>
    <a href="/watch?v=${second}&list=PL${name}">${VIDEOS[second].title} · 17:47</a>
    <a href="/playlist?list=PL${name}">View full playlist</a>
  </yt-lockup-view-model>`;
}

function playerResponse({ captions = [], audio = [], desc = "", keywords }) {
  return {
    playabilityStatus: { status: "OK" },
    videoDetails: { shortDescription: desc, ...(keywords ? { keywords } : {}) },
    streamingData: {
      adaptiveFormats: [
        { itag: 137, mimeType: "video/mp4" },
        ...audio.map(([id, displayName]) => ({ itag: 140, mimeType: "audio/mp4", audioTrack: { id, displayName } })),
      ],
    },
    captions: captions.length
      ? {
          playerCaptionsTracklistRenderer: {
            captionTracks: captions.map(([languageCode, kind]) => ({
              languageCode,
              ...(kind ? { kind } : {}),
              vssId: (kind === "asr" ? "a." : ".") + languageCode,
            })),
          },
        }
      : undefined,
  };
}

const watchCalls = [];
function watchPage(id) {
  const v = VIDEOS[id];
  const pr = JSON.stringify(playerResponse(v ? v.pr : {}));
  // Big filler after the player data, to exercise the streaming early exit.
  return `<!doctype html><html><head><script>var ytcfg = {"a":"}"};</script></head><body>
<script>var ytInitialPlayerResponse = ${pr};var meta = document.querySelector('meta');</script>
<script>var ytInitialData = {"filler":"${"x".repeat(200000)}"};</script></body></html>`;
}

function card(id, tag = "ytd-video-renderer") {
  const t = VIDEOS[id].title;
  return `<${tag} id="card-${id}" class="card">
    <a href="/watch?v=${id}"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"></a>
    <a id="video-title" href="/watch?v=${id}" title="${t}">${t}</a>
    <ytd-channel-name><div id="text">Some Channel</div></ytd-channel-name>
  </${tag}>`;
}

function searchPage() {
  const ids = ["hiTitle0001", "hiTitleEnSp", "hiTitleNone", "hiTitleMrSp", "enTitleHiBt", "hiAsr000001", "enAsr000001", "hiOrig00001", "enOrigDub01", "hiDesc00001", "enAsrTagHi1", "enAsrTagSpm"];
  return `<!doctype html><html><body><ytd-app><div id="contents">
${ids.map((id) => card(id)).join("\n")}
<div class="future-layout" id="card-genericHi01">
  <a href="/watch?v=genericHi01"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"></a>
  <span>Mystery card layout</span>
</div>
${card("recycledEn1")}
${playlistCard("plHindi", "Learn editing", "plHiVid0001", "plHiVid0002")}
${playlistCard("plUrduHindi", "Adobe Premiere Pro CC Course", "plUrVid0001", "plUrVid0002")}
${playlistCard("plEnglish", "Editing course", "plEnVid0001", "plEnVid0002")}
<ytd-playlist-renderer id="card-plTextOnly" class="card">
  <a href="/playlist?list=PLtextonly"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="160" height="90"></a>
  <h3><a href="/playlist?list=PLtextonly">Adobe Premiere Pro CC Course</a></h3>
  <div>Before you Start Learning Adobe Premiere Pro CC Class 1 - Urdu / Hindi · 22:21</div>
  <a href="/playlist?list=PLtextonly">View full playlist</a>
</ytd-playlist-renderer>
</div></ytd-app></body></html>`;
}

// A long results page that loads scrolled to the bottom: the cards on screen
// are last in page order, and should still be checked first.
const PRIORITY_IDS = Array.from({ length: 16 }, (_, i) => `prio${String(i).padStart(7, "0")}`);
for (const id of PRIORITY_IDS) VIDEOS[id] = { title: `Ordinary video ${id}`, pr: { captions: [["en", "asr"]] } };
function priorityPage() {
  return `<!doctype html><html><body style="margin:0"><ytd-app><div id="contents">
${PRIORITY_IDS.map((id) => card(id).replace('width="160" height="90"', 'width="160" height="300" style="display:block"')).join("\n")}
</div></ytd-app><script>window.scrollTo(0, document.body.scrollHeight);</script></body></html>`;
}

async function hiddenState(page) {
  return page.$$eval(".card, .future-layout", (els) =>
    Object.fromEntries(els.map((e) => [e.id.replace("card-", ""), e.getAttribute("data-langblock") || "shown"]))
  );
}

async function waitSettled(page) {
  await page.waitForFunction(() => document.querySelectorAll('[data-langblock="pending"]').length === 0, null, {
    timeout: 15000,
  });
  await page.waitForTimeout(300);
}

const userDataDir = mkdtempSync(path.join(os.tmpdir(), "langblock-e2e-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  await context.route("https://www.youtube.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/results") {
      const body = url.searchParams.get("search_query") === "priority" ? priorityPage() : searchPage();
      return route.fulfill({ contentType: "text/html; charset=utf-8", body });
    }
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      watchCalls.push(id);
      const calls = watchCalls.filter((v) => v === id).length;
      // The first two checks of this video fail, as on a flaky connection:
      // YouTube is busy, then sends a page without the video data.
      if (id === "flakyHi0001" && calls === 1) return route.fulfill({ status: 503, body: "busy" });
      if (id === "flakyHi0001" && calls === 2) return route.fulfill({ contentType: "text/html", body: "<html>consent</html>" });
      if (id === "brokenVid01") return route.fulfill({ status: 503, body: "busy" });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: watchPage(id) });
    }
    return route.fulfill({ contentType: "text/html", body: "<html><body>home</body></html>" });
  });

  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extId = new URL(worker.url()).host;

  // The settings page opens itself on install. Use it to block Hindi.
  // It opens by itself on install; wait for that tab instead of racing it.
  const optionsUrl = `chrome-extension://${extId}/ui/options.html`;
  let options = null;
  for (let i = 0; i < 30 && !options; i++) {
    options = context.pages().find((p) => p.url().startsWith(optionsUrl)) || null;
    if (!options) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(options, "settings page opens on install");
  await options.waitForLoadState();
  await options.fill("#lang-search", "hin");
  await options.check("#lang-list input[type=checkbox]");
  await options.waitForSelector(".chip");
  assert.equal(await options.textContent(".chip span"), "Hindi");
  await options.fill("#lang-search", "");
  await options.screenshot({ path: path.join(shots, "options.png"), fullPage: true });
  assert.ok(await options.isVisible("#donate"), "donation link shown");
  assert.match(await options.getAttribute("#donate", "href"), /^https:\/\//);

  // Search page
  const yt = await context.newPage();
  await yt.goto("https://www.youtube.com/results?search_query=test");
  await waitSettled(yt);
  let state = await hiddenState(yt);
  console.log("search page:", state);
  assert.equal(state.hiTitle0001, "blocked", "Devanagari title");
  assert.equal(state.hiAsr000001, "blocked", "Hindi auto-captions");
  assert.equal(state.enAsr000001, "shown", "English auto-captions");
  assert.equal(state.hiOrig00001, "blocked", "Hindi original audio");
  assert.equal(state.enOrigDub01, "shown", "English original with Hindi dub");
  assert.equal(state.hiDesc00001, "blocked", "Hindi description");
  assert.equal(state.genericHi01, "blocked", "unknown card layout");
  assert.equal(state.recycledEn1, "shown");
  assert.equal(state.plHindi, "blocked", "playlist of Hindi videos");
  assert.equal(state.plUrduHindi, "blocked", "playlist whose videos say 'Urdu / Hindi'");
  assert.equal(state.plEnglish, "shown", "playlist of English videos");
  assert.equal(state.plTextOnly, "blocked", "playlist card without video links, judged by its text");
  assert.equal(state.hiTitleEnSp, "blocked", "title in Hindi script outweighs YouTube's English label");
  assert.equal(state.hiTitleMrSp, "shown", "Hindi-looking title but YouTube says Marathi: the spoken language wins");
  assert.equal(state.enTitleHiBt, "shown", "a few Hindi letters in an English title don't outweigh English captions");
  assert.equal(state.hiTitleNone, "blocked", "Hindi title, no spoken-language info: title decides");
  assert.equal(state.enAsrTagHi1, "blocked", "labelled English, but the tags say Hindi");
  assert.equal(state.enAsrTagSpm, "shown", "tags naming many languages are ignored");
  assert.equal(await yt.isVisible("#card-hiAsr000001"), false, "blocked card is not displayed");

  // A card added later (infinite scroll)
  await yt.evaluate((html) => document.getElementById("contents").insertAdjacentHTML("beforeend", html), card("lateHi00001"));
  await yt.waitForTimeout(400);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).lateHi00001, "blocked", "card added later");

  // A check that fails is tried again a few seconds later, and again
  const flakyStart = Date.now();
  await yt.evaluate((html) => document.getElementById("contents").insertAdjacentHTML("beforeend", html), card("flakyHi0001"));
  await yt.waitForFunction(
    () => document.getElementById("card-flakyHi0001")?.getAttribute("data-langblock") === "blocked",
    null,
    { timeout: 30000 }
  );
  assert.equal(watchCalls.filter((v) => v === "flakyHi0001").length, 3, "failed check retried twice");
  console.log(`flaky video hidden after ${((Date.now() - flakyStart) / 1000).toFixed(1)} s`);

  // YouTube fills in a card's title after its link: the card is judged again
  await yt.evaluate((html) => document.getElementById("contents").insertAdjacentHTML("beforeend", html), card("lateTitle01"));
  await yt.waitForTimeout(400);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).lateTitle01, "shown", "no title yet");
  await yt.evaluate(() => {
    const t = "मेरा नया गाना सुनिए दोस्तों";
    const a = document.querySelector("#card-lateTitle01 #video-title");
    a.textContent = t;
    a.setAttribute("title", t);
  });
  await yt.waitForTimeout(400);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).lateTitle01, "blocked", "title filled in later");

  // A video remembered by an older version, before tags were read, is
  // checked once more and its tags count
  await options.evaluate(() =>
    chrome.storage.local.set({ "v:oldCacheHi1": { o: null, a: [], s: ["en"], d: null, t: Date.now() } })
  );
  await yt.evaluate((html) => document.getElementById("contents").insertAdjacentHTML("beforeend", html), card("oldCacheHi1"));
  await yt.waitForFunction(
    () => document.getElementById("card-oldCacheHi1")?.getAttribute("data-langblock") === "blocked",
    null,
    { timeout: 15000 }
  );
  assert.equal(watchCalls.filter((v) => v === "oldCacheHi1").length, 1, "old entry checked again once");

  // YouTube reuses card elements: swap a shown card's link to a Hindi video
  await yt.evaluate(() => {
    for (const a of document.querySelectorAll("#card-recycledEn1 a")) a.setAttribute("href", "/watch?v=recycledHi1");
  });
  await yt.waitForTimeout(400);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).recycledEn1, "blocked", "recycled card re-checked");

  // Second visit uses the cache: no new watch page requests
  const before = watchCalls.length;
  await yt.reload();
  await waitSettled(yt);
  assert.equal(watchCalls.length, before, "cached results reused");
  assert.equal((await hiddenState(yt)).hiAsr000001, "blocked");

  // Dubbed-track option
  await options.check("#blockDubbed");
  await yt.waitForTimeout(500);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).enOrigDub01, "blocked", "dub option");
  await options.uncheck("#blockDubbed");

  // Dim mode
  await options.check('input[name="action"][value="dim"]');
  await yt.waitForTimeout(400);
  assert.equal(await yt.isVisible("#card-hiAsr000001"), true, "dimmed card stays visible");
  const why = await yt.getAttribute("#card-hiAsr000001", "data-langblock-why");
  assert.equal(why, "Hidden by LangBlock: Hindi (spoken)");
  assert.equal(await yt.getAttribute("#card-enAsrTagHi1", "data-langblock-why"), "Hidden by LangBlock: Hindi (tags)");
  await yt.screenshot({ path: path.join(shots, "search-dimmed.png"), fullPage: true });
  await options.check('input[name="action"][value="hide"]');

  // Troubleshooting labels
  await options.check("#debug");
  await yt.waitForTimeout(500);
  await waitSettled(yt);
  const shownLabel = await yt.getAttribute("#card-enAsr000001", "data-langblock-debug");
  console.log("debug label (shown):", shownLabel);
  assert.match(shownLabel, /^LangBlock: Shown · spoken: English \(auto-captions\)/);
  const hiddenLabel = await yt.getAttribute("#card-plUrduHindi", "data-langblock-debug");
  console.log("debug label (hidden):", hiddenLabel);
  assert.match(hiddenLabel, /^LangBlock: Hidden: Hindi \(name\) · playlist, 2 videos found/);
  const tagLabel = await yt.getAttribute("#card-enAsrTagHi1", "data-langblock-debug");
  console.log("debug label (tags):", tagLabel);
  assert.match(tagLabel, /^LangBlock: Hidden: Hindi \(tags\) · spoken: English \(auto-captions\), tags name Hindi/);
  // A check that keeps failing says why
  await yt.evaluate((html) => {
    document.getElementById("contents").insertAdjacentHTML("beforeend", html);
    document.getElementById("card-brokenVid01").scrollIntoView();
  }, card("brokenVid01"));
  await yt.waitForFunction(
    () => /try 2 of 5 \(last: YouTube answered 503\)/.test(document.getElementById("card-brokenVid01")?.getAttribute("data-langblock-debug") || ""),
    null,
    { timeout: 15000 }
  );
  console.log("debug label (failing):", await yt.getAttribute("#card-brokenVid01", "data-langblock-debug"));
  await yt.evaluate(() => document.getElementById("card-brokenVid01").remove());
  assert.equal(await yt.isVisible("#card-hiAsr000001"), true, "hidden videos are faded in troubleshooting mode");
  await yt.screenshot({ path: path.join(shots, "search-debug.png"), fullPage: true });
  await options.uncheck("#debug");
  await yt.waitForTimeout(400);
  assert.equal(await yt.getAttribute("#card-enAsr000001", "data-langblock-debug"), null, "labels removed");

  // Turning search filtering off shows everything
  await options.uncheck('[data-surface="search"]');
  await yt.waitForTimeout(500);
  state = await hiddenState(yt);
  assert.ok(Object.values(state).every((s) => s === "shown"), "search filtering off");
  await options.check('[data-surface="search"]');

  // Master switch off
  await options.uncheck("#enabled");
  await yt.waitForTimeout(500);
  assert.ok(Object.values(await hiddenState(yt)).every((s) => s === "shown"), "extension off");
  await options.check("#enabled");

  // "Block all except English", individual changes afterwards, "Unblock all" and Undo
  const summary = () => options.textContent("#chips");
  assert.equal(await options.textContent("#block-all"), "Block all except English");
  await options.click("#block-all");
  await options.waitForFunction(() => document.getElementById("chips").textContent.startsWith("Blocking"));
  assert.match(await summary(), /^Blocking (\d+) of \1 languages\.|^Blocking \d+ of \d+ languages\. Not blocked: English\.$/);
  assert.equal(await options.isDisabled("#block-all"), true, "already blocking all but English");
  assert.equal(await options.isVisible("#bulk-msg button"), true, "undo offered");
  await yt.waitForTimeout(500);
  await waitSettled(yt);
  state = await hiddenState(yt);
  assert.equal(state.enAsr000001, "shown", "English stays visible with everything else blocked");
  assert.equal(state.hiAsr000001, "blocked");
  await options.fill("#lang-search", "fren");
  await options.uncheck("#lang-list input[type=checkbox]");
  await options.waitForFunction(() => document.getElementById("chips").textContent.endsWith("Not blocked: English, French."));
  assert.equal(await options.isVisible("#bulk-msg"), false, "an individual change replaces Undo");
  assert.equal(await options.isDisabled("#block-all"), false);
  await options.fill("#lang-search", "");
  await options.click("#unblock-all");
  await options.waitForSelector("#no-langs", { state: "visible" });
  assert.equal(await options.isDisabled("#unblock-all"), true);
  await yt.waitForTimeout(500);
  assert.ok(Object.values(await hiddenState(yt)).every((s) => s === "shown"), "nothing blocked");
  await options.click("#bulk-msg button");
  await options.waitForFunction(() => document.getElementById("chips").textContent.endsWith("Not blocked: English, French."));
  // Back to Hindi only
  await options.click("#unblock-all");
  await options.fill("#lang-search", "hin");
  await options.check("#lang-list input[type=checkbox]");
  await options.fill("#lang-search", "");
  await options.waitForFunction(() => document.querySelector("#chips .chip span")?.textContent === "Hindi");

  // On-screen videos are checked first
  const prio = await context.newPage();
  const prioStart = watchCalls.length;
  await prio.goto("https://www.youtube.com/results?search_query=priority");
  const onScreenNow = () =>
    prio.$$eval(".card", (els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight;
        })
        .map((e) => e.id.replace("card-", ""))
    );
  const visible = await onScreenNow();
  await prio.waitForFunction(
    (ids) => ids.every((id) => document.getElementById("card-" + id)?.hasAttribute("data-lb-done") && document.getElementById("card-" + id).getAttribute("data-langblock") !== "pending"),
    visible,
    { timeout: 15000 }
  );
  const order = watchCalls.slice(prioStart).filter((id) => id.startsWith("prio"));
  console.log("on screen:", visible.join(" "), "| checked in order:", order.join(" "));
  assert.ok(visible.length >= 2 && visible.every((id) => order.indexOf(id) !== -1 && order.indexOf(id) < visible.length), "on-screen cards checked first");
  await prio.close();

  // Popup reports the count for the active tab
  await yt.bringToFront();
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 520 });
  await popup.goto(`chrome-extension://${extId}/ui/popup.html`);
  await popup.waitForTimeout(500);
  console.log("popup status:", await popup.textContent("#status"));
  await popup.screenshot({ path: path.join(shots, "popup.png") });

  // Clearing the cache works
  await options.click("#clear-cache");
  await options.waitForFunction(() => document.getElementById("cache-count").textContent === "0");

  console.log("E2E OK. Watch page requests:", watchCalls.length);
} finally {
  await context.close();
}
