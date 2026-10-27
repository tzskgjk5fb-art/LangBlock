# LangBlock

A free browser extension that hides YouTube videos spoken in languages you choose, in search results, the home page and feeds, the "Up next" list and channel pages.

## How detection works

Each video card goes through two checks. Both run in your browser and need no API key or account.

1. **Title check (instant, offline).** The title, channel name and snippet are run through the browser's built-in language detector (`i18n.detectLanguage`) and a writing-system check (for example Devanagari for Hindi). Clear matches are hidden immediately. Short titles in the Latin alphabet fool the detector (it calls "Adobe Premiere Pro Tutorials" Italian), so for those it has to be sure, at least 80%, and the text has to contain two everyday words of that language, such as "di", "il" or "che" for Italian. When the spoken-language check (below) finds YouTube's spoken-language information, that decides instead, so a French title on a video spoken in English is shown again. The title only decides on its own when YouTube has no spoken-language information, with one exception: English is YouTube's default label and many videos spoken in other languages carry it, so a title at least 40% written in a blocked language's own script (Malayalam, Devanagari, Bengali and so on) outweighs an "English" label.
2. **Spoken-language check.** For videos that pass the title check, LangBlock loads the video's YouTube watch page once and reads two fields from the player data YouTube embeds in it (`ytInitialPlayerResponse`):
   - the **original audio track** (`audioTrack.id` like `hi.4`, or a display name containing "original") on videos with multiple audio tracks;
   - the language of the **auto-generated caption track** (`captionTracks[].kind == "asr"`), which is YouTube's own speech recognition naming the spoken language;
   - the language of a video's only audio track. This is whatever the uploader picked and is sometimes wrong, so it counts only when there are no auto-captions;
   - the **tags and hashtags** the uploader gave the video (`videoDetails.keywords`, and `#hashtags` in the description). When they name a blocked language by the same rules as titles ("premiere pro tutorial in hindi", "#hindi") and YouTube says the video is English, or says nothing, the video is hidden. This catches many videos spoken in a mix of Hindi and English (Hinglish), which YouTube often labels English. Tags naming three or more languages are search bait and are ignored, an original audio track among several outranks the tags, and so does any spoken language other than English. Only the language codes are kept, never the tags.

   If none of the spoken-language fields exists, the full description is run through the language detector. The page is read as a stream and the download stops as soon as the player data is complete. Only cards near the screen are checked, the ones on screen first, three at a time. A check that fails (YouTube busy, a slow connection, a page without the player data) is tried again after about 2, 8, 30 and 90 seconds, and after that on the next YouTube page you open; a page is only given up on when it sends nothing for 10 seconds or takes more than 30 in all. Results are cached on the device (60 days, 3 days when nothing was found, 1 hour when YouTube held the details back, for example behind a "confirm you're not a bot" check). Videos cached by a version before 1.0.9, which didn't read tags, are checked once more when they come into view.

The second check matters because YouTube auto-translates titles and auto-dubs audio, so a Hindi video can show an English title.

### Why this approach
- **Free:** no YouTube Data API key or quota, and no third-party service.
- **Stable:** the caption-track and audio-track fields have kept the same shape for over a decade and are relied on by many tools. Card detection uses a list of known YouTube elements, plus a fallback that finds any card linking to a single video. A YouTube layout change therefore degrades gracefully instead of breaking.
- **Private:** nothing leaves the device except normal requests to YouTube.

### Playlists and language names
- **Playlist cards** list their first videos. LangBlock checks up to three of them and hides the playlist when at least half of the videos with a known language are in a blocked language. Their titles are also included in the title check.
- **Language named in the title.** "in Hindi", "(Hindi)", "| Hindi", "Urdu / Hindi" or "Hindi dubbed" count as a signal. So does a language's own name in its own script anywhere in the text ("اردو / हिंदी", "മലയാളം", "【中文】", but not "中文字幕"), and an English name anywhere when the text is also written in that language's script ("… | Basics Malayalam Tutorial" next to Malayalam). Names that only ever mean the language (Hindi, Urdu, Bangla, Malayalam, Telugu, Kannada, Marathi and a few more) count wherever they stand, so "Premiere Pro Tutorial Hindi (2026)" and "Bangla Tutorial" are caught. Names that double as everyday adjectives only count in those label positions, so "French toast", "Korean BBQ" or "Exploring Tamil Nadu" don't. Common alternative names count too: Bangla, Farsi, Hinglish, Mandarin, Oriya, Sinhalese, Kiswahili. All of this outranks YouTube's spoken-language label, because that label isn't always right.

