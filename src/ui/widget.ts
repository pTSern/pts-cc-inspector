import type { Json, PropertyGroup, Property } from "../shared/protocol";
import type { PropertyContext } from "./properties";

export function renderWidgetComponent(
  group: PropertyGroup,
  context: PropertyContext,
  signal: AbortSignal,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "ci-widget-container";

  const prop = (key: string): Property | undefined =>
    group.properties.find((p) => p.key === key);

  const setProp = (key: string, value: Json): void => {
    const p = prop(key);
    if (p) {
      context.run(async () => {
        await context.call("set", { path: p.path, value });
        await context.changed();
      });
    }
  };

  const isAlignTop = prop("isAlignTop")?.value === true;
  const isAlignBottom = prop("isAlignBottom")?.value === true;
  const isAlignLeft = prop("isAlignLeft")?.value === true;
  const isAlignRight = prop("isAlignRight")?.value === true;
  const isAlignHCenter = prop("isAlignHorizontalCenter")?.value === true;
  const isAlignVCenter = prop("isAlignVerticalCenter")?.value === true;

  const topVal = Number(prop("top")?.value ?? 0);
  const bottomVal = Number(prop("bottom")?.value ?? 0);
  const leftVal = Number(prop("left")?.value ?? 0);
  const rightVal = Number(prop("right")?.value ?? 0);
  const hCenterVal = Number(prop("horizontalCenter")?.value ?? 0);
  const vCenterVal = Number(prop("verticalCenter")?.value ?? 0);

  const isAbsTop = prop("isAbsoluteTop")?.value !== false;
  const isAbsBottom = prop("isAbsoluteBottom")?.value !== false;
  const isAbsLeft = prop("isAbsoluteLeft")?.value !== false;
  const isAbsRight = prop("isAbsoluteRight")?.value !== false;

  const alignModeProp = prop("alignMode");
  const alignMode = Number(alignModeProp?.value ?? 1);
  const targetProp = prop("target");

  // Determine current active mode
  let hMode: "NONE" | "LEFT" | "CENTER" | "RIGHT" | "BOTH" = "NONE";
  if (isAlignLeft && isAlignRight) hMode = "BOTH";
  else if (isAlignHCenter) hMode = "CENTER";
  else if (isAlignLeft) hMode = "LEFT";
  else if (isAlignRight) hMode = "RIGHT";

  let vMode: "NONE" | "TOP" | "CENTER" | "BOTTOM" | "BOTH" = "NONE";
  if (isAlignTop && isAlignBottom) vMode = "BOTH";
  else if (isAlignVCenter) vMode = "CENTER";
  else if (isAlignTop) vMode = "TOP";
  else if (isAlignBottom) vMode = "BOTTOM";

  // Top layout: 2 columns
  const topColumns = document.createElement("div");
  topColumns.className = "ci-widget-columns";

  // LEFT COLUMN: 2D Interactive Diagram Box
  const diagram = document.createElement("div");
  diagram.className = "ci-widget-diagram";

  const btnTop = document.createElement("button");
  btnTop.type = "button";
  btnTop.className = `ci-wbox-edge ci-wbox-top ${isAlignTop ? "is-active" : ""}`;
  btnTop.title = "Toggle Top Alignment";
  btnTop.innerHTML = `<span class="ci-wbox-text">top</span><span class="ci-wbox-arrow">▼</span>`;
  btnTop.addEventListener("click", () => setProp("isAlignTop", !isAlignTop), {
    signal,
  });

  const middleRow = document.createElement("div");
  middleRow.className = "ci-wbox-middle";

  const btnLeft = document.createElement("button");
  btnLeft.type = "button";
  btnLeft.className = `ci-wbox-edge ci-wbox-left ${isAlignLeft ? "is-active" : ""}`;
  btnLeft.title = "Toggle Left Alignment";
  btnLeft.innerHTML = `<span class="ci-wbox-text">left</span><span class="ci-wbox-arrow">▶</span>`;
  btnLeft.addEventListener(
    "click",
    () => setProp("isAlignLeft", !isAlignLeft),
    { signal },
  );

  const centerBox = document.createElement("div");
  centerBox.className = "ci-wbox-center";

  const btnRight = document.createElement("button");
  btnRight.type = "button";
  btnRight.className = `ci-wbox-edge ci-wbox-right ${isAlignRight ? "is-active" : ""}`;
  btnRight.title = "Toggle Right Alignment";
  btnRight.innerHTML = `<span class="ci-wbox-text">right</span><span class="ci-wbox-arrow">◀</span>`;
  btnRight.addEventListener(
    "click",
    () => setProp("isAlignRight", !isAlignRight),
    { signal },
  );

  middleRow.append(btnLeft, centerBox, btnRight);

  const btnBottom = document.createElement("button");
  btnBottom.type = "button";
  btnBottom.className = `ci-wbox-edge ci-wbox-bottom ${isAlignBottom ? "is-active" : ""}`;
  btnBottom.title = "Toggle Bottom Alignment";
  btnBottom.innerHTML = `<span class="ci-wbox-text">bottom</span><span class="ci-wbox-arrow">▲</span>`;
  btnBottom.addEventListener(
    "click",
    () => setProp("isAlignBottom", !isAlignBottom),
    { signal },
  );

  diagram.append(btnTop, middleRow, btnBottom);

  // RIGHT COLUMN: Alignment bars & Inputs
  const rightColumn = document.createElement("div");
  rightColumn.className = "ci-widget-controls-col";

  // HORIZONTAL ALIGNMENT
  const hSection = document.createElement("div");
  hSection.className = "ci-widget-section";

  const hTitle = document.createElement("div");
  hTitle.className = "ci-widget-heading";
  hTitle.textContent = "Horizontal Alignment";

  const hBar = document.createElement("div");
  hBar.className = "ci-widget-segmented";

  const hIcons: Record<string, string> = {
    NONE: '<span class="ci-seg-text">NONE</span>',
    LEFT: '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="2" x2="2" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="4" y="5" width="6" height="6" fill="currentColor"/></svg>',
    CENTER:
      '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="5" y="5" width="6" height="6" fill="currentColor"/></svg>',
    RIGHT:
      '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="14" y1="2" x2="14" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="6" y="5" width="6" height="6" fill="currentColor"/></svg>',
    BOTH: '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="2" x2="2" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><line x1="14" y1="2" x2="14" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="4" y="5" width="8" height="6" fill="currentColor"/></svg>',
  };

  (["NONE", "LEFT", "CENTER", "RIGHT", "BOTH"] as const).forEach((mode) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ci-seg-btn ${hMode === mode ? "is-active" : ""}`;
    btn.innerHTML = hIcons[mode];
    btn.title = `Align ${mode}`;
    btn.addEventListener(
      "click",
      () => {
        context.run(async () => {
          if (mode === "NONE") {
            await setProp("isAlignLeft", false);
            await setProp("isAlignRight", false);
            await setProp("isAlignHorizontalCenter", false);
          } else if (mode === "LEFT") {
            await setProp("isAlignLeft", true);
            await setProp("isAlignRight", false);
            await setProp("isAlignHorizontalCenter", false);
          } else if (mode === "CENTER") {
            await setProp("isAlignHorizontalCenter", true);
            await setProp("isAlignLeft", false);
            await setProp("isAlignRight", false);
          } else if (mode === "RIGHT") {
            await setProp("isAlignRight", true);
            await setProp("isAlignLeft", false);
            await setProp("isAlignHorizontalCenter", false);
          } else if (mode === "BOTH") {
            await setProp("isAlignLeft", true);
            await setProp("isAlignRight", true);
            await setProp("isAlignHorizontalCenter", false);
          }
        });
      },
      { signal },
    );
    hBar.append(btn);
  });

  const hInputsRow = document.createElement("div");
  hInputsRow.className = "ci-widget-inputs-row";

  if (hMode === "CENTER") {
    const colCenter = createInputCol(
      "Horizontal Center",
      hCenterVal,
      isAlignHCenter,
      () => setProp("isAlignHorizontalCenter", !isAlignHCenter),
      (val) => setProp("horizontalCenter", val),
      null,
      signal,
    );
    hInputsRow.append(colCenter);
  } else {
    const colLeft = createInputCol(
      "Left",
      leftVal,
      isAlignLeft,
      () => setProp("isAlignLeft", !isAlignLeft),
      (val) => setProp("left", val),
      {
        unit: isAbsLeft ? "px" : "%",
        toggle: () => setProp("isAbsoluteLeft", !isAbsLeft),
      },
      signal,
    );
    const colRight = createInputCol(
      "Right",
      rightVal,
      isAlignRight,
      () => setProp("isAlignRight", !isAlignRight),
      (val) => setProp("right", val),
      {
        unit: isAbsRight ? "px" : "%",
        toggle: () => setProp("isAbsoluteRight", !isAbsRight),
      },
      signal,
    );
    hInputsRow.append(colLeft, colRight);
  }

  hSection.append(hTitle, hBar, hInputsRow);

  // VERTICAL ALIGNMENT
  const vSection = document.createElement("div");
  vSection.className = "ci-widget-section";

  const vTitle = document.createElement("div");
  vTitle.className = "ci-widget-heading";
  vTitle.textContent = "Vertical Alignment";

  const vBar = document.createElement("div");
  vBar.className = "ci-widget-segmented";

  const vIcons: Record<string, string> = {
    NONE: '<span class="ci-seg-text">NONE</span>',
    TOP: '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="2" x2="14" y2="2" stroke="currentColor" stroke-dasharray="2 1"/><rect x="5" y="4" width="6" height="6" fill="currentColor"/></svg>',
    CENTER:
      '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-dasharray="2 1"/><rect x="5" y="5" width="6" height="6" fill="currentColor"/></svg>',
    BOTTOM:
      '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="14" x2="14" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="5" y="6" width="6" height="6" fill="currentColor"/></svg>',
    BOTH: '<svg viewBox="0 0 16 16" width="16" height="16"><line x1="2" y1="2" x2="14" y2="2" stroke="currentColor" stroke-dasharray="2 1"/><line x1="2" y1="14" x2="14" y2="14" stroke="currentColor" stroke-dasharray="2 1"/><rect x="5" y="4" width="6" height="8" fill="currentColor"/></svg>',
  };

  (["NONE", "TOP", "CENTER", "BOTTOM", "BOTH"] as const).forEach((mode) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ci-seg-btn ${vMode === mode ? "is-active" : ""}`;
    btn.innerHTML = vIcons[mode];
    btn.title = `Align ${mode}`;
    btn.addEventListener(
      "click",
      () => {
        context.run(async () => {
          if (mode === "NONE") {
            await setProp("isAlignTop", false);
            await setProp("isAlignBottom", false);
            await setProp("isAlignVerticalCenter", false);
          } else if (mode === "TOP") {
            await setProp("isAlignTop", true);
            await setProp("isAlignBottom", false);
            await setProp("isAlignVerticalCenter", false);
          } else if (mode === "CENTER") {
            await setProp("isAlignVerticalCenter", true);
            await setProp("isAlignTop", false);
            await setProp("isAlignBottom", false);
          } else if (mode === "BOTTOM") {
            await setProp("isAlignBottom", true);
            await setProp("isAlignTop", false);
            await setProp("isAlignVerticalCenter", false);
          } else if (mode === "BOTH") {
            await setProp("isAlignTop", true);
            await setProp("isAlignBottom", true);
            await setProp("isAlignVerticalCenter", false);
          }
        });
      },
      { signal },
    );
    vBar.append(btn);
  });

  const vInputsRow = document.createElement("div");
  vInputsRow.className = "ci-widget-inputs-row";

  if (vMode === "CENTER") {
    const colCenter = createInputCol(
      "Vertical Center",
      vCenterVal,
      isAlignVCenter,
      () => setProp("isAlignVerticalCenter", !isAlignVCenter),
      (val) => setProp("verticalCenter", val),
      null,
      signal,
    );
    vInputsRow.append(colCenter);
  } else {
    const colTop = createInputCol(
      "Top",
      topVal,
      isAlignTop,
      () => setProp("isAlignTop", !isAlignTop),
      (val) => setProp("top", val),
      {
        unit: isAbsTop ? "px" : "%",
        toggle: () => setProp("isAbsoluteTop", !isAbsTop),
      },
      signal,
    );
    const colBottom = createInputCol(
      "Bottom",
      bottomVal,
      isAlignBottom,
      () => setProp("isAlignBottom", !isAlignBottom),
      (val) => setProp("bottom", val),
      {
        unit: isAbsBottom ? "px" : "%",
        toggle: () => setProp("isAbsoluteBottom", !isAbsBottom),
      },
      signal,
    );
    vInputsRow.append(colTop, colBottom);
  }

  vSection.append(vTitle, vBar, vInputsRow);
  rightColumn.append(hSection, vSection);

  topColumns.append(diagram, rightColumn);
  container.append(topColumns);

  // BOTTOM ROWS: Target & Align Mode
  const bottomMeta = document.createElement("div");
  bottomMeta.className = "ci-widget-meta";

  // Target row
  const targetRow = document.createElement("div");
  targetRow.className = "ci-widget-meta-row";
  const targetLabel = document.createElement("span");
  targetLabel.className = "ci-widget-meta-label";
  targetLabel.textContent = "Target";

  const targetBox = document.createElement("div");
  targetBox.className = "ci-widget-target-box";
  const targetIcon = document.createElement("span");
  targetIcon.className = "ci-widget-target-icon";
  targetIcon.textContent = "❖";
  const targetText = document.createElement("span");
  targetText.textContent =
    targetProp?.value && typeof targetProp.value === "object"
      ? (targetProp.value as Record<string, Json>).name?.toString() || "cc.Node"
      : targetProp?.value
        ? String(targetProp.value)
        : "cc.Node (Parent)";
  targetBox.append(targetIcon, targetText);
  targetRow.append(targetLabel, targetBox);

  // Align Mode row
  const modeRow = document.createElement("div");
  modeRow.className = "ci-widget-meta-row";
  const modeLabel = document.createElement("span");
  modeLabel.className = "ci-widget-meta-label";
  modeLabel.textContent = "Align Mode";

  const modeSelect = document.createElement("select");
  modeSelect.className = "ci-widget-select";
  const modes = [
    { label: "ONCE", value: 0 },
    { label: "ON_WINDOW_RESIZE", value: 1 },
    { label: "ALWAYS", value: 2 },
  ];
  modes.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.value);
    opt.textContent = m.label;
    if (m.value === alignMode) opt.selected = true;
    modeSelect.append(opt);
  });
  modeSelect.addEventListener(
    "change",
    () => setProp("alignMode", Number(modeSelect.value)),
    { signal },
  );
  modeRow.append(modeLabel, modeSelect);

  bottomMeta.append(targetRow, modeRow);
  container.append(bottomMeta);

  return container;
}

