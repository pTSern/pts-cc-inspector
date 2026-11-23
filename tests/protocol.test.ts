import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionId,
  isRequest,
  messageTargetOrigin,
  normalizeSettings,
} from "../src/shared/protocol";
import { safePath, valueKind } from "../src/runtime/properties";
import {
  decodeVirtualEntry,
  normalizeExportPath,
} from "../src/runtime/export";

test("refresh preferences cannot schedule an unbounded or excessively tight polling loop", () => {
  assert.equal(normalizeSettings({ refreshMs: 1 }).refreshMs, 250);
  assert.equal(normalizeSettings({ refreshMs: 999999 }).refreshMs, 10000);
  for (const value of [NaN, Infinity, -Infinity, "1", null, {}]) {
    const refreshMs = normalizeSettings({ refreshMs: value }).refreshMs;
    assert.ok(
      Number.isFinite(refreshMs) && refreshMs >= 250 && refreshMs <= 10000,
    );
  }
});

test("preference normalization drops unrelated identity, network and prototype data", () => {
  const input = JSON.parse(
    '{"locale":"vi","refreshMs":500,"clientId":"do-not-persist","endpoint":"https://example.invalid","__proto__":{"polluted":true}}',
  );
  const normalized = normalizeSettings(input);
  assert.equal(normalized.locale, "vi");
  assert.equal(normalized.refreshMs, 500);
  assert.equal(normalized.overlayColor, "#36c7ff");
  assert.equal("clientId" in normalized, false);
  assert.equal("endpoint" in normalized, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, "__proto__"),
    false,
  );
  assert.equal("polluted" in {}, false);
  assert.equal(
    normalizeSettings({ overlayColor: "#ff0077" }).overlayColor,
    "#ff0077",
  );
  assert.equal(
    normalizeSettings({ overlayColor: "invalid" }).overlayColor,
    "#36c7ff",
  );
});

test("page requests cannot introduce executable commands or malformed correlation metadata", () => {
  assert.equal(
    isRequest({ id: "1", command: "eval", args: "alert(1)" }),
    false,
  );
  assert.equal(isRequest({ id: "1".repeat(101), command: "tree" }), false);
  assert.equal(isRequest({ id: "1", command: "set", generation: 0.5 }), false);
  assert.equal(
    isRequest({ id: "1", command: "set", generation: Infinity }),
    false,
  );
  assert.equal(isRequest(null), false);
  assert.equal(isRequest({ id: "1", command: "assetTree" }), true);
  assert.equal(isRequest({ id: "1", command: "exportProject" }), true);
  assert.equal(
    isRequest({
      id: "1",
      command: "assetInspect",
      args: { uuid: "abc", bundle: "main" },
    }),
    true,
  );
});

test("valueKind distinguishes engine value structs from nodes and components with x/y/z or width/height", () => {
  class Vec3 {
    x = 1;
    y = 2;
    z = 3;
  }
  class Node {
    x = 10;
    y = 20;
    z = 0;
    width = 100;
    height = 80;
  }
  const cc = { Vec3 };
  assert.equal(valueKind(new Vec3(), cc), "vec3");
  assert.equal(valueKind(new Node(), cc), "object");
});

test("safePath rejects prototype and constructor traversal", () => {
  assert.throws(() => safePath(["node", "__proto__", "polluted"]), {
    name: "InspectorError",
  });
  assert.throws(() => safePath(["node", "constructor", "prototype"]), {
    name: "InspectorError",
  });
});

test("messageTargetOrigin uses wildcard for file:// and opaque origins while preserving http(s) origins", () => {
  assert.equal(messageTargetOrigin("https://game.example.com"), "https://game.example.com");
  assert.equal(messageTargetOrigin("http://127.0.0.1:7456"), "http://127.0.0.1:7456");
  assert.equal(messageTargetOrigin("file://"), "*");
  assert.equal(messageTargetOrigin("null"), "*");
  assert.equal(messageTargetOrigin(""), "*");
});

test("createSessionId generates valid UUID strings", () => {
  const id = createSessionId();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("decodeVirtualEntry handles string text, base64 data URIs, and virtual file objects", () => {
  const plain = decodeVirtualEntry('{"ok":true}');
  assert.equal(new TextDecoder().decode(plain!), '{"ok":true}');

  // 1x1 PNG header bytes encoded as base64 data URI (playable single-HTML format)
  const pngBytes = decodeVirtualEntry("data:image/png;base64,iVBORw0KGgo=");
  assert.deepEqual(
    Array.from(pngBytes!),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );

  const objBytes = decodeVirtualEntry({ text: "console.log(1);" });
  assert.equal(new TextDecoder().decode(objBytes!), "console.log(1);");

  const rawBytes = decodeVirtualEntry({ data: new Uint8Array([1, 2, 3]) });
  assert.deepEqual(Array.from(rawBytes!), [1, 2, 3]);
});

test("normalizeExportPath preserves clean relative paths for file:// and nested http:// URLs", () => {
  assert.equal(
    normalizeExportPath(
      "assets/main/config.json",
      "file:///E:/__pTSern/.spy/HomeIsland/Sample.html",
    ),
    "assets/main/config.json",
  );
  assert.equal(
    normalizeExportPath(
      "file:///E:/__pTSern/.spy/HomeIsland/assets/main/index.js?v=1",
      "file:///E:/__pTSern/.spy/HomeIsland/Sample.html",
    ),
    "assets/main/index.js",
  );
  assert.equal(
    normalizeExportPath(
      "assets/internal/config.json",
      "http://127.0.0.1:8080/games/home/Sample.html",
    ),
    "assets/internal/config.json",
  );
});
