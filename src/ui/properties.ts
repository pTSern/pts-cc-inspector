import type {
  Command,
  Json,
  NodeDetails,
  Property,
  PropertyGroup,
} from "../shared/protocol";
import type { MessageKey } from "../locales";
import { renderWidgetComponent } from "./widget";

export interface PropertyContext {
  t(key: MessageKey): string;
  call<T = unknown>(
    command: Command,
    args?: Record<string, unknown>,
  ): Promise<T>;
  run(operation: () => Promise<void>): void;
  changed(): Promise<void>;
  preview(url: string, title: string): void;
}

export class PropertyView {
  readonly element = document.createElement("div");
  private readonly abort = new AbortController();
  private readonly expanded = new Set<string>();
  private readonly collapsedGroups = new Set<string>();
  private activeMenu: HTMLElement | null = null;

  constructor(
    private readonly details: NodeDetails,
    private readonly context: PropertyContext,
    expanded?: Set<string>,
    collapsedGroupIds?: Set<string>,
  ) {
    if (expanded) this.expanded = new Set(expanded);
    if (collapsedGroupIds) this.collapsedGroups = new Set(collapsedGroupIds);
    this.element.className = "ci-property-view";

    for (const group of details.groups) {
      const section = document.createElement("details");
      section.className = "ci-property-group";
      section.open = !this.collapsedGroups.has(group.id);
      section.addEventListener(
        "toggle",
        () => {
          if (section.open) this.collapsedGroups.delete(group.id);
          else this.collapsedGroups.add(group.id);
        },
        { signal: this.abort.signal },
      );

      const heading = document.createElement("summary");
      heading.className = "ci-group-summary";

      if (group.kind === "component") {
        const titleBtn = document.createElement("button");
        titleBtn.type = "button";
        titleBtn.className = "ci-component-title-btn";
        titleBtn.textContent = group.name;
        titleBtn.title = "Click for component options";
        titleBtn.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showComponentMenu(group, titleBtn);
          },
          { signal: this.abort.signal },
        );
        heading.append(titleBtn);
      } else {
        const titleSpan = document.createElement("span");
        titleSpan.className = "ci-group-title";
        titleSpan.textContent = group.name;
        heading.append(titleSpan);
      }

      const badge = document.createElement("span");
      badge.className = "ci-badge";
      badge.textContent = context.t(
        group.kind === "node" ? "inspector" : "components",
      );
      heading.append(badge);
      section.append(heading);

      if (group.name === "cc.Widget" || group.name === "Widget") {
        section.append(
          renderWidgetComponent(group, context, this.abort.signal),
        );
      } else {
        if (!group.properties.length) {
          const empty = document.createElement("p");
          empty.className = "ci-muted";
          empty.textContent = context.t("noProperties");
          section.append(empty);
        }
        for (const property of group.properties)
          section.append(this.property(property));
      }

