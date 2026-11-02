import type { Json, Property, PropertyKind } from "../shared/protocol";
import {
  isObject,
  numericFields,
  type CocosNamespace,
  type EngineObject,
  type EngineValue,
} from "./contracts";
export type { EngineObject } from "./contracts";
export class InspectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InspectorError";
  }
}
export function fail(code: string, message: string): never {
  throw new InspectorError(code, message);
}
const FORBIDDEN = { prototype: true, constructor: true } as const;
export function safePath(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 12 ||
    value.some(
      (k) =>
        typeof k !== "string" ||
        !k.length ||
        k.length > 160 ||
        k === "__proto__" ||
        Object.prototype.hasOwnProperty.call(FORBIDDEN, k),
    )
  )
    fail("INVALID_PATH", "Property path is invalid or protected.");
  return value as string[];
}
export function descriptor(
  object: EngineObject,
  key: string,
): PropertyDescriptor | undefined {
  let current: object | null = object;
  for (
    let depth = 0;
    current && depth < 16;
    depth++, current = Object.getPrototypeOf(current)
  ) {
    const found = Object.getOwnPropertyDescriptor(current, key);
    if (found) return found;
  }
  return undefined;
}
export function readField(object: EngineObject, key: string): unknown {
  if (
    key === "__proto__" ||
    Object.prototype.hasOwnProperty.call(FORBIDDEN, key)
  )
    fail("INVALID_PATH", "Protected property cannot be accessed.");
  return object[key];
}
export function className(value: object, cc?: CocosNamespace): string {
  try {
    return String(
      cc?.js?.getClassName?.(value) || value.constructor?.name || "Object",
    ).slice(0, 160);
  } catch {
    return "Object";
  }
}
export function imageLike(value: unknown): value is EngineObject {
  return (
    isObject(value) &&
    (typeof value.getTexture === "function" ||
      typeof value.getGFXTexture === "function" ||
      typeof value.getHtmlElementObj === "function" ||
      (!!value.texture && ("rect" in value || "_rect" in value)) ||
      (!!value.image && ("width" in value || "_width" in value)))
  );
}
function ownNumber(value: EngineObject, key: string): boolean {
  try {
    return typeof value[key] === "number" && Number.isFinite(value[key]);
  } catch {
    return false;
  }
}
const VALUE_TYPES: readonly [
  keyof Pick<
    CocosNamespace,
    "Color" | "Size" | "Quat" | "Vec4" | "Vec3" | "Vec2"
  >,
  PropertyKind,
  readonly string[],
][] = [
  ["Color", "color", ["r", "g", "b", "a"]],
  ["Size", "size", ["width", "height"]],
  ["Quat", "vec4", ["x", "y", "z", "w"]],
  ["Vec4", "vec4", ["x", "y", "z", "w"]],
  ["Vec3", "vec3", ["x", "y", "z"]],
  ["Vec2", "vec2", ["x", "y"]],
];
export function valueKind(value: unknown, cc?: CocosNamespace): PropertyKind {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "string";
  if (imageLike(value)) return "image";
  if (!isObject(value)) return "object";
  // Nodes, components and custom objects can also expose x/y/z or width/height.
  // Only real engine value classes qualify for whole-value typed replacement.
  const name = className(value, cc);
  for (const [type, kind, fields] of VALUE_TYPES) {
    const ctor = cc?.[type];
    const matches =
      typeof ctor === "function"
        ? value instanceof ctor
        : name === type || name === `cc.${type}`;
    if (matches && fields.every((key) => ownNumber(value, key))) return kind;
  }
  return "object";
}
export function preview(value: unknown, kind = valueKind(value)): Json {
  if (kind === "null") return null;
  if (kind === "string" && typeof value === "string")
    return value.slice(0, 4096);
  if (kind === "boolean" && typeof value === "boolean") return value;
  if (kind === "number" && typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  const fields =
    kind === "color"
      ? ["r", "g", "b", "a"]
      : kind === "size"
        ? ["width", "height"]
        : kind === "vec2"
          ? ["x", "y"]
          : kind === "vec3"
            ? ["x", "y", "z"]
            : kind === "vec4"
              ? ["x", "y", "z", "w"]
              : null;
  if (fields && isObject(value))
    return Object.fromEntries(fields.map((k) => [k, Number(value[k])]));
  if (kind === "array" && Array.isArray(value)) return `Array(${value.length})`;
  return value !== null && typeof value === "object"
    ? className(value)
    : "Object";
}
export function reflectedKeys(object: EngineObject): string[] {
  const ctor = object.constructor;
  const props =
    ctor &&
    (typeof ctor === "function" || typeof ctor === "object") &&
    "__props__" in ctor
      ? ctor.__props__
      : undefined;
  const reflected = Array.isArray(props)
    ? props
        .filter((k: unknown): k is string => typeof k === "string")
        .map((key) => {
          const publicKey = key.startsWith("_N$")
            ? key.slice(3)
            : key.startsWith("_")
              ? key.slice(1)
              : key;
          return publicKey !== key && descriptor(object, publicKey)
            ? publicKey
            : key;
        })
    : [];
  return [
    ...new Set([
      ...reflected,
      ...Object.keys(object).filter((k) => !k.startsWith("_")),
    ]),
  ]
    .filter(
      (k) =>
        k !== "__proto__" &&
        !Object.prototype.hasOwnProperty.call(FORBIDDEN, k) &&
        ![
          "node",
          "_node",
          "_objFlags",
          "_id",
          "_uuid",
          "_name",
          "_components",
          "parent",
          "children",
        ].includes(k),
    )
    .slice(0, 160);
}
export function reflectedOptions(
  object: EngineObject,
  key: string,
  cc: CocosNamespace,
): { label: string; value: Json }[] | undefined {
  try {
    const attrs = cc.Class?.Attr?.getClassAttrs?.(object.constructor);
    if (!isObject(attrs)) return undefined;
    const list =
      attrs[`${key}$_$enumList`] ||
      attrs[`_${key}$_$enumList`] ||
      attrs[`_N$${key}$_$enumList`];
    if (Array.isArray(list))
      return list
        .slice(0, 256)
        .filter(
          (e: unknown): e is { name: string; value: number } =>
            isObject(e) &&
            typeof e.name === "string" &&
            typeof e.value === "number" &&
            Number.isFinite(e.value),
        )
        .map((e) => ({ label: e.name, value: e.value }));
  } catch {
    /* Reflection is optional; data properties remain inspectable. */
  }
  return undefined;
}
export function property(
  object: EngineObject,
  key: string,
  path: string[],
  cc: CocosNamespace,
  allowGetter = false,
  locked?: string,
): Property | null {
  const d = descriptor(object, key);
  if (!d) return null;
  const base = { key, label: key, path };
  if (d.get && !allowGetter)
    return {
      ...base,
      type: "null",
      value: null,
      readOnly: true,
      reason: "Getter is not evaluated automatically.",
    };
  try {
    const value = readField(object, key);
    if (typeof value === "function") return null;
    const kind = valueKind(value, cc);
    const options = reflectedOptions(object, key, cc);
    const row: Property = {
      ...base,
      type: options ? "enum" : kind,
      value: preview(value, kind),
      readOnly:
        !!locked ||
        (d.set === undefined && (d.get !== undefined || d.writable === false)),
      expandable:
        ["object", "array", "vec2", "vec3", "vec4", "size", "color"].includes(
          kind,
        ) && value !== null,
    };
    if (locked) row.reason = locked;
    if (options) row.options = options;
    if (isObject(value)) {
      const uuid = value._uuid || value.uuid;
      if (typeof uuid === "string" && uuid.length <= 512) row.assetUuid = uuid;
    }
    if (kind === "image") row.readOnly = true;
    if (kind === "number") row.step = 0.1;
    return row;
  } catch (error) {
    return {
      ...base,
      type: "null",
      value: null,
      readOnly: true,
      reason: `Property read failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
export function validateValue(value: unknown, depth = 0): void {
  if (depth > 8) fail("INVALID_VALUE", "Value nesting exceeds the limit.");
  if (typeof value === "number" && !Number.isFinite(value))
    fail("INVALID_VALUE", "Numeric values must be finite.");
  if (typeof value === "string" && value.length > 65536)
    fail("INVALID_VALUE", "String exceeds the size limit.");
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 256)
      fail("INVALID_VALUE", "Value contains too many fields.");
    for (const [key, item] of entries) {
      if (
        key === "__proto__" ||
        Object.prototype.hasOwnProperty.call(FORBIDDEN, key)
      )
        fail("INVALID_VALUE", "Value contains a protected key.");
      validateValue(item, depth + 1);
    }
  } else if (
    !["number", "string", "boolean"].includes(typeof value) &&
    value !== null
  )
    fail("INVALID_VALUE", "Only JSON property values are accepted.");
}
export function typedValue(
  previous: unknown,
  value: unknown,
  cc: CocosNamespace,
): unknown {
  validateValue(value);
  const kind = valueKind(previous, cc);
  if (kind === "number" || kind === "boolean" || kind === "string") {
    if (typeof previous !== typeof value)
      fail("TYPE_MISMATCH", "Property value has the wrong type.");
    return value;
  }
  const names =
    kind === "color"
      ? ["r", "g", "b", "a"]
      : kind === "size"
        ? ["width", "height"]
        : kind === "vec2"
          ? ["x", "y"]
          : kind === "vec3"
            ? ["x", "y", "z"]
            : kind === "vec4"
              ? ["x", "y", "z", "w"]
              : null;
  if (!names)
    fail(
      "UNSUPPORTED_WRITE",
      "Expand objects or arrays and edit an individual supported field.",
    );
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("TYPE_MISMATCH", "A typed property requires a numeric object.");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== names.length ||
    names.some(
      (k) => typeof input[k] !== "number" || !Number.isFinite(input[k]),
    )
  )
    fail("TYPE_MISMATCH", "Typed property fields must all be finite numbers.");
  if (
    kind === "color" &&
    names.some((k) => (input[k] as number) < 0 || (input[k] as number) > 255)
  )
    fail("INVALID_VALUE", "Color channels must be between 0 and 255.");
  if (!isObject(previous))
    fail("TYPE_MISMATCH", "A typed property requires an engine value.");
  // valueKind verified the engine class and its numeric members above.
  const typed = previous as EngineValue;
  const result =
    typeof typed.clone === "function"
      ? typed.clone()
      : kind === "color" && cc.Color
        ? new cc.Color()
        : kind === "size" && cc.Size
          ? new cc.Size()
          : kind === "vec2" && cc.Vec2
            ? new cc.Vec2()
            : kind === "vec3" && cc.Vec3
              ? new cc.Vec3()
              : kind === "vec4" && cc.Vec4
                ? new cc.Vec4()
                : null;
  if (!result)
    fail(
      "UNSUPPORTED_WRITE",
      "This engine does not expose a supported typed-value constructor.",
    );
  const mutable = result as EngineObject;
  for (const key of names) mutable[key] = input[key];
  return result;
}
