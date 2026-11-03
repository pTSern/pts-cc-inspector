import { localize, localeNames } from "../locales";
import { normalizeSettings, type Locale } from "../shared/protocol";
const app = document.getElementById("app")!;
document.body.className = "popup";
async function start() {
  const stored = await chrome.storage.local.get("settings");
  const settings = normalizeSettings(stored.settings);
  const locale = settings.locale;
  document.documentElement.lang = locale;
  const t = (key: string) => localize(key, locale);
  const main = document.createElement("main");
  const title = document.createElement("h1");
  title.textContent = "pts-cc-inspector";
  const hint = document.createElement("p");
  hint.textContent = t("popupHint");
  const open = document.createElement("button");
  open.className = "primary";
  open.textContent = t("openFloating");
  const options = document.createElement("button");
  options.textContent = t("openPreferences");
  options.addEventListener("click", () => chrome.runtime.openOptionsPage());
  const reload = document.createElement("button");
  reload.textContent = t("reloadExtension");
  reload.addEventListener("click", () => {
    chrome.runtime.reload();
    window.close();
  });
  const output = document.createElement("output");
  output.setAttribute("aria-live", "polite");
  open.addEventListener("click", async () => {
    open.disabled = true;
    output.textContent = t("opening");
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined || !tab.url || !/^https?:|^file:/.test(tab.url))
        throw new Error(t("noActiveTab"));
      const result = await chrome.runtime.sendMessage({
        type: "toggle-floating",
        tabId: tab.id,
      });
      if (!result?.ok) throw new Error(result?.error || t("noActiveTab"));
      window.close();
    } catch (error) {
      output.className = "error";
      output.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      open.disabled = false;
    }
  });
  const label = document.createElement("label");
  label.textContent = t("language");
  const select = document.createElement("select");
  select.setAttribute("aria-label", t("language"));
  for (const [value, name] of Object.entries(localeNames)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = name;
    select.append(option);
  }
  select.value = locale;
  select.addEventListener("change", async () => {
    await chrome.storage.local.set({
      settings: { ...settings, locale: select.value as Locale },
    });
    await start();
  });
  label.append(select);
  const footer = document.createElement("footer");
  footer.textContent = t("privacyNote") + " · 1.0.0-beta";
  main.append(title, hint, open, options, reload, label, output, footer);
  app.replaceChildren(main);
}
void start().catch((error) => {
  app.textContent = String(error);
});
