// Builds the Firefox store description from the Chrome one, and puts both
// into docs/STORE_LISTING.md as copyable blocks. Edit
// docs/store/description-chrome.txt, then run `npm run store-text`.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath = path.join(root, "docs", "store", "description-chrome.txt");
const firefoxPath = path.join(root, "docs", "store", "description-firefox.txt");
const listingPath = path.join(root, "docs", "STORE_LISTING.md");

const HEADINGS = {
  "HOW IT WORKS": "How it works",
  FEATURES: "Features",
  "FREE AND PRIVATE": "Free and private",
  "PERMISSIONS, AND EXACTLY WHAT EACH ONE DOES": "Permissions, and exactly what each one does",
  LIMITS: "Limits",
};
const BOLD_LABELS = /^(Spoken language|Tags|Language named in the title|Title check|"Storage"):\s/;
const CHROME_SITE_ACCESS = '"Read and change your data on www.youtube.com and m.youtube.com" (site access):';
const FIREFOX_SITE_ACCESS = '**"Access your data for www.youtube.com and m.youtube.com"** (site access):';

// Firefox's description box takes Markdown and joins lines that aren't
// separated by a blank line, so headings become bold lines, "•" becomes a
// "-" list, and blank lines go around both. It also uses Firefox's own
// wording for the site access permission.
function toFirefoxMarkdown(text) {
  const out = [];
  let inList = false;
  for (const line of text.split("\n")) {
    if (HEADINGS[line]) {
      out.push("", `**${HEADINGS[line]}**`, "");
      inList = false;
      continue;
    }
    if (line.startsWith("• ")) {
      let item = line.slice(2);
      if (item.startsWith(CHROME_SITE_ACCESS)) item = FIREFOX_SITE_ACCESS + item.slice(CHROME_SITE_ACCESS.length);
      else item = item.replace(BOLD_LABELS, "**$1:** ");
      if (!inList && out.length && out[out.length - 1] !== "") out.push("");
      out.push("- " + item);
      inList = true;
      continue;
    }
    if (inList && line) out.push("");
    out.push(line);
    inList = false;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function putBlock(listing, name, lang, body) {
  const re = new RegExp(`(<!-- description:${name} -->)[\\s\\S]*?(<!-- /description:${name} -->)`);
  if (!re.test(listing)) throw new Error(`STORE_LISTING.md has no description:${name} markers`);
  return listing.replace(re, (_, start, end) => `${start}\n\`\`\`${lang}\n${body}\`\`\`\n${end}`);
}

const chrome = readFileSync(chromePath, "utf8").trim() + "\n";
const firefox = toFirefoxMarkdown(chrome);
writeFileSync(chromePath, chrome);
writeFileSync(firefoxPath, firefox);
let listing = readFileSync(listingPath, "utf8");
listing = putBlock(listing, "chrome", "text", chrome);
listing = putBlock(listing, "firefox", "markdown", firefox);
writeFileSync(listingPath, listing);
console.log("store text updated");
