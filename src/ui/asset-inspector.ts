import type { AssetDetails } from "../shared/protocol";
import type { MessageKey } from "../locales";
import type { PropertyContext } from "./properties";

export function renderAssetInspector(
  details: AssetDetails,
  context: PropertyContext,
  signal: AbortSignal,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "ci-asset-inspector";

  // 1. Header Card
  const headerCard = document.createElement("div");
  headerCard.className = "ci-asset-header-card";

  const titleRow = document.createElement("div");
  titleRow.className = "ci-asset-title-row";

  const title = document.createElement("h3");
  title.className = "ci-asset-title";
  title.textContent = details.name;

  titleRow.append(title);

  const badgeRow = document.createElement("div");
  badgeRow.className = "ci-asset-badge-row";

  const bundleBadge = document.createElement("span");
  bundleBadge.className = "ci-badge ci-badge-bundle";
  bundleBadge.textContent = `Bundle: ${details.bundle}`;

  const typeBadge = document.createElement("span");
  typeBadge.className = "ci-badge ci-badge-type";
  typeBadge.textContent = details.type;

  const loadedBadge = document.createElement("span");
  loadedBadge.className = `ci-badge ${details.loaded ? "ci-badge-loaded" : "ci-badge-unloaded"}`;
  loadedBadge.textContent = details.loaded ? "In Memory" : "On Disk";

  badgeRow.append(bundleBadge, typeBadge, loadedBadge);
  headerCard.append(titleRow, badgeRow);
  container.append(headerCard);

  // 2. Image / Texture Preview (if available)
  if (details.previewUrl) {
    const previewSection = document.createElement("div");
    previewSection.className = "ci-asset-preview-section";

    const previewTitle = document.createElement("div");
    previewTitle.className = "ci-asset-section-title";
    previewTitle.textContent = "Image Preview";

    const previewBox = document.createElement("div");
    previewBox.className = "ci-asset-preview-box";

    const img = document.createElement("img");
    img.className = "ci-asset-preview-img";
    img.src = details.previewUrl;
    img.alt = details.name;

    previewBox.append(img);

    if (details.width && details.height) {
      const dimBadge = document.createElement("span");
      dimBadge.className = "ci-asset-dim-badge";
      dimBadge.textContent = `${details.width} × ${details.height} px`;
      previewBox.append(dimBadge);
    }

    previewSection.append(previewTitle, previewBox);
    container.append(previewSection);
  }

  // 3. Metadata Table
  const metaSection = document.createElement("div");
  metaSection.className = "ci-asset-meta-section";

  const metaTitle = document.createElement("div");
  metaTitle.className = "ci-asset-section-title";
  metaTitle.textContent = "Asset Information";

  const metaTable = document.createElement("div");
  metaTable.className = "ci-asset-meta-table";

  for (const [key, val] of Object.entries(details.info)) {
    const row = document.createElement("div");
    row.className = "ci-asset-meta-row";

    const keySpan = document.createElement("span");
    keySpan.className = "ci-asset-meta-key";
    keySpan.textContent = key;

    const valSpan = document.createElement("span");
    valSpan.className = "ci-asset-meta-val";
    valSpan.textContent = String(val);

    row.append(keySpan, valSpan);
    metaTable.append(row);
  }

  metaSection.append(metaTitle, metaTable);
  container.append(metaSection);

  // 4. Meta Data Section
  if (details.meta && Object.keys(details.meta).length > 0) {
    const customMetaSection = document.createElement("div");
    customMetaSection.className = "ci-asset-meta-section";

    const customMetaTitle = document.createElement("div");
    customMetaTitle.className = "ci-asset-section-title";
    customMetaTitle.textContent = "Meta Data";

    const customMetaTable = document.createElement("div");
    customMetaTable.className = "ci-asset-meta-table";

    for (const [key, val] of Object.entries(details.meta)) {
      const row = document.createElement("div");
      row.className = "ci-asset-meta-row";

      const keySpan = document.createElement("span");
      keySpan.className = "ci-asset-meta-key";
      keySpan.textContent = key;

      const valSpan = document.createElement("span");
      valSpan.className = "ci-asset-meta-val";
      valSpan.textContent =
        typeof val === "object" && val !== null
          ? JSON.stringify(val)
          : String(val);

      row.append(keySpan, valSpan);
      customMetaTable.append(row);
    }

    customMetaSection.append(customMetaTitle, customMetaTable);
    container.append(customMetaSection);
  }
  // 4. Action Buttons Toolbar
  const actionsRow = document.createElement("div");
  actionsRow.className = "ci-asset-actions-row";

  const copyUuidBtn = document.createElement("button");
  copyUuidBtn.type = "button";
  copyUuidBtn.className = "ci-btn";
  copyUuidBtn.textContent = "Copy UUID";
  copyUuidBtn.addEventListener(
    "click",
    () => {
      navigator.clipboard.writeText(details.uuid);
    },
    { signal },
  );

  const copyPathBtn = document.createElement("button");
  copyPathBtn.type = "button";
  copyPathBtn.className = "ci-btn";
  copyPathBtn.textContent = "Copy Path";
  copyPathBtn.addEventListener(
    "click",
    () => {
      navigator.clipboard.writeText(details.path);
    },
    { signal },
  );

  const openAssetBtn = document.createElement("button");
  openAssetBtn.type = "button";
  openAssetBtn.className = "ci-btn";
  openAssetBtn.textContent = "Open in Creator";
  openAssetBtn.title =
    "Locate and focus this asset in Cocos Creator (via localhost:2505)";
  openAssetBtn.addEventListener(
    "click",
    () => {
      context.run(async () => {
        await context.call("openAsset", {
          uuid: details.uuid,
          path: details.path,
        });
      });
    },
    { signal },
  );

  actionsRow.append(copyUuidBtn, copyPathBtn, openAssetBtn);
  container.append(actionsRow);

  return container;
}
