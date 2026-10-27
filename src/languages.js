// Languages LangBlock can block. `code` is the ISO 639-1 code (or the code
// YouTube and the browser's language detector use). `script` is the main
// writing system, used by the offline script check when the browser has no
// built-in language detector. `alt` are other English names ("Bangla"),
// `native` other spellings of the language's own name ("हिंदी").
(function (root) {
  "use strict";

  const LANGUAGES = [
    { code: "af", name: "Afrikaans", script: "Latin" },
    { code: "am", name: "Amharic", script: "Ethiopic" },
    { code: "ar", name: "Arabic", script: "Arabic" },
    { code: "as", name: "Assamese", script: "Bengali" },
    { code: "az", name: "Azerbaijani", script: "Latin" },
    { code: "be", name: "Belarusian", script: "Cyrillic" },
    { code: "bg", name: "Bulgarian", script: "Cyrillic" },
    { code: "bn", name: "Bengali", script: "Bengali", alt: ["Bangla"] },
    { code: "bs", name: "Bosnian", script: "Latin" },
    { code: "ca", name: "Catalan", script: "Latin" },
    { code: "cs", name: "Czech", script: "Latin" },
    { code: "cy", name: "Welsh", script: "Latin" },
    { code: "da", name: "Danish", script: "Latin" },
    { code: "de", name: "German", script: "Latin" },
    { code: "el", name: "Greek", script: "Greek" },
    { code: "en", name: "English", script: "Latin" },
    { code: "es", name: "Spanish", script: "Latin" },
    { code: "et", name: "Estonian", script: "Latin" },
    { code: "eu", name: "Basque", script: "Latin" },
    { code: "fa", name: "Persian", script: "Arabic", alt: ["Farsi"] },
    { code: "fi", name: "Finnish", script: "Latin" },
    { code: "fil", name: "Filipino / Tagalog", script: "Latin", aliases: ["tl"] },
    { code: "fr", name: "French", script: "Latin" },
    { code: "ga", name: "Irish", script: "Latin" },
    { code: "gl", name: "Galician", script: "Latin" },
    { code: "gu", name: "Gujarati", script: "Gujarati" },
    { code: "ha", name: "Hausa", script: "Latin" },
    { code: "he", name: "Hebrew", script: "Hebrew", aliases: ["iw"] },
    { code: "hi", name: "Hindi", script: "Devanagari", native: ["हिंदी"], alt: ["Hinglish"] },
    { code: "hr", name: "Croatian", script: "Latin" },
    { code: "hu", name: "Hungarian", script: "Latin" },
    { code: "hy", name: "Armenian", script: "Armenian" },
    { code: "id", name: "Indonesian", script: "Latin", aliases: ["in"], alt: ["Bahasa Indonesia"] },
    { code: "ig", name: "Igbo", script: "Latin" },
    { code: "is", name: "Icelandic", script: "Latin" },
    { code: "it", name: "Italian", script: "Latin" },
    { code: "ja", name: "Japanese", script: "Japanese" },
    { code: "jv", name: "Javanese", script: "Latin" },
    { code: "ka", name: "Georgian", script: "Georgian" },
    { code: "kk", name: "Kazakh", script: "Cyrillic" },
    { code: "km", name: "Khmer", script: "Khmer" },
    { code: "kn", name: "Kannada", script: "Kannada" },
    { code: "ko", name: "Korean", script: "Hangul" },
    { code: "ky", name: "Kyrgyz", script: "Cyrillic" },
    { code: "lo", name: "Lao", script: "Lao" },
    { code: "lt", name: "Lithuanian", script: "Latin" },
    { code: "lv", name: "Latvian", script: "Latin" },
    { code: "mk", name: "Macedonian", script: "Cyrillic" },
    { code: "ml", name: "Malayalam", script: "Malayalam" },
    { code: "mn", name: "Mongolian", script: "Cyrillic" },
    { code: "mr", name: "Marathi", script: "Devanagari" },
    { code: "ms", name: "Malay", script: "Latin", alt: ["Bahasa Melayu"] },
    { code: "my", name: "Burmese", script: "Myanmar" },
    { code: "ne", name: "Nepali", script: "Devanagari" },
    { code: "nl", name: "Dutch", script: "Latin" },
    { code: "no", name: "Norwegian", script: "Latin", aliases: ["nb", "nn"] },
    { code: "or", name: "Odia", script: "Oriya", alt: ["Oriya"] },
    { code: "pa", name: "Punjabi", script: "Gurmukhi", native: ["پنجابی"], alt: ["Panjabi"] },
    { code: "pl", name: "Polish", script: "Latin" },
    { code: "ps", name: "Pashto", script: "Arabic" },
    { code: "pt", name: "Portuguese", script: "Latin" },
    { code: "ro", name: "Romanian", script: "Latin" },
    { code: "ru", name: "Russian", script: "Cyrillic" },
    { code: "sd", name: "Sindhi", script: "Arabic" },
    { code: "si", name: "Sinhala", script: "Sinhala", alt: ["Sinhalese"] },
    { code: "sk", name: "Slovak", script: "Latin" },
    { code: "sl", name: "Slovenian", script: "Latin" },
    { code: "so", name: "Somali", script: "Latin" },
    { code: "sq", name: "Albanian", script: "Latin" },
    { code: "sr", name: "Serbian", script: "Cyrillic" },
    { code: "sv", name: "Swedish", script: "Latin" },
    { code: "sw", name: "Swahili", script: "Latin", alt: ["Kiswahili"] },
    { code: "ta", name: "Tamil", script: "Tamil" },
    { code: "te", name: "Telugu", script: "Telugu" },
    { code: "tg", name: "Tajik", script: "Cyrillic" },
    { code: "th", name: "Thai", script: "Thai" },
    { code: "tr", name: "Turkish", script: "Latin" },
    { code: "uk", name: "Ukrainian", script: "Cyrillic" },
    { code: "ur", name: "Urdu", script: "Arabic" },
    { code: "uz", name: "Uzbek", script: "Latin" },
    { code: "vi", name: "Vietnamese", script: "Latin" },
    { code: "yo", name: "Yoruba", script: "Latin" },
    { code: "zh", name: "Chinese", script: "Han", alt: ["Mandarin"] },
    { code: "zu", name: "Zulu", script: "Latin" },
  ];

  // Old or alternative codes that YouTube or browsers sometimes report.
  const ALIASES = {};
  for (const lang of LANGUAGES) {
    for (const alias of lang.aliases || []) ALIASES[alias] = lang.code;
  }

  const BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

  // "en-US", "hi-Latn", "zh-Hant", "pt_BR", "iw" -> "en", "hi", "zh", "pt", "he"
  function normalizeCode(code) {
    if (typeof code !== "string" || !code) return null;
    const base = code.trim().toLowerCase().split(/[-_.]/)[0];
    if (!base) return null;
    return ALIASES[base] || base;
  }

  function languageName(code) {
    const lang = BY_CODE[normalizeCode(code)];
    return lang ? lang.name : code;
  }

  // ---------------------------------------------------------------------
  // Text shown to the user, in the browser's language
  // ---------------------------------------------------------------------

  const api = root.browser || root.chrome;
  let uiLocale = "en";
  try {
    uiLocale = api.i18n.getUILanguage() || "en";
  } catch {
    uiLocale = "en";
  }

  /** Translated UI text from _locales (English when there's no translation). */
  function t(key, subs) {
    try {
      return api.i18n.getMessage(key, subs) || key;
    } catch {
      return key;
    }
  }

  // English keeps the names above ("Filipino / Tagalog"). Other languages
  // use the browser's own translation of each language name.
  let displayNames = null;
  if (normalizeCode(uiLocale) !== "en") {
    try {
      displayNames = new Intl.DisplayNames([uiLocale], { type: "language" });
    } catch {
      displayNames = null;
    }
  }

  /** A language's name in the user's language. */
  function localName(code) {
    const c = normalizeCode(code);
    if (displayNames && BY_CODE[c]) {
      try {
        const name = displayNames.of(c);
        if (name && name !== c) return name;
      } catch {
        // fall through to the English name
      }
    }
    return languageName(code);
  }

  root.LangBlock = Object.assign(root.LangBlock || {}, {
    LANGUAGES,
    LANGUAGE_BY_CODE: BY_CODE,
    UI_LOCALE: uiLocale,
    normalizeCode,
    languageName,
    localName,
    t,
  });
})(globalThis);
