import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { CellType } from "../src/core/CellTypes.js";
import { UnstructuredGrid } from "../src/core/UnstructuredGrid.js";
import { initializeSurfaceWasm } from "../src/wasm/surfaceExtractorWasm.js";

const count = Math.max(1, Number(process.argv[2] ?? 100_000));

function makeTetrahedra() {
    const grid = new UnstructuredGrid();
    const points = new Float32Array(count * 12);
    const connectivity = new Int32Array(count * 4);
    const offsets = new Int32Array(count + 1);
    const types = new Uint8Array(count);
    for (let i = 0; i < count; ++i) {
        const point = i * 4;
        const p = i * 12;
        points.set([i * 2, 0, 0, i * 2 + 1, 0, 0, i * 2, 1, 0, i * 2, 0, 1], p);
        connectivity.set([point, point + 1, point + 2, point + 3], point);
        offsets[i + 1] = point + 4;
        types[i] = CellType.TETRA;
    }
    return grid.setPoints(points).setCells(connectivity, offsets, types);
}

function time(label, fn) {
    const start = performance.now();
    const output = fn();
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(1)} ms (${output.polys.length} faces)`);
    return elapsed;
}

const jsTime = time("JavaScript", () => makeTetrahedra().extractSurface());
const bytes = await readFile(new URL("../src/wasm/surface_extractor.wasm", import.meta.url));
if (!await initializeSurfaceWasm({ bytes })) throw new Error("Unable to initialize Surface WASM");
const wasmTime = time("WASM", () => makeTetrahedra().extractSurface());
console.log(`Speedup: ${(jsTime / wasmTime).toFixed(2)}x`);
