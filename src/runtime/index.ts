import {
  CHANNEL,
  isRequest,
  type RuntimeEvent,
  type RuntimeResponse,
} from "../shared/protocol";
import { EngineInspector } from "./engine";
declare const __PTS_BUILD_ID__: string;
interface InstalledRuntime {
  buildId: string;
  dispose: () => void;
}
const world = window as Window & { __ptsInspectorRuntime?: InstalledRuntime };
if (
  world.__ptsInspectorRuntime &&
  world.__ptsInspectorRuntime.buildId !== __PTS_BUILD_ID__
) {
  world.__ptsInspectorRuntime.dispose();
}
if (!world.__ptsInspectorRuntime) {
  let session = "";
  let disposed = false;
  const emit = (event: RuntimeEvent) => {
    if (session && !disposed)
      window.postMessage(
        { channel: CHANNEL, session, kind: "event", event },
        location.origin === "null" ? "*" : location.origin,
      );
  };
  const inspector = new EngineInspector(emit);
  const listener = async (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.data?.channel !== CHANNEL ||
      typeof event.data?.session !== "string" ||
      event.data.session.length > 100
    )
      return;
    if (event.data.kind === "dispose") {
      if (!session || event.data.session === session) dispose();
      return;
    }
    if (event.data.kind !== "request" || !isRequest(event.data.request)) return;
    session = event.data.session;
    const request = event.data.request;
    let response: RuntimeResponse;
    try {
      response = {
        id: request.id,
        ok: true,
        result: await inspector.dispatch(request),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const explicitCode =
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        /^[A-Z0-9_]{2,64}$/.test(error.code)
          ? error.code
          : null;
      const separator = message.indexOf(":");
      const prefixCode =
        separator > 0 && /^[A-Z0-9_]{2,64}$/.test(message.slice(0, separator))
          ? message.slice(0, separator)
          : null;
      response = {
        id: request.id,
        ok: false,
        error: {
          code: explicitCode || prefixCode || "RUNTIME_ERROR",
          message:
            prefixCode && !explicitCode
              ? message.slice(separator + 1).trim()
              : message,
        },
      };
    }
    if (!disposed)
      window.postMessage(
        {
          channel: CHANNEL,
          session: event.data.session,
          kind: "response",
          response,
        },
        location.origin === "null" ? "*" : location.origin,
      );
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    inspector.dispose();
    window.removeEventListener("message", listener);
    window.removeEventListener("pagehide", dispose);
    delete world.__ptsInspectorRuntime;
  }
  world.__ptsInspectorRuntime = { buildId: __PTS_BUILD_ID__, dispose };
  window.addEventListener("message", listener);
  window.addEventListener("pagehide", dispose, { once: true });
}
