import { fail, type EngineObject } from "./properties";

interface Range {
  node: EngineObject;
  first: number;
  count: number;
}
interface Patch {
  owner: EngineObject;
  key: string;
  original: PropertyDescriptor | undefined;
  wrapper: Function;
}
type EngineMethod = (this: EngineObject, ...args: unknown[]) => unknown;
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
  constructor(private readonly cc: EngineObject) {}
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
  value(node: EngineObject): number | undefined {
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
    const original = owner[key];
    if (typeof original !== "function") return;
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
  private bufferId(buffer: EngineObject | undefined): unknown {
    return buffer?.objectID ?? buffer;
  }
  private add(
    node: EngineObject | undefined,
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
    node: EngineObject | undefined,
    ia: EngineObject | undefined,
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
  private captureModels(component: EngineObject): void {
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
  private watchAssembler(assembler: EngineObject | undefined): void {
    if (!assembler) return;
    const proto = Object.getPrototypeOf(assembler) as EngineObject | null;
    if (
      !proto ||
      this.hooked.has(proto) ||
      typeof proto.fillBuffers !== "function"
    )
      return;
    this.hooked.add(proto);
    this.patch(proto, "fillBuffers", (original, self, args) => {
      const component = args[0] as EngineObject,
        renderer = args[1] as EngineObject;
      let buffer =
        typeof self.getBuffer === "function"
          ? self.getBuffer(renderer)
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
      if (buffer)
        this.add(
          component?.node,
          buffer._ib,
          start,
          buffer.indiceOffset - start,
        );
      if (self._ia) this.addIA(component?.node, self._ia);
      if (typeof self.getBuffers === "function") {
        const buffers = self.getBuffers();
        if (Array.isArray(buffers))
          for (const entry of buffers.slice(0, 256))
            this.addIA(component?.node, entry.ia);
      }
      return result;
    });
  }
  private discoverAssemblers(): void {
    const scene = this.cc.director.getScene();
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
        this.patch(this.cc.renderer.device, "draw", (original, self, args) => {
          const index = Number(self._stats?.drawcalls ?? this.drawIndex) + 1;
          this.drawIndex = index;
          this.draw(self._next?.indexBuffer, args[0], args[1], index);
          return original.apply(self, args);
        });
        this.patch(this.cc.Assembler, "init", (original, self, args) => {
          const result = original.apply(self, args);
          this.watchAssembler((args[0] as EngineObject)?._assembler);
          return result;
        });
        this.discoverAssemblers();
      } else {
        const command =
          this.cc.director.root.device.commandBuffer ||
          this.cc.director.root.device._cmdBuff;
        const commandProto = Object.getPrototypeOf(command) as EngineObject;
        this.patch(
          commandProto,
          "bindInputAssembler",
          (original, self, args) => {
            this.boundAssemblers.set(self, args[0] as EngineObject);
            return original.apply(self, args);
          },
        );
        this.patch(commandProto, "draw", (original, self, args) => {
          const source = args[0] as EngineObject;
          const ia = source?.drawInfo ? source : this.boundAssemblers.get(self);
          const info = source?.drawInfo || source || ia?.drawInfo;
          const index = Number(self.numDrawCalls ?? this.drawIndex) + 1;
          this.drawIndex = index;
          this.draw(
            this.bufferId(ia?.indexBuffer || ia?._indexBuffer),
            info?.firstIndex,
            info?.indexCount,
            index,
          );
          return original.apply(self, args);
        });
        this.patch(
          this.cc.internal.UIRenderer.prototype,
          "fillBuffers",
          (original, self, args) => {
            const before = self.renderData?.chunk?.meshBuffer;
            const start = before?.indexOffset;
            const result = original.apply(self, args);
            const after = self.renderData?.chunk?.meshBuffer;
            if (before && before === after)
              this.add(
                self.node,
                this.bufferId(after._iaInfo?.indexBuffer),
                start,
                after.indexOffset - start,
              );
            this.captureModels(self);
            return result;
          },
        );
        if (this.cc.RenderFlow?.prototype?.render)
          this.patch(
            this.cc.RenderFlow.prototype,
            "render",
            (original, self, args) => {
              if (Array.isArray(self._stages))
                for (const stage of self._stages.slice(0, 64)) {
                  const profiler = stage._pipeline?.profiler;
                  const models = profiler?._subModels;
                  if (Array.isArray(models))
                    for (const model of models.slice(0, 64))
                      this.addIA(profiler.node, model._inputAssembler);
                }
              return original.apply(self, args);
            },
          );
      }
      this.beforeEvent = this.cc.Director.EVENT_BEFORE_DRAW;
      this.afterEvent = this.cc.Director.EVENT_AFTER_DRAW;
      this.cc.director.on(this.beforeEvent, this.beginFrame);
      this.cc.director.on(this.afterEvent, this.endFrame);
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
        this.cc.director.off(this.beforeEvent, this.beginFrame);
      } catch {
        failed = true;
      }
    if (this.afterEvent)
      try {
        this.cc.director.off(this.afterEvent, this.endFrame);
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
