// Builds the editor page (editor-src/) into one self-contained HTML document and writes it to
// pyxpo_rich_editor/_bundle.py, which the Python component sends to the native web view.
//
// The page has no network access of its own, so everything is inlined: Tiptap, marked, the CSS and the icons.
//
//   node tools/build_bundle.mjs [--modules <node_modules dir>]
//
// The packages come from a node_modules folder holding @tiptap/* 3.x, marked, lucide-react and esbuild
// (EDITOR_NODE_MODULES or --modules). Nothing is written there.
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--modules");
const modules = resolve(
  flag > 0 ? process.argv[flag + 1] : process.env.EDITOR_NODE_MODULES ?? join(root, "node_modules"),
);
if (!existsSync(join(modules, "@tiptap", "core"))) {
  console.error(`No @tiptap/core under ${modules}. Pass --modules <node_modules dir> or set EDITOR_NODE_MODULES.`);
  process.exit(1);
}
const require = createRequire(join(modules, "noop.js"));
const esbuild = require("esbuild");
const src = join(root, "editor-src");

// Every quoted kebab-case word in the sources that names a lucide icon is an icon the page uses.
function iconModule() {
  const dir = join(modules, "lucide-react", "dist", "esm", "icons");
  const names = new Set();
  for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    for (const [, name] of readFileSync(join(src, file), "utf8").matchAll(/"([a-z][a-z0-9]*(?:-[a-z0-9]+)*)"/g)) {
      if (existsSync(join(dir, `${name}.mjs`))) names.add(name);
    }
  }
  const icons = {};
  for (const name of [...names].sort()) {
    let text = readFileSync(join(dir, `${name}.mjs`), "utf8");
    // An old name re-exports the icon it became.
    const alias = text.match(/export \{ default \} from '\.\/([a-z0-9-]+)\.mjs'/);
    if (alias) text = readFileSync(join(dir, `${alias[1]}.mjs`), "utf8");
    const match = text.match(/const __iconData = (\{[\s\S]*?\n\});\n/);
    if (!match) continue; // index.mjs and the like: a word, not an icon
    const nodes = Function(`return ${match[1]}`)().node;
    const kids = nodes
      .map(([tag, attrs]) => {
        const list = Object.entries(attrs)
          .filter(([key]) => key !== "key")
          .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${value}"`)
          .join(" ");
        return `<${tag} ${list}/>`;
      })
      .join("");
    icons[name] =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
  }
  return { icons, source: `export default ${JSON.stringify(icons)};` };
}

const { icons, source } = iconModule();
const result = await esbuild.build({
  entryPoints: [join(src, "main.ts")],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  target: ["safari15", "chrome90"],
  nodePaths: [modules],
  loader: { ".css": "text" },
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "icons",
      setup(build) {
        build.onResolve({ filter: /^virtual:icons$/ }, () => ({ path: "icons", namespace: "icons" }));
        build.onLoad({ filter: /.*/, namespace: "icons" }, () => ({ contents: source, loader: "js" }));
      },
    },
  ],
});
for (const warning of result.warnings) console.warn(warning.text);
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html =
  "<!doctype html><html><head><meta charset=utf-8>" +
  '<meta name=viewport content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">' +
  `</head><body><div id=app></div><script>${js}</script></body></html>`;

// The English labels, for Python to list: the page's own copy of them is in the bundle above.
const labels = await esbuild.build({
  entryPoints: [join(src, "labels.ts")], bundle: true, write: false, format: "cjs", platform: "neutral",
});
const mod = { exports: {} };
Function("module", "exports", labels.outputFiles[0].text)(mod, mod.exports);

const out = join(root, "pyxpo_rich_editor", "_bundle.py");
writeFileSync(
  out,
  '"""The editor page, built from editor-src/ by tools/build_bundle.mjs. Do not edit by hand."""\n' +
    `LABELS = ${JSON.stringify(mod.exports.DEFAULT_LABELS, null, 4)}\n\n` +
    `HTML = ${JSON.stringify(html)}\n`,
);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KiB, ${Object.keys(icons).length} icons`);
