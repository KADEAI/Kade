import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";

type TranslationModule = { default?: Record<string, any> } | Record<string, any>;
type TranslationMap = Record<string, Record<string, Record<string, any>>>;
type LocaleLoader = () => Promise<TranslationModule>;

const ENGLISH_LOCALE_FILES = import.meta.glob("./locales/en/*.json", { eager: true });
const LOCALE_FILES = import.meta.glob("./locales/**/*.json") as Record<string, LocaleLoader>;
const loadedLanguages = new Set<string>();
const i18next = createInstance();

const buildTranslations = (
  files: Record<string, TranslationModule>,
): TranslationMap => {
  const translations: TranslationMap = {};

  Object.entries(files).forEach(([path, module]) => {
    const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json/);

    if (!match) {
      return;
    }

    const [, language, namespace] = match;

    if (!translations[language]) {
      translations[language] = {};
    }

    translations[language][namespace] = (module as TranslationModule).default || module;
  });

  return translations;
};

const englishTranslations = buildTranslations(
  ENGLISH_LOCALE_FILES as Record<string, TranslationModule>,
);

const collectLanguagePaths = (language: string) =>
  Object.keys(LOCALE_FILES).filter((path) => path.includes(`/locales/${language}/`));

const addTranslations = (translations: TranslationMap) => {
  Object.entries(translations).forEach(([lang, namespaces]) => {
    Object.entries(namespaces).forEach(([namespace, resources]) => {
      i18next.addResourceBundle(lang, namespace, resources, true, true);
    });
  });
};

const resolveLanguageCandidates = (language?: string) => {
  if (!language) {
    return ["en"];
  }

  const candidates = [language];
  const baseLanguage = language.split("-")[0];
  if (baseLanguage !== language) {
    candidates.push(baseLanguage);
  }
  if (!candidates.includes("en")) {
    candidates.push("en");
  }

  return candidates;
};

async function loadLanguage(language?: string) {
  await i18nextInitPromise;

  for (const candidate of resolveLanguageCandidates(language)) {
    if (loadedLanguages.has(candidate)) {
      return candidate;
    }

    const paths = collectLanguagePaths(candidate);
    if (paths.length === 0) {
      continue;
    }

    const modules = await Promise.all(paths.map((path) => LOCALE_FILES[path]()));
    const translations = buildTranslations(
      Object.fromEntries(paths.map((path, index) => [path, modules[index]])),
    );

    addTranslations(translations);
    loadedLanguages.add(candidate);
    return candidate;
  }

  return "en";
};

loadedLanguages.add("en");

const i18nextInitPromise = i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  debug: false,
  resources: {
    en: englishTranslations.en ?? {},
  },
  interpolation: {
    escapeValue: false,
  },
});

export async function loadTranslations(language?: string) {
  return loadLanguage(language);
}

export default i18next;
