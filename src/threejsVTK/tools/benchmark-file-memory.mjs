import { readFile, stat } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { performance } from "node:perf_hooks";
import { VTKReader } from "../src/io/VTKReader.js";
import { initializeSurfaceWasm } from "../src/wasm/surfaceExtractorWasm.js";

const input = process.argv[2];
if (!input) {
    console.error("Usage: node --expose-gc tools/benchmark-file-memory.mjs <large-file.vtk>");
    process.exit(2);
}
const filePath = resolve(input);
if (extname(filePath).toLowerCase() !== ".vtk") {
    console.error("Node benchmark currently supports legacy .vtk; use browser telemetry for .vtp DOM parsing.");
    process.exit(2);
}

global.gc?.();
const before = process.memoryUsage();
const fileInfo = await stat(filePath);
const bytes = await readFile(filePath);
const afterRead = process.memoryUsage();
await initializeSurfaceWasm({ bytes: await readFile(new URL("../src/wasm/surface_extractor.wasm", import.meta.url)) });
const started = performance.now();
const output = new VTKReader({ worker: false }).parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { format: "vtk", fileName: filePath },
);
const elapsedMs = performance.now() - started;
const afterParse = process.memoryUsage();

const mb = (value) => Math.round(value / 1048576 * 10) / 10;
console.log(JSON.stringify({
    file: filePath,
    fileMB: mb(fileInfo.size),
    elapsedMs: Math.round(elapsedMs * 10) / 10,
    points: output.getNumberOfPoints(),
    cells: output.getNumberOfCells(),
    rssMB: { before: mb(before.rss), afterRead: mb(afterRead.rss), afterParse: mb(afterParse.rss) },
    arrayBuffersMB: {
        before: mb(before.arrayBuffers), afterRead: mb(afterRead.arrayBuffers), afterParse: mb(afterParse.arrayBuffers),
    },
    note: "Run on an idle machine; RSS afterParse is a conservative retained-memory measurement, not an OS-level instantaneous peak.",
}, null, 2));
