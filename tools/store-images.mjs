// Renders store images: docs/store/promo-440x280.png and a 1280x800 settings screenshot.
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "store");
const ext = path.join(root, "dist", "chrome");
const icon = readFileSync(path.join(root, "icons", "icon.svg"), "utf8");

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(os.tmpdir(), "lb-img-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await new Promise((r) => setTimeout(r, 1000)); // let the first-run settings tab open

  const promo = await ctx.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(`<html><body style="margin:0;width:440px;height:280px;display:flex;align-items:center;gap:22px;padding:0 32px;box-sizing:border-box;background:linear-gradient(135deg,#4f46e5,#7c3aed);font-family:system-ui,Arial,sans-serif;color:#fff">
    <div style="width:110px;height:110px;flex:none">${icon.replace("<svg ", '<svg width="110" height="110" ')}</div>
    <div><div style="font-size:38px;font-weight:800;letter-spacing:-0.5px">LangBlock</div>
    <div style="font-size:17px;line-height:1.35;margin-top:6px;opacity:.95">Hide YouTube videos in languages you don't want.</div>
    <div style="font-size:13px;margin-top:10px;opacity:.8">Free · Private · No data collected</div></div></body></html>`);
  await promo.screenshot({ path: path.join(out, "promo-440x280.png") });

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`chrome-extension://${id}/ui/options.html`);
  for (const name of ["hindi", "urdu"]) {
    await page.fill("#lang-search", name);
    await page.check("#lang-list input[type=checkbox]");
  }
  await page.fill("#lang-search", "");
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, "screenshot-settings-1280x800.png") });
} finally {
  await ctx.close();
}
