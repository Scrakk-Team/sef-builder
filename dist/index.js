#!/usr/bin/env node

// src/index.ts
import * as fs3 from "node:fs/promises";
import { resolve } from "node:path";

// src/api.ts
import * as fs2 from "node:fs/promises";
import * as path2 from "node:path";
import { zipSync } from "fflate";

// src/config.ts
var SEF = {
  /** Nombre del manifest dentro del paquete. */
  MANIFEST: "manifest.json",
  /** Carpeta de código compilado. */
  DIST: "dist",
  /** Entry del bundle compilado. */
  ENTRY: "dist/modules.js",
  /** Data por tipo (layout v2). */
  THEMES_DIR: "themes",
  ICONS_DIR: "icons",
  PRODUCT_ICONS_DIR: "productIcons",
  LSP_DIR: "lsp",
  /** Escenas de eventos (`contributes.events` → `path`). */
  EVENTS_DIR: "events",
  /** Recursos del paquete (audio de eventos, imágenes…). */
  ASSETS_DIR: "assets",
  /** Extensión de paquete instalable. */
  EXTENSION_EXT: ".sef"
};
var ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;
var RUNTIME_EXTERNALS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@features/layout"
];
function collectCodePaths(manifest) {
  const contributes = manifest.contributes ?? {};
  const paths = [];
  const push = (value) => {
    if (typeof value === "string") paths.push(value);
  };
  for (const panel of contributes.panels ?? []) {
    push(panel?.component);
  }
  for (const button of contributes.activityBar ?? []) {
    push(button?.icon);
  }
  for (const tab of contributes.centerTabs ?? []) {
    push(tab?.component);
    push(tab?.icon);
  }
  return [...new Set(paths)];
}

// src/version.ts
function parseVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw ?? "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

