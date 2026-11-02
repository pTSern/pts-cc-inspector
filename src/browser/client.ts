import {
  normalizeSettings,
  type Command,
  type FrameInfo,
  type InspectorClient,
  type RuntimeEvent,
  type Settings,
} from "../shared/protocol";
interface Waiting {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: number;
}
export class BrowserInspectorClient implements InspectorClient {
  private port: chrome.runtime.Port | null = null;
  private readonly waiting = new Map<string, Waiting>();
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private sequence = 0;
  private stopped = false;
  private retry: number | undefined;
  private ready: Promise<FrameInfo[]>;
  private attachFailed = false;
  private currentFrames: FrameInfo[] = [];
  private visible = true;
  constructor(
    private readonly tabId: number,
    private frameId = 0,
  ) {
    this.connect();
    this.ready = this.attach();
    void this.ready.catch(() => {});
  }
  private connect() {
    if (this.stopped) return;
    this.port = chrome.runtime.connect({ name: "pts-client" });
    this.port.onMessage.addListener((message) => {
      if (message.type === "result") {
        const request = this.waiting.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.waiting.delete(message.id);
        message.ok
          ? request.resolve(message.result)
          : request.reject(
              new Error(message.error || "Browser operation failed."),
            );
      } else if (message.type === "event") {
        for (const listener of this.listeners) listener(message.event);
      } else if (message.type === "visibility") {
        window.dispatchEvent(
          new CustomEvent("pts-panel-visibility", {
            detail: message.visible === true,
          }),
        );
      }
    });
    this.port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      this.port = null;
      for (const request of this.waiting.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("DISCONNECTED: Extension worker restarted."));
      }
      this.waiting.clear();
      if (this.stopped) return;
      for (const listener of this.listeners)
        listener({ type: "status", data: { code: "RECONNECTING" } });
      this.retry = window.setTimeout(() => {
        if (this.stopped) return;
        try {
          this.connect();
          this.ready = this.attach();
          void this.ready.then(
            () => {
              for (const listener of this.listeners)
                listener({
                  type: "sceneChanged",
                  data: { reason: "reconnect" },
                });
            },
            () => {},
          );
        } catch (error) {
          for (const listener of this.listeners)
            listener({
              type: "status",
              data: { code: "CONNECTION_ERROR", message: String(error) },
            });
        }
      }, 300);
    });
  }
  private rpc<T>(message: Record<string, unknown>): Promise<T> {
    if (this.stopped || !this.port)
      return Promise.reject(new Error("DISCONNECTED: Inspector is closed."));
    const id = `ui-${++this.sequence}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error("TIMEOUT: Browser operation timed out."));
      }, 20000);
      this.waiting.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      });
      try {
        this.port!.postMessage({ ...message, id });
      } catch (error) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(error);
      }
    });
  }
  private async attach(): Promise<FrameInfo[]> {
    if (this.tabId < 0) return [];
    try {
      const frames = await this.rpc<FrameInfo[]>({
        type: "attach",
        tabId: this.tabId,
        frameId: this.frameId,
      });
      this.currentFrames = frames;
      this.attachFailed = false;
      return frames;
    } catch (error) {
      this.attachFailed = true;
      throw error;
    }
  }
  private async attached() {
    if (this.attachFailed) {
      this.attachFailed = false;
      this.ready = this.attach();
    }
    await this.ready;
  }
  async call<T = unknown>(
    command: Command,
    args?: unknown,
    generation?: number,
  ): Promise<T> {
    await this.attached();
    const result = await this.rpc<T>({
      type: "command",
      request: {
        id: `command-${this.sequence + 1}`,
        command,
        args,
        generation,
      },
    });
    if (
      (command === "inspectScript" || command === "inspectHandler") &&
      chrome.devtools?.inspectedWindow
    ) {
      const selected = this.currentFrames.find(
        (frame) => frame.frameId === this.frameId,
      );
      await new Promise<void>((resolve, reject) =>
        chrome.devtools.inspectedWindow.eval(
          "inspect(window.__PTS_CC_INSPECTOR_TARGET__)",
          selected ? { frameURL: selected.url } : {},
          (_result, exception) =>
            exception?.isException
              ? reject(
                  new Error(
                    exception.value ||
                      exception.description ||
                      "Unable to reveal the selected function.",
                  ),
                )
              : resolve(),
        ),
      );
    }
    return result;
  }
  onEvent(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async listFrames() {
    await this.attached();
    this.currentFrames = await this.rpc<FrameInfo[]>({ type: "frames" });
    return this.currentFrames;
  }
  async selectFrame(frameId: number) {
    await this.attached();
    await this.rpc({ type: "selectFrame", frameId });
    this.frameId = frameId;
  }
  async getSettings() {
    return normalizeSettings(await this.rpc<Settings>({ type: "getSettings" }));
  }
  async saveSettings(settings: Partial<Settings>) {
    return normalizeSettings(
      await this.rpc<Settings>({ type: "saveSettings", settings }),
    );
  }
  setVisible(visible: boolean) {
    if (this.stopped || this.visible === visible) return;
    this.visible = visible;
    void this.rpc({ type: "visible", visible }).catch((error) => {
      for (const listener of this.listeners)
        listener({
          type: "status",
          data: { code: "VISIBILITY_ERROR", message: String(error) },
        });
    });
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.retry);
    for (const request of this.waiting.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("DISCONNECTED: Inspector closed."));
    }
    this.waiting.clear();
    this.listeners.clear();
    this.port?.disconnect();
    this.port = null;
  }
}
