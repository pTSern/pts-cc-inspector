import type { CocosNamespace, EngineNode, EngineVec2 } from "./contracts";
import { fail } from "./properties";
export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export class SelectionOverlay {
  private element: HTMLDivElement | null = null;
  private frame = 0;
  private selected: EngineNode | null = null;
  private hovered: EngineNode | null = null;
  private picking = false;
  private candidates: EngineNode[] = [];
  private lastMove = 0;
  private oldCursor = "";
  private color = "#36c7ff";
  setColor(hex: unknown): void {
    if (typeof hex === "string" && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      this.color = hex;
      if (this.element) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        this.element.style.border = `2px solid ${hex}`;
        this.element.style.background = `rgba(${r},${g},${b},.15)`;
      }
    }
  }
  constructor(
    private readonly engine: () => CocosNamespace,
    private readonly valid: (node: EngineNode) => boolean,
    private readonly onPick: (node: EngineNode | null) => void,
  ) {}
  bounds(node: EngineNode): Bounds | null {
    const cc = this.engine();
    const canvas = (cc.game?.canvas ||
      document.querySelector("canvas")) as HTMLCanvasElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    try {
      const uiTransformCtor =
        cc.UITransform ||
        cc.js?.getClassByName?.("cc.UITransform") ||
        "cc.UITransform";
      const transform =
        node._uiProps?.uiTransformComp ||
        (typeof node.getComponent === "function"
          ? node.getComponent(uiTransformCtor)
          : null);
      const size =
        transform?.contentSize ||
        (typeof node.width === "number"
          ? { width: node.width, height: node.height ?? 0 }
          : null);
      const anchor = transform?.anchorPoint || {
        x: node.anchorX ?? 0.5,
        y: node.anchorY ?? 0.5,
      };
      const converter = transform || node;
      let corners: EngineVec2[];
      const Vec3 = cc.Vec3;
      if (
        size &&
        typeof converter.convertToWorldSpaceAR === "function" &&
        Vec3
      ) {
        const left = -anchor.x * size.width,
          bottom = -anchor.y * size.height;
        corners = [
          [left, bottom],
          [left + size.width, bottom],
          [left + size.width, bottom + size.height],
          [left, bottom + size.height],
        ].map(([x, y]) => converter.convertToWorldSpaceAR!(new Vec3(x, y, 0)));
      } else {
        const box = node.getBoundingBoxToWorld?.();
        if (!box || !Vec3) return null;
        corners = [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x + box.width, box.y + box.height],
          [box.x, box.y + box.height],
        ].map(([x, y]) => new Vec3(x, y, 0));
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
          const projected = componentCamera.getWorldToScreenPoint!(point);
          return { x: projected.x - origin.x, y: projected.y - origin.y };
        });
        surfaceWidth = visible.width;
        surfaceHeight = visible.height;
      } else if (componentCamera?.worldToScreen) {
        corners = corners.map((point) => componentCamera.worldToScreen!(point));
        surfaceWidth = canvas.width;
        surfaceHeight = canvas.height;
      } else if (renderCamera?.worldToScreen && Vec3) {
        corners = corners.map((point) => {
          const output = new Vec3();
          renderCamera.worldToScreen!(output, point);
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
  highlight(node: EngineNode | null, hover = false): void {
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
          border: `2px solid ${this.color}`,
          background: `rgba(${parseInt(this.color.slice(1, 3), 16)},${parseInt(this.color.slice(3, 5), 16)},${parseInt(this.color.slice(5, 7), 16)},.15)`,
          boxSizing: "border-box",
        });
        document.documentElement.append(this.element);
      }
      const hex = this.color;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      this.element.style.border = `2px solid ${hex}`;
      this.element.style.background = `rgba(${r},${g},${b},.15)`;
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
  pick(nodes: EngineNode[]): void {
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
  private hit(x: number, y: number): EngineNode | null {
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
