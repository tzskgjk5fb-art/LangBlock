# LangBlock: store listing text

Text for the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO) forms. On GitHub, each grey box has a copy button in its top-right corner, which copies the text exactly, line breaks included.

## Name
```text
LangBlock: YouTube Language Filter
```

## Summary (132 characters max)
```text
Hide YouTube videos spoken in languages you choose, in search and recommendations. Free, private, no data collected.
```

## Links
- Homepage / support: https://github.com/tzskgjk5fb-art/LangBlock
- Privacy policy: https://github.com/tzskgjk5fb-art/LangBlock/blob/main/docs/PRIVACY.md

## Category
- Chrome / Edge: Productivity (or "Fun" / "Social & Communication")
- Firefox: Search Tools / Social & Communication

## Description for the Chrome Web Store and Edge
Plain text, which these stores show with the line breaks as they are. Also in [description-chrome.txt](store/description-chrome.txt).

<!-- description:chrome -->
```text
LangBlock hides YouTube videos in languages you don't want to see. Pick the languages to block (for example Hindi), and matching videos disappear from search results, the home page, your feeds, the "Up next" list and channel pages.

HOW IT WORKS
LangBlock checks each video on your device, using four signals:
• Spoken language: LangBlock reads the spoken language YouTube itself has recorded for the video, namely the language of its automatic captions and its original audio track. This catches videos whose titles are in English or were auto-translated by YouTube. On music and very short clips, where YouTube sometimes guesses a language even though nobody speaks, something else about the video has to agree. Each video is checked once and the answer is remembered on your device.
• Tags: when the uploader tagged the video with a blocked language ("tutorial in hindi", "#hindi"), it is hidden even if YouTube labels it English. Many videos that mix Hindi and English are only caught this way.
• Language named in the title: titles such as "Hindi tutorial", "(Hindi)", "Urdu / Hindi", "Bangla Tutorial" or the language's own name in its own script ("اردو / हिंदी") count, even when YouTube labels the video differently. Names that are also everyday words, like "French toast" or "Korean BBQ", don't.
• Title check: your browser's built-in language detector and a writing-system check read the title, so obvious matches (for example a title written in Devanagari) are hidden instantly. When YouTube knows the spoken language, that wins, so a French title on a video spoken in English stays visible. The exception is YouTube's default "English" label, which many videos in other languages carry: a title written largely in a blocked language's own script outweighs it.

FEATURES
• Block any number of languages (80+ supported)
• Block every language except your own in one click, or unblock all, with Undo
• Also filters playlists, by checking the videos they list
• Choose where to filter: search, home and feeds, "Up next", channel pages
• Optionally hide videos that offer a dubbed audio track in a blocked language
• Hide videos completely, or fade them out with a label saying why
• Troubleshooting mode shows on each video why LangBlock hid or kept it
• Works on www.youtube.com and m.youtube.com (Firefox for Android)
• Light and dark mode
• Settings in 17 languages, following your browser's language

FREE AND PRIVATE
LangBlock is completely free with no ads, no accounts and no tracking. It collects no data and sends nothing to the developer or any third party. A small, optional "Support LangBlock" link lets you donate if you'd like to.

PERMISSIONS, AND EXACTLY WHAT EACH ONE DOES
• "Read and change your data on www.youtube.com and m.youtube.com" (site access): lets LangBlock see the list of videos on YouTube pages, hide the ones in blocked languages, and load a video's YouTube page in the background to read its spoken-language information. LangBlock has no access to any other website.
• "Storage": saves your settings (which languages to block and your options) and remembers the language of videos already checked, so they are not checked again. Remembered videos stay on your device and can be cleared at any time from the settings page. If your browser syncs extension settings, your settings (not the remembered videos) sync with your own browser account.
LangBlock asks for nothing else: no access to your tabs, browsing history, cookies, downloads or other sites.

LIMITS
No language filter is perfect. Videos without captions or audio-track information (often music or brand-new videos) are judged by their title and description only, and short titles in the Latin alphabet only count when their language is clear. Videos in languages that share a writing system (for example Hindi and Marathi) are told apart by the browser's language detector. A video whose title, tags and YouTube label all say English is shown, because LangBlock can't listen to the audio. If something is hidden or shown wrongly, turn on troubleshooting mode to see why.
```
<!-- /description:chrome -->

## Description for Firefox Add-ons
Firefox's description box uses Markdown and joins lines that aren't separated by a blank line, so this version has "-" bullet points and blank lines between sections. Also in [description-firefox.txt](store/description-firefox.txt).

