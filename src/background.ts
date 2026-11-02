import {
  normalizeSettings,
  isRequest,
  type FrameInfo,
  type RuntimeRequest,
  type RuntimeResponse,
  type RuntimeEvent,
  type Settings,
  type EditorTarget,
} from "./shared/protocol";

type Port = chrome.runtime.Port;
interface Client {
  port: Port;
  tabId: number;
  frameId: number;
  visible: boolean;
  attached: boolean;
  documentId?: string;
}
interface Bridge {
  port: Port;
  tabId: number;
  frameId: number;
  documentId?: string;
}
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: number | NodeJS.Timeout;
  tabId: number;
  frameId: number;
}
const clients = new Set<Client>();
const bridges = new Map<string, Bridge>();
const initializing = new Map<number, Promise<FrameInfo[]>>();
const pending = new Map<string, Pending>();
const bridgeWaiters = new Map<string, Set<() => void>>();
let sequence = 0;
const key = (tabId: number, frameId: number) => `${tabId}:${frameId}`;
const ownOrigin = chrome.runtime.getURL("");
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const post = (port: Port, message: unknown) => {
  try {
    port.postMessage(message);
  } catch {
    /* A closed UI cannot receive a response. */
  }
};
function failPending(tabId: number, frameId?: number) {
  for (const [id, p] of pending) {
    if (p.tabId === tabId && (frameId === undefined || p.frameId === frameId)) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new Error("DISCONNECTED: The inspected document disconnected."));
    }
  }
}
function notify(tabId: number, event: RuntimeEvent) {
  for (const client of clients)
    if (client.attached && client.tabId === tabId)
      post(client.port, { type: "event", event });
}
async function settings(): Promise<Settings> {
  const stored = await chrome.storage.local.get("settings");
  return normalizeSettings(stored.settings);
}
function validTab(tabId: unknown): tabId is number {
  return typeof tabId === "number" && Number.isSafeInteger(tabId) && tabId >= 0;
}
async function frames(tabId: number): Promise<FrameInfo[]> {
  const values = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => ({ url: location.href, title: document.title }),
  });
  return values
    .filter((v) => v.result && !v.result.url.startsWith(ownOrigin))
    .map((v) => ({
      frameId: v.frameId,
      documentId: v.documentId,
      url: v.result!.url,
      title: v.result!.title,
    }));
}
async function initialize(tabId: number): Promise<FrameInfo[]> {
  const current = initializing.get(tabId);
  if (current) return current;
  const work = (async () => {
    const list = await frames(tabId);
    if (!list.length)
      throw new Error(
        "FRAME_UNAVAILABLE: No injectable game documents are available.",
      );
    const frameIds = list.map((frame) => frame.frameId);
    await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      files: ["bridge.js"],
      world: "ISOLATED",
    });
    await chrome.scripting.executeScript({
      target: { tabId, frameIds },
      files: ["runtime.js"],
      world: "MAIN",
    });
    return list;
  })();
  initializing.set(tabId, work);
  try {
    return await work;
  } finally {
    initializing.delete(tabId);
  }
}
async function bridgeFor(tabId: number, frameId: number): Promise<Bridge> {
  const k = key(tabId, frameId);
  const ready = bridges.get(k);
  if (ready) return ready;
  await new Promise<void>((resolve, reject) => {
    const callbacks = bridgeWaiters.get(k) || new Set<() => void>();
    const finish = () => {
      clearTimeout(timer);
      callbacks.delete(finish);
      if (!callbacks.size) bridgeWaiters.delete(k);
      resolve();
    };
    const timer = setTimeout(() => {
      callbacks.delete(finish);
      if (!callbacks.size) bridgeWaiters.delete(k);
      reject(
        new Error("FRAME_UNAVAILABLE: The selected frame is unavailable."),
      );
    }, 5000);
    callbacks.add(finish);
    bridgeWaiters.set(k, callbacks);
  });
  const bridge = bridges.get(k);
  if (!bridge) throw new Error("DISCONNECTED: The frame disconnected.");
  return bridge;
}
async function command(
  tabId: number,
  frameId: number,
  request: RuntimeRequest,
): Promise<unknown> {
  const bridge = await bridgeFor(tabId, frameId);
  return new Promise((resolve, reject) => {
    const id = `worker-${++sequence}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("TIMEOUT: The game did not respond within 15 seconds."));
    }, 15000);
    pending.set(id, { resolve, reject, timer, tabId, frameId });
    post(bridge.port, { type: "request", request: { ...request, id } });
  });
}
function cleanup(tabId: number) {
  if ([...clients].some((c) => c.attached && c.tabId === tabId)) return;
  failPending(tabId);
  for (const [k, bridge] of bridges) {
    if (bridge.tabId === tabId) {
      post(bridge.port, { type: "stop" });
      bridges.delete(k);
    }
  }
}
async function openInCreator(target: unknown): Promise<{ opened: true }> {
  const data = target as EditorTarget;
  const field =
    typeof data?.uuid === "string"
      ? "uuid"
      : typeof data?.fileId === "string"
        ? "fileId"
        : null;
  if (!field)
    throw new Error(
      "NO_EDITOR_TARGET: This object has no Creator asset identity.",
    );
  const value = data[field]!;
  if (!value || value.length > 1024)
    throw new Error("NO_EDITOR_TARGET: Invalid asset identity.");
  const response = await fetch(
    `http://localhost:2505/open?${field}=${encodeURIComponent(value)}`,
    {
      signal: AbortSignal.timeout(2500),
      credentials: "omit",
      redirect: "error",
    },
  ).catch(() => {
    throw new Error(
      "EDITOR_UNAVAILABLE: No local Creator integration is listening on localhost:2505.",
    );
  });
  if (!response.ok)
    throw new Error(
      `EDITOR_UNAVAILABLE: Local Creator integration returned ${response.status}.`,
    );
  return { opened: true };
}
async function handle(
  client: Client,
  message: Record<string, unknown>,
): Promise<unknown> {
  if (message.type === "attach") {
    let tabId = message.tabId;
    const floating = client.port.sender?.url?.startsWith(
      ownOrigin + "floating.html",
    );
    if (floating) {
      tabId = client.port.sender?.tab?.id;
      if (tabId !== message.tabId)
        throw new Error(
          "INVALID_TAB: Floating inspector must stay in its own tab.",
        );
    }
    if (!validTab(tabId))
      throw new Error("INVALID_TAB: An inspected tab is required.");
    client.tabId = tabId;
    client.frameId =
      typeof message.frameId === "number" && Number.isInteger(message.frameId)
        ? message.frameId
        : 0;
    client.attached = true;
    try {
      const list = await initialize(tabId);
      if (!clients.has(client)) cleanup(tabId);
      return list;
    } catch (error) {
      client.attached = false;
      cleanup(tabId);
      throw error;
    }
  }
  if (message.type === "getSettings") return settings();
  if (message.type === "saveSettings") {
    const current = await settings();
    const update =
      message.settings && typeof message.settings === "object"
        ? message.settings
        : {};
    const next = normalizeSettings({ ...current, ...update });
    await chrome.storage.local.set({ settings: next });
    return next;
  }
  if (!client.attached)
    throw new Error(
      "NOT_ATTACHED: Open a game page and connect the inspector.",
    );
  if (message.type === "frames") return frames(client.tabId);
  if (message.type === "selectFrame") {
    const list = await frames(client.tabId);
    if (
      typeof message.frameId !== "number" ||
      !list.some((f) => f.frameId === message.frameId)
    )
      throw new Error(
        "FRAME_UNAVAILABLE: The selected frame no longer exists.",
      );
    await initialize(client.tabId);
    client.frameId = message.frameId;
    client.documentId = undefined;
    return { frameId: client.frameId };
  }
  if (message.type === "visible") {
    client.visible = message.visible === true;
    if (
      !client.visible &&
      ![...clients].some(
        (other) =>
          other !== client &&
          other.attached &&
          other.visible &&
          other.tabId === client.tabId &&
          other.frameId === client.frameId,
      )
    ) {
      for (const name of ["hover", "select", "cancelPick"] as const)
        void command(client.tabId, client.frameId, {
          id: `visibility-${++sequence}`,
          command: name,
          args: { id: null },
        }).catch(() => {});
      void command(client.tabId, client.frameId, {
        id: `visibility-${++sequence}`,
        command: "gameInfo",
        args: { drawCallAttribution: false },
      }).catch(() => {});
    }
    return null;
  }
  if (message.type === "command") {
    if (!isRequest(message.request))
      throw new Error("INVALID_REQUEST: Unknown inspector command.");
    if (message.request.command === "replaceImage") {
      const args = message.request.args as { dataUrl?: unknown } | undefined;
      if (
        typeof args?.dataUrl !== "string" ||
        args.dataUrl.length > 8 * 1024 * 1024
      )
        throw new Error(
          "INVALID_IMAGE: Image is missing or exceeds the 6 MiB encoded limit.",
        );
    }
    const selectedBridge = await bridgeFor(client.tabId, client.frameId);
    if (
      message.request.command === "support" ||
      message.request.command === "tree"
    )
      client.documentId = selectedBridge.documentId;
    else if (client.documentId !== selectedBridge.documentId)
      throw new Error(
        "STALE_DOCUMENT: The game document changed. Refresh before using the selection.",
      );
    const result = await command(client.tabId, client.frameId, message.request);
    if (
      message.request.command === "pick" &&
      client.port.sender?.url?.startsWith(ownOrigin + "floating.html")
    ) {
      const host = bridges.get(key(client.tabId, 0));
      if (host) post(host.port, { type: "floatingPicking", active: true });
    } else if (message.request.command === "cancelPick") {
      const host = bridges.get(key(client.tabId, 0));
      if (host) post(host.port, { type: "floatingPicking", active: false });
    }
    if (
      message.request.command === "openAsset" ||
      message.request.command === "openPrefab"
    )
      return openInCreator(result);
    return result;
  }
  throw new Error("INVALID_REQUEST: Unknown browser operation.");
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.sender?.id !== chrome.runtime.id) return;
  if (port.name === "pts-bridge") {
    const tabId = port.sender.tab?.id;
    const frameId = port.sender.frameId;
    if (!validTab(tabId) || typeof frameId !== "number")
      return port.disconnect();
    const bridge: Bridge = {
      port,
      tabId,
      frameId,
      documentId: port.sender.documentId,
    };
    const k = key(tabId, frameId);
    const previous = bridges.get(k);
    if (previous && previous.port !== port) {
      failPending(tabId, frameId);
      post(previous.port, { type: "stop" });
    }
    bridges.set(k, bridge);
    for (const ready of bridgeWaiters.get(k) || []) ready();
    port.onMessage.addListener((message) => {
      if (bridges.get(k) !== bridge || !message || typeof message !== "object")
        return;
      if (message.type === "response") {
        const response = message.response as RuntimeResponse;
        const p = pending.get(response?.id);
        if (!p || p.tabId !== tabId || p.frameId !== frameId) return;
        clearTimeout(p.timer);
        pending.delete(response.id);
        response.ok
          ? p.resolve(response.result)
          : p.reject(
              new Error(
                `${response.error?.code || "RUNTIME_ERROR"}: ${response.error?.message || "The game command failed."}`,
              ),
            );
      } else if (message.type === "event") {
        const event = message.event as RuntimeEvent;
        if (
          !event ||
          !["picked", "sceneChanged", "status", "detached"].includes(event.type)
        )
          return;
        if (event.type === "picked") {
          const host = bridges.get(key(tabId, 0));
          if (host) post(host.port, { type: "floatingPicking", active: false });
        }
        for (const client of clients)
          if (
            client.attached &&
            client.tabId === tabId &&
            client.frameId === frameId
          )
            post(client.port, { type: "event", event });
      } else if (message.type === "floatingClosed") {
        // Removing the iframe closes its client port; normal ownership cleanup follows.
      }
    });
    port.onDisconnect.addListener(() => {
      if (bridges.get(k) === bridge) {
        bridges.delete(k);
        failPending(tabId, frameId);
        notify(tabId, {
          type: "status",
          data: { code: "FRAME_DISCONNECTED", frameId },
        });
      }
    });
    return;
  }
  if (port.name !== "pts-client" || !port.sender.url?.startsWith(ownOrigin))
    return port.disconnect();
  const path = new URL(port.sender.url).pathname;
  if (
    !["/panel.html", "/floating.html", "/popup.html", "/options.html"].includes(
      path,
    )
  )
    return port.disconnect();
  const client: Client = {
    port,
    tabId: -1,
    frameId: 0,
    visible: true,
    attached: false,
  };
  clients.add(client);
  port.onMessage.addListener((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      typeof message.id !== "string" ||
      message.id.length > 100
    )
      return;
    handle(client, message).then(
      (result) =>
        post(port, { type: "result", id: message.id, ok: true, result }),
      (error) =>
        post(port, {
          type: "result",
          id: message.id,
          ok: false,
          error: errorMessage(error),
        }),
    );
  });
  port.onDisconnect.addListener(() => {
    clients.delete(client);
    if (client.attached) cleanup(client.tabId);
  });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const client of clients)
    if (client.tabId === tabId) {
      client.attached = false;
      post(client.port, {
        type: "event",
        event: { type: "detached", data: { code: "TAB_CLOSED" } },
      });
    }
  cleanup(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (
    change.status !== "complete" ||
    ![...clients].some((c) => c.attached && c.tabId === tabId)
  )
    return;
  initialize(tabId).then(
    () =>
      notify(tabId, { type: "sceneChanged", data: { reason: "navigation" } }),
    (error) =>
      notify(tabId, {
        type: "status",
        data: { code: "CONNECTION_ERROR", message: errorMessage(error) },
      }),
  );
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(ownOrigin))
    return;
  if (message?.type === "panel-hidden" && validTab(message.tabId)) {
    for (const client of clients)
      if (
        client.tabId === message.tabId &&
        client.port.sender?.url?.startsWith(ownOrigin + "panel.html")
      )
        post(client.port, { type: "visibility", visible: false });
    respond({ ok: true });
    return;
  }
  if (
    message?.type === "toggle-floating" &&
    new URL(sender.url).pathname === "/popup.html" &&
    validTab(message.tabId)
  ) {
    const tabId = message.tabId;
    (async () => {
      await initialize(tabId);
      const bridge = await bridgeFor(tabId, 0);
      const config = await settings();
      post(bridge.port, { type: "floating", tabId, locale: config.locale });
      return { ok: true };
    })().then(respond, (error) =>
      respond({ ok: false, error: errorMessage(error) }),
    );
    return true;
  }
  return;
});