### Picking languages
Tick languages in the list, or use "Block all except English" (named after the browser's language) to block every language LangBlock knows except yours, and "Unblock all" to clear the list. Individual languages can still be ticked or unticked afterwards, and both buttons offer Undo.

### Translations
The settings page, popup and the "Hidden by LangBlock" label follow the browser's language, using the standard extension `_locales` system (no extra permission). Included: English, Arabic, Chinese (Simplified and Traditional), French, German, Hindi, Indonesian, Italian, Japanese, Korean, Polish, Portuguese (Brazil and Portugal), Russian, Spanish, Turkish, Ukrainian and Vietnamese; any other browser language falls back to English. Language names come from the browser (`Intl.DisplayNames`), so they appear in the user's language and can be searched in either that language or English. The troubleshooting labels stay in English. The translations haven't been checked by native speakers yet, so corrections are welcome.

### Troubleshooting mode
Settings → Troubleshooting → "Show LangBlock's reasoning on every video" labels each recognised video with what LangBlock found (spoken language and where it came from, any language the tags name, the title's detected language, shown as "maybe Italian (ignored)" when the guess was too weak to use, any language named in the text, and why a check failed, such as "timed out" or "YouTube answered 503") and fades hidden videos instead of removing them. A video with no label wasn't recognised as a video card.

### Known limits
- Videos without auto-captions or audio-track info (music, very short or brand-new videos) fall back to title and description.
- A video whose title, description, tags and YouTube label all say English is shown, even if it is spoken in another language. LangBlock can't listen to the audio, and text that only appears inside a thumbnail image can't be read.
- Romanized text (Hindi written in Latin letters) is mostly caught by the spoken-language check, not the title check.
- Languages that share a script (Hindi, Marathi, Nepali) are separated by the browser's detector; without one (Safari), blocking one may hide the others in title matches.

## Browser support

| Browser | Status |
| --- | --- |
| Chrome, Edge, Brave, Opera, Vivaldi (desktop) | `dist/langblock-chrome-*.zip` |
| Firefox desktop 128+ and Firefox for Android 128+ | `dist/langblock-firefox-*.zip` |
| Edge for Android | Edge for Android only offers a small, curated set of extensions, so availability there isn't guaranteed |
| Safari (macOS, iOS, iPadOS) | Convert with `xcrun safari-web-extension-converter dist/chrome` in Xcode. Safari has no `i18n.detectLanguage`, so the title check uses the writing-system check only; the spoken-language check works as normal. |
| Chrome for Android | Google doesn't support extensions there |

## Permissions

| Permission | Why |
| --- | --- |
| Site access to `www.youtube.com` and `m.youtube.com` (content script) | Find video cards, hide blocked ones, and read a video's language fields from its YouTube page. No other sites. |
| `storage` | Save settings and the on-device cache of checked videos. |

Nothing else: no `tabs`, `history`, `cookies`, `webRequest`, or `<all_urls>`.

## Security
- Manifest V3 with a strict extension page CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- No remote code, no `eval`, no `innerHTML` (enforced by ESLint rules); all UI is built with DOM APIs and `textContent`.
- All stored settings and cache entries are validated before use.
- The popup's message handler only answers messages from LangBlock itself.
- No analytics and no data collection. Firefox's `data_collection_permissions` is set to `none`.

## Donation link
`DONATION_URL` in `src/config.js` points to https://ko-fi.com/josh3579. It must be an `https://` URL. The link shows as a small "♥ Support LangBlock" in the settings page and popup, and stays hidden while the value is empty.

## Development

```sh
npm test            # unit tests (Node 20+)
npm run test:e2e    # builds, then loads the extension in Chromium against mock YouTube pages (needs Playwright)
npm run lint        # ESLint, including security rules
npm run build       # dist/langblock-chrome-<v>.zip and dist/langblock-firefox-<v>.zip
npx web-ext lint --source-dir dist/firefox
```

To try it unpacked:
- Chrome or Edge: open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick `dist/chrome`.
- Firefox: open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `dist/firefox/manifest.json`.

Store listing text, permission explanations and the privacy policy are in [`docs/`](docs/).

## License
MIT
