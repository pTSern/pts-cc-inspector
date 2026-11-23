import { createZip, type ZipEntry } from "./zip";
import type { CocosNamespace } from "./contracts";

export interface ExportResult {
  ok: boolean;
  filename: string;
  fileCount: number;
  totalBytes: number;
  zipBytes: number;
}

interface TargetFile {
  url?: string;
  content?: Uint8Array | string;
}

interface BundleAssetInfo {
  packedUuids?: string[];
  ext?: string;
  native?: string;
}

interface BundleConfig {
  importBase?: string;
  nativeBase?: string;
  assetInfos?:
    | { _map?: Record<string, BundleAssetInfo> }
    | Record<string, BundleAssetInfo>;
}

interface ExportableBundle {
  name?: string;
  base?: string;
  _config?: BundleConfig;
  config?: BundleConfig;
}

interface ExportableBundles {
  forEach?: (fn: (b: unknown, name: string) => void) => void;
}

interface ExportableAssetManager {
  bundles?: ExportableBundles;
  assets?: {
    forEach?: (fn: (asset: unknown, uuid: string) => void) => void;
  };
}

interface VirtualFile {
  data?: Uint8Array | ArrayBuffer | string;
  text?: string;
  mime?: string;
}

type VirtualEntry = VirtualFile | Uint8Array | ArrayBuffer | string;

interface GlobalCocosContext {
  _CCSettings?: unknown;
  __res?: Record<string, VirtualEntry>;
  __js?: Record<string, VirtualEntry>;
  __pts_files?: Record<string, VirtualEntry>;
  __super_html_res?: Record<string, VirtualEntry>;
  cc?: {
    assetManager?: ExportableAssetManager;
  };
}

const textEncoder = new TextEncoder();

