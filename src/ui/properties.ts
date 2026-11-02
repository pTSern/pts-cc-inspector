import type { Command, Json, NodeDetails, Property } from "../shared/protocol";
import type { MessageKey } from "../locales";

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
  constructor(
    private readonly details: NodeDetails,
    private readonly context: PropertyContext,
    expanded?: Set<string>,
  ) {
    if (expanded) this.expanded = expanded;
    this.element.className = "ci-property-view";
    for (const group of details.groups) {
      const section = document.createElement("details");
      section.className = "ci-property-group";
      section.open = true;
      const heading = document.createElement("summary");
      heading.textContent = group.name;
      const badge = document.createElement("span");
      badge.className = "ci-badge";
      badge.textContent = context.t(
        group.kind === "node" ? "inspector" : "components",
      );
      heading.append(badge);
      section.append(heading);
      if (!group.properties.length) {
        const empty = document.createElement("p");
        empty.className = "ci-muted";
        empty.textContent = context.t("noProperties");
        section.append(empty);
      }
      for (const property of group.properties)
        section.append(this.property(property));
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
    for (const kind of ["scripts", "handlers"] as const) {
      const items = details[kind];
      if (!items.length) continue;
      const section = document.createElement("section");
      section.className = "ci-debug-section";
      const heading = document.createElement("h3");
      heading.textContent = context.t(kind);
      section.append(heading);
      for (const item of items) {
        const button = this.button(
          kind === "scripts" ? "inspectScript" : "inspectHandler",
          async () => {
            await context.call(
              kind === "scripts" ? "inspectScript" : "inspectHandler",
              { index: item.index },
            );
          },
        );
        button.className = "ci-target-button";
        button.textContent = `${context.t(kind === "scripts" ? "inspectScript" : "inspectHandler")}: ${item.name}${"event" in item ? ` · ${item.event}` : ""}`;
        section.append(button);
      }
      this.element.append(section);
    }
  }
  get expandedPaths(): Set<string> {
    return this.expanded;
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
    const label = document.createElement("label");
    label.className = "ci-property-label";
    label.textContent = property.label;
    label.title = `${property.path.join(".")}${property.reason ? `\n${property.reason}` : ""}`;
    const control = document.createElement("div");
    control.className = "ci-property-control";
    const path = property.path;
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
        label.classList.add("ci-draggable");
        label.addEventListener(
          "pointerdown",
          (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            input.focus();
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
            label.setPointerCapture(event.pointerId);
            label.addEventListener(
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
            label.addEventListener("pointerup", end, {
              once: true,
              signal: drag.signal,
            });
            label.addEventListener(
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
      const axes =
        property.type === "size"
          ? ["width", "height"]
          : property.type === "color"
            ? ["r", "g", "b", "a"]
            : ["x", "y", "z", "w"].slice(0, Number(property.type.slice(-1)));
      control.classList.add("ci-vector");
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
      if (property.type === "color") {
        const color = disable(document.createElement("input"));
        color.type = "color";
        color.className = "ci-color";
        const hex = ["r", "g", "b"]
          .map((axis) =>
            Math.round(Math.max(0, Math.min(255, Number(value[axis]) || 0)))
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
        color.value = `#${hex}`;
        color.addEventListener(
          "change",
          () =>
            this.context.run(() =>
              commit({
                ...value,
                r: parseInt(color.value.slice(1, 3), 16),
                g: parseInt(color.value.slice(3, 5), 16),
                b: parseInt(color.value.slice(5, 7), 16),
              }),
            ),
          { signal: this.abort.signal },
        );
        control.append(color);
      }
    } else {
      const summary = document.createElement("span");
      summary.className = "ci-value-summary";
      summary.textContent =
        property.value === null
          ? "null"
          : typeof property.value === "object"
            ? JSON.stringify(property.value).slice(0, 180)
            : String(property.value);
      control.append(summary);
    }
    if (property.expandable || property.children) {
      const key = JSON.stringify(path);
      const nested = document.createElement("div");
      nested.className = "ci-nested";
      nested.hidden = true;
      const expand = this.button("expand", async () => {
        if (!nested.hidden) {
          nested.hidden = true;
          expand.textContent = this.context.t("expand");
          this.expanded.delete(key);
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
        expand.textContent = this.context.t("collapse");
        this.expanded.add(key);
      });
      control.prepend(expand);
      wrapper.append(nested);
      if (this.expanded.has(key)) {
        this.context.run(async () => {
          const children =
            property.children ??
            (await this.context.call<Property[]>("expand", { path }));
          if (this.abort.signal.aborted) return;
          nested.replaceChildren(
            ...children.map((child) => this.property(child, depth + 1)),
          );
          nested.hidden = false;
          expand.textContent = this.context.t("collapse");
        });
      }
    }
    if (
      property.type === "object" ||
      property.type === "array" ||
      property.type === "image"
    )
      control.append(
        this.button("log", async () => {
          await this.context.call("log", { path });
        }),
      );
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
    if (property.assetUuid || property.type === "image")
      control.append(
        this.button("openAsset", async () => {
          await this.context.call("openAsset", { path });
        }),
      );
    if (property.readOnly) {
      const lock = document.createElement("span");
      lock.className = "ci-readonly";
      lock.textContent = "◇";
      lock.title = property.reason ?? this.context.t("readonly");
      lock.setAttribute("aria-label", this.context.t("readonly"));
      label.append(lock);
    }
    if (property.readOnly && property.reason) {
      const reason = document.createElement("span");
      reason.className = "ci-readonly-reason";
      reason.textContent = property.reason;
      control.append(reason);
    }
    row.append(label, control);
    wrapper.prepend(row);
    return wrapper;
  }
  dispose(): void {
    this.abort.abort();
    this.element.remove();
  }
}
