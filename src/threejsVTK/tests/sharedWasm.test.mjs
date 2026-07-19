import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

console.log("\nShared-memory WASM");
const bytes = await readFile(new URL("../src/wasm/surface_extractor.shared.wasm", import.meta.url));
const memory = new WebAssembly.Memory({ initial: 1, maximum: 65536, shared: true });
const { instance } = await WebAssembly.instantiate(bytes, {
    env: { memory },
    wasi_snapshot_preview1: { proc_exit() {}, fd_close() { return 0; }, fd_seek() { return 0; }, fd_write() { return 0; } },
});
const points = new Float32Array([0, 0, 0, 1, 1, 1]);
const vectors = new Float32Array([1, 0, 0, 0, 2, 0]);
const pointsPtr = 16;
const vectorsPtr = 48;
new Float32Array(memory.buffer, pointsPtr, points.length).set(points);
new Float32Array(memory.buffer, vectorsPtr, vectors.length).set(vectors);
instance.exports.warp_points_range(pointsPtr, points.length, vectorsPtr, vectors.length, 3, 2, 0, 2);
assert.deepEqual(Array.from(new Float32Array(memory.buffer, pointsPtr, points.length)), [2, 0, 0, 1, 5, 1]);
console.log("  ok  imports SharedArrayBuffer memory and executes a disjoint warp range");
