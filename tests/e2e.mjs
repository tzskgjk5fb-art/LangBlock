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

function playerResponse({ captions = [], audio = [], desc = "" }) {
  return {
    playabilityStatus: { status: "OK" },
    videoDetails: { shortDescription: desc },
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
  const ids = ["hiTitle0001", "hiTitleEnSp", "hiTitleNone", "hiAsr000001", "enAsr000001", "hiOrig00001", "enOrigDub01", "hiDesc00001"];
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
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: searchPage() });
    }
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v");
      watchCalls.push(id);
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
  assert.equal(state.hiTitleEnSp, "shown", "Hindi title but spoken English: spoken language wins");
  assert.equal(state.hiTitleNone, "blocked", "Hindi title, no spoken-language info: title decides");
  assert.equal(await yt.isVisible("#card-hiAsr000001"), false, "blocked card is not displayed");

  // A card added later (infinite scroll)
  await yt.evaluate((html) => document.getElementById("contents").insertAdjacentHTML("beforeend", html), card("lateHi00001"));
  await yt.waitForTimeout(400);
  await waitSettled(yt);
  assert.equal((await hiddenState(yt)).lateHi00001, "blocked", "card added later");

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
