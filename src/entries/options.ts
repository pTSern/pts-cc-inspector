import { localize, localeNames } from "../locales";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type Locale,
  type Settings,
} from "../shared/protocol";
const app = document.getElementById("app")!;
async function render() {
  const stored = await chrome.storage.local.get("settings");
  let settings = normalizeSettings(stored.settings);
  const t = (key: string) => localize(key, settings.locale);
  document.documentElement.lang = settings.locale;
  const main = document.createElement("main");
  const title = document.createElement("h1");
  title.textContent = "pts-cc-inspector — " + t("settingsTitle");
  main.append(title);
  const output = document.createElement("output");
  output.setAttribute("aria-live", "polite");
  const persist = async (update: Partial<Settings>) => {
    settings = normalizeSettings({ ...settings, ...update });
    await chrome.storage.local.set({ settings });
    output.textContent = t("saved");
  };
  const language = document.createElement("select");
  language.setAttribute("aria-label", t("language"));
  for (const [key, name] of Object.entries(localeNames)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = name;
    language.append(option);
  }
  language.value = settings.locale;
  language.addEventListener("change", async () => {
    await persist({ locale: language.value as Locale });
    await render();
  });
  const languageRow = document.createElement("label");
  languageRow.textContent = t("language");
  languageRow.append(language);
  main.append(languageRow);
  const interval = document.createElement("input");
  interval.type = "number";
  interval.min = "250";
  interval.max = "10000";
  interval.step = "250";
  interval.value = String(settings.refreshMs);
  interval.addEventListener(
    "change",
    () =>
      void persist({ refreshMs: Number(interval.value) }).then(() => {
        interval.value = String(settings.refreshMs);
      }),
  );
  const row = document.createElement("label");
  row.textContent = t("refreshInterval");
  row.append(interval);
  main.append(row);
  for (const key of [
    "autoTree",
    "autoProperties",
    "hoverHighlight",
    "selectionHighlight",
  ] as const) {
    const label = document.createElement("label");
    label.textContent = t(key);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = settings[key];
    input.addEventListener(
      "change",
      () => void persist({ [key]: input.checked }),
    );
    label.append(input);
    main.append(label);
  }
  const reset = document.createElement("button");
  reset.textContent = t("resetSettings");
  reset.addEventListener("click", async () => {
    await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
    await render();
  });
  const privacy = document.createElement("p");
  privacy.textContent = t("privacyNote");
  main.append(reset, output, privacy);
  app.replaceChildren(main);
}
void render().catch((error) => {
  app.textContent = String(error);
});
