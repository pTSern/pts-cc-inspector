import { build } from "esbuild";
import {
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
  readdir,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const hash = createHash("sha256");
for (const folder of ["src/runtime", "src/shared"]) {
  const files = (await readdir(resolve(root, folder)))
    .filter((file) => file.endsWith(".ts"))
    .sort();
  for (const file of files)
    hash.update(await readFile(resolve(root, folder, file)));
}
const buildId = hash.digest("hex").slice(0, 16);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
const entries = {
  background: "src/background.ts",
  bridge: "src/content/bridge.ts",
  runtime: "src/runtime/index.ts",
  devtools: "src/entries/devtools.ts",
  panel: "src/entries/panel.ts",
  floating: "src/entries/floating.ts",
  popup: "src/entries/popup.ts",
  options: "src/entries/options.ts",
};
await build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome111"],
  define: { __PTS_BUILD_ID__: JSON.stringify(buildId) },
  minify: true,
  sourcemap: "external",
  sourcesContent: true,
  legalComments: "external",
  metafile: true,
}).then(async (result) => {
  const outputs = Object.entries(result.metafile!.outputs)
    .filter(([name]) => name.endsWith(".js"))
    .map(([name, data]) => ({
      file: name.replace(/^dist[\\/]/, ""),
      bytes: data.bytes,
    }));
  console.table(outputs);
  await writeFile(
    resolve(dist, "build-info.json"),
    JSON.stringify({ version: "1.0.0-beta", outputs }, null, 2) + "\n",
  );
});
for (const file of [
  "manifest.json",
  "devtools.html",
  "panel.html",
  "floating.html",
  "popup.html",
  "options.html",
])
  await copyFile(resolve(root, file), resolve(dist, file));
await copyFile(resolve(root, "src/ui/inspector.css"), resolve(dist, "ui.css"));
await copyFile(
  resolve(root, "src/entries/controls.css"),
  resolve(dist, "controls.css"),
);
const manifest = JSON.parse(
  await readFile(resolve(dist, "manifest.json"), "utf8"),
);
if (
  manifest.key ||
  manifest.update_url ||
  manifest.version !== "1.0.0" ||
  manifest.version_name !== "1.0.0-beta"
)
  throw new Error("Invalid local extension manifest");
console.log("Local extension ready: " + dist);
