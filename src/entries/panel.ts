import { BrowserInspectorClient } from "../browser/client";
import { mountInspector } from "../ui";
const client = new BrowserInspectorClient(
  chrome.devtools.inspectedWindow.tabId,
);
const cleanup = mountInspector(document.getElementById("app")!, client);
const visibility = (event: Event) =>
  client.setVisible((event as CustomEvent<boolean>).detail);
window.addEventListener("pts-panel-visibility", visibility);
window.addEventListener(
  "pagehide",
  () => {
    window.removeEventListener("pts-panel-visibility", visibility);
    cleanup();
    client.dispose();
  },
  { once: true },
);
