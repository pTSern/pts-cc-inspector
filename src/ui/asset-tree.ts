import type { AssetNode, AssetTreeSnapshot } from "../shared/protocol";
import type { MessageKey } from "../locales";
import { createArrowTriangle, setArrowTriangleExpanded } from "./icons";
type Translate = (key: MessageKey) => string;

export interface AssetTreeActions {
  select(node: AssetNode): void;
}

const ROW_HEIGHT = 28;

export function assetIcon(type = "", ext = ""): string {
  const t = (type + " " + ext).toLowerCase();
  if (
    t.includes("sprite") ||
    t.includes("texture") ||
    t.includes("image") ||
    t.includes("png") ||
    t.includes("jpg")
  )
    return "🖼️";
  if (
    t.includes("audio") ||
    t.includes("sound") ||
    t.includes("mp3") ||
    t.includes("wav") ||
    t.includes("ogg")
  )
    return "🎵";
  if (t.includes("prefab")) return "◆";
  if (t.includes("scene")) return "🎬";
  if (t.includes("font") || t.includes("ttf")) return "🔤";
  if (t.includes("json") || t.includes("text")) return "📄";
  if (t.includes("material") || t.includes("effect")) return "🎨";
  if (t.includes("animation")) return "🎞️";
  return "📦";
}

export class AssetTreeView {
  readonly element: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readonly abort = new AbortController();
  private nodes: AssetNode[] = [];
  private byId = new Map<string, AssetNode>();
  private visible: AssetNode[] = [];
  private expanded = new Set<string>();
  private selected: string | null = null;
  private query = "";
  private initialized = false;
  private rows: HTMLDivElement[] = [];

  constructor(
    private readonly t: Translate,
    private readonly actions: AssetTreeActions,
    private readonly scope: string,
  ) {
    this.element = document.createElement("div");
    this.element.className = "ci-tree ci-asset-tree";
    this.element.tabIndex = 0;
    this.element.setAttribute("role", "tree");
    this.element.setAttribute("aria-label", t("assetsTree"));

    this.spacer = document.createElement("div");
    this.spacer.className = "ci-tree-spacer";
    this.layer = document.createElement("div");
    this.layer.className = "ci-tree-layer";
    this.empty = document.createElement("div");
    this.empty.className = "ci-empty";
    this.empty.textContent = t("noAssets");

    this.element.append(this.spacer, this.layer, this.empty);

    const opts = { signal: this.abort.signal };
    this.element.addEventListener("scroll", () => this.render(), opts);
    this.element.addEventListener(
      "click",
      (event) => {
        const row = this.rowFrom(event.target);
        if (!row) return;
        const id = row.dataset.id;
        if (!id) return;
        const node = this.byId.get(id);
        if (!node) return;
        if ((event.target as Element).closest("[data-expand]")) {
          this.expand(id);
        } else {
          this.setSelected(id);
          this.actions.select(node);
          this.element.focus();
        }
      },
      opts,
    );
    this.element.addEventListener(
      "dblclick",
      (event) => {
        const row = this.rowFrom(event.target);
        if (row?.dataset.id) this.expand(row.dataset.id);
      },
      opts,
    );
    this.element.addEventListener("keydown", (event) => this.key(event), opts);

    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(this.element);
  }

  private rowFrom(target: EventTarget | null): HTMLElement | null {
    return target instanceof Element
      ? target.closest<HTMLElement>(".ci-tree-row")
      : null;
  }