export function normalizeExportPath(raw: string, pageHref: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const base = new URL(".", pageHref).href;
  let rel = trimmed;
  try {
    const resolved = new URL(trimmed, pageHref).href;
    if (resolved.startsWith(base)) {
      rel = resolved.slice(base.length);
    } else {
      rel = new URL(resolved).pathname.replace(/^\/+/, "");
    }
  } catch {}
  return rel
    .replace(/\\/g, "/")
    .split("?")[0]
    .split("#")[0]
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function decodeBase64(b64: string): Uint8Array {
  const normalized = b64
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const bin = atob(normalized);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export function decodeVirtualEntry(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") {
    const dataUri = /^data:[^,]*;base64,([\s\S]*)$/i.exec(value);
    if (dataUri) {
      try {
        return decodeBase64(dataUri[1]);
      } catch {
        return textEncoder.encode(value);
      }
    }
    return textEncoder.encode(value);
  }
  if (value && typeof value === "object") {
    const vf = value as VirtualFile;
    if (vf.data !== undefined) {
      const decoded = decodeVirtualEntry(vf.data);
      if (decoded) return decoded;
    }
    if (typeof vf.text === "string") {
      return textEncoder.encode(vf.text);
    }
  }
  return null;
}

async function fetchWithPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await fn(items[idx], idx);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function exportCocosProject(
  cc?: CocosNamespace,
): Promise<ExportResult> {
  const pageHref = window.location.href;
  const base = new URL(".", pageHref).href;
  const filesMap = new Map<string, TargetFile>();
  const globals = globalThis as typeof globalThis & GlobalCocosContext;

  const normalizeRelPath = (raw: string): string =>
    normalizeExportPath(raw, pageHref);

  // Check for single-HTML playable / pts-super-html in-memory virtual filesystems
  const virtualStores = [
    globals.__res,
    globals.__pts_files,
    globals.__super_html_res,
    globals.__js,
  ].filter((store): store is Record<string, VirtualEntry> =>
    Boolean(store && typeof store === "object"),
  );
  let hasVirtualFiles = false;
  if (virtualStores.length > 0) {
    const seenObjects = new Set<object>();
    for (const store of virtualStores) {
      for (const rawName of Object.keys(store)) {
        const entry = store[rawName];
        if (entry === null || entry === undefined) continue;
        if (typeof entry === "object") {
          if (seenObjects.has(entry)) continue;
          seenObjects.add(entry);
        }
        const cleanPath = rawName
          .replace(/\\/g, "/")
          .replace(/^\.\//, "")
          .replace(/^\/+/, "");
        if (!cleanPath || filesMap.has(cleanPath)) continue;
        const content = decodeVirtualEntry(entry);
        if (content) {
          filesMap.set(cleanPath, { content });
          hasVirtualFiles = true;
        }
      }
    }
  }

  // 1. Root index.html (only fetch directly when not a single-HTML virtual bundle)
  if (!hasVirtualFiles) {
    filesMap.set("index.html", {
      url: pageHref.split("?")[0].split("#")[0],
    });
  }

  // 2. DOM scripts and stylesheets
  for (const s of Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[src]"),
  )) {
    const src = s.getAttribute("src");
    if (
      src &&
      !src.startsWith("chrome-extension:") &&
      !src.startsWith("blob:")
    ) {
      try {
        const u = new URL(src, window.location.href);
        const rel = normalizeRelPath(u.href);
        if (rel && !filesMap.has(rel)) filesMap.set(rel, { url: u.href });
      } catch {}
    }
  }

  for (const l of Array.from(
    document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"], link[rel="icon"]',
    ),
  )) {
    const href = l.getAttribute("href");
    if (
      href &&
      !href.startsWith("chrome-extension:") &&
      !href.startsWith("blob:")
    ) {
      try {
        const u = new URL(href, window.location.href);
        const rel = normalizeRelPath(u.href);
        if (rel && !filesMap.has(rel)) filesMap.set(rel, { url: u.href });
      } catch {}
    }
  }

  // 3. Performance resource timing entries (network requests made by the game)
  if (
    typeof performance !== "undefined" &&
    typeof performance.getEntriesByType === "function"
  ) {
    for (const e of performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[]) {
      const name = e.name;
      if (
        name &&
        name.startsWith(base) &&
        !name.includes("chrome-extension:") &&
        !name.includes("pts-fixtures") &&
        !name.startsWith("blob:")
      ) {
        const rel = normalizeRelPath(name);
        if (rel && !filesMap.has(rel)) {
          filesMap.set(rel, { url: name });
        }
      }
    }
  }

  // 4. Global Cocos settings (window._CCSettings or cc.settings)
  if (globals._CCSettings) {
    const settingsStr = JSON.stringify(globals._CCSettings, null, 2);
    if (!filesMap.has("src/settings.json")) {
      filesMap.set("src/settings.json", { content: settingsStr });
    }
  }

  // 5. Bundles and their indexed assets
  const am = (cc?.assetManager || globals.cc?.assetManager) as
    | ExportableAssetManager
    | undefined;
  const bundles = am?.bundles;
  if (bundles && typeof bundles.forEach === "function") {
    bundles.forEach((b: unknown, name: string) => {
      if (!b || typeof b !== "object") return;
      const bundle = b as ExportableBundle;
      const cfg = bundle._config || bundle.config || {};
      const bName = bundle.name || name;
      const bBase = bundle.base || `assets/${bName}/`;
      const importBase = String(cfg.importBase || "import");
      const nativeBase = String(cfg.nativeBase || "native");

      // config.json
      const cfgRel = normalizeRelPath(`${bBase}config.json`);
      if (!filesMap.has(cfgRel)) {
        filesMap.set(cfgRel, { content: JSON.stringify(cfg, null, 2) });
      }

      // bundle script index.js
      const scriptRel = normalizeRelPath(`${bBase}index.js`);
      if (!filesMap.has(scriptRel)) {
        const scriptUrl = new URL(`${bBase}index.js`, window.location.href)
          .href;
        filesMap.set(scriptRel, { url: scriptUrl });
      }

      // Packs and assetInfos
      const rawInfos = cfg.assetInfos;
      const assetInfos: Record<string, BundleAssetInfo> =
        rawInfos && typeof rawInfos === "object" && "_map" in rawInfos
          ? (rawInfos._map as Record<string, BundleAssetInfo>)
          : ((rawInfos || {}) as Record<string, BundleAssetInfo>);

      for (const uuid in assetInfos) {
        const info = assetInfos[uuid];
        if (!info) continue;

        // If pack file or json asset
        if (info.packedUuids || info.ext === ".json") {
          const pPath = `${bBase}${importBase}/${uuid.slice(0, 2)}/${uuid}.json`;
          const pRel = normalizeRelPath(pPath);
          if (!filesMap.has(pRel)) {
            const pUrl = new URL(pPath, window.location.href).href;
            filesMap.set(pRel, { url: pUrl });
          }
        }

        // If native asset (image, sound, font, etc.)
        if (info.native) {
          const nPath = `${bBase}${nativeBase}/${uuid.slice(0, 2)}/${uuid}.${info.native}`;
          const nRel = normalizeRelPath(nPath);
          if (!filesMap.has(nRel)) {
            const nUrl = new URL(nPath, window.location.href).href;
            filesMap.set(nRel, { url: nUrl });
          }
        }
      }
    });
  }

  // 6. Live loaded assets from cc.assetManager.assets
  const assetsObj = am?.assets;
  if (assetsObj && typeof assetsObj.forEach === "function") {
    try {
      assetsObj.forEach((asset: unknown) => {
        if (!asset || typeof asset !== "object") return;
        if ("nativeUrl" in asset && typeof asset.nativeUrl === "string") {
          const nativeUrl = asset.nativeUrl;
          if (nativeUrl && !nativeUrl.startsWith("data:")) {
            const rel = normalizeRelPath(nativeUrl);
            if (rel && !filesMap.has(rel)) {
              const u = new URL(nativeUrl, window.location.href).href;
              filesMap.set(rel, { url: u });
            }
          }
        }
      });
    } catch {}
  }

  // 6.5 Ensure stylesheet & index.html exist for virtual/single-HTML builds
  const isCc3 =
    filesMap.has("src/system.bundle.js") ||
    filesMap.has("application.js") ||
    filesMap.has("cocos-js/cc.js");
  if (hasVirtualFiles) {
    const cssName = isCc3 ? "style.css" : "style-mobile.css";
    if (!filesMap.has(cssName) && !filesMap.has("style.css") && !filesMap.has("style-mobile.css")) {
      const inlineCss = Array.from(document.querySelectorAll("head style"))
        .map((el) => el.textContent?.trim() || "")
        .filter(Boolean)
        .join("\n");
      if (inlineCss) {
        filesMap.set(cssName, { content: inlineCss });
      }
    }
  }
  if (!filesMap.has("index.html")) {
    let htmlContent: string;
    if (isCc3) {
      htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${document.title || "Cocos Creator"}</title>
  <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true"/>
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="format-detection" content="telephone=no">
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div id="GameDiv" cc_exact_fit_screen="true">
    <div id="Cocos3dGameContainer">
      <canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="99"></canvas>
    </div>
  </div>
  <script src="src/polyfills.bundle.js" charset="utf-8"></script>
  <script src="src/system.bundle.js" charset="utf-8"></script>
  <script src="src/import-map.json" type="systemjs-importmap" charset="utf-8"></script>
  <script>
    System.import('./index.js').catch(function(err) { console.error(err); });
  </script>
</body>
</html>`;
    } else {
      const cssHref = filesMap.has("style-mobile.css")
        ? "style-mobile.css"
        : filesMap.has("style.css")
          ? "style.css"
          : "style-mobile.css";
      const settingsScript = filesMap.has("src/settings.js")
        ? "src/settings.js"
        : filesMap.has("src/settings.json")
          ? "src/settings.json"
          : "src/settings.js";
      const engineScript = filesMap.has("cocos2d-js-min.js")
        ? "cocos2d-js-min.js"
        : filesMap.has("cocos2d-js.js")
          ? "cocos2d-js.js"
          : "cocos2d-js-min.js";
      const physicsScript = filesMap.has("physics-min.js")
        ? "physics-min.js"
        : filesMap.has("physics.js")
          ? "physics.js"
          : null;
      const scriptLines = [
        `  <script src="${settingsScript}" charset="utf-8"></script>`,
        `  <script src="${engineScript}" charset="utf-8"></script>`,
        ...(physicsScript
          ? [`  <script src="${physicsScript}" charset="utf-8"></script>`]
          : []),
        `  <script src="main.js" charset="utf-8"></script>`,
        `  <script>if (typeof window.boot === "function") window.boot();</script>`,
      ];
      htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${document.title || "Cocos Creator"}</title>
  <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true"/>
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <link rel="stylesheet" type="text/css" href="${cssHref}"/>
</head>
<body>
  <canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="0"></canvas>
  <div id="splash">
    <div class="progress-bar stripes">
      <span style="width: 0%"></span>
    </div>
  </div>
${scriptLines.join("\n")}
</body>
</html>`;
    }
    filesMap.set("index.html", { content: htmlContent });
  }

  // 7. Fetch all files concurrently with pool
  const entriesList = Array.from(filesMap.entries());
  const encoder = textEncoder;
  let totalBytes = 0;

  const zipEntries = await fetchWithPool(
    entriesList,
    6,
    async ([path, target]) => {
      let data: Uint8Array | null = null;
      if (target.content) {
        data =
          typeof target.content === "string"
            ? encoder.encode(target.content)
            : target.content;
      } else if (target.url && !target.url.startsWith("file:")) {
        try {
          const resp = await fetch(target.url, { credentials: "omit" });
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            data = new Uint8Array(buf);
          }
        } catch {}
      }
      if (data) {
        totalBytes += data.byteLength;
        return { path, data } as ZipEntry;
      }
      return null;
    },
  );

  const validZipEntries = zipEntries.filter((e): e is ZipEntry => e !== null);

  // 8. Generate ZIP archive
  const zipBytes = await createZip(validZipEntries);

  // 9. Generate clean filename
  const rawTitle = document.title || "cocos-game";
  const cleanTitle = rawTitle
    .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, "_")
    .slice(0, 40);
  const filename = `${cleanTitle || "cocos-project"}_build.zip`;

  // 10. Trigger browser download in page context
  try {
    const blob = new Blob([zipBytes as unknown as BlobPart], {
      type: "application/zip",
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    }, 15000);
  } catch {}

  return {
    ok: true,
    filename,
    fileCount: validZipEntries.length,
    totalBytes,
    zipBytes: zipBytes.byteLength,
  };
}
