import type {
  EditorTarget,
  EngineSupport,
  GameInfo,
  NodeDetails,
  Property,
  PropertyGroup,
  RuntimeEvent,
  RuntimeRequest,
  TreeNode,
  TreeSnapshot,
} from "../shared/protocol";
import {
  className,
  descriptor,
  fail,
  imageLike,
  InspectorError,
  property,
  readField,
  reflectedKeys,
  safePath,
  typedValue,
  validateValue,
  valueKind,
  type EngineObject,
} from "./properties";
import { SelectionOverlay } from "./overlay";
import { imagePreview, replaceImage, type ImagePreview } from "./images";
import { DrawCallAttribution } from "./draw-calls";
import {
  cocosNamespace,
  isObject,
  numericFields,
  type CocosNamespace,
  type EngineNode,
  type EngineComponent,
  type EngineDirector,
  type EngineAtlas,
  type EngineAsset,
} from "./contracts";

const MAX_NODES = 20000;
const NODE_FIELDS = [
  "name",
  "active",
  "position",
  "scale",
  "eulerAngles",
  "angle",
  "rotation",
  "rotationX",
  "rotationY",
  "x",
  "y",
  "z",
  "width",
  "height",
  "anchorX",
  "anchorY",
  "opacity",
  "color",
  "group",
  "layer",
];
const COMPONENT_FIELDS = [
  "enabled",
  "string",
  "color",
  "spriteFrame",
  "texture",
  "font",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "horizontalAlign",
  "verticalAlign",
  "overflow",
  "enableWrapText",
  "spacingX",
  "cacheMode",
  "contentSize",
  "anchorPoint",
  "opacity",
  "interactable",
  "isChecked",
  "progress",
  "volume",
  "loop",
  "mute",
  "playOnLoad",
  "clip",
  "clips",
  "defaultClip",
  "type",
  "sizeMode",
  "fillType",
  "fillCenter",
  "fillStart",
  "fillRange",
  "trim",
  "srcBlendFactor",
  "dstBlendFactor",
];
const EVENT_FIELDS = [
  "clickEvents",
  "checkEvents",
  "slideEvents",
  "scrollEvents",
  "textChanged",
  "editingDidBegan",
  "editingDidEnded",
  "editingReturn",
  "pageEvents",
];
interface Handler {
  name: string;
  event: string;
  target: EngineObject | Function;
}
interface Breakpoint {
  node: EngineNode;
  event: string;
  listener: () => void;
}
interface Location {
  root: EngineObject;
  owner: EngineObject;
  key: string;
  path: string[];
  rootKey: string;
}
function argsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_ARGUMENT", "Command arguments must be an object.");
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.length || value.length > 512)
    fail("INVALID_ARGUMENT", `${name} must be a nonempty bounded string.`);
  return value;
}

