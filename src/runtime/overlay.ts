import { fail, type EngineObject } from "./properties";

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export class SelectionOverlay {
  private element: HTMLDivElement | null = null;
  private frame = 0;
  private selected: EngineObject | null = null;
  private hovered: EngineObject | null = null;
  private picking = false;
  private candidates: EngineObject[] = [];
  private lastMove = 0;
  private oldCursor = "";
  constructor(
    private readonly engine: () => EngineObject,
    private readonly valid: (node: EngineObject) => boolean,
    private readonly onPick: (node: EngineObject | null) => void,
  ) {}
  bounds(node: EngineObject): Bounds | null {
    if (!this.valid(node) || node.activeInHierarchy === false) return null;
    const cc = this.engine();
    const canvas = (cc.game?.canvas ||
      document.querySelector("canvas")) as HTMLCanvasElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    try {
      const transform = cc.UITransform
        ? node.getComponent?.(cc.UITransform)
        : null;
      const size =
        transform?.contentSize ||
        (typeof node.width === "number"
          ? { width: node.width, height: node.height }
          : null);
      const anchor = transform?.anchorPoint || {
        x: node.anchorX ?? 0.5,
        y: node.anchorY ?? 0.5,
      };
      const converter = transform || node;
      let corners: EngineObject[];
      if (
        size &&
        typeof converter.convertToWorldSpaceAR === "function" &&
        cc.Vec3
      ) {
        const left = -anchor.x * size.width,
          bottom = -anchor.y * size.height;
        corners = [
          [left, bottom],
          [left + size.width, bottom],
          [left + size.width, bottom + size.height],
          [left, bottom + size.height],
        ].map(([x, y]) =>
          converter.convertToWorldSpaceAR(new cc.Vec3(x, y, 0)),
        );
      } else {
        const box = node.getBoundingBoxToWorld?.();
        if (!box || !cc.Vec3) return null;
        corners = [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x + box.width, box.y + box.height],
          [box.x, box.y + box.height],
        ].map(([x, y]) => new cc.Vec3(x, y, 0));
      }
      const componentCamera = cc.Camera?.findCamera?.(node);
      const renderCamera =
        cc.director?.root?.batcher2D?.getFirstRenderCamera?.(node);
      if (componentCamera?.targetTexture) return null;
      if (
        renderCamera?.window &&
        cc.director?.root?.mainWindow &&
        renderCamera.window !== cc.director.root.mainWindow
      )
        return null;
      let surfaceWidth: number, surfaceHeight: number;
      if (componentCamera?.getWorldToScreenPoint) {
        const visible = cc.visibleRect || cc.view?.getVisibleSize?.();
        if (!visible?.width || !visible?.height) return null;
        const origin = componentCamera.node?.is3DNode
          ? { x: 0, y: 0 }
          : cc.view?.getVisibleOrigin?.() || { x: 0, y: 0 };
        corners = corners.map((point) => {
          const projected = componentCamera.getWorldToScreenPoint(point);
          return { x: projected.x - origin.x, y: projected.y - origin.y };
        });
        surfaceWidth = visible.width;
        surfaceHeight = visible.height;
      } else if (componentCamera?.worldToScreen) {
        corners = corners.map((point) => componentCamera.worldToScreen(point));
        surfaceWidth = canvas.width;
        surfaceHeight = canvas.height;
      } else if (renderCamera?.worldToScreen) {
        corners = corners.map((point) => {
          const output = new cc.Vec3();
          renderCamera.worldToScreen(output, point);
          return output;
        });
        surfaceWidth = canvas.width;
        surfaceHeight = canvas.height;
      } else {
        if (transform) return null; // A 3D world-space UI needs its rendering camera, not guessed design-space scaling.
        const visible = cc.view?.getVisibleSize?.();
        if (!visible?.width || !visible?.height) return null;
        const origin = cc.view?.getVisibleOrigin?.() || { x: 0, y: 0 };
        corners = corners.map((point) => ({
          x: point.x - origin.x,
          y: point.y - origin.y,
        }));
        surfaceWidth = visible.width;
        surfaceHeight = visible.height;
      }
      if (
        !corners.every(
          (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
        )
      )
        return null;
      const x = Math.min(...corners.map((point) => point.x)),
        y = Math.min(...corners.map((point) => point.y));
      const width = Math.max(...corners.map((point) => point.x)) - x,
        height = Math.max(...corners.map((point) => point.y)) - y;
      const bounds = {
        left: rect.left + (x / surfaceWidth) * rect.width,
        top: rect.top + (1 - (y + height) / surfaceHeight) * rect.height,
        width: (width / surfaceWidth) * rect.width,
        height: (height / surfaceHeight) * rect.height,
      };
      return Object.values(bounds).every(Number.isFinite) ? bounds : null;
    } catch {
      return null;
    }
  }
  highlight(node: EngineObject | null, hover = false): void {
    if (hover) this.hovered = node;
    else this.selected = node;
    if (this.hovered || this.selected) this.schedule();
    else this.hide();
  }
  private schedule(): void {
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.render();
      });
  }
  private render(): void {
    if (this.hovered && !this.valid(this.hovered)) this.hovered = null;
    if (this.selected && !this.valid(this.selected)) this.selected = null;
    const node = this.hovered || this.selected;
    if (!node) {
      this.hide();
      return;
    }
    const bounds = this.bounds(node);
    if (bounds) {
      if (!this.element) {
        this.element = document.createElement("div");
        this.element.setAttribute("data-pts-inspector-overlay", "");
        Object.assign(this.element.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: "2147483646",
          border: "2px solid #36c7ff",
          background: "rgba(54,199,255,.10)",
          boxSizing: "border-box",
        });
        document.documentElement.append(this.element);
      }
      Object.assign(this.element.style, {
        display: "block",
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      });
    } else if (this.element) this.element.style.display = "none";
    this.schedule();
  }
  private hide(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.element?.remove();
    this.element = null;
  }
  pick(nodes: EngineObject[]): void {
    if (!document.querySelector("canvas"))
      fail("PICK_UNAVAILABLE", "No game canvas is available for picking.");
    this.cancelPick();
    this.candidates = nodes.slice(-20000);
    this.picking = true;
    this.oldCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";
    window.addEventListener("pointermove", this.move, true);
    window.addEventListener("pointerdown", this.down, true);
    window.addEventListener("click", this.click, true);
    window.addEventListener("keydown", this.key, true);
    window.addEventListener("contextmenu", this.contextMenu, true);
  }
  private hit(x: number, y: number): EngineObject | null {
    for (let i = this.candidates.length - 1; i >= 0; i--) {
      const node = this.candidates[i];
      const b = this.bounds(node);
      if (
        b &&
        x >= b.left &&
        x <= b.left + b.width &&
        y >= b.top &&
        y <= b.top + b.height
      )
        return node;
    }
    return null;
  }
  private move = (event: PointerEvent): void => {
    const now = performance.now();
    if (now - this.lastMove < 100) return;
    this.lastMove = now;
    this.highlight(this.hit(event.clientX, event.clientY), true);
  };
  private down = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  private click = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const node =
      event.button === 0 ? this.hit(event.clientX, event.clientY) : null;
    this.cancelPick();
    this.onPick(node);
  };
  private key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.cancelPick();
      this.onPick(null);
    }
  };
  private contextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancelPick();
    this.onPick(null);
  };
  cancelPick(): void {
    if (!this.picking) return;
    this.picking = false;
    this.candidates = [];
    document.documentElement.style.cursor = this.oldCursor;
    window.removeEventListener("pointermove", this.move, true);
    window.removeEventListener("pointerdown", this.down, true);
    window.removeEventListener("click", this.click, true);
    window.removeEventListener("keydown", this.key, true);
    window.removeEventListener("contextmenu", this.contextMenu, true);
    this.highlight(null, true);
  }
  dispose(): void {
    this.cancelPick();
    this.selected = null;
    this.hovered = null;
    this.hide();
  }
}
