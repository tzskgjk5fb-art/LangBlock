// Builds store-ready packages:
//   dist/langblock-chrome-<version>.zip   Chrome, Edge, Opera, Brave and other Chromium browsers
//   dist/langblock-firefox-<version>.zip  Firefox desktop and Firefox for Android
// The source manifest lists both background forms; each package keeps only
// the one its browser uses, so neither store shows a warning.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const FILES = ["_locales", "src", "ui", "icons"];

const targets = {
  chrome(m) {
    m.background = { service_worker: m.background.service_worker };
    delete m.browser_specific_settings;
    return m;
  },
  firefox(m) {
    m.background = { scripts: m.background.scripts };
    delete m.minimum_chrome_version;
    return m;
  },
};

rmSync(dist, { recursive: true, force: true });
for (const [name, transform] of Object.entries(targets)) {
  const dir = path.join(dist, name);
  mkdirSync(dir, { recursive: true });
  for (const f of FILES) cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
  rmSync(path.join(dir, "icons", "icon.svg"), { force: true });
  const m = transform(structuredClone(manifest));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
  const zip = path.join(dist, `langblock-${name}-${manifest.version}.zip`);
  execFileSync("zip", ["-qrX", zip, "."], { cwd: dir });
  console.log("built", path.relative(root, zip));
}