// src/schema.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
function validateManifest(manifest) {
  const issues = [];
  if (typeof manifest.id !== "string" || !ID_RE.test(manifest.id)) {
    issues.push({ field: "id", message: "id requerido (kebab/word chars)" });
  }
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    issues.push({ field: "name", message: "name requerido" });
  }
  if (parseVersion(String(manifest.version ?? "")) === null) {
    issues.push({ field: "version", message: "version semver requerida (ej. 0.1.0)" });
  }
  if (manifest.engine !== void 0 && typeof manifest.engine !== "string") {
    issues.push({ field: "engine", message: 'engine debe ser string (ej. ">=0.1.0")' });
  }
  if (manifest.runtime !== void 0) {
    const runtime = manifest.runtime;
    if (!runtime || typeof runtime !== "object" || typeof runtime.entry !== "string" || runtime.entry.length === 0) {
      issues.push({
        field: "runtime",
        message: 'runtime debe ser { kind, entry } con entry string (ej. {"kind":"node","entry":"extension.js"})'
      });
    }
  }
  const VALID_PERMISSIONS = /* @__PURE__ */ new Set([
    "fs.read",
    "fs.write",
    "fs.all",
    "shell.exec",
    "network.fetch",
    "lsp.use"
  ]);
  if (manifest.permissions !== void 0 && (!Array.isArray(manifest.permissions) || !manifest.permissions.every((p) => typeof p === "string" && VALID_PERMISSIONS.has(p)))) {
    issues.push({
      field: "permissions",
      message: `permissions debe ser array de: ${[...VALID_PERMISSIONS].join(", ")}`
    });
  }
  const contributes = manifest.contributes;
  if (!contributes || typeof contributes !== "object") {
    issues.push({ field: "contributes", message: "contributes requerido" });
    return issues;
  }
  const c = contributes;
  const KNOWN_KINDS = [
    "panels",
    "views",
    "activityBar",
    "centerTabs",
    "themes",
    "fileIcons",
    "productIcons",
    "lspServers",
    "languages",
    "notifications",
    "encodings",
    "tools",
    "skills",
    "fileHandlers",
    "events"
  ];
  for (const key of Object.keys(c)) {
    if (!KNOWN_KINDS.includes(key)) {
      issues.push({ field: `contributes.${key}`, message: `tipo desconocido (${KNOWN_KINDS.join(", ")})` });
    }
  }
  return issues;
}
async function validatePackage(rootDir) {
  const manifestPath = path.join(rootDir, SEF.MANIFEST);
  let raw;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    return [{ field: SEF.MANIFEST, message: `${SEF.MANIFEST} no encontrado en ${rootDir}` }];
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return [{ field: SEF.MANIFEST, message: `JSON inv\xE1lido: ${String(error)}` }];
  }
  const issues = validateManifest(manifest);
  if (issues.length > 0) return issues;
  for (const codePath of collectCodePaths(manifest)) {
    if (!Number.isNaN(Number(codePath))) continue;
    try {
      await fs.access(path.join(rootDir, codePath));
    } catch {
      issues.push({ field: codePath, message: "archivo de c\xF3digo no encontrado" });
    }
  }
  const themes = manifest.contributes?.themes ?? [];
  for (const theme of themes) {
    if (typeof theme.path === "string") continue;
    const expected = `${SEF.THEMES_DIR}/${String(theme.id)}.json`;
    try {
      await fs.access(path.join(rootDir, expected));
    } catch {
      issues.push({
        field: expected,
        message: 'tema sin "path" \u2192 se esperaba archivo por convenci\xF3n v2'
      });
    }
  }
  const fileIcons = manifest.contributes?.fileIcons ?? [];
  for (const theme of fileIcons) {
    if (typeof theme.path === "string") {
      try {
        await fs.access(path.join(rootDir, String(theme.path)));
      } catch {
        issues.push({ field: String(theme.path), message: "archivo de iconos no encontrado" });
      }
      continue;
    }
    const expected = `${SEF.ICONS_DIR}/${String(theme.id)}.json`;
    try {
      await fs.access(path.join(rootDir, expected));
    } catch {
      issues.push({
        field: expected,
        message: 'tema de iconos sin "path" \u2192 se esperaba archivo por convenci\xF3n'
      });
    }
  }
  const productIcons = manifest.contributes?.productIcons ?? [];
  for (const theme of productIcons) {
    if (typeof theme.path === "string") {
      try {
        await fs.access(path.join(rootDir, String(theme.path)));
      } catch {
        issues.push({ field: String(theme.path), message: "archivo de iconos de producto no encontrado" });
      }
      continue;
    }
    const expected = `${SEF.PRODUCT_ICONS_DIR}/${String(theme.id)}.json`;
    try {
      await fs.access(path.join(rootDir, expected));
    } catch {
      issues.push({
        field: expected,
        message: 'tema de iconos sin "path" \u2192 se esperaba archivo por convenci\xF3n'
      });
    }
  }
  const events = manifest.contributes?.events ?? [];
  for (const event of events) {
    const label = `${SEF.EVENTS_DIR}/${String(event.id ?? "?")}.json`;
    if (typeof event.id !== "string" || typeof event.name !== "string") {
      issues.push({
        field: `${SEF.EVENTS_DIR} (${String(event.id ?? "?")})`,
        message: 'un evento necesita "id" y "name"'
      });
      continue;
    }
    if (typeof event.path !== "string" && event.scene === void 0) {
      issues.push({
        field: label,
        message: 'un evento necesita "path" (archivo del paquete) o "scene" (inline)'
      });
      continue;
    }
    if (typeof event.path !== "string") {
      await checkEventAssets(rootDir, event.scene, issues);
      continue;
    }
    let sceneRaw;
    try {
      sceneRaw = await fs.readFile(path.join(rootDir, event.path), "utf-8");
    } catch {
      issues.push({ field: event.path, message: "escena del evento no encontrada" });
      continue;
    }
    let scene;
    try {
      scene = JSON.parse(sceneRaw);
    } catch (error) {
      issues.push({ field: event.path, message: `escena con JSON inv\xE1lido: ${String(error)}` });
      continue;
    }
    if (typeof scene.specVersion !== "number") {
      issues.push({ field: event.path, message: 'la escena necesita "specVersion" (hoy: 1)' });
    }
    if (!Array.isArray(scene.timeline)) {
      issues.push({ field: event.path, message: 'la escena necesita "timeline" (array de ops)' });
    }
    await checkEventAssets(rootDir, scene, issues);
  }
  return issues;
}
async function checkEventAssets(rootDir, scene, issues) {
  if (!scene || typeof scene !== "object") return;
  const sounds = scene.sounds;
  if (!sounds || typeof sounds !== "object") return;
  for (const [key, value] of Object.entries(sounds)) {
    const file = value?.file;
    if (typeof file !== "string" || !file) continue;
    try {
      await fs.access(path.join(rootDir, file));
    } catch {
      issues.push({ field: file, message: `sonido "${key}": el archivo no existe en el paquete` });
    }
  }
}