      this.element.append(section);
    }

    if (details.animations.length) {
      const section = document.createElement("section");
      section.className = "ci-debug-section";
      const heading = document.createElement("h3");
      heading.textContent = context.t("animations");
      section.append(heading);
      for (const animation of details.animations) {
        const row = document.createElement("div");
        row.className = "ci-animation-row";
        const select = document.createElement("select");
        select.setAttribute("aria-label", context.t("clip"));
        for (const clip of animation.clips) {
          const option = document.createElement("option");
          option.value = clip;
          option.textContent = clip;
          select.append(option);
        }
        select.disabled = animation.clips.length === 0;
        const label = document.createElement("span");
        label.className = "ci-muted";
        label.textContent = animation.id;
        const play = this.button("play", async () => {
          await context.call("animationPlay", {
            componentId: animation.id,
            clip: select.value,
          });
        });
        play.disabled = !animation.clips.length;
        const stop = this.button("stop", async () => {
          await context.call("animationStop", { componentId: animation.id });
        });
        row.append(label, select, play, stop);
        section.append(row);
      }
      this.element.append(section);
    }

    // Only render event handlers in debug section (scripts are accessible directly from component header)
    if (details.handlers.length) {
      const section = document.createElement("section");
      section.className = "ci-debug-section";
      const heading = document.createElement("h3");
      heading.textContent = context.t("handlers");
      section.append(heading);
      for (const item of details.handlers) {
        const button = this.button("inspectHandler", async () => {
          await context.call("inspectHandler", { index: item.index });
        });
        button.className = "ci-target-button";
        button.textContent = `${context.t("inspectHandler")}: ${item.name} · ${item.event}`;
        section.append(button);
      }
      this.element.append(section);
    }
  }

  get expandedPaths(): Set<string> {
    return this.expanded;
  }

  get collapsedGroupIds(): Set<string> {
    return this.collapsedGroups;
  }

  private closeActiveMenu(): void {
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
  }

  private mountDropdown(menu: HTMLElement, anchor: HTMLElement): void {
    this.closeActiveMenu();
    this.activeMenu = menu;
    document.body.append(menu);

    const rect = anchor.getBoundingClientRect();
    const menuWidth = 170;
    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.zIndex = "2147483647";

    const onPointer = (e: Event): void => {
      if (
        !menu.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      ) {
        this.closeActiveMenu();
        window.removeEventListener("pointerdown", onPointer, true);
      }
    };
    window.addEventListener("pointerdown", onPointer, true);
    this.abort.signal.addEventListener("abort", () => this.closeActiveMenu(), {
      once: true,
    });
  }

  private showComponentMenu(group: PropertyGroup, anchor: HTMLElement): void {
    const menu = document.createElement("div");
    menu.className = "ci-dropdown-menu";

    const script = this.details.scripts.find((s) => s.name === group.name);
    if (script) {
      const inspectItem = document.createElement("button");
      inspectItem.type = "button";
      inspectItem.className = "ci-menu-item";
      inspectItem.textContent = this.context.t("inspectScript");
      inspectItem.addEventListener(
        "click",
        () => {
          this.closeActiveMenu();
          this.context.run(async () => {
            await this.context.call("inspectScript", { index: script.index });
          });
        },
        { signal: this.abort.signal },
      );
      menu.append(inspectItem);
    }

    const logItem = document.createElement("button");
    logItem.type = "button";
    logItem.className = "ci-menu-item";
    logItem.textContent = this.context.t("logComponent");
    logItem.addEventListener(
      "click",
      () => {
        this.closeActiveMenu();
        this.context.run(async () => {
          await this.context.call("log", { path: [group.id] });
        });
      },
      { signal: this.abort.signal },
    );
    menu.append(logItem);

    const copyItem = document.createElement("button");
    copyItem.type = "button";
    copyItem.className = "ci-menu-item";
    copyItem.textContent = this.context.t("copyComponent");
    copyItem.addEventListener(
      "click",
      () => {
        this.closeActiveMenu();
        navigator.clipboard.writeText(group.name);
      },
      { signal: this.abort.signal },
    );
    menu.append(copyItem);

    this.mountDropdown(menu, anchor);
  }

  private showPropertyMenu(
    property: Property,
    anchor: HTMLElement,
    toggleExpand?: () => void,
    isExpanded?: boolean,
  ): void {
    const menu = document.createElement("div");
    menu.className = "ci-dropdown-menu";

    if (property.expandable || property.children) {
      const expandItem = document.createElement("button");
      expandItem.type = "button";
      expandItem.className = "ci-menu-item";
      expandItem.textContent = this.context.t(
        isExpanded ? "collapse" : "expand",
      );
      expandItem.addEventListener(
        "click",
        () => {
          this.closeActiveMenu();
          toggleExpand?.();
        },
        { signal: this.abort.signal },
      );
      menu.append(expandItem);
    }

    const logItem = document.createElement("button");
    logItem.type = "button";
    logItem.className = "ci-menu-item";
    logItem.textContent = this.context.t("log");
    logItem.addEventListener(
      "click",
      () => {
        this.closeActiveMenu();
        this.context.run(async () => {
          await this.context.call("log", { path: property.path });
        });
      },
      { signal: this.abort.signal },
    );
    menu.append(logItem);

    const copyPathItem = document.createElement("button");
    copyPathItem.type = "button";
    copyPathItem.className = "ci-menu-item";
    copyPathItem.textContent = this.context.t("copyPath");
    copyPathItem.addEventListener(
      "click",
      () => {
        this.closeActiveMenu();
        navigator.clipboard.writeText(property.path.join("."));
      },
      { signal: this.abort.signal },
    );
    menu.append(copyPathItem);

    const copyValItem = document.createElement("button");
    copyValItem.type = "button";
    copyValItem.className = "ci-menu-item";
    copyValItem.textContent = this.context.t("copyValue");
    copyValItem.addEventListener(
      "click",
      () => {
        this.closeActiveMenu();
        navigator.clipboard.writeText(JSON.stringify(property.value));
      },
      { signal: this.abort.signal },
    );
    menu.append(copyValItem);

    this.mountDropdown(menu, anchor);
  }

  private button(
    key: MessageKey,
    action: () => Promise<void>,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = this.context.t(key);
    button.addEventListener(
      "click",
      () =>
        this.context.run(async () => {
          button.disabled = true;
          try {
            await action();
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }),
      { signal: this.abort.signal },
    );
    return button;
  }

  private property(property: Property, depth = 0): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "ci-property-wrap";

    const row = document.createElement("div");
    row.className = "ci-property-row";
    row.style.setProperty("--property-depth", String(Math.min(depth, 12)));

    const path = property.path;
    const keyPath = JSON.stringify(path);
    const isExpandable = !!(property.expandable || property.children);
    const isExpanded = this.expanded.has(keyPath);

    // Make property name a button that shows dropdown on click and displays tooltip on hover
    const labelBtn = document.createElement("button");
    labelBtn.type = "button";
    labelBtn.className = "ci-property-name-btn";
    if (property.reason) {
      labelBtn.title = property.reason;
      labelBtn.classList.add("has-reason");
    } else {
      labelBtn.title = property.path.join(".");
    }

    if (isExpandable) {
      const chevron = document.createElement("span");
      chevron.className = "ci-prop-chevron";
      chevron.textContent = isExpanded ? "▾" : "▸";
      labelBtn.append(chevron);
    }

    const isArrayIndex = /^\d+$/.test(property.key);
    const nameSpan = document.createElement("span");
    nameSpan.className = isArrayIndex
      ? "ci-prop-name ci-array-index"
      : "ci-prop-name";
    nameSpan.textContent = isArrayIndex ? `[${property.key}]` : property.label;
    labelBtn.append(nameSpan);

    if (property.readOnly) {
      const lock = document.createElement("span");
      lock.className = "ci-readonly";
      lock.textContent = "◇";
      lock.setAttribute("aria-label", this.context.t("readonly"));
      labelBtn.append(lock);
    }

    let toggleExpandFn: (() => Promise<void>) | undefined;

    labelBtn.addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showPropertyMenu(
          property,
          labelBtn,
          toggleExpandFn,
          this.expanded.has(keyPath),
        );
      },
      { signal: this.abort.signal },
    );

    if (isExpandable) {
      labelBtn.addEventListener(
        "dblclick",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleExpandFn?.();
        },
        { signal: this.abort.signal },
      );
    }

    const control = document.createElement("div");
    control.className = "ci-property-control";

    const commit = async (value: Json): Promise<void> => {
      await this.context.call("set", { path, value });
      await this.context.changed();
    };

    const disable = <
      T extends
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | HTMLButtonElement,
    >(
      input: T,
    ): T => {
      input.disabled = property.readOnly;
      input.title = property.readOnly
        ? (property.reason ?? this.context.t("readonly"))
        : property.path.join(".");
      input.setAttribute("aria-label", property.label);
      return input;
    };

    if (property.type === "boolean") {
      const input = disable(document.createElement("input"));
      input.type = "checkbox";
      input.checked = property.value === true;
      input.addEventListener(
        "change",
        () => this.context.run(() => commit(input.checked)),
        { signal: this.abort.signal },
      );
      control.append(input);
    } else if (property.type === "number") {
      const input = disable(document.createElement("input"));
      input.type = "number";
      input.value = String(property.value);
      input.step = String(property.step ?? "any");
      if (property.min !== undefined) input.min = String(property.min);
      if (property.max !== undefined) input.max = String(property.max);
      const save = (): void =>
        this.context.run(async () => {
          const value = input.value === "" ? NaN : Number(input.value);
          if (!Number.isFinite(value))
            throw new Error(this.context.t("invalidNumber"));
          await commit(value);
        });
      input.addEventListener("change", save, { signal: this.abort.signal });
      control.append(input);
      if (
        !property.readOnly &&
        typeof property.value === "number" &&
        Number.isFinite(property.value)
      ) {
        labelBtn.classList.add("ci-draggable");
        labelBtn.addEventListener(
          "pointerdown",
          (event) => {
            if (event.button !== 0) return;
            const startX = event.clientX;
            const start = Number(input.value);
            if (!Number.isFinite(start)) return;
            const step =
              property.step && property.step > 0 ? property.step : 0.1;
            const drag = new AbortController();
            const abortDrag = (): void => drag.abort();
            this.abort.signal.addEventListener("abort", abortDrag, {
              once: true,
            });
            drag.signal.addEventListener(
              "abort",
              () => this.abort.signal.removeEventListener("abort", abortDrag),
              { once: true },
            );
            labelBtn.setPointerCapture(event.pointerId);
            labelBtn.addEventListener(
              "pointermove",
              (move) => {
                let value =
                  start +
                  (move.clientX - startX) * step * (move.shiftKey ? 0.1 : 1);
                if (property.min !== undefined)
                  value = Math.max(property.min, value);
                if (property.max !== undefined)
                  value = Math.min(property.max, value);
                input.value = String(Number(value.toFixed(6)));
              },
              { signal: drag.signal },
            );
            const end = (): void => {
              drag.abort();
              if (Number(input.value) !== start) save();
            };
            labelBtn.addEventListener("pointerup", end, {
              once: true,
              signal: drag.signal,
            });
            labelBtn.addEventListener(
              "pointercancel",
              () => {
                drag.abort();
                input.value = String(start);
              },
              { once: true, signal: drag.signal },
            );
          },
          { signal: this.abort.signal },
        );
      }
    } else if (property.type === "string") {
      const input = disable(document.createElement("textarea"));
      input.value = typeof property.value === "string" ? property.value : "";
      input.rows = input.value.includes("\n") ? 3 : 1;
      input.addEventListener(
        "change",
        () => this.context.run(() => commit(input.value)),
        { signal: this.abort.signal },
      );
      control.append(input);
    } else if (property.type === "enum" && property.options) {
      const input = disable(document.createElement("select"));
      property.options.forEach((option, index) => {
        const item = document.createElement("option");
        item.value = String(index);
        item.textContent = option.label;
        item.selected =
          JSON.stringify(option.value) === JSON.stringify(property.value);
        input.append(item);
      });
      input.addEventListener(
        "change",
        () =>
          this.context.run(() =>
            commit(property.options![Number(input.value)].value),
          ),
        { signal: this.abort.signal },
      );
      control.append(input);
    } else if (
      ["vec2", "vec3", "vec4", "size", "color"].includes(property.type) &&
      property.value &&
      typeof property.value === "object" &&
      !Array.isArray(property.value)
    ) {
      const value = property.value as Record<string, Json>;
      if (property.type === "color") {
        control.classList.add("ci-color-row");
        const hex = ["r", "g", "b"]
          .map((axis) =>
            Math.round(Math.max(0, Math.min(255, Number(value[axis]) || 0)))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
        const color = disable(document.createElement("input"));
        color.type = "color";
        color.className = "ci-color";
        color.value = `#${hex}`;

        const hexText = disable(document.createElement("input"));
        hexText.type = "text";
        hexText.className = "ci-hex-text";
        hexText.value = `#${hex.toUpperCase()}`;
        hexText.maxLength = 7;
        hexText.spellcheck = false;

        color.addEventListener(
          "change",
          () => {
            const nextHex = color.value;
            hexText.value = nextHex.toUpperCase();
            this.context.run(() =>
              commit({
                ...value,
                r: parseInt(nextHex.slice(1, 3), 16),
                g: parseInt(nextHex.slice(3, 5), 16),
                b: parseInt(nextHex.slice(5, 7), 16),
              }),
            );
          },
          { signal: this.abort.signal },
        );

        hexText.addEventListener(
          "change",
          () => {
            let h = hexText.value.trim();
            if (!h.startsWith("#")) h = "#" + h;
            if (/^#[0-9a-fA-F]{6}$/.test(h)) {
              color.value = h;
              this.context.run(() =>
                commit({
                  ...value,
                  r: parseInt(h.slice(1, 3), 16),
                  g: parseInt(h.slice(3, 5), 16),
                  b: parseInt(h.slice(5, 7), 16),
                }),
              );
            } else {
              hexText.value = color.value.toUpperCase();
            }
          },
          { signal: this.abort.signal },
        );

        control.append(color, hexText);
      } else {
        const isVecLine = property.type === "vec2" || property.type === "vec3";
        const isGrid2x2 =
          property.type === "vec4" || (property.type as string) === "rect";
        control.classList.add(
          "ci-vector",
          isVecLine
            ? "ci-vector-line"
            : isGrid2x2
              ? "ci-vector-grid-2x2"
              : "ci-vector-size",
        );
        const axes =
          property.type === "size"
            ? ["width", "height"]
            : ["x", "y", "z", "w"].slice(0, Number(property.type.slice(-1)));
        for (const axis of axes) {
          if (typeof value[axis] !== "number") continue;
          const field = document.createElement("label");
          field.className = "ci-axis";
          const title = document.createElement("span");
          title.textContent = axis;
          const input = disable(document.createElement("input"));
          input.type = "number";
          input.step = String(property.step ?? "any");
          input.value = String(value[axis]);
          input.setAttribute("aria-label", `${property.label} ${axis}`);
          input.addEventListener(
            "change",
            () =>
              this.context.run(async () => {
                const next = input.value === "" ? NaN : Number(input.value);
                if (!Number.isFinite(next))
                  throw new Error(this.context.t("invalidNumber"));
                await commit({ ...value, [axis]: next });
              }),
            { signal: this.abort.signal },
          );
          field.append(title, input);
          control.append(field);
        }
      }
    } else {
      const summary = document.createElement("span");
      summary.className = "ci-value-summary";
      summary.textContent =
        property.value === null
          ? "null"
          : Array.isArray(property.value)
            ? `Array [${property.value.length}]`
            : typeof property.value === "object"
              ? "{…}"
              : String(property.value);
      control.append(summary);
    }

    if (isExpandable) {
      const nested = document.createElement("div");
      nested.className = "ci-nested";
      nested.hidden = !isExpanded;

      toggleExpandFn = async (): Promise<void> => {
        const currentlyExpanded = !nested.hidden;
        if (currentlyExpanded) {
          nested.hidden = true;
          this.expanded.delete(keyPath);
          const chev = labelBtn.querySelector(".ci-prop-chevron");
          if (chev) chev.textContent = "▸";
          return;
        }
        const children =
          property.children ??
          (await this.context.call<Property[]>("expand", { path }));
        if (this.abort.signal.aborted) return;
        nested.replaceChildren(
          ...children.map((child) => this.property(child, depth + 1)),
        );
        nested.hidden = false;
        this.expanded.add(keyPath);
        const chev = labelBtn.querySelector(".ci-prop-chevron");
        if (chev) chev.textContent = "▾";
      };

      wrapper.append(nested);
      if (isExpanded) {
        this.context.run(async () => {
          const children =
            property.children ??
            (await this.context.call<Property[]>("expand", { path }));
          if (this.abort.signal.aborted) return;
          nested.replaceChildren(
            ...children.map((child) => this.property(child, depth + 1)),
          );
        });
      }
    }

    if (property.type === "image") {
      control.append(
        this.button("preview", async () => {
          const image = await this.context.call<{ url: string }>(
            "imagePreview",
            { path },
          );
          if (!image.url) throw new Error(this.context.t("noImage"));
          if (!this.abort.signal.aborted)
            this.context.preview(image.url, property.label);
        }),
      );
      const file = document.createElement("input");
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/webp";
      file.hidden = true;
      file.setAttribute("aria-label", this.context.t("imageFile"));
      const replace = this.button("replaceImage", async () => {
        file.click();
      });
      control.append(replace, file);
      file.addEventListener(
        "change",
        () =>
          this.context.run(async () => {
            const chosen = file.files?.[0];
            if (!chosen) return;
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(chosen.type)
            )
              throw new Error(this.context.t("imageType"));
            if (chosen.size > 5 * 1024 * 1024)
              throw new Error(this.context.t("imageSize"));
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () =>
                reject(
                  reader.error ?? new Error(this.context.t("errorGeneric")),
                );
              reader.onabort = () =>
                reject(new Error(this.context.t("errorGeneric")));
              this.abort.signal.addEventListener(
                "abort",
                () => {
                  if (reader.readyState === FileReader.LOADING) reader.abort();
                },
                { once: true },
              );
              reader.readAsDataURL(chosen);
            });
            if (this.abort.signal.aborted) return;
            await this.context.call("replaceImage", { path, dataUrl });
            await this.context.changed();
          }),
        { signal: this.abort.signal },
      );
    }

    if (property.assetUuid || property.type === "image") {
      control.append(
        this.button("openAsset", async () => {
          await this.context.call("openAsset", { path });
        }),
      );
    }

    row.append(labelBtn, control);
    wrapper.prepend(row);
    return wrapper;
  }

  dispose(): void {
    this.closeActiveMenu();
    this.abort.abort();
    this.element.remove();
  }
}
