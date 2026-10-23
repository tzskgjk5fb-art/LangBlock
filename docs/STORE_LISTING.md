# LangBlock: store listing text

Paste these into the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (AMO) forms.

## Name
LangBlock: YouTube Language Filter

## Summary (132 characters max)
Hide YouTube videos spoken in languages you choose, in search and recommendations. Free, private, no data collected.

## Links
Homepage / support: https://github.com/tzskgjk5fb-art/LangBlock
Privacy policy: https://github.com/tzskgjk5fb-art/LangBlock/blob/main/docs/PRIVACY.md

## Category
Chrome / Edge: Productivity (or "Fun" / "Social & Communication"). Firefox: Search Tools / Social & Communication.

## Description

LangBlock hides YouTube videos in languages you don't want to see. Pick the languages to block (for example Hindi), and matching videos disappear from search results, the home page, your feeds, the "Up next" list and channel pages.

HOW IT WORKS
LangBlock checks each video in two ways, both on your device:
• Title check: your browser's built-in language detector and writing-system check read the title, channel name and snippet. Obvious matches are hidden instantly.
• Spoken-language check: LangBlock reads the spoken language YouTube itself has recorded for the video, namely the language of YouTube's automatic captions and the video's original audio track. This catches videos whose titles are in English or were auto-translated by YouTube. Each video is checked once and the answer is remembered on your device.

FEATURES
• Block any number of languages (80+ supported)
• Choose where to filter: search, home and feeds, "Up next", channel pages
• Optionally hide videos that offer a dubbed audio track in a blocked language
• Hide videos completely, or fade them out with a label saying why
• Works on www.youtube.com and m.youtube.com (Firefox for Android)
• Light and dark mode

FREE AND PRIVATE
LangBlock is completely free with no ads, no accounts and no tracking. It collects no data and sends nothing to the developer or any third party. A small, optional "Support LangBlock" link lets you donate if you'd like to.

PERMISSIONS, AND EXACTLY WHAT EACH ONE DOES
• "Read and change your data on www.youtube.com and m.youtube.com" (site access): lets LangBlock see the list of videos on YouTube pages, hide the ones in blocked languages, and load a video's YouTube page in the background to read its spoken-language information. LangBlock has no access to any other website.
• "Storage": saves your settings (which languages to block and your options) and remembers the language of videos already checked, so they are not checked again. Remembered videos stay on your device and can be cleared at any time from the settings page. If your browser syncs extension settings, your settings (not the remembered videos) sync with your own browser account.
LangBlock asks for nothing else: no access to your tabs, browsing history, cookies, downloads or other sites.

LIMITS
No language filter is perfect. Videos without captions or audio-track information are judged by their title and description only. Videos in languages that share a writing system (for example Hindi and Marathi) are told apart by the browser's language detector.

---

## Chrome Web Store privacy practices tab

Single purpose:
Hide YouTube videos whose spoken language the user has chosen to block.

Permission justifications:
- storage: Stores the user's settings and a local cache of video id → detected language so each video is only checked once.
- Host permission (www.youtube.com, m.youtube.com, via content script): Needed to find video cards on YouTube pages, hide the ones in blocked languages, and read a video's spoken-language fields from its YouTube watch page.

Remote code: No, I am not using remote code. All JavaScript is included in the package.

Data usage: Check none of the data types. Certify: does not sell or transfer user data to third parties, does not use or transfer data for unrelated purposes, does not use data for creditworthiness or lending.

Privacy policy URL: https://github.com/tzskgjk5fb-art/LangBlock/blob/main/docs/PRIVACY.md

## Firefox (AMO)

The manifest declares `data_collection_permissions: { required: ["none"] }`, so Firefox shows users that LangBlock collects no data.
Source code: the package is plain, unminified JavaScript, so no separate source upload is needed.
