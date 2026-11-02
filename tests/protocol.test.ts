import test from "node:test";
import assert from "node:assert/strict";
import { isRequest, normalizeSettings } from "../src/shared/protocol";

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
  assert.equal("clientId" in normalized, false);
  assert.equal("endpoint" in normalized, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized, "__proto__"),
    false,
  );
  assert.equal("polluted" in {}, false);
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
});