<!-- description:firefox -->
```markdown
LangBlock hides YouTube videos in languages you don't want to see. Pick the languages to block (for example Hindi), and matching videos disappear from search results, the home page, your feeds, the "Up next" list and channel pages.

**How it works**

LangBlock checks each video on your device, using four signals:

- **Spoken language:** LangBlock reads the spoken language YouTube itself has recorded for the video, namely the language of its automatic captions and its original audio track. This catches videos whose titles are in English or were auto-translated by YouTube. On music and very short clips, where YouTube sometimes guesses a language even though nobody speaks, something else about the video has to agree. Each video is checked once and the answer is remembered on your device.
- **Tags:** when the uploader tagged the video with a blocked language ("tutorial in hindi", "#hindi"), it is hidden even if YouTube labels it English. Many videos that mix Hindi and English are only caught this way.
- **Language named in the title:** titles such as "Hindi tutorial", "(Hindi)", "Urdu / Hindi", "Bangla Tutorial" or the language's own name in its own script ("اردو / हिंदी") count, even when YouTube labels the video differently. Names that are also everyday words, like "French toast" or "Korean BBQ", don't.
- **Title check:** your browser's built-in language detector and a writing-system check read the title, so obvious matches (for example a title written in Devanagari) are hidden instantly. When YouTube knows the spoken language, that wins, so a French title on a video spoken in English stays visible. The exception is YouTube's default "English" label, which many videos in other languages carry: a title written largely in a blocked language's own script outweighs it.

**Features**

- Block any number of languages (80+ supported)
- Block every language except your own in one click, or unblock all, with Undo
- Also filters playlists, by checking the videos they list
- Choose where to filter: search, home and feeds, "Up next", channel pages
- Optionally hide videos that offer a dubbed audio track in a blocked language
- Hide videos completely, or fade them out with a label saying why
- Troubleshooting mode shows on each video why LangBlock hid or kept it
- Works on www.youtube.com and m.youtube.com (Firefox for Android)
- Light and dark mode
- Settings in 17 languages, following your browser's language

**Free and private**

LangBlock is completely free with no ads, no accounts and no tracking. It collects no data and sends nothing to the developer or any third party. A small, optional "Support LangBlock" link lets you donate if you'd like to.

**Permissions, and exactly what each one does**

- **"Access your data for www.youtube.com and m.youtube.com"** (site access): lets LangBlock see the list of videos on YouTube pages, hide the ones in blocked languages, and load a video's YouTube page in the background to read its spoken-language information. LangBlock has no access to any other website.
- **"Storage":** saves your settings (which languages to block and your options) and remembers the language of videos already checked, so they are not checked again. Remembered videos stay on your device and can be cleared at any time from the settings page. If your browser syncs extension settings, your settings (not the remembered videos) sync with your own browser account.

LangBlock asks for nothing else: no access to your tabs, browsing history, cookies, downloads or other sites.

**Limits**

No language filter is perfect. Videos without captions or audio-track information (often music or brand-new videos) are judged by their title and description only, and short titles in the Latin alphabet only count when their language is clear. Videos in languages that share a writing system (for example Hindi and Marathi) are told apart by the browser's language detector. A video whose title, tags and YouTube label all say English is shown, because LangBlock can't listen to the audio. If something is hidden or shown wrongly, turn on troubleshooting mode to see why.
```
<!-- /description:firefox -->

To change the description, edit [description-chrome.txt](store/description-chrome.txt) and run `npm run store-text`, which updates the Firefox version and both boxes above.

## Chrome Web Store privacy practices tab

### Single purpose
```text
Hide YouTube videos whose spoken language the user has chosen to block.
```

### Permission justification: storage
```text
Stores the user's settings and a local cache of video id → detected language so each video is only checked once.
```

### Permission justification: host permission
```text
Needed to find video cards on YouTube pages (www.youtube.com, m.youtube.com, via content script), hide the ones in blocked languages, and read a video's spoken-language fields from its YouTube watch page.
```

### Remote code
No, I am not using remote code. All JavaScript is included in the package.

### Data usage
Tick none of the data types, and tick all three certifications: does not sell or transfer user data to third parties, does not use or transfer data for unrelated purposes, does not use data for creditworthiness or lending.

### Privacy policy URL
```text
https://github.com/tzskgjk5fb-art/LangBlock/blob/main/docs/PRIVACY.md
```

## Firefox (AMO)
- The manifest declares `data_collection_permissions: { required: ["none"] }`, so Firefox shows users that LangBlock collects no data.
- Source code: the package is plain, unminified JavaScript, so no separate source upload is needed.
