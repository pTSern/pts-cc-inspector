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
  data?: Uint8Array;
  text?: string;
  mime?: string;
}

interface GlobalCocosContext {
  _CCSettings?: unknown;
  __res?: Record<string, VirtualFile>;
  __pts_files?: Record<string, VirtualFile>;
  __super_html_res?: Record<string, VirtualFile>;
  cc?: {
    assetManager?: ExportableAssetManager;
  };
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
  const base = new URL(".", window.location.href).href;
  const filesMap = new Map<string, TargetFile>();
  const globals = globalThis as typeof globalThis & GlobalCocosContext;

  const normalizeRelPath = (raw: string): string => {
    let rel = raw;
    if (rel.startsWith(base)) {
      rel = rel.slice(base.length);
    } else {
      try {
        const u = new URL(rel, window.location.href);
        rel = u.pathname.replace(/^\/+/, "");
      } catch {}
    }
    return rel.split("?")[0].split("#")[0].replace(/^\/+/, "");
  };

  // Check for pts-super-html / playable in-memory virtual filesystem
  const virtualRes =
    globals.__res || globals.__pts_files || globals.__super_html_res;
  if (virtualRes && typeof virtualRes === "object") {
    const seenVf = new Set<VirtualFile>();
    for (const rawName of Object.keys(virtualRes)) {
      const vf = virtualRes[rawName];
      if (!vf || typeof vf !== "object" || seenVf.has(vf)) continue;
      seenVf.add(vf);
      const cleanPath = rawName
        .replace(/\\/g, "/")
        .replace(/^\.\//, "")
        .replace(/^\/+/, "");
      let content: Uint8Array | undefined = vf.data;
      if (!content && typeof vf.text === "string") {
        content = new TextEncoder().encode(vf.text);
      }
      if (content) {
        filesMap.set(cleanPath, { content });
      }
    }
  }

  // 1. Root index.html
  if (!virtualRes) {
    filesMap.set("index.html", {
      url: window.location.href.split("?")[0].split("#")[0],
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

  // 6.5 Ensure index.html exists
  if (!filesMap.has("index.html")) {
    const isCc3 =
      filesMap.has("src/system.bundle.js") ||
      filesMap.has("application.js") ||
      filesMap.has("cocos-js/cc.js");
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
      htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${document.title || "Cocos Creator"}</title>
  <meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,minimal-ui=true"/>
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <link rel="stylesheet" type="text/css" href="style-mobile.css"/>
</head>
<body>
  <canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="0"></canvas>
  <script src="src/settings.json" charset="utf-8"></script>
  <script src="main.js" charset="utf-8"></script>
  <script src="cocos2d-js-min.js" charset="utf-8"></script>
</body>
</html>`;
    }
    filesMap.set("index.html", { content: htmlContent });
  }

  // 7. Fetch all files concurrently with pool
  const entriesList = Array.from(filesMap.entries());
  const encoder = new TextEncoder();
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
      } else if (target.url) {
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
