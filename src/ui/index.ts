import { DEFAULT_SETTINGS, normalizeSettings } from "../shared/protocol";
import type {
  Command,
  EngineSupport,
  FrameInfo,
  GameInfo,
  InspectorClient,
  Locale,
  NodeDetails,
  RuntimeEvent,
  Settings,
  TreeSnapshot,
} from "../shared/protocol";
import { errorKeys, localeNames, localize } from "../locales";
import type { MessageKey } from "../locales";
import { HierarchyView } from "./tree";
import { PropertyView } from "./properties";

let instanceCounter = 0;
export function mountInspector(
  root: HTMLElement,
  client: InspectorClient,
  options: { floating?: boolean; onClose?: () => void } = {},
): () => void {
  let inspector: InspectorUI | null = new InspectorUI(root, client, options);
  return () => {
    inspector?.dispose();
    inspector = null;
  };
}
class InspectorUI {
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly abort = new AbortController();
  private readonly scope = `ci-${++instanceCounter}`;
  private readonly unsubscribe: () => void;
  private readonly visibilityObserver: IntersectionObserver;
  private shellAbort = new AbortController();
  private tree!: HierarchyView;
  private propertyView: PropertyView | null = null;
  private treeSnapshot: TreeSnapshot | null = null;
  private details: NodeDetails | null = null;
  private support: EngineSupport | null = null;
  private frames: FrameInfo[] = [];
  private frameId: number | null = null;
  private selected: string | null = null;
  private epoch = 0;
  private disposed = false;
  private settingsReady = false;
  private intersecting = true;
  private panelVisible = true;
  private visible = !document.hidden;
  private timer: number | undefined;
  private hoverTimer: number | undefined;
  private treeFlight: Promise<void> | null = null;
  private treeEpoch = -1;
  private detailsFlight: Promise<void> | null = null;
  private detailsRequest: {
    id: string;
    generation: number;
    epoch: number;
  } | null = null;
  private treeLast = 0;
  private propertiesLast = 0;
  private hoverBusy = false;
  private hoverTarget: string | null = null;
  private pickActive = false;
  private fpsVisible: boolean | null = null;
  private drawAttribution = false;
  private attributionControl!: HTMLLabelElement;
  private bucketControls!: HTMLDivElement;
  private isPaused = false;
  private pauseButton!: HTMLButtonElement;
  private stepButton!: HTMLButtonElement;
  private showDrawCalls = false;
  private showDrawCallsControl!: HTMLLabelElement;
  private currentDetailsId: string | null = null;
  private menuAbort: AbortController | null = null;
  private dialogAbort: AbortController | null = null;
  private settingsQueue: Promise<void> = Promise.resolve();
  private menu: HTMLElement | null = null;
  private dialog: HTMLDialogElement | null = null;
  private status!: HTMLElement;
  private engineLabel!: HTMLElement;
  private frameSelect!: HTMLSelectElement;
  private pickButton!: HTMLButtonElement;
  private fpsButton!: HTMLButtonElement;
  private inspectorBody!: HTMLElement;
  private inspectorTitle!: HTMLElement;
  private inspectorPath!: HTMLElement;
  private count!: HTMLElement;
  private buckets!: HTMLSelectElement;
  private search!: HTMLInputElement;
  private activeFilter!: HTMLSelectElement;
  private treeAuto!: HTMLInputElement;
  private propertiesAuto!: HTMLInputElement;
  private actionsButton!: HTMLButtonElement;
  constructor(
    private readonly root: HTMLElement,
    private readonly client: InspectorClient,
    private readonly options: { floating?: boolean; onClose?: () => void },
  ) {
    root.classList.add("ci-root");
    root.classList.toggle("ci-floating", !!options.floating);
    this.renderShell();
    this.unsubscribe = client.onEvent((event) => this.event(event));
    document.addEventListener(
      "visibilitychange",
      () => this.updateVisibility(),
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "pts-panel-visibility",
      (event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (typeof detail === "boolean") {
          this.panelVisible = detail;
          this.updateVisibility();
        }
      },
      { signal: this.abort.signal },
    );
    window.addEventListener(
      "pts-settings-updated",
      (event) => {
        const detail = (event as CustomEvent<unknown>).detail;
        if (detail && typeof detail === "object") {
          this.settings = normalizeSettings(detail);
          this.startTimer();
          this.renderSupport();
          void this.client
            .call("overlayConfig", { color: this.settings.overlayColor })
            .catch(() => {});
          if (this.selected && this.settings.selectionHighlight) {
            void this.nodeCall("select", {
              id: this.selected,
              color: this.settings.overlayColor,
            }).catch(() => {});
          }
        }
      },
      { signal: this.abort.signal },
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (this.menu && !this.menu.contains(event.target as Node))
          this.closeMenu();
      },
      { signal: this.abort.signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          this.closeMenu();
          if (this.pickActive) this.run(() => this.setPick(false));
        }
      },
      { signal: this.abort.signal },
    );
    this.visibilityObserver = new IntersectionObserver((entries) => {
      this.intersecting = entries[0]?.isIntersecting ?? true;
      this.updateVisibility();
    });
    this.visibilityObserver.observe(root);
    client.setVisible(this.visible);
    this.run(async () => {
      this.settings = normalizeSettings(await client.getSettings());
      if (this.disposed) return;
      this.settingsReady = true;
      this.renderShell();
      this.startTimer();
      await this.connect();
    });
  }
  private t = (key: MessageKey): string => localize(key, this.settings.locale);
  private button(
    key: MessageKey,
    action: () => Promise<void> | void,
    compact = false,
    signal = this.shellAbort.signal,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = this.t(key);
    button.title = this.t(key);
    if (compact) button.className = "ci-compact";
    button.addEventListener(
      "click",
      () =>
        this.run(async () => {
          button.disabled = true;
          try {
            await action();
          } finally {
            if (button.isConnected && !signal.aborted) button.disabled = false;
          }
        }),
      { signal },
    );
    return button;
  }
  private checkbox(
    key: MessageKey,
    checked: boolean,
    changed: (value: boolean) => void,
    signal = this.shellAbort.signal,
  ): { label: HTMLLabelElement; input: HTMLInputElement } {
    const label = document.createElement("label");
    label.className = "ci-checkbox";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => changed(input.checked), { signal });
    label.append(input, document.createTextNode(this.t(key)));
    return { label, input };
  }
  private renderShell(): void {
    this.closeMenu();
    this.closeDialog();
    this.shellAbort.abort();
    this.shellAbort = new AbortController();
    this.tree?.dispose();
    this.propertyView?.dispose();
    this.propertyView = null;
    const toolbar = document.createElement("header");
    toolbar.className = "ci-toolbar";
    const brand = document.createElement("strong");
    brand.className = "ci-brand";
    brand.textContent = this.t("app");
    this.engineLabel = document.createElement("span");
    this.engineLabel.className = "ci-engine";
    this.frameSelect = document.createElement("select");
    this.frameSelect.className = "ci-frame-select";
    this.frameSelect.setAttribute("aria-label", this.t("frame"));
    this.frameSelect.addEventListener(
      "change",
      () => this.run(() => this.switchFrame(Number(this.frameSelect.value))),
      { signal: this.shellAbort.signal },
    );
    const refresh = this.button("refresh", async () => {
      await this.connect();
    });
    this.pickButton = this.button("pick", () => this.setPick(!this.pickActive));
    this.pickButton.setAttribute("aria-pressed", String(this.pickActive));
    this.fpsButton = this.button("fps", async () => {
      const epoch = this.epoch;
      const current = await this.client.call<GameInfo>("gameInfo");
      if (this.disposed || epoch !== this.epoch) return;
      const result = await this.client.call<{ visible: boolean }>("fps", {
        visible: !current.fpsVisible,
      });
      if (this.disposed || epoch !== this.epoch) return;
      this.fpsVisible = result.visible;
      this.fpsButton.setAttribute("aria-pressed", String(result.visible));
    });
    this.fpsButton.setAttribute(
      "aria-pressed",
      this.fpsVisible === null ? "mixed" : String(this.fpsVisible),
    );
    this.pauseButton = this.button("pause", () => this.togglePause());
    this.updatePauseButton();
    this.stepButton = this.button("step", () => this.stepRun());
    this.stepButton.title = this.isPaused
      ? this.t("stepHelpPaused")
      : this.t("stepHelp");
    this.stepButton.disabled = !this.isPaused;
    toolbar.append(
      brand,
      this.engineLabel,
      this.frameSelect,
      refresh,
      this.pickButton,
      this.fpsButton,
      this.pauseButton,
      this.stepButton,
      this.button("gameInfo", () => this.showGameInfo()),
      this.button("settings", () => this.showSettings()),
    );
    if (this.options.floating && this.options.onClose)
      toolbar.append(this.button("close", () => this.options.onClose?.()));
    const workspace = document.createElement("main");
    workspace.className = "ci-workspace";
    const hierarchy = document.createElement("section");
    hierarchy.className = "ci-hierarchy";
    hierarchy.setAttribute("aria-label", this.t("hierarchy"));
    const treeHeader = document.createElement("div");
    treeHeader.className = "ci-section-header";
    const treeTitle = document.createElement("h2");
    treeTitle.textContent = this.t("hierarchy");
    this.count = document.createElement("span");
    this.count.className = "ci-badge";
    treeHeader.append(
      treeTitle,
      this.count,
      this.button("refreshTree", () => this.refreshTree(true), true),
    );
    const filters = document.createElement("div");
    filters.className = "ci-filters";
    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.placeholder = this.t("search");
    this.search.setAttribute("aria-label", this.t("search"));
    this.search.addEventListener("input", () => this.applyFilters(), {
      signal: this.shellAbort.signal,
    });
    const secondaryFilters = document.createElement("div");
    secondaryFilters.className = "ci-secondary-filters";
    this.activeFilter = document.createElement("select");
    this.activeFilter.setAttribute("aria-label", this.t("active"));
    for (const [value, key] of [
      ["all", "allActive"],
      ["active", "activeOnly"],
      ["inactive", "inactiveOnly"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.t(key);
      this.activeFilter.append(option);
    }
    this.activeFilter.addEventListener("change", () => this.applyFilters(), {
      signal: this.shellAbort.signal,
    });
    this.buckets = document.createElement("select");
    this.buckets.setAttribute("aria-label", this.t("bucket"));
    this.buckets.hidden = true;
    this.buckets.addEventListener("change", () => this.applyFilters(), {
      signal: this.shellAbort.signal,
    });
    secondaryFilters.append(this.activeFilter, this.buckets);
    filters.append(this.search, secondaryFilters);
    const treeControls = document.createElement("div");
    treeControls.className = "ci-tree-controls";
    const treeAuto = this.checkbox(
      "autoTree",
      this.settings.autoTree,
      (value) => this.save({ autoTree: value }),
    );
    this.treeAuto = treeAuto.input;
    treeControls.append(
      treeAuto.label,
      this.button("expandAll", () => this.tree.expandAll(true), true),
      this.button("collapseAll", () => this.tree.expandAll(false), true),
    );
    const attribution = this.checkbox(
      "drawCallAttribution",
      this.drawAttribution,
      (value) =>
        this.run(async () => {
          const previous = this.drawAttribution;
          this.drawAttribution = value;
          attribution.input.disabled = true;
          try {
            await this.refreshTree(true, true);
            if (value) this.setStatus(this.t("drawCallHelp"));
          } catch (error) {
            this.drawAttribution = previous;
            attribution.input.checked = previous;
            throw error;
          } finally {
            if (attribution.input.isConnected)
              attribution.input.disabled = false;
          }
        }),
    );
    this.attributionControl = attribution.label;
    this.attributionControl.classList.add("ci-draw-toggle");
    const showDc = this.checkbox(
      "showDrawCallCount",
      this.showDrawCalls,
      (value) => {
        this.showDrawCalls = value;
        if (value && !this.drawAttribution) {
          this.drawAttribution = true;
          attribution.input.checked = true;
          this.run(async () => {
            await this.refreshTree(true, true);
            this.tree.setShowDrawCalls(true);
          });
        } else {
          this.tree.setShowDrawCalls(value);
        }
      },
    );
    this.showDrawCallsControl = showDc.label;
    this.showDrawCallsControl.classList.add("ci-draw-toggle");
    this.bucketControls = document.createElement("div");
    this.bucketControls.className = "ci-bucket-controls";
    this.bucketControls.hidden = true;
    for (const key of [
      "previousBucket",
      "currentBucket",
      "nextBucket",
      "allDrawCalls",
    ] as const) {
      this.bucketControls.append(
        this.button(
          key,
          () => {
            const values = [...this.buckets.options]
              .map((option) => option.value)
              .filter(Boolean);
            if (key === "allDrawCalls") this.buckets.value = "";
            else if (key === "currentBucket") {
              const bucket = this.selected
                ? this.tree.node(this.selected)?.drawCall
                : undefined;
              if (bucket === undefined) {
                this.setStatus(this.t("noDrawBucket"));
                return;
              }
              this.buckets.value = String(bucket);
            } else {
              const current =
                this.buckets.value ||
                (this.selected
                  ? String(this.tree.node(this.selected)?.drawCall ?? "")
                  : "");
              const index = values.indexOf(current);
              const next =
                key === "nextBucket"
                  ? Math.min(values.length - 1, index + 1)
                  : index < 0
                    ? values.length - 1
                    : Math.max(0, index - 1);
              this.buckets.value = values[next] ?? "";
            }
            this.applyFilters();
          },
          true,
        ),
      );
    }
    this.tree = new HierarchyView(
      this.t,
      {
        select: (id) => this.select(id),
        hover: (id) => this.scheduleHover(id),
        menu: (id, x, y) => this.run(() => this.showNodeMenu(id, x, y)),
        toggle: (id) =>
          this.run(async () => {
            await this.nodeCall("toggle", { id });
            await this.refreshTree(true);
            await this.refreshDetails(true);
          }),
      },
      this.scope,
    );
    hierarchy.append(
      treeHeader,
      filters,
      treeControls,
      this.attributionControl,
      this.showDrawCallsControl,
      this.bucketControls,
      this.tree.element,
    );
    const separator = document.createElement("div");
    separator.className = "ci-resizer";
    separator.tabIndex = 0;
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-orientation", "vertical");
    separator.setAttribute("aria-label", this.t("resized"));
    separator.setAttribute("aria-valuemin", "20");
    separator.setAttribute("aria-valuemax", "75");
    separator.setAttribute("aria-valuenow", "42");
    let split = 42;
    const resize = (value: number): void => {
      split = Math.max(20, Math.min(75, value));
      workspace.style.setProperty("--tree-width", `${split}%`);
      separator.setAttribute("aria-valuenow", String(Math.round(split)));
    };
    separator.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(split + (event.key === "ArrowLeft" ? -2 : 2));
        }
      },
      { signal: this.shellAbort.signal },
    );
    separator.addEventListener(
      "pointerdown",
      (event) => {
        event.preventDefault();
        separator.setPointerCapture(event.pointerId);
        const drag = new AbortController();
        this.shellAbort.signal.addEventListener("abort", () => drag.abort(), {
          once: true,
        });
        separator.addEventListener(
          "pointermove",
          (move) => {
            const rect = workspace.getBoundingClientRect();
            if (rect.width > 0)
              resize(((move.clientX - rect.left) / rect.width) * 100);
          },
          { signal: drag.signal },
        );
        separator.addEventListener("pointerup", () => drag.abort(), {
          once: true,
          signal: drag.signal,
        });
        separator.addEventListener("pointercancel", () => drag.abort(), {
          once: true,
          signal: drag.signal,
        });
      },
      { signal: this.shellAbort.signal },
    );
    const inspector = document.createElement("section");
    inspector.className = "ci-inspector";
    inspector.setAttribute("aria-label", this.t("inspector"));
    const inspectorHeader = document.createElement("div");
    inspectorHeader.className = "ci-section-header";
    this.inspectorTitle = document.createElement("h2");
    this.inspectorTitle.textContent = this.t("inspector");
    this.actionsButton = this.button(
      "actions",
      async () => {
        if (this.selected) {
          const rect = this.actionsButton.getBoundingClientRect();
          await this.showNodeMenu(this.selected, rect.left, rect.bottom);
        }
      },
      true,
    );
    this.actionsButton.disabled = !this.selected;
    inspectorHeader.append(
      this.inspectorTitle,
      this.actionsButton,
      this.button("refreshProperties", () => this.refreshDetails(true), true),
    );
    const propertiesAuto = this.checkbox(
      "autoProperties",
      this.settings.autoProperties,
      (value) => this.save({ autoProperties: value }),
    );
    this.propertiesAuto = propertiesAuto.input;
    const propertyToolbar = document.createElement("div");
    propertyToolbar.className = "ci-property-toolbar";
    propertyToolbar.append(propertiesAuto.label);
    this.inspectorPath = document.createElement("div");
    this.inspectorPath.className = "ci-selected-path";
    this.inspectorBody = document.createElement("div");
    this.inspectorBody.className = "ci-inspector-body";
    inspector.append(
      inspectorHeader,
      propertyToolbar,
      this.inspectorPath,
      this.inspectorBody,
    );
    workspace.append(hierarchy, separator, inspector);
    const footer = document.createElement("footer");
    footer.className = "ci-footer";
    this.status = document.createElement("span");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    const note = document.createElement("span");
    note.className = "ci-runtime-note";
    note.textContent = this.t("runtimeOnly");
    footer.append(this.status, note);
    this.root.replaceChildren(toolbar, workspace, footer);
    this.renderFrames();
    this.renderSupport();
    if (this.treeSnapshot) {
      this.tree.setSnapshot(this.treeSnapshot);
      this.renderTreeMeta();
      this.tree.setSelected(this.selected, true);
    }
    this.renderDetails();
    this.setStatus(this.t(this.support?.supported ? "ready" : "connecting"));
  }
  private renderFrames(): void {
    this.frameSelect.replaceChildren();
    for (const frame of this.frames) {
      const option = document.createElement("option");
      option.value = String(frame.frameId);
      option.textContent = `${frame.frameId}: ${frame.title || frame.url}`;
      option.title = frame.url;
      this.frameSelect.append(option);
    }
    if (this.frameId !== null) this.frameSelect.value = String(this.frameId);
    this.frameSelect.hidden = this.frames.length < 2;
  }
  private renderSupport(): void {
    this.engineLabel.textContent = this.support?.supported
      ? `${this.t("engine")} ${this.support.engineVersion}`
      : this.t("unsupported");
    this.engineLabel.classList.toggle(
      "is-connected",
      !!this.support?.supported,
    );
    this.engineLabel.title = this.support
      ? `${this.support.sceneName}\n${this.support.capabilities.join(", ")}${this.support.reason ? `\n${this.support.reason}` : ""}`
      : this.t("connecting");
    this.attributionControl.hidden = !this.support?.capabilities.includes(
      "drawCallAttribution",
    );
    this.attributionControl.querySelector("input")!.checked =
      this.drawAttribution;
    this.showDrawCallsControl.hidden = !this.support?.capabilities.includes(
      "drawCallAttribution",
    );
    this.showDrawCallsControl.querySelector("input")!.checked =
      this.showDrawCalls;
    this.pauseButton.hidden =
      !this.support?.capabilities.includes("gameControl");
    this.stepButton.hidden =
      !this.support?.capabilities.includes("gameControl");
  }
  private async connect(): Promise<void> {
    if (this.disposed || !this.visible) return;
    const epoch = this.epoch;
    this.setStatus(this.t("connecting"));
    const frames = await this.client.listFrames();
    if (this.disposed || epoch !== this.epoch) return;
    this.frames = frames;
    if (
      this.frameId === null ||
      !frames.some((frame) => frame.frameId === this.frameId)
    ) {
      this.frameId = frames[0]?.frameId ?? null;
      if (this.frameId !== null) await this.client.selectFrame(this.frameId);
    }
    if (this.disposed || epoch !== this.epoch) return;
    this.renderFrames();
    const support = await this.client.call<EngineSupport>("support");
    if (this.disposed || epoch !== this.epoch) return;
    this.support = support;
    this.renderSupport();
    this.updatePauseButton();
    void this.client
      .call("overlayConfig", { color: this.settings.overlayColor })
      .catch(() => {});
    if (!support.supported) {
      this.treeSnapshot = null;
      this.selected = null;
      this.details = null;
      this.tree.reset();
      this.renderDetails();
      this.setStatus(support.reason || this.t("unsupported"), true);
      return;
    }
    await this.refreshTree(true);
    await this.refreshDetails(true);
    this.setStatus(this.t("ready"));
  }
  private async switchFrame(id: number): Promise<void> {
    if (this.frameId === id) return;
    this.epoch++;
    this.closeMenu();
    this.closeDialog();
    this.treeSnapshot = null;
    this.selected = null;
    this.details = null;
    this.support = null;
    this.pickActive = false;
    this.fpsVisible = null;
    this.drawAttribution = false;
    this.tree.reset();
    this.renderDetails();
    this.renderSupport();
    this.count.textContent = "";
    this.buckets.replaceChildren();
    this.buckets.hidden = true;
    this.bucketControls.hidden = true;
    this.search.value = "";
    this.activeFilter.value = "all";
    this.frameSelect.disabled = true;
    try {
      await this.client.selectFrame(id);
      if (this.disposed) return;
      this.frameId = id;
      this.pickButton.setAttribute("aria-pressed", "false");
      this.fpsButton.setAttribute("aria-pressed", "mixed");
      await this.connect();
    } finally {
      if (!this.disposed) this.frameSelect.disabled = false;
    }
  }
  private async refreshTree(
    manual = false,
    afterCurrent = false,
  ): Promise<void> {
    if (this.disposed || !this.support?.supported || !this.visible) return;
    if (this.treeFlight) {
      const requestEpoch = this.treeEpoch;
      await this.treeFlight;
      if (afterCurrent || requestEpoch !== this.epoch)
        await this.refreshTree(manual);
      return;
    }
    this.treeLast = Date.now();
    const epoch = this.epoch;
    this.treeEpoch = epoch;
    const task = (async () => {
      const snapshot = await this.client.call<TreeSnapshot>("tree", {
        drawCallAttribution: this.drawAttribution,
      });
      if (this.disposed || epoch !== this.epoch) return;
      this.treeSnapshot = snapshot;
      this.tree.setSnapshot(snapshot);
      this.renderTreeMeta();
      if (this.selected && !this.tree.has(this.selected)) {
        this.selected = null;
        this.details = null;
        this.renderDetails();
        this.setStatus(this.t("selectionMissing"));
      }
      this.tree.setSelected(this.selected);
      if (
        this.selected &&
        (!this.details || this.details.generation !== snapshot.generation)
      )
        this.run(() => this.refreshDetails(manual));
      if (snapshot.truncated) this.setStatus(this.t("truncated"));
    })();
    this.treeFlight = task;
    try {
      await task;
    } finally {
      if (this.treeFlight === task) this.treeFlight = null;
    }
  }
  private renderTreeMeta(): void {
    if (!this.treeSnapshot) return;
    this.count.textContent = String(this.treeSnapshot.count);
    this.count.title = this.t("nodeCount");
    const current = this.buckets.value;
    const values = [
      ...new Set(
        this.treeSnapshot.nodes.flatMap((node) =>
          node.drawCall === undefined ? [] : [node.drawCall],
        ),
      ),
    ].sort((a, b) => a - b);
    this.buckets.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = this.t("allDrawCalls");
    this.buckets.append(all);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${this.t("bucket")} ${value}`;
      this.buckets.append(option);
    }
    this.buckets.hidden = values.length === 0;
    this.bucketControls.hidden = values.length === 0;
    this.buckets.value =
      values.includes(Number(current)) && current !== "" ? current : "";
    this.applyFilters();
  }
  private applyFilters(): void {
    this.tree.setFilter(
      this.search.value,
      this.activeFilter.value,
      this.buckets.value,
    );
  }
  private select(id: string): void {
    if (!this.tree.has(id)) return;
    const changed = this.selected !== id;
    this.selected = id;
    this.tree.setSelected(id);
    this.actionsButton.disabled = false;
    if (changed) {
      this.details = null;
      this.currentDetailsId = null;
      this.inspectorBody.scrollTop = 0;
      this.renderDetails();
    }
    if (this.settings.selectionHighlight)
      this.run(async () => {
        await this.nodeCall("select", {
          id,
          color: this.settings.overlayColor,
        });
      });
    this.run(() => this.refreshDetails(true));
  }
  private async refreshDetails(
    manual = false,
    afterCurrent = false,
  ): Promise<void> {
    if (this.disposed || !this.selected || !this.treeSnapshot || !this.visible)
      return;
    const focused = document.activeElement;
    if (
      !manual &&
      (this.propertyView?.hasOpenMenu ||
        Boolean(document.querySelector(".ci-dropdown-menu")) ||
        (this.inspectorBody.contains(focused) &&
          (focused instanceof HTMLInputElement ||
            focused instanceof HTMLTextAreaElement ||
            focused instanceof HTMLSelectElement)))
    )
      return;
    if (this.detailsFlight) {
      const request = this.detailsRequest;
      await this.detailsFlight;
      if (
        this.selected &&
        this.treeSnapshot &&
        (afterCurrent ||
          !request ||
          request.id !== this.selected ||
          request.generation !== this.treeSnapshot.generation ||
          request.epoch !== this.epoch)
      )
        await this.refreshDetails(manual);
      return;
    }
    this.propertiesLast = Date.now();
    const id = this.selected;
    const epoch = this.epoch;
    const generation = this.treeSnapshot.generation;
    this.detailsRequest = { id, generation, epoch };
    const task = (async () => {
      const details = await this.client.call<NodeDetails>(
        "inspect",
        { id },
        generation,
      );
      if (
        this.disposed ||
        epoch !== this.epoch ||
        id !== this.selected ||
        generation !== this.treeSnapshot?.generation
      )
        return;
      this.details = details;
      this.renderDetails();
    })();
    this.detailsFlight = task;
    try {
      await task;
    } finally {
      if (this.detailsFlight === task) this.detailsFlight = null;
    }
  }
  private renderDetails(): void {
    const isSameNode = this.currentDetailsId === this.details?.id;
    const prevScroll = isSameNode ? this.inspectorBody.scrollTop : 0;
    this.currentDetailsId = this.details?.id ?? null;

    const expanded = this.propertyView?.expandedPaths;
    const collapsedGroups = this.propertyView?.collapsedGroupIds;
    this.propertyView?.dispose();
    this.propertyView = null;
    this.inspectorBody.replaceChildren();
    this.actionsButton.disabled = !this.selected;
    this.inspectorTitle.textContent = this.details?.name ?? this.t("inspector");
    this.inspectorPath.textContent = this.details?.path ?? "";
    this.inspectorPath.title = this.details?.path ?? "";
    if (!this.details) {
      const empty = document.createElement("div");
      empty.className = "ci-empty";
      empty.textContent = this.t(this.selected ? "loading" : "selectNode");
      this.inspectorBody.append(empty);
      this.inspectorBody.scrollTop = 0;
      return;
    }
    const details = this.details;
    const epoch = this.epoch;
    this.propertyView = new PropertyView(
      details,
      {
        t: this.t,
        call: <T>(
          command: Command,
          args: Record<string, unknown> = {},
        ): Promise<T> => {
          if (this.disposed || epoch !== this.epoch)
            return Promise.reject(new Error(this.t("stale")));
          return this.client.call<T>(
            command,
            { id: details.id, ...args },
            details.generation,
          );
        },
        run: (operation) => this.run(operation),
        changed: () => this.refreshDetails(true, true),
        preview: (url, title) => this.showImage(url, title),
      },
      expanded,
      collapsedGroups,
    );
    this.inspectorBody.append(this.propertyView.element);
    if (isSameNode && prevScroll > 0) {
      this.inspectorBody.scrollTop = prevScroll;
      requestAnimationFrame(() => {
        if (this.currentDetailsId === details.id) {
          this.inspectorBody.scrollTop = prevScroll;
        }
      });
    } else if (!isSameNode) {
      this.inspectorBody.scrollTop = 0;
    }
  }
  private updatePauseButton(): void {
    if (!this.pauseButton) return;
    this.pauseButton.textContent = this.isPaused
      ? `▶ ${this.t("resume")}`
      : `⏸ ${this.t("pause")}`;
    this.pauseButton.setAttribute("aria-pressed", String(this.isPaused));
    this.pauseButton.title = this.t("pauseHelp");
    if (this.stepButton) {
      this.stepButton.disabled = !this.isPaused;
      this.stepButton.title = this.isPaused
        ? this.t("stepHelpPaused")
        : this.t("stepHelp");
    }
  }
  private async togglePause(): Promise<void> {
    const nextCommand = this.isPaused ? "gameResume" : "gamePause";
    const res = await this.client.call<{ paused: boolean }>(nextCommand);
    this.isPaused = !!res?.paused;
    this.updatePauseButton();
  }
  private async stepRun(): Promise<void> {
    await this.client.call("gameStep");
    if (this.drawAttribution) await this.refreshTree(true);
    await this.refreshDetails(true);
  }
  private async nodeCall<T = unknown>(
    command: Command,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.treeSnapshot) throw new Error(this.t("stale"));
    return this.client.call<T>(
      command,
      { id: this.selected, ...args },
      this.treeSnapshot.generation,
    );
  }
  private scheduleHover(id: string | null): void {
    if (!this.settings.hoverHighlight && id !== null) return;
    this.hoverTarget = id;
    window.clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(
      () => {
        this.hoverTimer = undefined;
        this.run(() => this.flushHover());
      },
      id === null ? 0 : 120,
    );
  }
  private async flushHover(): Promise<void> {
    if (this.hoverBusy || !this.treeSnapshot || this.disposed || !this.visible)
      return;
    this.hoverBusy = true;
    const id = this.hoverTarget;
    try {
      await this.nodeCall("hover", { id, color: this.settings.overlayColor });
    } finally {
      this.hoverBusy = false;
      if (id !== this.hoverTarget && !this.disposed)
        this.scheduleHover(this.hoverTarget);
    }
  }
  private async setPick(enabled: boolean): Promise<void> {
    await this.client.call(enabled ? "pick" : "cancelPick");
    if (this.disposed) return;
    this.pickActive = enabled;
    this.pickButton.setAttribute("aria-pressed", String(enabled));
  }
  private async showNodeMenu(id: string, x: number, y: number): Promise<void> {
    this.closeMenu();
    if (this.selected !== id) this.select(id);
    if (this.details?.id !== id) {
      await this.refreshDetails(true);
      if (this.details?.id !== id) return;
    }
    if (this.disposed || this.selected !== id) return;
    this.closeMenu();
    this.menuAbort = new AbortController();
    const signal = this.menuAbort.signal;
    const details = this.details;
    const menu = document.createElement("div");
    menu.className = "ci-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", this.t("actions"));
    const add = (
      key: MessageKey,
      action: () => Promise<void>,
      suffix = "",
    ): void => {
      const button = this.button(
        key,
        async () => {
          this.closeMenu();
          await action();
        },
        false,
        signal,
      );
      button.setAttribute("role", "menuitem");
      if (suffix) button.textContent = `${this.t(key)}: ${suffix}`;
      menu.append(button);
    };
    add("refreshTree", () => this.refreshTree(true));
    add("log", async () => {
      await this.nodeCall("log", { id });
    });
    add("logPath", async () => {
      await this.nodeCall("logPath", { id });
    });
    add("copyName", async () => {
      await navigator.clipboard.writeText(details.name);
      this.setStatus(this.t("copied"));
    });
    add("copyPath", async () => {
      await navigator.clipboard.writeText(details.path);
      this.setStatus(this.t("copied"));
    });
    add("toggle", async () => {
      await this.nodeCall("toggle", { id });
      await this.refreshTree(true);
      await this.refreshDetails(true);
    });
    add("destroy", async () => {
      this.confirmDestroy(id);
    });
    if (this.tree.node(id)?.prefab)
      add("openPrefab", async () => {
        await this.nodeCall("openPrefab", { id });
      });
    for (const script of details.scripts)
      add(
        "inspectScript",
        async () => {
          await this.nodeCall("inspectScript", { id, index: script.index });
        },
        script.name,
      );
    for (const handler of details.handlers)
      add(
        "inspectHandler",
        async () => {
          await this.nodeCall("inspectHandler", { id, index: handler.index });
        },
        `${handler.event} · ${handler.name}`,
      );
    for (const event of details.breakpointEvents)
      add(
        "breakOn",
        async () => {
          await this.nodeCall("breakOn", { id, event });
          this.setStatus(this.t("operationComplete"));
        },
        event,
      );
    add("clearBreakpoints", async () => {
      await this.nodeCall("clearBreakpoints", { id });
      this.setStatus(this.t("operationComplete"));
    });
    menu.addEventListener(
      "keydown",
      (event) => {
        const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button")];
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          buttons[
            (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) %
              buttons.length
          ]?.focus();
        } else if (event.key === "Escape") {
          event.preventDefault();
          this.closeMenu();
          this.tree.element.focus();
        }
      },
      { signal },
    );
    this.menu = menu;
    this.root.append(menu);
    const rootRect = this.root.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x - rootRect.left, rootRect.width - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y - rootRect.top, rootRect.height - menu.offsetHeight - 4))}px`;
    menu.querySelector<HTMLButtonElement>("button")?.focus();
  }
  private closeMenu(): void {
    this.menuAbort?.abort();
    this.menuAbort = null;
    this.menu?.remove();
    this.menu = null;
  }
  private openDialog(title: string): HTMLDialogElement {
    this.closeDialog();
    this.dialogAbort = new AbortController();
    const dialog = document.createElement("dialog");
    dialog.className = "ci-dialog";
    const heading = document.createElement("div");
    heading.className = "ci-dialog-heading";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const close = this.button(
      "close",
      () => this.closeDialog(),
      false,
      this.dialogAbort.signal,
    );
    heading.append(h2, close);
    dialog.append(heading);
    this.root.append(dialog);
    this.dialog = dialog;
    dialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        this.closeDialog();
      },
      { signal: this.dialogAbort.signal },
    );
    dialog.showModal();
    return dialog;
  }
  private closeDialog(): void {
    this.dialogAbort?.abort();
    this.dialogAbort = null;
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = null;
    }
  }
  private confirmDestroy(id: string): void {
    const generation = this.treeSnapshot?.generation;
    const epoch = this.epoch;
    const dialog = this.openDialog(this.t("destroy"));
    const warning = document.createElement("p");
    warning.textContent = this.t("destroyConfirm");
    const name = document.createElement("code");
    name.textContent = this.tree.path(id);
    const actions = document.createElement("div");
    actions.className = "ci-dialog-actions";
    const signal = this.dialogAbort!.signal;
    const cancel = this.button(
      "cancel",
      () => this.closeDialog(),
      false,
      signal,
    );
    const confirm = this.button(
      "confirm",
      async () => {
        if (
          this.epoch !== epoch ||
          generation === undefined ||
          generation !== this.treeSnapshot?.generation
        )
          throw new Error(this.t("stale"));
        await this.client.call("destroy", { id }, generation);
        this.closeDialog();
        if (this.selected === id) {
          this.selected = null;
          this.details = null;
          this.renderDetails();
        }
        await this.refreshTree(true);
      },
      false,
      signal,
    );
    confirm.className = "ci-danger";
    actions.append(cancel, confirm);
    dialog.append(warning, name, actions);
    cancel.focus();
  }
  private showSettings(): void {
    const dialog = this.openDialog(this.t("settings"));
    const signal = this.dialogAbort!.signal;
    const form = document.createElement("div");
    form.className = "ci-settings-form";
    const languageLabel = document.createElement("label");
    languageLabel.textContent = this.t("language");
    const language = document.createElement("select");
    for (const locale of Object.keys(localeNames) as Locale[]) {
      const option = document.createElement("option");
      option.value = locale;
      option.textContent = localeNames[locale];
      language.append(option);
    }
    language.value = this.settings.locale;
    language.addEventListener(
      "change",
      () => this.save({ locale: language.value as Locale }),
      { signal },
    );
    languageLabel.append(language);
    form.append(languageLabel);
    const intervalLabel = document.createElement("label");
    intervalLabel.textContent = this.t("refreshMs");
    const interval = document.createElement("input");
    interval.type = "number";
    interval.min = "250";
    interval.max = "10000";
    interval.step = "250";
    interval.value = String(this.settings.refreshMs);
    interval.addEventListener(
      "change",
      () => {
        const value = Number(interval.value);
        if (!Number.isFinite(value)) {
          this.setStatus(this.t("invalidNumber"), true);
          return;
        }
        const refreshMs = Math.min(10000, Math.max(250, Math.round(value)));
        interval.value = String(refreshMs);
        this.save({ refreshMs });
      },
      { signal },
    );
    intervalLabel.append(interval);
    form.append(intervalLabel);
    for (const key of [
      "autoTree",
      "autoProperties",
      "hoverHighlight",
      "selectionHighlight",
    ] as const)
      form.append(
        this.checkbox(
          key,
          this.settings[key],
          (value) => this.save({ [key]: value }),
          signal,
        ).label,
      );
    const colorLabel = document.createElement("label");
    colorLabel.className = "ci-settings-color-row";
    const colorTitle = document.createElement("span");
    colorTitle.textContent = this.t("overlayColor");
    colorTitle.title = this.t("overlayColorHelp");

    const colorControls = document.createElement("div");
    colorControls.className = "ci-settings-color-controls";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "ci-settings-color";
    colorInput.value = this.settings.overlayColor;

    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.className = "ci-settings-color-hex";
    hexInput.value = this.settings.overlayColor.toUpperCase();
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;

    let saveTimeout: number | undefined;
    const saveColor = (val: string) => {
      let h = val.trim();
      if (!h.startsWith("#")) h = "#" + h;
      if (/^#[0-9a-fA-F]{6}$/.test(h)) {
        colorInput.value = h;
        hexInput.value = h.toUpperCase();
        this.settings.overlayColor = h;
        window.clearTimeout(saveTimeout);
        saveTimeout = window.setTimeout(() => {
          this.save({ overlayColor: h });
        }, 120);
      }
    };

    colorInput.addEventListener("input", () => saveColor(colorInput.value), {
      signal,
    });
    colorInput.addEventListener(
      "change",
      () => {
        window.clearTimeout(saveTimeout);
        saveColor(colorInput.value);
      },
      { signal },
    );
    hexInput.addEventListener(
      "input",
      () => {
        if (/^#?[0-9a-fA-F]{6}$/.test(hexInput.value.trim())) {
          saveColor(hexInput.value);
        }
      },
      { signal },
    );
    hexInput.addEventListener(
      "change",
      () => {
        window.clearTimeout(saveTimeout);
        saveColor(hexInput.value);
      },
      { signal },
    );

    colorControls.append(colorInput, hexInput);
    colorLabel.append(colorTitle, colorControls);
    form.append(colorLabel);
    const help = document.createElement("p");
    help.className = "ci-muted";
    help.textContent = this.t("refreshHelp");
    dialog.append(form, help);
  }
  private save(patch: Partial<Settings>): void {
    this.settingsQueue = this.settingsQueue
      .then(async () => {
        const settings = normalizeSettings(
          await this.client.saveSettings(patch),
        );
        if (this.disposed) return;
        const localeChanged = settings.locale !== this.settings.locale;
        this.settings = settings;
        this.treeAuto.checked = settings.autoTree;
        this.propertiesAuto.checked = settings.autoProperties;
        if (!settings.hoverHighlight) this.scheduleHover(null);
        if (!settings.selectionHighlight && this.treeSnapshot)
          await this.nodeCall("select", { id: null });
        if (localeChanged) this.renderShell();
        this.startTimer();
        if (patch.overlayColor) {
          void this.client
            .call("overlayConfig", { color: patch.overlayColor })
            .catch(() => {});
          if (this.selected && this.settings.selectionHighlight) {
            void this.nodeCall("select", {
              id: this.selected,
              color: patch.overlayColor,
            }).catch(() => {});
          }
        }
        this.setStatus(this.t("saved"));
      })
      .catch((error) => this.reportError(error));
  }
  private async showGameInfo(): Promise<void> {
    const epoch = this.epoch;
    const info = await this.client.call<GameInfo>("gameInfo");
    if (this.disposed || epoch !== this.epoch) return;
    this.fpsVisible = info.fpsVisible;
    this.fpsButton.setAttribute("aria-pressed", String(info.fpsVisible));
    const dialog = this.openDialog(this.t("gameInfo"));
    const signal = this.dialogAbort!.signal;
    const grid = document.createElement("dl");
    grid.className = "ci-info-grid";
    const add = (key: MessageKey, value: unknown): void => {
      const term = document.createElement("dt");
      term.textContent = this.t(key);
      const desc = document.createElement("dd");
      desc.textContent =
        value === null || value === undefined
          ? this.t("unavailable")
          : typeof value === "boolean"
            ? this.t(value ? "enabled" : "disabled")
            : String(value);
      grid.append(term, desc);
    };
    add("engine", info.engineVersion);
    add("drawCalls", info.drawCalls);
    add("nodeCount", info.nodes);
    add("cachedObjects", info.cachedObjects);
    add("dynamicAtlas", info.dynamicAtlas?.enabled);
    if (info.dynamicAtlas) {
      const atlas = info.dynamicAtlas;
      add("atlasCount", atlas.atlasCount);
      add("maxAtlasCount", atlas.maxAtlasCount);
      add("maxFrameSize", atlas.maxFrameSize);
      add("textureSize", atlas.textureSize);
      add("textureBleeding", atlas.textureBleeding);
    }
    dialog.append(grid);
    if (
      info.dynamicAtlas &&
      this.support?.capabilities.includes("atlasToggle")
    ) {
      let initial = info.dynamicAtlas.enabled;
      const toggle = this.checkbox(
        "enabled",
        initial,
        (value) =>
          this.run(async () => {
            toggle.input.disabled = true;
            try {
              const result = await this.client.call<{ enabled?: boolean }>(
                "atlas",
                { enabled: value },
              );
              const actual =
                typeof result.enabled === "boolean"
                  ? result.enabled
                  : (await this.client.call<GameInfo>("gameInfo")).dynamicAtlas
                      ?.enabled;
              if (actual === undefined)
                throw new Error(this.t("unsupportedAction"));
              toggle.input.checked = actual;
              initial = actual;
            } catch (error) {
              toggle.input.checked = initial;
              throw error;
            } finally {
              if (toggle.input.isConnected) toggle.input.disabled = false;
            }
          }),
        signal,
      );
      dialog.append(toggle.label);
    }
    if (info.dynamicAtlas?.canView) {
      const actions = document.createElement("div");
      actions.className = "ci-dialog-actions";
      actions.append(
        this.button(
          "showAtlas",
          async () => {
            await this.client.call("atlas", { visible: true });
          },
          false,
          signal,
        ),
        this.button(
          "hideAtlas",
          async () => {
            await this.client.call("atlas", { visible: false });
          },
          false,
          signal,
        ),
      );
      dialog.append(actions);
    }
  }
  private showImage(url: string, title: string): void {
    const parsed = new URL(url, location.href);
    if (!["data:", "blob:"].includes(parsed.protocol))
      throw new Error(this.t("noImage"));
    const dialog = this.openDialog(`${this.t("preview")}: ${title}`);
    const image = document.createElement("img");
    image.className = "ci-image-preview";
    image.alt = title;
    image.addEventListener(
      "error",
      () => this.setStatus(this.t("noImage"), true),
      { once: true, signal: this.dialogAbort!.signal },
    );
    image.src = url;
    dialog.append(image);
  }
  private startTimer(): void {
    window.clearInterval(this.timer);
    if (this.disposed || !this.visible) return;
    this.timer = window.setInterval(
      () => {
        if (this.disposed || !this.visible || !this.support?.supported) return;
        const now = Date.now();
        if (
          this.settings.autoTree &&
          now - this.treeLast >= this.settings.refreshMs
        )
          this.run(() => this.refreshTree());
        if (
          this.settings.autoProperties &&
          now - this.propertiesLast >= this.settings.refreshMs
        )
          this.run(() => this.refreshDetails());
      },
      Math.max(250, this.settings.refreshMs),
    );
  }
  private updateVisibility(): void {
    const visible = !document.hidden && this.intersecting && this.panelVisible;
    if (this.visible === visible || this.disposed) return;
    this.visible = visible;
    this.client.setVisible(visible);
    if (!visible) {
      window.clearInterval(this.timer);
      window.clearTimeout(this.hoverTimer);
      this.hoverTarget = null;
      if (this.pickActive) this.run(() => this.setPick(false));
    } else if (this.settingsReady) {
      this.startTimer();
      this.run(async () => {
        if (!this.support) await this.connect();
        else if (!this.treeSnapshot || this.drawAttribution)
          await this.refreshTree(true);
        if (
          this.selected &&
          this.treeSnapshot &&
          this.settings.selectionHighlight &&
          this.visible
        )
          await this.nodeCall("select", { id: this.selected });
      });
    }
  }
  private event(event: RuntimeEvent): void {
    if (this.disposed) return;
    if (event.type === "picked") {
      this.pickActive = false;
      this.pickButton.setAttribute("aria-pressed", "false");
      const data = event.data;
      const id =
        typeof data === "string"
          ? data
          : data && typeof data === "object" && "id" in data
            ? String(data.id)
            : null;
      if (id)
        this.run(async () => {
          if (!this.tree.has(id)) await this.refreshTree(true);
          if (this.tree.has(id)) {
            this.tree.setSelected(id, true);
            this.select(id);
          }
        });
    } else if (event.type === "sceneChanged") {
      if (this.support?.supported || this.treeSnapshot) {
        this.epoch++;
        this.closeMenu();
        this.closeDialog();
        this.details = null;
        this.treeSnapshot = null;
        this.propertyView?.dispose();
        this.propertyView = null;
        this.renderDetails();
        this.run(() => this.refreshTree(true));
      }
    } else if (event.type === "detached") {
      this.epoch++;
      this.closeMenu();
      this.closeDialog();
      this.support = null;
      this.treeSnapshot = null;
      this.selected = null;
      this.details = null;
      this.pickActive = false;
      this.fpsVisible = null;
      this.drawAttribution = false;
      this.tree.reset();
      this.renderDetails();
      this.renderSupport();
      this.count.textContent = "";
      this.buckets.replaceChildren();
      this.buckets.hidden = true;
      this.bucketControls.hidden = true;
      this.pickButton.setAttribute("aria-pressed", "false");
      this.fpsButton.setAttribute("aria-pressed", "mixed");
      this.setStatus(this.t("disconnected"), true);
    } else if (event.type === "status") {
      const data = event.data;
      if (typeof data === "string") this.setStatus(data);
      else if (
        data &&
        typeof data === "object" &&
        "message" in data &&
        typeof data.message === "string"
      )
        this.setStatus(data.message);
    }
  }
  private setStatus(text: string, error = false): void {
    if (this.disposed) return;
    this.status.textContent = text;
    this.status.title = text;
    this.status.classList.toggle("ci-error", error);
  }
  private reportError(error: unknown): void {
    if (this.disposed) return;
    const record =
      error && typeof error === "object"
        ? (error as { code?: unknown; message?: unknown })
        : {};
    const message =
      typeof record.message === "string"
        ? record.message
        : this.t("errorGeneric");
    const code =
      typeof record.code === "string"
        ? record.code
        : (/\b(?:E_)?(?:STALE_DOCUMENT|STALE_GENERATION|INVALID_NODE|INVALID_COMPONENT|NODE_NOT_FOUND|NOT_FOUND|DISCONNECTED|UNSUPPORTED|READ_ONLY)\b/.exec(
            message,
          )?.[0] ?? "");
    const localized = errorKeys[code] ? this.t(errorKeys[code]) : message;
    this.setStatus(`${code ? `[${code}] ` : ""}${localized}`, true);
    if (
      /STALE|GENERATION|SCENE_CHANGED|INVALID_NODE|INVALID_COMPONENT/.test(code)
    ) {
      this.epoch++;
      this.details = null;
      this.treeSnapshot = null;
      this.renderDetails();
      this.run(() => this.refreshTree(true));
    }
  }
  private run(operation: () => Promise<void>): void {
    if (!this.disposed)
      void operation().catch((error) => this.reportError(error));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.abort.abort();
    this.shellAbort.abort();
    this.unsubscribe();
    this.visibilityObserver.disconnect();
    window.clearInterval(this.timer);
    window.clearTimeout(this.hoverTimer);
    this.client.setVisible(false);
    this.tree.dispose();
    this.propertyView?.dispose();
    this.propertyView = null;
    this.closeMenu();
    this.closeDialog();
    this.treeSnapshot = null;
    this.details = null;
    this.support = null;
    this.frames = [];
    this.selected = null;
    this.root.replaceChildren();
    this.root.classList.remove("ci-root", "ci-floating");
  }
}
