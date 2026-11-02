import { BrowserInspectorClient } from "../browser/client";
import { mountInspector } from "../ui";
const params = new URLSearchParams(location.search);
const tab = Number(params.get("tab"));
const frame = Number(params.get("frame") || 0);
const client = new BrowserInspectorClient(
  Number.isSafeInteger(tab) ? tab : -1,
  Number.isSafeInteger(frame) ? frame : 0,
);
const cleanup = mountInspector(document.getElementById("app")!, client, {
  floating: true,
});
window.addEventListener(
  "pagehide",
  () => {
    cleanup();
    client.dispose();
  },
  { once: true },
);