// src/api.ts
async function createScaffold(options) {
  const id = options.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const root = path2.join(options.targetDir, id);
  const manifest = {
    id,
    name: options.name,
    version: "0.1.0",
    author: "",
    description: `${options.name} \u2014 extensi\xF3n Scrakk Studio.`,
    engine: ">=0.1.0",
    permissions: [],
    // El packer escribe el bundle acá (ver `SEF.ENTRY`). Sin `entry`, el loader
    // busca `dist/index.js` y la extensión instala sin código.
    entry: SEF.ENTRY,
    contributes: {
      panels: [
        {
          id: `${id}-panel`,
          title: options.name,
          closable: true,
          component: "panels/Panel.tsx"
        }
      ]
    }
  };
  const panelSource = `export default function Panel() {
  return (
    <div style={{ padding: 16, fontSize: 13 }}>
      <strong>${options.name}</strong>
      <p>Mi primera extensi\xF3n de Scrakk Studio.</p>
    </div>
  )
}
`;
  await fs2.mkdir(path2.join(root, "panels"), { recursive: true });
  await fs2.writeFile(
    path2.join(root, SEF.MANIFEST),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  await fs2.writeFile(path2.join(root, "panels", "Panel.tsx"), panelSource);
  return root;
}
function generateModulesEntry(codePaths) {
  const lines = codePaths.map((codePath, index) => {
    const relative = "./" + codePath.replace(/\.tsx?$/, "");
    return `import C${index} from '${relative}'`;
  });
  if (codePaths.length === 0) {
    return `${lines.join("\n")}

export const modules = {}
`;
  }
  const map = codePaths.map((codePath, index) => `  ${JSON.stringify(codePath)}: C${index}`).join(",\n");
  return `${lines.join("\n")}

export const modules = {
${map}
}
`;
}
async function buildBundle(packageRoot) {
  const raw = await fs2.readFile(path2.join(packageRoot, SEF.MANIFEST), "utf-8");
  const manifest = JSON.parse(raw);
  const codePaths = collectCodePaths(manifest);
  const entry = generateModulesEntry(codePaths);
  const compiled = await compileEntry(entry, packageRoot);
  const outPath = path2.join(packageRoot, SEF.ENTRY);
  await fs2.mkdir(path2.dirname(outPath), { recursive: true });
  await fs2.writeFile(outPath, compiled);
  return { outPath, modules: codePaths };
}
async function compileEntry(entry, packageRoot) {
  const bun = globalThis.Bun;
  if (bun) return compileWithBun(bun, entry, packageRoot);
  const esbuild = await import("esbuild");
  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: packageRoot,
      sourcefile: "virtual-modules-entry.ts"
    },
    bundle: true,
    format: "esm",
    jsx: "automatic",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
    external: [...RUNTIME_EXTERNALS]
  });
  return result.outputFiles[0].contents;
}
async function compileWithBun(bun, entry, packageRoot) {
  const entryFile = path2.join(packageRoot, ".sef-entry.tsx");
  await fs2.writeFile(entryFile, entry);
  try {
    const result = await bun.build({
      entrypoints: [entryFile],
      format: "esm",
      target: "browser",
      external: [...RUNTIME_EXTERNALS],
      // NODE_ENV=production → `react/jsx-runtime` (como esbuild), no jsx-dev.
      define: { "process.env.NODE_ENV": '"production"' }
    });
    if (!result.success || result.outputs.length === 0) {
      throw new Error("Bun.build fall\xF3: " + result.logs.map(String).join(" "));
    }
    return new Uint8Array(await result.outputs[0].arrayBuffer());
  } finally {
    await fs2.rm(entryFile, { force: true });
  }
}
async function packSef(packageRoot) {
  const issues = await validatePackage(packageRoot);
  if (issues.length > 0) {
    throw new Error(
      "validaci\xF3n fallida: " + issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")
    );
  }
  const files = {};
  const manifestRaw = await fs2.readFile(path2.join(packageRoot, SEF.MANIFEST), "utf-8");
  const codePaths = new Set(collectCodePaths(JSON.parse(manifestRaw)));
  const addDir = async (dir, zipPrefix) => {
    let entries;
    try {
      entries = await fs2.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path2.join(dir, entry.name);
      const key = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await addDir(full, key);
      } else if (!codePaths.has(key)) {
        files[key] = new Uint8Array(await fs2.readFile(full));
      }
    }
  };
  await addDir(path2.join(packageRoot, SEF.DIST), SEF.DIST);
  await addDir(path2.join(packageRoot, SEF.THEMES_DIR), SEF.THEMES_DIR);
  await addDir(path2.join(packageRoot, SEF.ICONS_DIR), SEF.ICONS_DIR);
  await addDir(path2.join(packageRoot, SEF.PRODUCT_ICONS_DIR), SEF.PRODUCT_ICONS_DIR);
  await addDir(path2.join(packageRoot, SEF.LSP_DIR), SEF.LSP_DIR);
  await addDir(path2.join(packageRoot, SEF.EVENTS_DIR), SEF.EVENTS_DIR);
  await addDir(path2.join(packageRoot, SEF.ASSETS_DIR), SEF.ASSETS_DIR);
  for (const name of ["CREDITS.md", "CREDITS.txt", "LICENSE", "LICENSE.md", "LICENSE.txt"]) {
    try {
      files[name] = new Uint8Array(await fs2.readFile(path2.join(packageRoot, name)));
    } catch {
    }
  }
  files[SEF.MANIFEST] = new Uint8Array(
    await fs2.readFile(path2.join(packageRoot, SEF.MANIFEST))
  );
  const zipped = zipSync(files);
  const outPath = packageRoot.replace(/[\\/]+$/, "") + SEF.EXTENSION_EXT;
  await fs2.writeFile(outPath, zipped);
  return outPath;
}