  setSnapshot(snapshot: AssetTreeSnapshot): void {
    this.nodes = snapshot.nodes;
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    const shouldExpand =
      (!this.initialized || this.expanded.size === 0) && this.nodes.length > 0;
    if (shouldExpand) {
      for (const node of this.nodes) {
        if (node.isBundle) this.expanded.add(node.id);
      }
      this.initialized = true;
    }
    for (const id of this.expanded) {
      if (!this.byId.has(id)) this.expanded.delete(id);
    }
    this.filter();
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  node(id: string): AssetNode | undefined {
    return this.byId.get(id);
  }

  setFilter(query: string): void {
    const normalized = query.toLocaleLowerCase().trim();
    const changed = normalized !== this.query;
    this.query = normalized;
    if (changed) this.element.scrollTop = 0;
    this.filter();
  }

  setSelected(id: string | null, reveal = false): void {
    this.selected = id;
    if (reveal && id) {
      const node = this.byId.get(id);
      if (node?.parentId) this.expanded.add(node.parentId);
      this.filter();
      const index = this.visible.findIndex((n) => n.id === id);
      if (index >= 0) {
        this.element.scrollTop = Math.max(
          0,
          index * ROW_HEIGHT - this.element.clientHeight / 2,
        );
      }
    }
    this.render();
  }

  expandAll(expand: boolean): void {
    this.expanded.clear();
    if (expand) {
      for (const node of this.nodes) {
        if (node.isBundle) this.expanded.add(node.id);
      }
    }
    this.filter();
  }

  reset(): void {
    this.nodes = [];
    this.visible = [];
    this.byId.clear();
    this.expanded.clear();
    this.selected = null;
    this.initialized = false;
    this.render();
  }

  private expand(id: string, value = !this.expanded.has(id)): void {
    if (value) this.expanded.add(id);
    else this.expanded.delete(id);
    this.filter();
  }

  private filter(): void {
    const filtering = Boolean(this.query);
    const matches = new Set<string>();
    if (filtering) {
      for (const node of this.nodes) {
        if (node.isBundle) continue;
        const text =
          `${node.name} ${node.path || ""} ${node.type || ""} ${node.bundle}`.toLowerCase();
        if (text.includes(this.query)) {
          matches.add(node.id);
          if (node.parentId) matches.add(node.parentId);
        }
      }
    }

    const visibleIds = new Set<string>();
    this.visible = this.nodes.filter((node) => {
      const show = filtering
        ? matches.has(node.id)
        : node.isBundle || (node.parentId && this.expanded.has(node.parentId));
      if (show) visibleIds.add(node.id);
      return show;
    });
    this.render();
  }

  private render(): void {
    this.spacer.style.height = `${this.visible.length * ROW_HEIGHT}px`;
    this.empty.hidden = this.visible.length !== 0;

    const capacity = Math.max(
      1,
      Math.ceil((this.element.clientHeight || 400) / ROW_HEIGHT) + 10,
    );
    while (this.rows.length < capacity) {
      const row = document.createElement("div");
      row.className = "ci-tree-row ci-asset-row";
      row.setAttribute("role", "treeitem");

      const expander = createArrowTriangle(false);
      expander.classList.add("ci-expander");
      expander.dataset.expand = "true";
      const icon = document.createElement("span");
      icon.className = "ci-asset-icon";

      const name = document.createElement("span");
      name.className = "ci-node-name";

      const hint = document.createElement("span");
      hint.className = "ci-node-hint";

      row.append(expander, icon, name, hint);
      this.rows.push(row);
      this.layer.append(row);
    }
    while (this.rows.length > capacity) this.rows.pop()!.remove();

    const start = Math.max(
      0,
      Math.floor(this.element.scrollTop / ROW_HEIGHT) - 4,
    );
    let activeDescendant = "";

    this.rows.forEach((row, offset) => {
      const index = start + offset;
      const node = this.visible[index];
      row.hidden = !node;
      if (!node) {
        delete row.dataset.id;
        return;
      }
      row.dataset.id = node.id;
      row.id = `${this.scope}-asset-row-${index}`;
      row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
      row.style.paddingLeft = `${8 + Math.min(node.depth, 100) * 16}px`;
      row.classList.toggle("is-selected", node.id === this.selected);
      row.classList.toggle("is-bundle-row", node.isBundle);
      row.setAttribute("aria-level", String(node.depth + 1));
      row.setAttribute("aria-selected", String(node.id === this.selected));

      const isExpanded = this.expanded.has(node.id) || !!this.query;
      const expanderEl = row.children[0] as HTMLElement;
      if (node.isBundle) {
        expanderEl.style.visibility = "visible";
        setArrowTriangleExpanded(expanderEl, isExpanded);
        row.setAttribute("aria-expanded", String(isExpanded));
      } else {
        expanderEl.style.visibility = "hidden";
        row.removeAttribute("aria-expanded");
      }

      const iconEl = row.children[1] as HTMLElement;
      iconEl.textContent = node.isBundle
        ? "📦"
        : assetIcon(node.type, node.ext);

      const nameEl = row.children[2] as HTMLElement;
      nameEl.textContent = node.name;

      const hintEl = row.children[3] as HTMLElement;
      if (node.isBundle) {
        hintEl.textContent = `(${node.childCount ?? 0} assets)`;
      } else {
        hintEl.textContent = `${node.type || "Asset"}${node.loaded ? " • loaded" : ""}`;
      }

      row.title = node.path
        ? `${node.name}\n${node.path}\nUUID: ${node.uuid || ""}`
        : node.name;
      if (node.id === this.selected) activeDescendant = row.id;
    });

    if (activeDescendant) {
      this.element.setAttribute("aria-activedescendant", activeDescendant);
    } else {
      this.element.removeAttribute("aria-activedescendant");
    }
  }

  private key(event: KeyboardEvent): void {
    const index = this.visible.findIndex((n) => n.id === this.selected);
    const node = this.visible[index];
    let target: AssetNode | undefined;
    switch (event.key) {
      case "ArrowDown":
        target = this.visible[Math.min(this.visible.length - 1, index + 1)];
        break;
      case "ArrowUp":
        target = this.visible[Math.max(0, index - 1)];
        break;
      case "ArrowRight":
        if (node?.isBundle && !this.expanded.has(node.id)) {
          this.expand(node.id, true);
        } else if (node?.isBundle && this.expanded.has(node.id)) {
          target = this.visible[index + 1];
        }
        break;
      case "ArrowLeft":
        if (node?.isBundle && this.expanded.has(node.id)) {
          this.expand(node.id, false);
        } else if (node?.parentId) {
          target = this.byId.get(node.parentId);
        }
        break;
      case "Enter":
        if (node) this.actions.select(node);
        break;
      default:
        return;
    }
    if (target && target.id !== this.selected) {
      event.preventDefault();
      this.setSelected(target.id);
      this.actions.select(target);
      const nextIndex = this.visible.findIndex((n) => n.id === target!.id);
      if (nextIndex >= 0) {
        const top = nextIndex * ROW_HEIGHT;
        if (top < this.element.scrollTop) this.element.scrollTop = top;
        else if (
          top + ROW_HEIGHT >
          this.element.scrollTop + this.element.clientHeight
        ) {
          this.element.scrollTop = top + ROW_HEIGHT - this.element.clientHeight;
        }
      }
    }
  }

  dispose(): void {
    this.abort.abort();
    this.observer.disconnect();
    this.rows = [];
    this.nodes = [];
    this.visible = [];
    this.byId.clear();
    this.element.remove();
  }
}
