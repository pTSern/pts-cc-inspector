import {
  isObject,
  type CocosNamespace,
  type EngineAssembler,
  type EngineAssemblerRenderer,
  type EngineBuffer,
  type EngineComponent,
  type EngineDevice,
  type EngineInputAssembler,
  type EngineMethod,
  type EngineNode,
  type EngineObject,
} from "./contracts";
import { fail } from "./properties";

interface Range {
  node: EngineNode;
  first: number;
  count: number;
}
interface Patch {
  owner: EngineObject;
  key: string;
  original: PropertyDescriptor | undefined;
  wrapper: EngineMethod;
}
const MAX_RANGES = 40000;

/** Opt-in rendering instrumentation. Object identity/ranges stay in inspector-owned maps. */
export class DrawCallAttribution {
  private patches: Patch[] = [];
  private hooked = new WeakSet<object>();
  private ranges = new Map<unknown, Range[]>();
  private values = new WeakMap<object, number>();
  private boundAssemblers = new WeakMap<object, EngineObject>();
  private rangeCount = 0;
  private drawIndex = 0;
  private active = false;
  private beforeEvent: string | null = null;
  private afterEvent: string | null = null;
  constructor(private readonly cc: CocosNamespace) {}
  get supported(): boolean {
    const cc = this.cc;
    const frameEvents =
      typeof cc.director?.on === "function" &&
      typeof cc.director?.off === "function" &&
      typeof cc.Director?.EVENT_BEFORE_DRAW === "string" &&
      typeof cc.Director?.EVENT_AFTER_DRAW === "string";
    if (!frameEvents) return false;
    if (String(cc.ENGINE_VERSION || cc.VERSION).startsWith("2"))
      return (
        typeof cc.Assembler?.init === "function" &&
        typeof cc.renderer?.device?.draw === "function"
      );
    const command =
      cc.director?.root?.device?.commandBuffer ||
      cc.director?.root?.device?._cmdBuff;
    return (
      typeof command?.draw === "function" &&
      typeof cc.internal?.UIRenderer?.prototype?.fillBuffers === "function"
    );
  }
  get enabled(): boolean {
    return this.active;
  }
  value(node: EngineNode): number | undefined {
    return this.active ? this.values.get(node) : undefined;
  }
  private patch(
    owner: EngineObject,
    key: string,
    around: (
      original: EngineMethod,
      self: EngineObject,
      args: unknown[],
    ) => unknown,
  ): void {
    const candidate = owner[key];
    if (typeof candidate !== "function") return;
    const original = candidate as EngineMethod;
    const originalDescriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (
      originalDescriptor &&
      !originalDescriptor.configurable &&
      !originalDescriptor.writable
    )
      fail(
        "DRAW_ATTRIBUTION_UNAVAILABLE",
        "The renderer methods are not writable.",
      );
    const attribution = this;
    const wrapper = function (this: EngineObject, ...args: unknown[]): unknown {
      if (!attribution.active) return original.apply(this, args);
      return around(original, this, args);
    };
    Object.defineProperty(owner, key, {
      configurable: originalDescriptor?.configurable ?? true,
      enumerable: originalDescriptor?.enumerable ?? false,
      writable: originalDescriptor?.writable ?? true,
      value: wrapper,
    });
    this.patches.push({ owner, key, original: originalDescriptor, wrapper });
  }
  private beginFrame = (): void => {
    this.ranges.clear();
    this.rangeCount = 0;
    this.drawIndex = 0;
    this.values = new WeakMap();
  };
  private endFrame = (): void => {
    this.ranges.clear();
    this.rangeCount = 0;
  };
  private bufferId(buffer: EngineBuffer | undefined): unknown {
    return buffer?.objectID ?? buffer;
  }
  private add(
    node: EngineNode | undefined,
    buffer: unknown,
    first: unknown,
    count: unknown,
  ): void {
    if (
      !node ||
      buffer === undefined ||
      buffer === null ||
      typeof first !== "number" ||
      typeof count !== "number" ||
      !Number.isFinite(first) ||
      !Number.isFinite(count) ||
      first < 0 ||
      count <= 0 ||
      this.rangeCount >= MAX_RANGES
    )
      return;
    let list = this.ranges.get(buffer);
    if (!list) {
      list = [];
      this.ranges.set(buffer, list);
    }
    list.push({ node, first, count });
    this.rangeCount++;
  }
  private draw(
    buffer: unknown,
    first: unknown,
    count: unknown,
    index: number,
  ): void {
    if (typeof first !== "number" || typeof count !== "number" || count <= 0)
      return;
    const list = this.ranges.get(buffer);
    if (!list) return;
    for (const range of list)
      if (first <= range.first && range.first + range.count <= first + count)
        this.values.set(range.node, index);
  }
  private addIA(
    node: EngineNode | undefined,
    ia: EngineInputAssembler | undefined,
  ): void {
    if (!ia) return;
    const info = ia.drawInfo || ia._drawInfo;
    this.add(
      node,
      this.bufferId(ia.indexBuffer || ia._indexBuffer),
      info?.firstIndex ?? ia._start,
      info?.indexCount ?? ia._count,
    );
  }
  private captureModels(component: EngineComponent): void {
    const model = component.model || component._model;
    const submodels = model?.subModels || model?._subModels;
    if (Array.isArray(submodels))
      for (const sub of submodels.slice(0, 256))
        this.addIA(component.node, sub.inputAssembler || sub._inputAssembler);
    const particle = component._simulator?.renderData;
    if (particle?._iaInfo)
      this.add(
        component.node,
        this.bufferId(particle._iaInfo.indexBuffer),
        0,
        Math.max(0, particle.indexCount - 6),
      );
  }
  private watchAssembler(assembler: EngineAssembler | undefined): void {
    if (!assembler) return;
    const proto = Object.getPrototypeOf(assembler) as EngineAssembler | null;
    if (
      !proto ||
      this.hooked.has(proto) ||
      typeof proto.fillBuffers !== "function"
    )
      return;
    this.hooked.add(proto);
    this.patch(proto, "fillBuffers", (original, self, args) => {
      const assemblerSelf = self as EngineAssembler;
      const component = isObject(args[0])
        ? (args[0] as EngineComponent)
        : undefined;
      const renderer = isObject(args[1])
        ? (args[1] as EngineAssemblerRenderer)
        : undefined;
      let buffer =
        typeof assemblerSelf.getBuffer === "function"
          ? assemblerSelf.getBuffer(renderer)
          : undefined;
      if (
        !buffer &&
        component &&
        renderer?.getBuffer &&
        String(this.cc.js?.getClassName?.(component) || "").includes("Skeleton")
      ) {
        const format = this.cc.gfx?.VertexFormat;
        const tinted = component.useTint || component.isAnimationCached?.();
        if (format)
          buffer = renderer.getBuffer(
            "spine",
            tinted ? format.XY_UV_Two_Color : format.XY_UV_Color,
          );
      }
      const start = buffer?.indiceOffset;
      const result = original.apply(self, args);
      if (buffer && typeof start === "number")
        this.add(
          component?.node,
          buffer._ib,
          start,
          buffer.indiceOffset - start,
        );
      if (assemblerSelf._ia) this.addIA(component?.node, assemblerSelf._ia);
      if (typeof assemblerSelf.getBuffers === "function") {
        const buffers = assemblerSelf.getBuffers();
        if (Array.isArray(buffers))
          for (const entry of buffers.slice(0, 256))
            this.addIA(component?.node, entry.ia);
      }
      return result;
    });
  }
  private discoverAssemblers(): void {
    const scene = this.cc.director?.getScene();
    if (!scene) return;
    const stack = [scene];
    const seen = new Set<object>();
    while (stack.length && seen.size < 20000) {
      const node = stack.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      const components = node._components || node.components;
      if (Array.isArray(components))
        for (const component of components.slice(0, 256))
          this.watchAssembler(component?._assembler);
      if (Array.isArray(node.children))
        for (
          let i = Math.min(node.children.length, 20000 - stack.length) - 1;
          i >= 0;
          i--
        )
          stack.push(node.children[i]);
    }
  }
  enable(): void {
    if (this.active) return;
    if (!this.supported)
      fail(
        "DRAW_ATTRIBUTION_UNAVAILABLE",
        "This renderer does not expose reversible UI fill-buffer and draw-command hooks with frame boundaries.",
      );
    this.active = true;
    try {
      if (String(this.cc.ENGINE_VERSION || this.cc.VERSION).startsWith("2")) {
        const device = this.cc.renderer?.device;
        const assembler = this.cc.Assembler;
        if (!device || !assembler)
          fail(
            "DRAW_ATTRIBUTION_UNAVAILABLE",
            "Renderer device or Assembler unavailable.",
          );
        this.patch(device, "draw", (original, self, args) => {
          const dev = self as EngineDevice;
          const index = Number(dev._stats?.drawcalls ?? this.drawIndex) + 1;
          this.drawIndex = index;
          this.draw(dev._next?.indexBuffer, args[0], args[1], index);
          return original.apply(self, args);
        });
        this.patch(assembler, "init", (original, self, args) => {
          const result = original.apply(self, args);
          const comp = isObject(args[0])
            ? (args[0] as EngineComponent)
            : undefined;
          this.watchAssembler(comp?._assembler);
          return result;
        });
        this.discoverAssemblers();
      } else {
        const command =
          this.cc.director?.root?.device?.commandBuffer ||
          this.cc.director?.root?.device?._cmdBuff;
        const uiProto = this.cc.internal?.UIRenderer?.prototype;
        if (!command || !uiProto)
          fail(
            "DRAW_ATTRIBUTION_UNAVAILABLE",
            "CommandBuffer or UIRenderer unavailable.",
          );
        const commandProto = Object.getPrototypeOf(command) as EngineObject;
        this.patch(
          commandProto,
          "bindInputAssembler",
          (original, self, args) => {
            if (isObject(args[0])) this.boundAssemblers.set(self, args[0]);
            return original.apply(self, args);
          },
        );
        this.patch(commandProto, "draw", (original, self, args) => {
          const source = isObject(args[0])
            ? (args[0] as EngineInputAssembler)
            : undefined;
          const ia = (
            source?.drawInfo ? source : this.boundAssemblers.get(self)
          ) as EngineInputAssembler | undefined;
          const info =
            source?.drawInfo ||
            (source as
              | { firstIndex?: number; indexCount?: number }
              | undefined) ||
            ia?.drawInfo;
          const index =
            Number((self as EngineDevice).numDrawCalls ?? this.drawIndex) + 1;
          this.drawIndex = index;
          this.draw(
            this.bufferId(ia?.indexBuffer || ia?._indexBuffer),
            info?.firstIndex,
            info?.indexCount,
            index,
          );
          return original.apply(self, args);
        });
        this.patch(uiProto, "fillBuffers", (original, self, args) => {
          const comp = self as EngineComponent;
          const before = comp.renderData?.chunk?.meshBuffer;
          const start = before?.indexOffset;
          const result = original.apply(self, args);
          const after = comp.renderData?.chunk?.meshBuffer;
          if (before && before === after && typeof start === "number")
            this.add(
              comp.node,
              this.bufferId(after._iaInfo?.indexBuffer),
              start,
              after.indexOffset - start,
            );
          this.captureModels(comp);
          return result;
        });
        const flowProto = this.cc.RenderFlow?.prototype;
        if (flowProto && typeof flowProto.render === "function")
          this.patch(flowProto, "render", (original, self, args) => {
            if (Array.isArray(self._stages))
              for (const stage of self._stages.slice(0, 64)) {
                if (
                  !isObject(stage) ||
                  !isObject(stage._pipeline) ||
                  !isObject(stage._pipeline.profiler)
                )
                  continue;
                const profiler = stage._pipeline.profiler as {
                  node?: EngineNode;
                  _subModels?: { _inputAssembler?: EngineInputAssembler }[];
                };
                const models = profiler._subModels;
                if (Array.isArray(models))
                  for (const model of models.slice(0, 64))
                    this.addIA(profiler.node, model._inputAssembler);
              }
            return original.apply(self, args);
          });
      }
      this.beforeEvent = this.cc.Director?.EVENT_BEFORE_DRAW ?? null;
      this.afterEvent = this.cc.Director?.EVENT_AFTER_DRAW ?? null;
      if (this.beforeEvent)
        this.cc.director?.on?.(this.beforeEvent, this.beginFrame);
      if (this.afterEvent)
        this.cc.director?.on?.(this.afterEvent, this.endFrame);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  dispose(): void {
    this.active = false;
    let failed = false;
    if (this.beforeEvent)
      try {
        this.cc.director?.off?.(this.beforeEvent, this.beginFrame);
      } catch {
        failed = true;
      }
    if (this.afterEvent)
      try {
        this.cc.director?.off?.(this.afterEvent, this.endFrame);
      } catch {
        failed = true;
      }
    this.beforeEvent = null;
    this.afterEvent = null;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const patch = this.patches[i];
      try {
        if (patch.owner[patch.key] !== patch.wrapper) continue;
        if (patch.original)
          Object.defineProperty(patch.owner, patch.key, patch.original);
        else delete patch.owner[patch.key];
      } catch {
        failed = true;
      }
    }
    this.patches = [];
    this.ranges.clear();
    this.values = new WeakMap();
    this.boundAssemblers = new WeakMap();
    this.hooked = new WeakSet();
    this.rangeCount = 0;
    if (failed)
      fail(
        "DRAW_HOOK_RESTORE_FAILED",
        "The engine rejected restoration of one or more draw-attribution hooks.",
      );
  }
}