// src/index.ts
var USAGE = `sef \u2014 Scrakk Studio extension tooling (SEF)

uso:
  sef create <nombre> [dir-destino]   scaffold con panel de ejemplo
  sef build <dir-paquete>             bundle \u2192 dist/modules.js
  sef pack <dir-paquete>              valida y escribe <dir>.sef
  sef validate <dir-paquete>          solo valida

opciones:
  -v, --version                       versi\xF3n del CLI
  -h, --help                          esta ayuda`;
async function readVersion() {
  if (true) return "0.1.3";
  try {
    const url = new URL("../package.json", import.meta.url);
    const raw = await fs3.readFile(url, "utf-8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "create": {
      const name = args[0];
      if (!name) throw new Error("uso: sef create <nombre> [dir]");
      const target = resolve(args[1] ?? ".");
      const root = await createScaffold({ name, targetDir: target });
      console.log(`\u2713 scaffold creado en ${root}`);
      break;
    }
    case "build": {
      const dir = resolve(args[0] ?? ".");
      const { outPath, modules } = await buildBundle(dir);
      console.log(`\u2713 bundle: ${outPath} (${modules.length} m\xF3dulos)`);
      break;
    }
    case "pack": {
      const dir = resolve(args[0] ?? ".");
      const issues = await validatePackage(dir);
      if (issues.length > 0) {
        for (const issue of issues) console.error(`\u2717 ${issue.field}: ${issue.message}`);
        throw new Error("validaci\xF3n fallida \u2014 no se empaqueta");
      }
      const outPath = await packSef(dir);
      console.log(`\u2713 paquete: ${outPath}`);
      break;
    }
    case "validate": {
      const dir = resolve(args[0] ?? ".");
      const issues = await validatePackage(dir);
      if (issues.length === 0) {
        console.log("\u2713 paquete v\xE1lido");
      } else {
        for (const issue of issues) console.error(`\u2717 ${issue.field}: ${issue.message}`);
        process.exitCode = 1;
      }
      break;
    }
    case "version":
    case "-v":
    case "--version":
      console.log(await readVersion());
      break;
    case "help":
    case "-h":
    case "--help":
      console.log(USAGE);
      break;
    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}
main().catch((error) => {
  console.error("\u2717", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
