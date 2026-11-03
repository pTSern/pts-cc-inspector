import type { TreeNode, TreeSnapshot } from "../shared/protocol";
import type { MessageKey } from "../locales";
import { createArrowTriangle, setArrowTriangleExpanded } from "./icons";
type Translate = (key: MessageKey) => string;
export interface TreeActions {
  select(id: string): void;
  hover(id: string | null): void;
  menu(id: string, x: number, y: number): void;
  toggle(id: string): void;
}
const ROW_HEIGHT = 28;
export class HierarchyView {
  readonly element: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readonly abort = new AbortController();
  private nodes: TreeNode[] = [];
  private byId = new Map<string, TreeNode>();
  private paths = new Map<string, string>();
  private visible: TreeNode[] = [];
  private expanded = new Set<string>();
  private selected: string | null = null;
  private query = "";
  private activeFilter = "all";
  private bucket = "";
  private initialized = false;
  private showDrawCalls = false;
  private nodeDrawCallCounts = new Map<string, number>();
  private hoverId: string | null = null;
  private rows: HTMLDivElement[] = [];
  constructor(
    private readonly t: Translate,
    private readonly actions: TreeActions,
    private readonly scope: string,
  ) {
    this.element = document.createElement("div");
    this.element.className = "ci-tree";
    this.element.tabIndex = 0;
    this.element.setAttribute("role", "tree");
    this.element.setAttribute("aria-label", t("hierarchy"));
    this.element.title = t("treeHelp");
    this.spacer = document.createElement("div");
    this.spacer.className = "ci-tree-spacer";
    this.layer = document.createElement("div");
    this.layer.className = "ci-tree-layer";
    this.empty = document.createElement("div");
    this.empty.className = "ci-empty";
    this.empty.textContent = t("emptyTree");
    this.element.append(this.spacer, this.layer, this.empty);
    const opts = { signal: this.abort.signal };
    this.element.addEventListener("scroll", () => this.render(), opts);
    this.element.addEventListener(
      "click",
      (event) => {
        const row = this.rowFrom(event.target);
        if (!row) return;
        const id = row.dataset.id!;
        if ((event.target as Element).closest("[data-expand]")) this.expand(id);
        else {
          this.setSelected(id);
          this.actions.select(id);
          this.element.focus();
        }
      },
      opts,
    );
    this.element.addEventListener(
      "dblclick",
      (event) => {
        const row = this.rowFrom(event.target);
        if (row) this.expand(row.dataset.id!);
      },
      opts,
    );
    this.element.addEventListener(
      "contextmenu",
      (event) => {
        const row = this.rowFrom(event.target);
        if (!row) return;
        event.preventDefault();
        this.setSelected(row.dataset.id!);
        this.actions.select(row.dataset.id!);
        this.actions.menu(row.dataset.id!, event.clientX, event.clientY);
      },
      opts,
    );
    this.element.addEventListener(
      "pointermove",
      (event) => {
        const id = this.rowFrom(event.target)?.dataset.id ?? null;
        if (id !== this.hoverId) {
          this.hoverId = id;
          this.actions.hover(id);
        }
      },
      opts,
    );
    this.element.addEventListener(
      "pointerleave",
      () => {
        this.hoverId = null;
        this.actions.hover(null);
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
  setSnapshot(snapshot: TreeSnapshot): void {
    this.nodes = snapshot.nodes;
    this.byId = new Map(this.nodes.map((node) => [node.id, node]));
    this.paths.clear();
    for (const node of this.nodes)
      this.paths.set(
        node.id,
        `${node.parentId ? (this.paths.get(node.parentId) ?? "") : ""}/${node.name}`,
      );
    if (!this.initialized) {
      for (const node of this.nodes)
        if (!node.parentId) this.expanded.add(node.id);
      this.initialized = true;
    }
    for (const id of this.expanded)
      if (!this.byId.has(id)) this.expanded.delete(id);
    this.nodeDrawCallCounts.clear();
    const childMap = new Map<string, TreeNode[]>();
    for (const node of this.nodes) {
      if (node.parentId) {
        let list = childMap.get(node.parentId);
        if (!list) {
          list = [];
          childMap.set(node.parentId, list);
        }
        list.push(node);
      }
    }
    const computeDc = (node: TreeNode): number => {
      let count = node.drawCall !== undefined ? 1 : 0;
      const children = childMap.get(node.id);
      if (children) {
        for (const child of children) {
          count += computeDc(child);
        }
      }
      this.nodeDrawCallCounts.set(node.id, count);
      return count;
    };
    for (const node of this.nodes) {
      if (!node.parentId) computeDc(node);
    }
    this.filter();
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  node(id: string): TreeNode | undefined {
    return this.byId.get(id);
  }
  path(id: string): string {
    return this.paths.get(id) ?? "";
  }
  setFilter(query: string, active: string, bucket: string): void {
    const normalized = query.toLocaleLowerCase().trim();
    const changed =
      normalized !== this.query ||
      active !== this.activeFilter ||
      bucket !== this.bucket;
    this.query = normalized;
    this.activeFilter = active;
    this.bucket = bucket;
    if (changed) this.element.scrollTop = 0;
    this.filter();
  }
  setShowDrawCalls(show: boolean): void {
    this.showDrawCalls = show;
    this.render();
  }
  setSelected(id: string | null, reveal = false): void {
    this.selected = id;
    if (reveal && id) {
      let parent = this.byId.get(id)?.parentId;
      while (parent) {
        this.expanded.add(parent);
        parent = this.byId.get(parent)?.parentId;
      }
      this.filter();
      const index = this.visible.findIndex((node) => node.id === id);
      if (index >= 0)
        this.element.scrollTop = Math.max(
          0,
          index * ROW_HEIGHT - this.element.clientHeight / 2,
        );
    }
    this.render();
  }
  expandAll(expand: boolean): void {
    this.expanded.clear();
    if (expand)
      for (const node of this.nodes)
        if (node.childCount) this.expanded.add(node.id);
    this.filter();
  }
  reset(): void {
    this.nodes = [];
    this.visible = [];
    this.byId.clear();
    this.paths.clear();
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
    const filtering =
      !!this.query || this.activeFilter !== "all" || !!this.bucket;
    const matches = new Set<string>();
    if (filtering) {
      for (const node of this.nodes) {
        if (
          (this.activeFilter === "active" && !node.activeInHierarchy) ||
          (this.activeFilter === "inactive" && node.activeInHierarchy)
        )
          continue;
        if (this.bucket && String(node.drawCall) !== this.bucket) continue;
        if (
          this.query &&
          !`${this.paths.get(node.id)} ${node.componentTypes.join(" ")}`
            .toLocaleLowerCase()
            .includes(this.query)
        )
          continue;
        matches.add(node.id);
        let parent = node.parentId;
        while (parent && !matches.has(parent)) {
          matches.add(parent);
          parent = this.byId.get(parent)?.parentId ?? null;
        }
      }
    }
    const visibleIds = new Set<string>();
    this.visible = this.nodes.filter((node) => {
      const show = filtering
        ? matches.has(node.id)
        : !node.parentId ||
          (visibleIds.has(node.parentId) && this.expanded.has(node.parentId));
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
      row.className = "ci-tree-row";
      row.setAttribute("role", "treeitem");
      const expander = createArrowTriangle(false);
      expander.classList.add("ci-expander");
      expander.dataset.expand = "true";
      expander.setAttribute("aria-hidden", "true");
      const dot = document.createElement("span");
      dot.className = "ci-active-dot";
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "ci-node-name";
      const hint = document.createElement("span");
      hint.className = "ci-node-hint";
      const dcBadge = document.createElement("span");
      dcBadge.className = "ci-dc-badge";
      row.append(dcBadge, expander, dot, name, hint);
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
      row.id = `${this.scope}-row-${index}`;
      row.style.transform = `translateY(${index * ROW_HEIGHT}px)`;
      row.style.paddingLeft = `${8 + Math.min(node.depth, 100) * 16}px`;
      row.classList.toggle("is-selected", node.id === this.selected);
      row.classList.toggle("is-inactive", !node.activeInHierarchy);
      row.setAttribute("aria-level", String(node.depth + 1));
      row.setAttribute("aria-selected", String(node.id === this.selected));
      const expanded =
        this.expanded.has(node.id) ||
        !!this.query ||
        this.activeFilter !== "all" ||
        !!this.bucket;
      if (node.childCount) row.setAttribute("aria-expanded", String(expanded));
      const dcElem = row.children[0] as HTMLElement;
      dcElem.hidden = !this.showDrawCalls;
      if (this.showDrawCalls) {
        const dcCount =
          this.nodeDrawCallCounts.get(node.id) ??
          (node.drawCall !== undefined ? 1 : 0);
        dcElem.textContent = `[${dcCount}]`;
        dcElem.classList.toggle("has-dc", dcCount > 0);
      }
      const expanderEl = row.children[1] as HTMLElement;
      if (node.childCount) {
        expanderEl.style.visibility = "visible";
        setArrowTriangleExpanded(expanderEl, expanded);
      } else {
        expanderEl.style.visibility = "hidden";
      }
      row.children[2].setAttribute(
        "title",
        this.t(node.active ? "active" : "inactive"),
      );
      row.children[3].textContent = node.name;
      row.children[4].textContent = `${node.prefab ? "◆ " : ""}${node.componentTypes.join(" · ")}${node.drawCall === undefined ? "" : ` #${node.drawCall}`}`;
      row.title = `${this.paths.get(node.id)}\n${node.componentTypes.join(", ")}${node.prefab ? `\n${this.t("prefab")}` : ""}`;
      if (node.id === this.selected) activeDescendant = row.id;
    });
    if (activeDescendant)
      this.element.setAttribute("aria-activedescendant", activeDescendant);
    else this.element.removeAttribute("aria-activedescendant");
  }
  private key(event: KeyboardEvent): void {
    const index = this.visible.findIndex((node) => node.id === this.selected);
    const node = this.visible[index];
    let target: TreeNode | undefined;
    switch (event.key) {
      case "ArrowDown":
        target = this.visible[Math.min(this.visible.length - 1, index + 1)];
        break;
      case "ArrowUp":
        target = this.visible[Math.max(0, index - 1)];
        break;
      case "Home":
        target = this.visible[0];
        break;
      case "End":
        target = this.visible[this.visible.length - 1];
        break;
      case "ArrowRight":
        if (node?.childCount) {
          if (!this.expanded.has(node.id)) this.expand(node.id, true);
          else target = this.visible[index + 1];
        }
        break;
      case "ArrowLeft":
        if (node) {
          if (this.expanded.has(node.id)) this.expand(node.id, false);
          else if (node.parentId) target = this.byId.get(node.parentId);
        }
        break;
      case " ":
        if (node) this.actions.toggle(node.id);
        break;
      case "ContextMenu":
      case "F10": {
        if (event.key === "F10" && !event.shiftKey) return;
        if (node) {
          const rect = this.element.getBoundingClientRect();
          this.actions.menu(node.id, rect.left + 24, rect.top + 30);
        }
        break;
      }
      case "Enter":
        if (node) this.actions.select(node.id);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target) {
      this.setSelected(target.id);
      this.actions.select(target.id);
      const next = this.visible.findIndex((item) => item.id === target!.id);
      const top = next * ROW_HEIGHT;
      if (top < this.element.scrollTop) this.element.scrollTop = top;
      else if (
        top + ROW_HEIGHT >
        this.element.scrollTop + this.element.clientHeight
      )
        this.element.scrollTop = top + ROW_HEIGHT - this.element.clientHeight;
      this.render();
    }
  }
  dispose(): void {
    this.abort.abort();
    this.observer.disconnect();
    this.rows = [];
    this.nodes = [];
    this.visible = [];
    this.byId.clear();
    this.paths.clear();
    this.expanded.clear();
    this.element.remove();
  }
}