/** Owns live engine references only for the current scene generation. Never changes game-node metadata. */
export class EngineInspector {
  private cc: CocosNamespace = {};
  private scene: EngineNode | null = null;
  private generation = crypto.getRandomValues(new Uint32Array(1))[0];
  private sequence = 0;
  private ids = new WeakMap<object, string>();
  private nodes = new Map<string, EngineNode>();
  private components = new Map<string, EngineComponent>();
  private breakpoints: Breakpoint[] = [];
  private overlay: SelectionOverlay;
  private disposed = false;
  private tempSequence = 0;
  private exposed = new Map<string, unknown>();
  private debuggerTarget: unknown;
  private atlasVisible = false;
  private fpsRestore: {
    engine: CocosNamespace;
    visible: boolean;
    applied: boolean;
  } | null = null;
  private imagePreviews = new Map<object, ImagePreview>();
  private modifiedImages = new WeakSet<object>();
  private sceneDirector: EngineDirector | null = null;
  private drawAttribution: DrawCallAttribution | null = null;
  private sceneEvent: string | null = null;
  private sceneLaunched = (): void => {
    if (!this.disposed) this.sync();
  };
  constructor(private readonly emit: (event: RuntimeEvent) => void) {
    this.overlay = new SelectionOverlay(
      () => this.cc,
      (node) => this.validNode(node),
      (node) => {
        if (!node) {
          this.emit({ type: "picked", data: { id: null } });
          return;
        }
        this.sync();
        if (this.validNode(node))
          this.emit({
            type: "picked",
            data: { id: this.identify(node, "n"), generation: this.generation },
          });
      },
    );
  }
  private sync(): boolean {
    if (this.disposed) fail("DETACHED", "The inspector has been detached.");
    // An ES-module game may explicitly register its namespace without changing the original global cc.
    const globals = globalThis as typeof globalThis & EngineObject;
    const candidate = globals.__PTS_CC_INSPECTOR_ENGINE__ || globals.cc;
    const engine = cocosNamespace(candidate) || {};
    const version = String(engine.ENGINE_VERSION || engine.VERSION || "");
    if (
      !engine ||
      !/^[23](?:\.|$)/.test(version) ||
      typeof engine.director?.getScene !== "function"
    ) {
      if (this.scene || this.nodes.size) this.changeScene(null, engine || {});
      this.cc = engine || {};
      return false;
    }
    if (engine.director !== this.sceneDirector) {
      if (this.sceneDirector && this.sceneEvent)
        this.sceneDirector.off?.(this.sceneEvent, this.sceneLaunched);
      this.sceneDirector = engine.director;
      this.sceneEvent =
        typeof engine.Director?.EVENT_AFTER_SCENE_LAUNCH === "string"
          ? engine.Director.EVENT_AFTER_SCENE_LAUNCH
          : null;
      if (this.sceneEvent)
        this.sceneDirector?.on?.(this.sceneEvent, this.sceneLaunched);
    }
    const scene = engine.director!.getScene() || null;
    if (engine !== this.cc || scene !== this.scene)
      this.changeScene(scene, engine);
    return true;
  }
  private changeScene(scene: EngineNode | null, engine: CocosNamespace): void {
    const keepAttribution =
      !!this.drawAttribution?.enabled && engine === this.cc;
    this.clearBreakpoints();
    this.overlay.dispose();
    this.nodes.clear();
    this.components.clear();
    this.ids = new WeakMap();
    this.releaseExposed();
    this.imagePreviews.clear();
    this.modifiedImages = new WeakSet();
    this.drawAttribution?.dispose();
    this.drawAttribution = new DrawCallAttribution(engine);
    this.scene = scene;
    this.cc = engine;
    this.generation++;
    if (keepAttribution && this.drawAttribution.supported)
      this.drawAttribution.enable();
    this.emit({
      type: "sceneChanged",
      data: {
        generation: this.generation,
        sceneName: String(scene?.name || ""),
      },
    });
  }
  private identify(object: EngineNode, kind: "n" | "c"): string {
    let id = this.ids.get(object);
    if (!id) {
      id = `${kind}${++this.sequence}`;
      this.ids.set(object, id);
    }
    if (kind === "n") this.nodes.set(id, object);
    else this.components.set(id, object);
    return id;
  }
  private validNode(node: EngineNode): boolean {
    if (!node || node.isValid === false || node._destroyed === true)
      return false;
    if (this.cc.director?.getScene?.() !== this.scene) return false;
    if (typeof this.cc.isValid === "function" && !this.cc.isValid(node, true))
      return false;
    let current: EngineNode | null | undefined = node;
    for (let i = 0; current && i < 256; i++, current = current.parent)
      if (current === this.scene) return true;
    return false;
  }
  private requireNode(
    args: Record<string, unknown>,
    request: RuntimeRequest,
  ): EngineNode {
    if (request.generation !== this.generation)
      fail(
        "STALE_GENERATION",
        "The scene changed. Refresh the hierarchy before using this node.",
      );
    const node = this.nodes.get(requiredString(args.id, "Node ID"));
    if (!node || !this.validNode(node))
      fail(
        "INVALID_NODE",
        "The node no longer belongs to the current live scene.",
      );
    return node;
  }
  private nodeComponents(node: EngineNode): EngineComponent[] {
    const list =
      node.components ||
      node._components ||
      node.getComponents?.(this.cc.Component) ||
      [];
    return Array.isArray(list)
      ? list.filter((c) => c && c.isValid !== false).slice(0, 256)
      : [];
  }
  private typeName(component: EngineObject): string {
    return className(component, this.cc);
  }
  private drawCalls(): number | null {
    const values = [
      this.cc.director?.root?.device?.numDrawCalls,
      this.cc.renderer?.device?._stats?.drawcalls,
      this.cc.renderer?.drawCalls,
      this.cc.renderer?._drawCalls,
      this.cc.game?._renderContext?.drawCalls,
    ];
    return (
      values.find(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ?? null
    );
  }
  private support(): EngineSupport {
    const version = String(this.cc.ENGINE_VERSION || this.cc.VERSION || "");
    const supported =
      /^[23](?:\.|$)/.test(version) &&
      typeof this.cc.director?.getScene === "function";
    const capabilities = supported
      ? [
          "tree",
          "properties",
          "console",
          "eventBreakpoints",
          "animations",
          "editorTargets",
        ]
      : [];
    const uiTransformCtor =
      this.cc.UITransform ||
      this.cc.js?.getClassByName?.("cc.UITransform") ||
      "cc.UITransform";
    if (
      uiTransformCtor ||
      typeof this.scene?.getBoundingBoxToWorld === "function"
    )
      capabilities.push("uiPicking");
    if (
      typeof this.cc.profiler?.showStats === "function" ||
      typeof this.cc.debug?.setDisplayStats === "function"
    )
      capabilities.push("fps");
    if (typeof this.atlasManager()?.showDebug === "function")
      capabilities.push("atlasDebug");
    if (this.drawAttribution?.supported)
      capabilities.push("drawCallAttribution");
    const atlas = this.atlasManager(),
      enabled = atlas ? descriptor(atlas, "enabled") : undefined;
    if (enabled && (enabled.set || enabled.writable === true))
      capabilities.push("atlasToggle");
    return {
      supported,
      engineVersion: version,
      major: Number(version.charAt(0)) || 0,
      sceneName: String(this.scene?.name || ""),
      capabilities,
      ...(!supported
        ? {
            reason:
              "A global cc or explicitly registered Cocos 2.x/3.x engine namespace is required.",
          }
        : {}),
    };
  }
  private tree(): TreeSnapshot {
    const nodes: TreeNode[] = [];
    if (!this.scene)
      return {
        generation: this.generation,
        nodes,
        count: 0,
        drawCalls: this.drawCalls(),
      };
    const stack: {
      node: EngineNode;
      parentId: string | null;
      depth: number;
    }[] = [{ node: this.scene, parentId: null, depth: 0 }];
    const seen = new Set<object>();
    let truncated = false;
    while (stack.length && nodes.length < MAX_NODES) {
      const item = stack.pop()!;
      const { node, parentId, depth } = item;
      if (seen.has(node) || !this.validNode(node)) continue;
      seen.add(node);
      const id = this.identify(node, "n");
      const children = Array.isArray(node.children) ? node.children : [];
      const components = this.nodeComponents(node);
      for (const c of components) this.identify(c, "c");
      const row: TreeNode = {
        id,
        parentId,
        depth,
        name: String(node.name || "").slice(0, 1024),
        active: node.active !== false,
        activeInHierarchy: node.activeInHierarchy !== false,
        childCount: children.length,
        componentTypes: components.map((c) => this.typeName(c)),
        prefab: !!(node._prefab?.asset || node._prefab?.fileId || node.prefab),
      };
      const drawCall = this.drawAttribution?.enabled
        ? this.drawAttribution.value(node)
        : (node.drawCall ?? node._drawCall);
      if (typeof drawCall === "number" && Number.isFinite(drawCall))
        row.drawCall = drawCall;
      nodes.push(row);
      if (depth < 255) {
        const remaining = Math.max(0, MAX_NODES * 2 - stack.length);
        if (children.length > remaining) truncated = true;
        for (let i = Math.min(children.length, remaining) - 1; i >= 0; i--)
          stack.push({ node: children[i], parentId: id, depth: depth + 1 });
      } else if (children.length) truncated = true;
    }
    // Removed nodes/components must not be retained indefinitely between snapshots.
    for (const [id, node] of this.nodes)
      if (!seen.has(node)) this.nodes.delete(id);
    for (const [id, component] of this.components)
      if (
        !component.node ||
        !seen.has(component.node) ||
        component.isValid === false
      )
        this.components.delete(id);
    return {
      generation: this.generation,
      nodes,
      count: nodes.length,
      drawCalls: this.drawCalls(),
      truncated: truncated || stack.length > 0,
    };
  }
  private widgetReason(node: EngineNode, key: string): string | undefined {
    if (
      ![
        "position",
        "x",
        "y",
        "z",
        "width",
        "height",
        "contentSize",
        "anchorPoint",
        "anchorX",
        "anchorY",
      ].includes(key)
    )
      return;
    const widget = this.cc.Widget
      ? node.getComponent?.(this.cc.Widget)
      : this.nodeComponents(node).find((c) =>
          this.typeName(c).endsWith("Widget"),
        );
    if (!widget || widget.enabled === false) return;
    const x =
      widget.isAlignLeft ||
      widget.isAlignRight ||
      widget.isAlignHorizontalCenter;
    const y =
      widget.isAlignTop || widget.isAlignBottom || widget.isAlignVerticalCenter;
    if (
      (key === "x" && x) ||
      (key === "y" && y) ||
      (key === "position" && (x || y)) ||
      ((key === "width" || key === "contentSize") &&
        widget.isAlignLeft &&
        widget.isAlignRight) ||
      ((key === "height" || key === "contentSize") &&
        widget.isAlignTop &&
        widget.isAlignBottom)
    )
      return "This axis or size is controlled by an enabled Widget alignment constraint.";
    return;
  }
  private groupProperties(
    root: EngineObject,
    prefix: string,
    node: EngineNode,
  ): Property[] {
    const keys =
      prefix === "node"
        ? NODE_FIELDS
        : [...new Set([...COMPONENT_FIELDS, ...reflectedKeys(root)])];
    const ctor = root.constructor;
    const declared =
      ctor &&
      (typeof ctor === "function" || typeof ctor === "object") &&
      "__props__" in ctor
        ? ctor.__props__
        : undefined;
    const reflected = Array.isArray(declared) ? declared : [];
    return keys
      .map((key) =>
        property(
          root,
          key,
          [prefix, key],
          this.cc,
          prefix === "node" ||
            COMPONENT_FIELDS.includes(key) ||
            reflected.includes(key) ||
            reflected.includes(`_${key}`) ||
            reflected.includes(`_N$${key}`),
          this.widgetReason(node, key),
        ),
      )
      .filter((p): p is Property => p !== null)
      .slice(0, 160);
  }
  private nodePath(node: EngineNode): string {
    const parts: string[] = [];
    let current: EngineNode | null | undefined = node;
    for (
      let depth = 0;
      current && depth < 256;
      depth++, current = current.parent
    )
      parts.unshift(String(current.name || ""));
    return parts.join("/");
  }
  private handlerInventory(node: EngineNode): Handler[] {
    const handlers: Handler[] = [];
    for (const component of this.nodeComponents(node))
      for (const field of EVENT_FIELDS) {
        const d = descriptor(component, field);
        if (!d || d.get) continue;
        const list = component[field];
        if (!Array.isArray(list)) continue;
        for (const handler of list.slice(0, 128)) {
          if (!handler || typeof handler.handler !== "string") continue;
          const componentType =
            this.cc.js?._getClassById?.(handler._componentId) ||
            handler.component ||
            handler._componentId;
          const target = handler.target?.getComponent?.(componentType);
          const fn = target?.[handler.handler];
          if (typeof fn === "function")
            handlers.push({
              name: `${this.typeName(component)}.${field}: ${handler.component || ""}.${handler.handler}`,
              event: field,
              target: fn,
            });
        }
      }
    const tables = [
      node._bubblingListeners?._callbackTable,
      node._capturingListeners?._callbackTable,
      node._eventProcessor?._bubblingTarget?._callbackTable,
      node._eventProcessor?._capturingTarget?._callbackTable,
    ];
    for (const table of tables) {
      if (!table || typeof table !== "object") continue;
      for (const event of Object.keys(table).slice(0, 64)) {
        const bucket = table[event];
        const list = Array.isArray(bucket)
          ? bucket
          : bucket?.callbackInfos || bucket?.callbacks;
        if (!Array.isArray(list)) continue;
        for (const entry of list.slice(0, 128)) {
          const callback =
            typeof entry === "function" ? entry : entry?.callback;
          if (typeof callback === "function")
            handlers.push({
              name: `${event}: ${callback.name || "listener"}`,
              event,
              target: callback,
            });
        }
      }
    }
    return handlers.slice(0, 256);
  }
  private eventChoices(): string[] {
    const events = this.cc.Node?.EventType;
    return events
      ? [
          ...new Set(
            Object.values(events).filter(
              (event): event is string => typeof event === "string",
            ),
          ),
        ].slice(0, 128)
      : [
          "touch-start",
          "touch-move",
          "touch-end",
          "touch-cancel",
          "mouse-down",
          "mouse-up",
          "mouse-move",
          "mouse-enter",
          "mouse-leave",
        ];
  }
  private details(node: EngineNode): NodeDetails {
    const id = this.identify(node, "n");
    const groups: PropertyGroup[] = [
      {
        id: "node",
        name: "Node",
        kind: "node",
        properties: this.groupProperties(node, "node", node),
      },
    ];
    const components = this.nodeComponents(node);
    const animations: NodeDetails["animations"] = [];
    for (const component of components) {
      const componentId = this.identify(component, "c");
      groups.push({
        id: componentId,
        name: this.typeName(component),
        kind: "component",
        properties: this.groupProperties(component, componentId, node),
      });
      if (
        typeof component.play === "function" &&
        typeof component.stop === "function" &&
        (component.clips || typeof component.getClips === "function")
      ) {
        const clips = component.clips || component.getClips?.();
        animations.push({
          id: componentId,
          clips: Array.isArray(clips)
            ? clips
                .filter(Boolean)
                .map((clip: EngineObject) => String(clip.name || ""))
                .slice(0, 128)
            : [],
        });
      }
    }
    return {
      id,
      name: String(node.name || ""),
      path: this.nodePath(node),
      generation: this.generation,
      groups,
      animations,
      scripts: components.map((component, index) => ({
        name: this.typeName(component),
        index,
      })),
      handlers: this.handlerInventory(node).map((handler, index) => ({
        name: handler.name,
        event: handler.event,
        index,
      })),
      breakpointEvents: this.eventChoices(),
    };
  }
  private location(node: EngineNode, value: unknown): Location {
    const path = safePath(value);
    const prefix = path[0];
    const root = prefix === "node" ? node : this.components.get(prefix);
    if (
      !root ||
      (prefix !== "node" &&
        (!this.nodeComponents(node).includes(root) || root.isValid === false))
    )
      fail(
        "INVALID_COMPONENT",
        "The component is not attached to the selected live node.",
      );
    const row = this.groupProperties(root, prefix, node).find(
      (p) => p.key === path[1],
    );
    if (!row)
      fail("INVALID_PATH", "The property is not exposed by the inspector.");
    let owner = root;
    for (let i = 1; i < path.length - 1; i++) {
      const key = path[i];
      if (i > 1 && !this.expandableKeys(owner).includes(key))
        fail(
          "INVALID_PATH",
          "The nested property is not exposed by the inspector.",
        );
      const d = descriptor(owner, key);
      if (!d || (d.get && i > 1))
        fail("READ_ONLY", "Nested getters cannot be traversed.");
      const next = readField(owner, key);
      if (!isObject(next))
        fail("INVALID_PATH", "The property path does not refer to an object.");
      owner = next;
    }
    if (path.length > 2 && !this.expandableKeys(owner).includes(path.at(-1)!))
      fail("INVALID_PATH", "The nested field is not exposed by the inspector.");
    return { root, owner, key: path.at(-1)!, path, rootKey: path[1] };
  }
  private expandableKeys(value: EngineObject): string[] {
    const kind = valueKind(value, this.cc);
    if (["vec2", "vec3", "vec4", "color", "size"].includes(kind))
      return kind === "color"
        ? ["r", "g", "b", "a"]
        : kind === "size"
          ? ["width", "height"]
          : kind === "vec2"
            ? ["x", "y"]
            : kind === "vec3"
              ? ["x", "y", "z"]
              : ["x", "y", "z", "w"];
    return Object.keys(value)
      .filter(
        (k) =>
          !k.startsWith("_") &&
          ![
            "node",
            "parent",
            "children",
            "__proto__",
            "constructor",
            "prototype",
          ].includes(k),
      )
      .slice(0, 128);
  }
  private expand(node: EngineNode, path: unknown): Property[] {
    const location = this.location(node, path);
    const value = readField(location.owner, location.key);
    if (!isObject(value))
      fail(
        "NOT_EXPANDABLE",
        "The selected property is not an object or array.",
      );
    if (imageLike(value))
      fail("NOT_EXPANDABLE", "Use imagePreview to inspect image data.");
    return this.expandableKeys(value)
      .map((key) =>
        property(
          value,
          key,
          [...location.path, key],
          this.cc,
          false,
          this.widgetReason(
            node,
            ["position", "contentSize"].includes(location.rootKey)
              ? key
              : location.rootKey,
          ),
        ),
      )
      .filter((p): p is Property => p !== null);
  }
  private set(node: EngineNode, args: Record<string, unknown>): Property {
    const loc = this.location(node, args.path);
    const rootRow = this.groupProperties(loc.root, loc.path[0], node).find(
      (p) => p.key === loc.rootKey,
    )!;
    const axisEdit =
      loc.path.length === 3 &&
      ["position", "contentSize"].includes(loc.rootKey) &&
      !!this.widgetReason(node, loc.rootKey) &&
      !this.widgetReason(node, loc.key);
    if (rootRow.readOnly && !axisEdit)
      fail("READ_ONLY", rootRow.reason || "The property is read-only.");
    const row = property(
      loc.owner,
      loc.key,
      loc.path,
      this.cc,
      true,
      this.widgetReason(node, axisEdit ? loc.key : loc.rootKey),
    );
    if (!row || row.readOnly)
      fail("READ_ONLY", row?.reason || "The property is read-only.");
    const options = row.options;
    if (options && !options.some((option) => option.value === args.value))
      fail("INVALID_ENUM", "Value is not one of the reflected enum options.");
    let value = typedValue(readField(loc.owner, loc.key), args.value, this.cc);
    let key = loc.key,
      owner = loc.owner;
    // Editing a vector/color member still passes the complete typed value through its public owning setter.
    if (
      loc.path.length === 3 &&
      ["vec2", "vec3", "vec4", "color", "size"].includes(
        valueKind(loc.root[loc.rootKey], this.cc),
      )
    ) {
      const old = loc.root[loc.rootKey];
      if (!isObject(old))
        fail("INVALID_PATH", "Vector or color target is not an object.");
      const copy = {
        ...Object.fromEntries(this.expandableKeys(old).map((k) => [k, old[k]])),
        [key]: value,
      };
      value = typedValue(old, copy, this.cc);
      owner = loc.root;
      key = loc.rootKey;
    }
    if (
      owner === node &&
      key === "position" &&
      typeof node.setPosition === "function" &&
      numericFields(value, ["x", "y", "z"])
    )
      node.setPosition(value);
    else if (
      owner === node &&
      key === "scale" &&
      typeof node.setScale === "function" &&
      numericFields(value, ["x", "y", "z"])
    )
      node.setScale(value);
    else if (
      owner === node &&
      key === "eulerAngles" &&
      typeof node.setRotationFromEuler === "function" &&
      numericFields(value, ["x", "y", "z"])
    )
      node.setRotationFromEuler(value);
    else if (
      owner === node &&
      key === "color" &&
      typeof node.setColor === "function" &&
      numericFields(value, ["r", "g", "b", "a"])
    )
      node.setColor(value);
    else if (
      key === "contentSize" &&
      typeof owner.setContentSize === "function"
    )
      owner.setContentSize(value);
    else if (
      key === "anchorPoint" &&
      typeof owner.setAnchorPoint === "function"
    )
      owner.setAnchorPoint(value);
    else owner[key] = value;
    const readback = this.location(node, loc.path);
    const actual = property(
      readback.owner,
      readback.key,
      readback.path,
      this.cc,
      true,
      this.widgetReason(node, axisEdit ? loc.key : loc.rootKey),
    );
    if (!actual)
      fail("READBACK_FAILED", "The property disappeared after its setter ran.");
    return actual;
  }
  private expose(value: unknown): { name: string } {
    if (this.exposed.size >= 32) {
      const first = this.exposed.keys().next().value;
      if (first) {
        const globals = globalThis as unknown as EngineObject;
        if (globals[first] === this.exposed.get(first)) delete globals[first];
        this.exposed.delete(first);
      }
    }
    const globals = globalThis as unknown as EngineObject;
    let name: string;
    do {
      name = `temp${++this.tempSequence}`;
    } while (Object.prototype.hasOwnProperty.call(globals, name));
    globals[name] = value;
    this.exposed.set(name, value);
    console.log(`${name} =`, value);
    return { name };
  }
  private handoff(target: unknown): { target: string } {
    if (
      (typeof target !== "function" && typeof target !== "object") ||
      target === null
    )
      fail(
        "DEBUG_TARGET_UNAVAILABLE",
        "The requested debugger target is unavailable.",
      );
    (globalThis as unknown as EngineObject).__PTS_CC_INSPECTOR_TARGET__ =
      target;
    this.debuggerTarget = target;
    console.log("__PTS_CC_INSPECTOR_TARGET__ =", target);
    return { target: "__PTS_CC_INSPECTOR_TARGET__" };
  }
  private clearBreakpoints(node?: EngineNode): number {
    let count = 0;
    const remaining: Breakpoint[] = [];
    let failed = false;
    for (const item of this.breakpoints) {
      if (node && item.node !== node) {
        remaining.push(item);
        continue;
      }
      try {
        item.node.off?.(item.event, item.listener);
        count++;
      } catch {
        remaining.push(item);
        failed = true;
      }
    }
    this.breakpoints = remaining;
    if (failed)
      fail(
        "BREAKPOINT_REMOVE_FAILED",
        "The engine rejected removal of one or more breakpoint listeners.",
      );
    return count;
  }
  private atlasManager(): EngineAtlas | null {
    return (
      this.cc.dynamicAtlasManager ||
      this.cc.internal?.dynamicAtlasManager ||
      this.cc.DynamicAtlasManager?.instance ||
      null
    );
  }
  private fpsVisible(engine = this.cc): boolean {
    return !!(
      engine.profiler?.isShowingStats?.() ??
      engine.debug?.isDisplayStats?.() ??
      engine.profiler?._showStats
    );
  }
  private setFps(engine: CocosNamespace, visible: boolean): void {
    if (engine.debug?.setDisplayStats) engine.debug.setDisplayStats(visible);
    else if (engine.profiler?.showStats && engine.profiler?.hideStats) {
      if (visible) engine.profiler.showStats();
      else engine.profiler.hideStats();
    } else
      fail(
        "FPS_UNAVAILABLE",
        "This engine does not expose an FPS overlay control.",
      );
  }
  private restoreFps(): void {
    const saved = this.fpsRestore;
    this.fpsRestore = null;
    if (saved && this.fpsVisible(saved.engine) === saved.applied)
      this.setFps(saved.engine, saved.visible);
  }
  private gameInfo(): GameInfo {
    const tree = this.tree();
    const manager = this.atlasManager();
    return {
      engineVersion: String(this.cc.ENGINE_VERSION || this.cc.VERSION || ""),
      drawCalls: this.drawCalls(),
      nodes: tree.count,
      cachedObjects: this.nodes.size + this.components.size,
      fpsVisible: this.fpsVisible(),
      dynamicAtlas: manager
        ? {
            enabled: !!manager.enabled,
            atlasCount: Number(
              manager.atlasCount ?? manager._atlases?.length ?? 0,
            ),
            maxAtlasCount: Number(manager.maxAtlasCount || 0),
            maxFrameSize: Number(manager.maxFrameSize || 0),
            textureSize: Number(manager.textureSize || 0),
            textureBleeding: !!manager.textureBleeding,
            canView: typeof manager.showDebug === "function",
          }
        : null,
    };
  }
  private editorTarget(value: EngineAsset): EditorTarget {
    const uuid = value._uuid || value.uuid || value.asset?._uuid;
    const fileId = value.fileId || value._prefab?.fileId;
    if (
      (typeof uuid !== "string" || !uuid) &&
      (typeof fileId !== "string" || !fileId)
    )
      fail(
        "EDITOR_TARGET_UNAVAILABLE",
        "No Creator asset UUID or prefab file ID is available.",
      );
    return {
      ...(typeof uuid === "string" ? { uuid } : {}),
      ...(typeof fileId === "string" ? { fileId } : {}),
    };
  }
  async dispatch(request: RuntimeRequest): Promise<unknown> {
    try {
      return await this.execute(request);
    } catch (error) {
      if (error instanceof InspectorError) throw error;
      fail(
        "ENGINE_OPERATION_FAILED",
        `The engine rejected the requested operation: ${error instanceof Error ? error.message : "unknown engine error"}`,
      );
    }
  }
  private async execute(request: RuntimeRequest): Promise<unknown> {
    const args = argsObject(request.args);
    if (request.command === "detach") {
      this.dispose();
      return { detached: true };
    }
    const supported = this.sync();
    if (request.command === "support") return this.support();
    if (!supported)
      fail(
        "ENGINE_UNAVAILABLE",
        "No supported Cocos 2.x or 3.x engine namespace is available.",
      );
    switch (request.command) {
      case "tree":
      case "gameInfo": {
        if (args.drawCallAttribution !== undefined) {
          if (typeof args.drawCallAttribution !== "boolean")
            fail(
              "INVALID_ARGUMENT",
              "Draw-call attribution must be a boolean.",
            );
          if (args.drawCallAttribution) {
            if (!this.drawAttribution)
              fail(
                "DRAW_ATTRIBUTION_UNAVAILABLE",
                "The renderer is unavailable.",
              );
            this.drawAttribution.enable();
          } else this.drawAttribution?.dispose();
        }
        return request.command === "tree" ? this.tree() : this.gameInfo();
      }
      case "cancelPick":
        this.overlay.cancelPick();
        return { picking: false };
      case "pick": {
        const tree = this.tree();
        const nodes = tree.nodes
          .map((row) => this.nodes.get(row.id)!)
          .filter(Boolean);
        if (!nodes.some((node) => this.overlay.bounds(node)))
          fail(
            "PICK_UNAVAILABLE",
            "No supported 2D UI bounds are available. General 3D ray picking is not supported.",
          );
        this.overlay.pick(nodes);
        return { picking: true };
      }
      case "fps": {
        const visible = args.visible ?? args.enabled;
        if (typeof visible !== "boolean")
          fail("INVALID_ARGUMENT", "FPS visibility must be a boolean.");
        const current = this.fpsVisible();
        if (this.fpsRestore && this.fpsRestore.engine !== this.cc)
          this.restoreFps();
        if (!this.fpsRestore && current !== visible)
          this.fpsRestore = {
            engine: this.cc,
            visible: current,
            applied: visible,
          };
        this.setFps(this.cc, visible);
        if (this.fpsRestore) this.fpsRestore.applied = this.fpsVisible();
        return { visible: this.fpsVisible() };
      }
      case "atlas": {
        const manager = this.atlasManager();
        if (!manager)
          fail(
            "ATLAS_UNAVAILABLE",
            "This engine does not expose a dynamic atlas manager.",
          );
        if (args.enabled !== undefined) {
          if (typeof args.enabled !== "boolean")
            fail("INVALID_ARGUMENT", "Atlas enabled must be a boolean.");
          const d = descriptor(manager, "enabled");
          if (!d || (!d.set && d.writable !== true))
            fail("ATLAS_UNAVAILABLE", "Atlas enable state is read-only.");
          manager.enabled = args.enabled;
        }
        const visible = args.visible ?? args.show;
        if (visible !== undefined) {
          if (typeof visible !== "boolean")
            fail("INVALID_ARGUMENT", "Atlas visibility must be a boolean.");
          if (typeof manager.showDebug !== "function")
            fail(
              "ATLAS_VIEW_UNAVAILABLE",
              "This engine does not expose dynamic atlas debug visualization.",
            );
          manager.showDebug(visible);
          this.atlasVisible = visible;
        }
        return { enabled: !!manager.enabled, visible: this.atlasVisible };
      }
      case "clearBreakpoints": {
        const node =
          args.id === undefined ? undefined : this.requireNode(args, request);
        return { removed: this.clearBreakpoints(node) };
      }
      case "hover":
      case "select": {
        const node = args.id === null ? null : this.requireNode(args, request);
        if (node && !this.overlay.bounds(node))
          fail(
            "HIGHLIGHT_UNAVAILABLE",
            "The node has no supported 2D screen bounds.",
          );
        this.overlay.highlight(node, request.command === "hover");
        return { id: node ? this.identify(node, "n") : null };
      }
    }
    const node = this.requireNode(args, request);
    switch (request.command) {
      case "inspect":
        return this.details(node);
      case "expand":
        return this.expand(node, args.path);
      case "set":
        validateValue(args.value);
        return this.set(node, args);
      case "toggle": {
        node.active = !node.active;
        return { id: args.id, active: !!node.active };
      }
      case "destroy": {
        if (node === this.scene)
          fail(
            "DESTROY_SCENE",
            "Destroy the scene through the game, not the inspector.",
          );
        if (typeof node.destroy !== "function")
          fail("DESTROY_UNAVAILABLE", "The engine node has no destroy method.");
        const destroyed = node.destroy();
        if (destroyed === false)
          fail("DESTROY_FAILED", "The engine refused to destroy the node.");
        this.clearBreakpoints(node);
        this.nodes.delete(String(args.id));
        return { destroyed: true };
      }
      case "log":
      case "logPath": {
        if (request.command === "logPath") {
          const path = this.nodePath(node);
          console.log(path);
          return { path };
        }
        if (args.path) {
          const loc = this.location(node, args.path);
          return this.expose(readField(loc.owner, loc.key));
        }
        return this.expose(node);
      }
      case "inspectScript": {
        const components = this.nodeComponents(node);
        if (
          !Number.isInteger(args.index) ||
          Number(args.index) < 0 ||
          Number(args.index) >= components.length
        )
          fail("INVALID_SCRIPT", "The selected component index is invalid.");
        return this.handoff(components[Number(args.index)].constructor);
      }
      case "inspectHandler": {
        const handlers = this.handlerInventory(node);
        if (
          !Number.isInteger(args.index) ||
          Number(args.index) < 0 ||
          Number(args.index) >= handlers.length
        )
          fail(
            "INVALID_HANDLER",
            "The selected event-handler index is invalid.",
          );
        return this.handoff(handlers[Number(args.index)].target);
      }
      case "breakOn": {
        const event = requiredString(args.event, "Event");
        if (!this.eventChoices().includes(event))
          fail(
            "INVALID_EVENT",
            "Choose one of the supported node breakpoint events.",
          );
        if (typeof node.on !== "function" || typeof node.off !== "function")
          fail(
            "BREAKPOINT_UNAVAILABLE",
            "This node does not expose removable event listeners.",
          );
        if (
          this.breakpoints.some(
            (item) => item.node === node && item.event === event,
          )
        )
          return { event, enabled: true };
        const listener = (): void => {
          debugger;
        };
        node.on(event, listener);
        this.breakpoints.push({ node, event, listener });
        return { event, enabled: true };
      }
      case "animationPlay":
      case "animationStop": {
        const id = requiredString(
          args.componentId ?? args.animationId,
          "Animation component ID",
        );
        const component = this.components.get(id);
        if (
          !component ||
          !this.nodeComponents(node).includes(component) ||
          typeof component.play !== "function" ||
          typeof component.stop !== "function"
        )
          fail(
            "ANIMATION_UNAVAILABLE",
            "The selected component does not expose supported animation playback.",
          );
        if (request.command === "animationStop") {
          component.stop();
          return { stopped: true };
        }
        const clip = requiredString(args.clip, "Animation clip");
        const clips = component.clips || component.getClips?.();
        if (!Array.isArray(clips) || !clips.some((c) => c?.name === clip))
          fail(
            "INVALID_CLIP",
            "The animation clip is not attached to this component.",
          );
        const state = component.play(clip);
        if (!state)
          fail(
            "ANIMATION_FAILED",
            "The engine could not play the selected animation clip.",
          );
        return { clip, playing: state.isPlaying !== false };
      }
      case "imagePreview":
      case "replaceImage":
      case "openAsset": {
        const loc = this.location(node, args.path);
        const value = readField(loc.owner, loc.key);
        if (!isObject(value))
          fail(
            "ASSET_UNAVAILABLE",
            "The selected property does not reference a live asset.",
          );
        if (request.command === "openAsset") return this.editorTarget(value);
        if (request.command === "imagePreview") {
          const cached = this.imagePreviews.get(value);
          if (cached) return cached;
          if (this.modifiedImages.has(value))
            fail(
              "PREVIEW_UNAVAILABLE",
              "The modified GPU image preview has been evicted from the bounded preview cache.",
            );
          return imagePreview(value);
        }
        const result = await replaceImage(value, args.dataUrl, this.cc, () => {
          this.sync();
          if (request.generation !== this.generation || !this.validNode(node))
            fail(
              "STALE_GENERATION",
              "The scene changed before image replacement.",
            );
          const current = this.location(node, args.path);
          if (readField(current.owner, current.key) !== value)
            fail(
              "STALE_ASSET",
              "The selected image asset changed before replacement.",
            );
        });
        if (this.imagePreviews.size >= 16) {
          const first = this.imagePreviews.keys().next().value;
          if (first) this.imagePreviews.delete(first);
        }
        this.modifiedImages.add(value);
        this.imagePreviews.set(value, {
          url: result.previewUrl,
          width: result.width,
          height: result.height,
        });
        return {
          width: result.width,
          height: result.height,
          sharedTexture: result.sharedTexture,
        };
      }
      case "openPrefab": {
        const prefab = node._prefab || node.prefab;
        if (!prefab)
          fail(
            "PREFAB_UNAVAILABLE",
            "The node has no runtime prefab asset metadata.",
          );
        return this.editorTarget(prefab.asset || prefab);
      }
      default:
        fail("UNSUPPORTED_COMMAND", `Unsupported command: ${request.command}.`);
    }
  }
  private releaseExposed(): void {
    const globals = globalThis as unknown as EngineObject;
    for (const [name, value] of this.exposed)
      if (globals[name] === value) delete globals[name];
    this.exposed.clear();
    if (
      this.debuggerTarget !== undefined &&
      globals.__PTS_CC_INSPECTOR_TARGET__ === this.debuggerTarget
    )
      delete globals.__PTS_CC_INSPECTOR_TARGET__;
    this.debuggerTarget = undefined;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const failures: unknown[] = [];
    const cleanup = [
      () => this.clearBreakpoints(),
      () => this.overlay.dispose(),
      () => this.restoreFps(),
      () => this.drawAttribution?.dispose(),
      () => this.releaseExposed(),
      () => {
        if (this.sceneDirector && this.sceneEvent)
          this.sceneDirector.off?.(this.sceneEvent, this.sceneLaunched);
      },
    ];
    for (const release of cleanup)
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    this.nodes.clear();
    this.components.clear();
    this.scene = null;
    this.drawAttribution = null;
    this.imagePreviews.clear();
    this.modifiedImages = new WeakSet();
    this.sceneDirector = null;
    this.sceneEvent = null;
    this.emit({ type: "detached" });
    if (failures.length)
      fail(
        "DETACH_FAILED",
        "The engine rejected one or more hook or listener cleanup operations.",
      );
  }
}
