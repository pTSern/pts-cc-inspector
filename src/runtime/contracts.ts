/** Reflected fields remain unknown until a consumer checks their shape. */
export type EngineObject = Record<string, unknown>;
export function isObject(value: unknown): value is EngineObject {
  return value !== null && typeof value === "object";
}
export interface EngineVec2 {
  x: number;
  y: number;
}
export interface EngineVec3 extends EngineVec2 {
  z: number;
}
export interface EngineVec4 extends EngineVec3 {
  w: number;
}
export interface EngineSize {
  width: number;
  height: number;
}
export interface EngineColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface EngineRect extends EngineVec2, EngineSize {}
export type EngineMethod = (this: EngineObject, ...args: unknown[]) => unknown;
export interface EngineValue {
  clone?: () => EngineValue;
}
export interface ValueConstructor {
  new (...values: number[]): EngineValue;
}
export interface EngineAsset extends EngineObject {
  _uuid?: string;
  uuid?: string;
  isValid?: boolean;
  asset?: EngineAsset;
  fileId?: string;
  _prefab?: EngineAsset;
}
export interface EngineNode extends EngineAsset {
  name?: string;
  active?: boolean;
  activeInHierarchy?: boolean;
  _destroyed?: boolean;
  parent?: EngineNode | null;
  children?: EngineNode[];
  components?: EngineComponent[];
  _components?: EngineComponent[];
  prefab?: EngineAsset;
  width?: number;
  height?: number;
  anchorX?: number;
  _uiProps?: { uiTransformComp?: EngineComponent };
  is3DNode?: boolean;
  getComponents?: (type: unknown) => EngineComponent[];
  getComponent?: (type: unknown) => EngineComponent | null;
  destroy?: () => boolean | void;
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  setPosition?: (value: EngineVec3) => void;
  setScale?: (value: EngineVec3) => void;
  setRotationFromEuler?: (value: EngineVec3) => void;
  setColor?: (value: EngineColor) => void;
  getBoundingBoxToWorld?: () => EngineRect;
  convertToWorldSpaceAR?: (value: EngineVec3) => EngineVec3;
  _bubblingListeners?: CallbackTarget;
  _capturingListeners?: CallbackTarget;
  _eventProcessor?: {
    _bubblingTarget?: CallbackTarget;
    _capturingTarget?: CallbackTarget;
  };
}
export interface CallbackEntry {
  callback?: (...args: unknown[]) => unknown;
}
export interface CallbackBucket {
  callbackInfos?: (CallbackEntry | ((...args: unknown[]) => unknown))[];
  callbacks?: (CallbackEntry | ((...args: unknown[]) => unknown))[];
}
export interface CallbackTarget {
  _callbackTable?: Record<
    string,
    | CallbackBucket
    | (CallbackEntry | ((...args: unknown[]) => unknown))[]
    | undefined
  >;
}
export interface EngineComponent extends EngineAsset {
  node?: EngineNode;
  enabled?: boolean;
  contentSize?: EngineSize;
  anchorPoint?: EngineVec2;
  convertToWorldSpaceAR?: (value: EngineVec3) => EngineVec3;
  setContentSize?: (value: EngineSize) => void;
  setAnchorPoint?: (value: EngineVec2) => void;
  play?: (clip: string) => { isPlaying?: boolean } | null;
  stop?: () => void;
  clips?: unknown;
  getClips?: () => unknown;
  _assembler?: EngineAssembler;
  model?: EngineModel;
  _model?: EngineModel;
  _simulator?: {
    renderData?: {
      _iaInfo?: { indexBuffer?: EngineBuffer };
      indexCount: number;
    };
  };
  useTint?: boolean;
  isAnimationCached?: () => boolean;
  renderData?: { chunk?: { meshBuffer?: EngineMeshBuffer } };
  updateAlignment?: () => void;
}
export interface EngineCamera {
  targetTexture?: unknown;
  node?: EngineNode;
  getWorldToScreenPoint?: (point: EngineVec2) => EngineVec2;
  worldToScreen?: (point: EngineVec2) => EngineVec2;
}
export interface RenderCamera {
  window?: unknown;
  worldToScreen?: (output: EngineVec3, point: EngineVec2) => void;
}
export interface EngineAtlas extends EngineObject {
  enabled?: boolean;
  _atlases?: unknown[];
  showDebug?: (visible: boolean) => void;
}
export interface BufferTextureRegion {
  buffOffset: number;
  buffStride: number;
  buffTexHeight: number;
  texOffset: { x: number; y: number; z: number };
  texExtent: { width: number; height: number; depth: number };
  texSubres: { mipLevel: number; baseArrayLayer: number; layerCount: number };
}
export interface GfxTexture {
  format?: unknown;
  levelCount?: number;
}
export interface EngineImageData {
  data?: unknown;
  _data?: unknown;
  nativeUrl?: string;
}
export interface EngineTexture extends EngineAsset {
  width?: number;
  height?: number;
  _width?: number;
  _height?: number;
  texture?: EngineTexture;
  _texture?: EngineTexture;
  image?: EngineImageData;
  _image?: unknown;
  rect?: EngineRect;
  _rect?: EngineRect;
  getTexture?: () => EngineTexture | null;
  getRect?: () => EngineRect;
  isRotated?: () => boolean;
  rotated?: boolean;
  _rotated?: boolean;
  getHtmlElementObj?: () => unknown;
  getGFXTexture?: () => GfxTexture | null;
  getPixelFormat?: () => unknown;
  getImpl?: () => {
    updateSubImage?: (options: {
      image: HTMLCanvasElement;
      x: number;
      y: number;
      width: number;
      height: number;
      level: number;
      flipY: boolean;
      premultiplyAlpha: boolean;
    }) => void;
  };
  update?: (options: { image: HTMLCanvasElement }) => void;
  nativeUrl?: string;
  _format?: unknown;
  _genMipmaps?: boolean;
  _flipY?: boolean;
  _premultiplyAlpha?: boolean;
}
export interface EngineBuffer extends EngineObject {
  objectID?: unknown;
}
export interface EngineDrawInfo {
  firstIndex?: number;
  indexCount?: number;
}
export interface EngineInputAssembler extends EngineObject {
  drawInfo?: EngineDrawInfo;
  _drawInfo?: EngineDrawInfo;
  indexBuffer?: EngineBuffer;
  _indexBuffer?: EngineBuffer;
  _start?: number;
  _count?: number;
}
export interface EngineModel {
  subModels?: EngineSubModel[];
  _subModels?: EngineSubModel[];
}
export interface EngineSubModel {
  inputAssembler?: EngineInputAssembler;
  _inputAssembler?: EngineInputAssembler;
}
export interface EngineMeshBuffer {
  indexOffset: number;
  _iaInfo?: { indexBuffer?: EngineBuffer };
}
export interface EngineAssembler extends EngineObject {
  getBuffer?: (
    renderer: EngineAssemblerRenderer | undefined,
  ) => EngineAssemblerBuffer | undefined;
  getBuffers?: () => { ia?: EngineInputAssembler }[];
  _ia?: EngineInputAssembler;
}
export interface EngineAssemblerBuffer {
  indiceOffset: number;
  _ib?: unknown;
}
export interface EngineAssemblerRenderer extends EngineObject {
  getBuffer?: (
    name: string,
    format: unknown,
  ) => EngineAssemblerBuffer | undefined;
}
export interface EngineDevice extends EngineObject {
  numDrawCalls?: number;
  _stats?: { drawcalls?: number };
  _next?: { indexBuffer?: unknown };
  commandBuffer?: EngineObject;
  _cmdBuff?: EngineObject;
  copyTexImagesToTexture?: (
    images: HTMLCanvasElement[],
    texture: GfxTexture,
    regions: BufferTextureRegion[],
  ) => void;
}
export interface EngineDirector {
  getScene: () => EngineNode | null;
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  pause?: () => void;
  resume?: () => void;
  isPaused?: () => boolean;
  mainLoop?: () => void;
  tick?: (dt: number) => void;
  root?: {
    device?: EngineDevice;
    mainWindow?: unknown;
    batcher2D?: {
      getFirstRenderCamera?: (node: EngineNode) => RenderCamera | null;
    };
  };
}
export interface EngineAssetInfo extends EngineObject {
  uuid?: string;
  path?: string;
  ctor?: unknown;
  ext?: string;
  native?: string;
  depends?: string[];
}
export interface EngineBundleConfig extends EngineObject {
  name?: string;
  base?: string;
  importBase?: string;
  nativeBase?: string;
  deps?: string[];
  assetInfos?: { _map?: Record<string, EngineAssetInfo>; _count?: number };
  scenes?: { _map?: Record<string, unknown>; _count?: number };
  paths?: { _map?: Record<string, unknown>; _count?: number };
}
export interface EngineBundle extends EngineObject {
  name?: string;
  base?: string;
  _config?: EngineBundleConfig;
}
export interface EngineAssetManager extends EngineObject {
  bundles?: {
    _map?: Record<string, EngineBundle>;
    _count?: number;
    get?: (name: string) => EngineBundle | undefined;
    forEach?: (fn: (bundle: EngineBundle, name: string) => void) => void;
  };
  getBundle?: (name: string) => EngineBundle | undefined;
  assets?: {
    _map?: Record<string, EngineAsset>;
    _count?: number;
    get?: (uuid: string) => EngineAsset | undefined;
    forEach?: (fn: (asset: EngineAsset, uuid: string) => void) => void;
  };
}
export interface CocosNamespace extends EngineObject {
  ENGINE_VERSION?: unknown;
  VERSION?: unknown;
  director?: EngineDirector;
  assetManager?: EngineAssetManager;
  Director?: {
    EVENT_AFTER_SCENE_LAUNCH?: string;
    EVENT_BEFORE_DRAW?: string;
    EVENT_AFTER_DRAW?: string;
  };
  Node?: { EventType?: Record<string, unknown> };
  Component?: unknown;
  UITransform?: unknown;
  Widget?: unknown;
  Vec2?: ValueConstructor;
  Vec3?: { new (...values: number[]): EngineValue & EngineVec3 };
  Vec4?: ValueConstructor;
  Quat?: ValueConstructor;
  Color?: ValueConstructor;
  Size?: ValueConstructor;
  js?: {
    getClassName?: (value: unknown) => unknown;
    getClassByName?: (name: string) => unknown;
    _getClassById?: (id: string) => unknown;
  };
  Class?: { Attr?: { getClassAttrs?: (ctor: unknown) => unknown } };
  isValid?: (value: object, strict?: boolean) => boolean;
  renderer?: { device?: EngineDevice; drawCalls?: number; _drawCalls?: number };
  game?: {
    canvas?: HTMLCanvasElement;
    device?: EngineDevice;
    _renderContext?: { drawCalls?: number };
    pause?: () => void;
    resume?: () => void;
    isPaused?: () => boolean;
    step?: () => void;
  };
  profiler?: {
    isShowingStats?: () => boolean;
    showStats?: () => void;
    hideStats?: () => void;
    _showStats?: boolean;
  };
  debug?: {
    isDisplayStats?: () => boolean;
    setDisplayStats?: (visible: boolean) => void;
  };
  dynamicAtlasManager?: EngineAtlas;
  DynamicAtlasManager?: { instance?: EngineAtlas };
  internal?: {
    dynamicAtlasManager?: EngineAtlas;
    UIRenderer?: { prototype?: EngineObject };
  };
  Camera?: { findCamera?: (node: EngineNode) => EngineCamera | null };
  visibleRect?: EngineSize;
  view?: {
    getVisibleSize?: () => EngineSize;
    getVisibleOrigin?: () => EngineVec2;
  };
  gfx?: {
    Format?: Record<string, unknown>;
    VertexFormat?: Record<string, unknown>;
    BufferTextureCopy?: new () => BufferTextureRegion;
  };
  Texture2D?: { PixelFormat?: Record<string, unknown> };
  Assembler?: EngineObject;
  RenderFlow?: { prototype?: EngineObject };
}
/** A recognized namespace is an engine-owned API, not a message payload. Optional APIs are checked at use sites. */
export function cocosNamespace(value: unknown): CocosNamespace | null {
  if (
    !isObject(value) ||
    !/^[23](?:\.|$)/.test(String(value.ENGINE_VERSION || value.VERSION || ""))
  )
    return null;
  return value as CocosNamespace;
}
export function numericFields<K extends string>(
  value: unknown,
  keys: readonly K[],
): value is EngineObject & Record<K, number> {
  return (
    isObject(value) &&
    keys.every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
    )
  );
}
