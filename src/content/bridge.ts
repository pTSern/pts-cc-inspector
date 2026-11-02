import { CHANNEL, type RuntimeRequest } from "../shared/protocol";
interface BridgeState {
  dispose: () => void;
  alive: boolean;
}
const world = globalThis as typeof globalThis & {
  __ptsInspectorBridge?: BridgeState;
};
if (!world.__ptsInspectorBridge?.alive) {
  const session = crypto.randomUUID();
  let port: chrome.runtime.Port | null = null;
  let stopped = false;
  let retry: number | undefined;
  let floating: HTMLElement | null = null;
  let previousFocus: Element | null = null;
  const send = (message: unknown) => {
    try {
      port?.postMessage(message);
    } catch {
      /* Disconnection is handled by the port lifecycle. */
    }
  };
  const removeFloating = () => {
    floating?.remove();
    floating = null;
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    previousFocus = null;
  };
  const relay = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.data?.channel !== CHANNEL ||
      event.data?.session !== session
    )
      return;
    if (event.data.kind === "response")
      send({ type: "response", response: event.data.response });
    else if (event.data.kind === "event")
      send({ type: "event", event: event.data.event });
  };
  const dispatch = (kind: string, extra: Record<string, unknown> = {}) =>
    window.postMessage(
      { channel: CHANNEL, session, kind, ...extra },
      location.origin === "null" ? "*" : location.origin,
    );
  function dispose() {
    if (stopped) return;
    stopped = true;
    state.alive = false;
    clearTimeout(retry);
    removeFloating();
    window.removeEventListener("message", relay);
    window.removeEventListener("pagehide", dispose);
    dispatch("dispose");
    port?.disconnect();
    port = null;
    delete world.__ptsInspectorBridge;
  }
  function showFloating(tabId: number, locale: string) {
    if (floating) {
      removeFloating();
      return;
    }
    previousFocus = document.activeElement;
    const host = document.createElement("div");
    host.id = "pts-cc-inspector-host";
    Object.assign(host.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      width: "min(960px,95vw)",
      height: "min(650px,92vh)",
      minWidth: "min(360px,95vw)",
      minHeight: "260px",
      maxWidth: "98vw",
      maxHeight: "96vh",
      zIndex: "2147483647",
      resize: "both",
      overflow: "hidden",
      boxShadow: "0 8px 36px #0009",
      border: "1px solid #586574",
      borderRadius: "6px",
      background: "#161b22",
    });
    const shadow = host.attachShadow({ mode: "closed" });
    const bar = document.createElement("div");
    bar.textContent = "pts-cc-inspector";
    Object.assign(bar.style, {
      height: "26px",
      lineHeight: "26px",
      padding: "0 8px",
      color: "#e6edf3",
      font: "12px/26px system-ui",
      background: "#252d39",
      cursor: "move",
      userSelect: "none",
      display: "flex",
      justifyContent: "space-between",
    });
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute(
      "aria-label",
      locale === "vi" ? "Đóng trình kiểm tra" : "Close inspector",
    );
    Object.assign(close.style, {
      color: "inherit",
      background: "transparent",
      border: "0",
      fontSize: "20px",
      cursor: "pointer",
    });
    close.addEventListener("click", removeFloating);
    bar.append(close);
    const iframe = document.createElement("iframe");
    iframe.src =
      chrome.runtime.getURL("floating.html") + "?tab=" + tabId + "&frame=0";
    iframe.title = "pts-cc-inspector";
    Object.assign(iframe.style, {
      width: "100%",
      height: "calc(100% - 26px)",
      border: "0",
      display: "block",
    });
    let drag: { x: number; y: number; left: number; top: number } | null = null;
    bar.addEventListener("pointerdown", (event) => {
      if (event.target === close) return;
      const rect = host.getBoundingClientRect();
      drag = {
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      bar.setPointerCapture(event.pointerId);
    });
    bar.addEventListener("pointermove", (event) => {
      if (!drag) return;
      host.style.right = "auto";
      host.style.left =
        Math.max(
          0,
          Math.min(innerWidth - 100, drag.left + event.clientX - drag.x),
        ) + "px";
      host.style.top =
        Math.max(
          0,
          Math.min(innerHeight - 26, drag.top + event.clientY - drag.y),
        ) + "px";
    });
    bar.addEventListener("pointerup", () => {
      drag = null;
    });
    bar.addEventListener("pointercancel", () => {
      drag = null;
    });
    shadow.append(bar, iframe);
    document.documentElement.append(host);
    floating = host;
  }
  function connect() {
    if (stopped || !chrome.runtime?.id) return;
    try {
      port = chrome.runtime.connect({ name: "pts-bridge" });
      port.onMessage.addListener((message) => {
        if (message.type === "request")
          dispatch("request", { request: message.request as RuntimeRequest });
        else if (message.type === "stop") dispose();
        else if (message.type === "floating")
          showFloating(message.tabId, message.locale);
        else if (message.type === "floatingPicking" && floating) {
          floating.style.opacity = message.active ? "0" : "1";
          floating.style.pointerEvents = message.active ? "none" : "auto";
        }
      });
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        port = null;
        if (!stopped) retry = window.setTimeout(connect, 1000);
      });
    } catch {
      dispose();
    }
  }
  const state: BridgeState = { dispose, alive: true };
  world.__ptsInspectorBridge = state;
  window.addEventListener("message", relay);
  window.addEventListener("pagehide", dispose, { once: true });
  connect();
}