function createInputCol(
  label: string,
  value: number,
  isAligned: boolean,
  toggleAlign: () => void,
  setValue: (val: number) => void,
  unitOption: { unit: string; toggle: () => void } | null,
  signal: AbortSignal,
): HTMLElement {
  const col = document.createElement("div");
  col.className = "ci-widget-input-col";

  const header = document.createElement("div");
  header.className = "ci-widget-input-header";

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;

  const lockBtn = document.createElement("button");
  lockBtn.type = "button";
  lockBtn.className = `ci-widget-lock ${isAligned ? "is-locked" : "is-unlocked"}`;
  lockBtn.title = isAligned
    ? "Aligned (Locked)"
    : "Not aligned (Click to lock)";
  lockBtn.textContent = isAligned ? "🔒" : "🔓";
  lockBtn.addEventListener("click", toggleAlign, { signal });

  header.append(labelSpan, lockBtn);

  const box = document.createElement("div");
  box.className = "ci-widget-input-box";

  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.step = "any";
  input.disabled = !isAligned;
  input.addEventListener(
    "change",
    () => {
      const next = input.value === "" ? 0 : Number(input.value);
      if (Number.isFinite(next)) setValue(next);
    },
    { signal },
  );

  box.append(input);

  if (unitOption) {
    const unitBtn = document.createElement("button");
    unitBtn.type = "button";
    unitBtn.className = "ci-widget-unit";
    unitBtn.textContent = unitOption.unit;
    unitBtn.title = "Toggle px / %";
    unitBtn.disabled = !isAligned;
    unitBtn.addEventListener("click", unitOption.toggle, { signal });
    box.append(unitBtn);
  }

  col.append(header, box);
  return col;
}
