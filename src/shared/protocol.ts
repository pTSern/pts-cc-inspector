export const CHANNEL = "pts-cc-inspector" as const;
export const PROTOCOL_VERSION = 1;
export const COMMANDS = [
  "support",
  "tree",
  "inspect",
  "expand",
  "set",
  "toggle",
  "destroy",
  "hover",
  "select",
  "pick",
  "cancelPick",
  "log",
  "logPath",
  "inspectScript",
  "inspectHandler",
  "breakOn",
  "clearBreakpoints",
  "fps",
  "gameInfo",
  "atlas",
  "animationPlay",
  "animationStop",
  "imagePreview",
  "replaceImage",
  "openAsset",
  "openPrefab",
  "detach",
  "gamePause",
  "gameResume",
  "gameStep",
] as const;
export type Command = (typeof COMMANDS)[number];
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface RuntimeRequest {
  id: string;
  command: Command;
  args?: unknown;
  generation?: number;
}
export interface RuntimeResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}
export interface RuntimeEvent {
  type: "picked" | "sceneChanged" | "status" | "detached";
  data?: unknown;
}
export interface EngineSupport {
  supported: boolean;
  engineVersion: string;
  major: number;
  sceneName: string;
  capabilities: string[];
  reason?: string;
}
export interface TreeNode {
  id: string;
  parentId: string | null;
  depth: number;
  name: string;
  active: boolean;
  activeInHierarchy: boolean;
  childCount: number;
  componentTypes: string[];
  drawCall?: number;
  prefab?: boolean;
}
export interface TreeSnapshot {
  generation: number;
  nodes: TreeNode[];
  count: number;
  drawCalls: number | null;
  truncated?: boolean;
}
export type PropertyKind =
  | "number"
  | "string"
  | "boolean"
  | "color"
  | "vec2"
  | "vec3"
  | "vec4"
  | "size"
  | "enum"
  | "object"
  | "array"
  | "image"
  | "null";
export interface Property {
  key: string;
  label: string;
  path: string[];
  type: PropertyKind;
  value: Json;
  readOnly: boolean;
  reason?: string;
  step?: number;
  min?: number;
  max?: number;
  options?: { label: string; value: Json }[];
  expandable?: boolean;
  children?: Property[];
  assetUuid?: string;
  imageUrl?: string;
}
export interface PropertyGroup {
  id: string;
  name: string;
  kind: "node" | "component";
  properties: Property[];
}
export interface NodeDetails {
  id: string;
  name: string;
  path: string;
  generation: number;
  groups: PropertyGroup[];
  animations: { id: string; clips: string[] }[];
  scripts: { name: string; index: number }[];
  handlers: { name: string; index: number; event: string }[];
  breakpointEvents: string[];
}
export interface GameInfo {
  engineVersion: string;
  drawCalls: number | null;
  nodes: number;
  cachedObjects: number;
  dynamicAtlas: null | {
    enabled: boolean;
    atlasCount: number;
    maxAtlasCount: number;
    maxFrameSize: number;
    textureSize: number;
    textureBleeding: boolean;
    canView: boolean;
  };
  fpsVisible: boolean;
  paused?: boolean;
}
export interface EditorTarget {
  uuid?: string;
  fileId?: string;
}
export type Locale = "en" | "vi";
export interface Settings {
  locale: Locale;
  refreshMs: number;
  autoTree: boolean;
  autoProperties: boolean;
  hoverHighlight: boolean;
  selectionHighlight: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  refreshMs: 1000,
  autoTree: false,
  autoProperties: true,
  hoverHighlight: true,
  selectionHighlight: true,
};
export interface FrameInfo {
  frameId: number;
  documentId?: string;
  url: string;
  title: string;
}
export interface InspectorClient {
  call<T = unknown>(
    command: Command,
    args?: unknown,
    generation?: number,
  ): Promise<T>;
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  listFrames(): Promise<FrameInfo[]>;
  selectFrame(frameId: number): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Partial<Settings>): Promise<Settings>;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function isCommand(value: unknown): value is Command {
  return (
    typeof value === "string" && (COMMANDS as readonly string[]).includes(value)
  );
}
export function isRequest(value: unknown): value is RuntimeRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<RuntimeRequest>;
  return (
    typeof r.id === "string" &&
    r.id.length <= 100 &&
    isCommand(r.command) &&
    (r.generation === undefined || Number.isSafeInteger(r.generation))
  );
}
export function normalizeSettings(value: unknown): Settings {
  const v = (
    value && typeof value === "object" ? value : {}
  ) as Partial<Settings>;
  return {
    locale: v.locale === "vi" ? "vi" : "en",
    refreshMs:
      typeof v.refreshMs === "number" && Number.isFinite(v.refreshMs)
        ? Math.min(10000, Math.max(250, Math.round(v.refreshMs)))
        : DEFAULT_SETTINGS.refreshMs,
    autoTree:
      typeof v.autoTree === "boolean" ? v.autoTree : DEFAULT_SETTINGS.autoTree,
    autoProperties:
      typeof v.autoProperties === "boolean"
        ? v.autoProperties
        : DEFAULT_SETTINGS.autoProperties,
    hoverHighlight:
      typeof v.hoverHighlight === "boolean"
        ? v.hoverHighlight
        : DEFAULT_SETTINGS.hoverHighlight,
    selectionHighlight:
      typeof v.selectionHighlight === "boolean"
        ? v.selectionHighlight
        : DEFAULT_SETTINGS.selectionHighlight,
  };
}
