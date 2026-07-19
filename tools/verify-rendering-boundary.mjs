import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
const libraryRoot = fileURLToPath(new URL("../src/threejsVTK/", import.meta.url));
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const violations = [];

async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            await visit(path);
            continue;
        }
        if (!sourceExtensions.has(extname(entry.name))) continue;
        const contents = await readFile(path, "utf8");
        if (/\bfrom\s*["']three(?:\/[^"']*)?["']|\brequire\(\s*["']three/.test(contents)) {
            violations.push(relative(sourceRoot, path));
        }
    }
}

for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if (entry.name === "threejsVTK") continue;
    const path = join(sourceRoot, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (sourceExtensions.has(extname(entry.name))) {
        const contents = await readFile(path, "utf8");
        if (/\bfrom\s*["']three(?:\/[^"']*)?["']|\brequire\(\s*["']three/.test(contents)) {
            violations.push(relative(sourceRoot, path));
        }
    }
}

if (violations.length) {
    console.error("Application code must access Three.js through threejsVTK:\n" + violations.join("\n"));
    process.exitCode = 1;
} else {
    console.log(`Rendering boundary verified; backend is isolated in ${libraryRoot}`);
}
