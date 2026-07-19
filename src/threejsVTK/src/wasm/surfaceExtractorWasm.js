import { CellArray } from "../core/CellArray.js";
import { DataArray } from "../core/FieldData.js";
import { PolyData } from "../core/PolyData.js";

let wasm = null;
let loadPromise = null;
let lastError = null;
let sharedKernelPromise = null;

const defaultUrl = new URL("./surface_extractor.wasm", import.meta.url);
const simdUrl = new URL("./surface_extractor.simd.wasm", import.meta.url);
const sharedUrl = new URL("./surface_extractor.shared.wasm", import.meta.url);

function exportFunction(exports, name) {
    const fn = exports[name] ?? exports[`_${name}`];
    if (typeof fn !== "function") throw new Error(`Surface WASM is missing export: ${name}`);
    return fn;
}

async function instantiate(source, { sharedMemory = false } = {}) {
    const importedMemory = sharedMemory
        ? new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true })
        : null;
    const imports = {
        env: importedMemory ? { memory: importedMemory } : {},
        wasi_snapshot_preview1: {
            proc_exit(code) { throw new Error(`Surface WASM exited with code ${code}`); },
            fd_close() { return 0; },
            fd_seek() { return 0; },
            fd_write() { return 0; },
        },
    };

    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        const bytes = source instanceof ArrayBuffer
            ? source
            : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
        return WebAssembly.instantiate(bytes, imports);
    }

    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to load Surface WASM (${response.status} ${response.statusText})`);
    if (WebAssembly.instantiateStreaming) {
        try {
            return await WebAssembly.instantiateStreaming(response.clone(), imports);
        } catch {
            // Dev servers may serve .wasm with an incorrect MIME type.
        }
    }
    return WebAssembly.instantiate(await response.arrayBuffer(), imports);
}

/**
 * Loads the optional surface-extraction accelerator. Calling this once during
 * app startup makes subsequent UnstructuredGrid.extractSurface() calls use
 * WASM synchronously. Until it resolves, the existing JavaScript path remains active.
 */
export function initializeSurfaceWasm({ url = defaultUrl, bytes = null } = {}) {
    if (wasm) return Promise.resolve(true);
    if (loadPromise) return loadPromise;

    const capabilities = getWasmCapabilities();
    const useDefault = bytes == null && String(url) === String(defaultUrl);
    const useShared = false;
    const selectedUrl = useDefault && capabilities.simd ? simdUrl : url;
    loadPromise = instantiate(bytes ?? selectedUrl)
        .then((result) => {
            const exports = result.instance?.exports ?? result.exports;
            if (!(exports.memory instanceof WebAssembly.Memory)) {
                throw new Error("Surface WASM does not export linear memory");
            }
            exportFunction(exports, "__wasm_call_ctors")();
            wasm = {
                exports,
                module: result.module,
                malloc: exportFunction(exports, "malloc"),
                free: exportFunction(exports, "free"),
                extract: exportFunction(exports, "surface_extract"),
                sharedMemory: useShared,
            };
            lastError = null;
            return true;
        })
        .catch((error) => {
            lastError = error;
            loadPromise = null;
            return false;
        });
    return loadPromise;
}

export function getSurfaceWasmStatus() {
    return {
        ready: wasm !== null,
        sharedMemory: wasm?.sharedMemory ?? false,
        loading: loadPromise !== null && wasm === null,
        error: lastError,
    };
}

export function getWasmCapabilities() {
    let simd = false;
    try {
        // Minimal v128.const module. Validation is a safe feature test and does not instantiate it.
        simd = WebAssembly.validate(Uint8Array.from([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,22,1,20,0,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,11]));
    } catch { simd = false; }
    const threads = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;
    return { simd, threads, crossOriginIsolated: globalThis.crossOriginIsolated === true };
}

function copyExportedArray(exports, prefix) {
    const ptr = exportFunction(exports, `${prefix}_ptr`)();
    const length = exportFunction(exports, `${prefix}_len`)();
    if (!length) return new Int32Array(0);
    return new Int32Array(exports.memory.buffer, ptr, length).slice();
}

function copyPointOutput(exports) {
    const ptr = exportFunction(exports, "point_output_ptr")();
    const length = exportFunction(exports, "point_output_len")();
    if (!length) return new Float32Array(0);
    return new Float32Array(exports.memory.buffer, ptr, length).slice();
}

function copyScalarOutput(exports) {
    const ptr = exportFunction(exports, "scalar_output_ptr")();
    const length = exportFunction(exports, "scalar_output_len")();
    if (!length) return new Float32Array(0);
    return new Float32Array(exports.memory.buffer, ptr, length).slice();
}

function copyExportedFloatArray(exports, prefix) {
    const ptr = exportFunction(exports, `${prefix}_ptr`)();
    const length = exportFunction(exports, `${prefix}_len`)();
    if (!length) return new Float32Array(0);
    return new Float32Array(exports.memory.buffer, ptr, length).slice();
}

function copyInput(runtime, values) {
    const ptr = runtime.malloc(values.byteLength);
    if (!ptr && values.byteLength) throw new Error("Surface WASM ran out of memory");
    new Uint8Array(runtime.exports.memory.buffer, ptr, values.byteLength)
        .set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));
    return ptr;
}

function buildOutput(grid, raw, passCellData) {
    const out = new PolyData();
    out.setPoints(grid.points instanceof Float32Array ? grid.points : Float32Array.from(grid.points));
    out.setPolys(CellArray.fromOffsetsConnectivity(raw.polyOffsets, raw.polyConnectivity));
    out.setStrips(CellArray.fromOffsetsConnectivity(raw.stripOffsets, raw.stripConnectivity));

    let cellsCache = null;
    const srcConn = grid.connectivity, srcOffsets = grid.offsets, srcTypes = grid.cellTypes;
    Object.defineProperty(out, "cells", {
        configurable: true,
        enumerable: true,
        get() {
            if (!cellsCache) {
                cellsCache = Array.from(raw.polySources, (sourceCell) => ({
                    type: srcTypes[sourceCell],
                    points: Array.from(srcConn.subarray(srcOffsets[sourceCell], srcOffsets[sourceCell + 1])),
                }));
            }
            return cellsCache;
        },
        set(value) { cellsCache = value; },
    });

    const surfaceCellMap = new Int32Array(raw.polySources.length + raw.stripSources.length);
    surfaceCellMap.set(raw.polySources);
    surfaceCellMap.set(raw.stripSources, raw.polySources.length);
    out.userData.surfaceCellMap = surfaceCellMap;
    out.userData.polySourceCellMap = raw.polySources;
    out.userData.stripSourceCellMap = raw.stripSources;

    for (const array of grid.pointData.arrays.values()) {
        out.pointData.addArray(array.clone(), {
            asScalars: grid.pointData.activeScalars === array.name,
            asVectors: grid.pointData.activeVectors === array.name,
        });
    }

    if (passCellData) {
        for (const array of grid.cellData.arrays.values()) {
            const components = array.numberOfComponents;
            const values = new Float32Array(raw.polySources.length * components);
            for (let i = 0; i < raw.polySources.length; ++i) {
                const sourceCell = raw.polySources[i];
                for (let c = 0; c < components; ++c) {
                    values[i * components + c] = array.getComponent(sourceCell, c);
                }
            }
            out.cellData.addArray(new DataArray(array.name, values, components), {
                asScalars: grid.cellData.activeScalars === array.name,
            });
        }
    }
    return out;
}

/** Returns null while the optional module is unavailable, enabling a zero-risk JS fallback. */
export function tryExtractSurfaceWasm(grid, passCellData) {
    if (!wasm) return null;

    const runtime = wasm;
    const pointers = [];
    try {
        // Allocate all blocks first because memory growth invalidates existing JS views.
        const connectivityPtr = copyInput(runtime, grid.connectivity); pointers.push(connectivityPtr);
        const offsetsPtr = copyInput(runtime, grid.offsets); pointers.push(offsetsPtr);
        const typesPtr = copyInput(runtime, grid.cellTypes); pointers.push(typesPtr);

        const code = runtime.extract(
            connectivityPtr, grid.connectivity.length,
            offsetsPtr, grid.offsets.length,
            typesPtr, grid.cellTypes.length,
        );
        if (code !== 0) throw new Error(`Surface WASM rejected the grid (code ${code})`);

        const exports = runtime.exports;
        return buildOutput(grid, {
            polyOffsets: copyExportedArray(exports, "surface_poly_offsets"),
            polyConnectivity: copyExportedArray(exports, "surface_poly_connectivity"),
            polySources: copyExportedArray(exports, "surface_poly_sources"),
            stripOffsets: copyExportedArray(exports, "surface_strip_offsets"),
            stripConnectivity: copyExportedArray(exports, "surface_strip_connectivity"),
            stripSources: copyExportedArray(exports, "surface_strip_sources"),
        }, passCellData);
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) runtime.free(ptr);
    }
}

export function tryWarpPointsWasm(points, vectors, vectorComponents, scale) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const vectorValues = vectors instanceof Float32Array ? vectors : Float32Array.from(vectors);
    const pointers = [];
    try {
        const pointsPtr = copyInput(wasm, pointValues); pointers.push(pointsPtr);
        const vectorsPtr = copyInput(wasm, vectorValues); pointers.push(vectorsPtr);
        const code = exportFunction(wasm.exports, "warp_points")(
            pointsPtr, pointValues.length,
            vectorsPtr, vectorValues.length,
            vectorComponents, Number(scale),
        );
        if (code !== 0) throw new Error(`Warp WASM rejected the input (code ${code})`);
        return copyPointOutput(wasm.exports);
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) wasm.free(ptr);
    }
}

export async function tryWarpPointsParallelWasm(points, vectors, vectorComponents, scale, { threads } = {}) {
    if (!getWasmCapabilities().threads || typeof Worker === "undefined") return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const vectorValues = vectors instanceof Float32Array ? vectors : Float32Array.from(vectors);
    const pointCount = pointValues.length / 3;
    const workerCount = Math.max(1, Math.min(threads ?? globalThis.navigator?.hardwareConcurrency ?? 4, 8, Math.ceil(pointCount / 100000)));
    if (workerCount < 2) return null;
    sharedKernelPromise ??= fetch(sharedUrl).then(async (response) => WebAssembly.compile(await response.arrayBuffer()));
    const module = await sharedKernelPromise;
    const pointsPtr = 16;
    const vectorsPtr = (pointsPtr + pointValues.byteLength + 15) & ~15;
    const requiredBytes = vectorsPtr + vectorValues.byteLength;
    const pages = Math.max(1, Math.ceil(requiredBytes / 65536));
    const memory = new WebAssembly.Memory({ initial: pages, maximum: 65536, shared: true });
    new Float32Array(memory.buffer, pointsPtr, pointValues.length).set(pointValues);
    new Float32Array(memory.buffer, vectorsPtr, vectorValues.length).set(vectorValues);
    try {
        const jobs = [];
        for (let index = 0; index < workerCount; ++index) {
            const startPoint = Math.floor(pointCount * index / workerCount);
            const endPoint = Math.floor(pointCount * (index + 1) / workerCount);
            jobs.push(new Promise((resolve, reject) => {
                const worker = new Worker(new URL("./sharedWasm.worker.js", import.meta.url), { type: "module" });
                worker.onmessage = ({ data }) => {
                    worker.terminate();
                    data.ok ? resolve() : reject(new Error(data.message));
                };
                worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)); };
                worker.postMessage({
                    module, memory,
                    pointsPtr, pointValueCount: pointValues.length,
                    vectorsPtr, vectorValueCount: vectorValues.length,
                    vectorComponents, scale, startPoint, endPoint,
                });
            }));
        }
        await Promise.all(jobs);
        return new Float32Array(memory.buffer, pointsPtr, pointValues.length).slice();
    } catch (error) {
        lastError = error;
        return null;
    } finally {}
}

export function trySmoothPointsWasm(points, triangles, iterations, relaxation) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const triangleValues = triangles instanceof Int32Array ? triangles : Int32Array.from(triangles);
    const pointers = [];
    try {
        const pointsPtr = copyInput(wasm, pointValues); pointers.push(pointsPtr);
        const trianglesPtr = copyInput(wasm, triangleValues); pointers.push(trianglesPtr);
        const code = exportFunction(wasm.exports, "smooth_points")(
            pointsPtr, pointValues.length,
            trianglesPtr, triangleValues.length,
            Math.max(0, Math.trunc(iterations)), Number(relaxation),
        );
        if (code !== 0) throw new Error(`Smooth WASM rejected the input (code ${code})`);
        return copyPointOutput(wasm.exports);
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) wasm.free(ptr);
    }
}

export function tryContourLinesWasm(points, triangles, scalars, isoValues) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const triangleValues = triangles instanceof Int32Array ? triangles : Int32Array.from(triangles);
    const scalarValues = scalars instanceof Float32Array ? scalars : Float32Array.from(scalars);
    const isoValueArray = isoValues instanceof Float32Array ? isoValues : Float32Array.from(isoValues);
    const pointers = [];
    try {
        const pointsPtr = copyInput(wasm, pointValues); pointers.push(pointsPtr);
        const trianglesPtr = copyInput(wasm, triangleValues); pointers.push(trianglesPtr);
        const scalarsPtr = copyInput(wasm, scalarValues); pointers.push(scalarsPtr);
        const isoPtr = copyInput(wasm, isoValueArray); pointers.push(isoPtr);
        const code = exportFunction(wasm.exports, "contour_lines")(
            pointsPtr, pointValues.length,
            trianglesPtr, triangleValues.length,
            scalarsPtr, scalarValues.length,
            isoPtr, isoValueArray.length,
        );
        if (code !== 0) throw new Error(`Contour WASM rejected the input (code ${code})`);
        return {
            points: copyPointOutput(wasm.exports),
            scalars: copyScalarOutput(wasm.exports),
        };
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) wasm.free(ptr);
    }
}

export function tryClipTrianglesWasm(points, triangles, normal, origin, insideOut) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const triangleValues = triangles instanceof Int32Array ? triangles : Int32Array.from(triangles);
    const pointers = [];
    try {
        const pointsPtr = copyInput(wasm, pointValues); pointers.push(pointsPtr);
        const trianglesPtr = copyInput(wasm, triangleValues); pointers.push(trianglesPtr);
        const code = exportFunction(wasm.exports, "clip_triangles")(
            pointsPtr, pointValues.length, trianglesPtr, triangleValues.length,
            Number(normal[0]), Number(normal[1]), Number(normal[2]),
            Number(origin[0]), Number(origin[1]), Number(origin[2]), insideOut ? 1 : 0,
        );
        if (code !== 0) throw new Error(`Clip WASM rejected the input (code ${code})`);
        return {
            points: copyPointOutput(wasm.exports),
            polyOffsets: copyExportedArray(wasm.exports, "surface_poly_offsets"),
            polyConnectivity: copyExportedArray(wasm.exports, "surface_poly_connectivity"),
            sourceA: copyExportedArray(wasm.exports, "interpolation_source_a"),
            sourceB: copyExportedArray(wasm.exports, "interpolation_source_b"),
            amount: copyExportedFloatArray(wasm.exports, "interpolation_amount"),
        };
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) wasm.free(ptr);
    }
}

export function tryCutSegmentsWasm(points, triangles, normal, origin) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    const triangleValues = triangles instanceof Int32Array ? triangles : Int32Array.from(triangles);
    const pointers = [];
    try {
        const pointsPtr = copyInput(wasm, pointValues); pointers.push(pointsPtr);
        const trianglesPtr = copyInput(wasm, triangleValues); pointers.push(trianglesPtr);
        const code = exportFunction(wasm.exports, "cut_segments")(
            pointsPtr, pointValues.length, trianglesPtr, triangleValues.length,
            Number(normal[0]), Number(normal[1]), Number(normal[2]),
            Number(origin[0]), Number(origin[1]), Number(origin[2]),
        );
        if (code !== 0) throw new Error(`Cutter WASM rejected the input (code ${code})`);
        return {
            points: copyPointOutput(wasm.exports),
            segments: copyExportedArray(wasm.exports, "surface_poly_connectivity"),
            sourceA: copyExportedArray(wasm.exports, "interpolation_source_a"),
            sourceB: copyExportedArray(wasm.exports, "interpolation_source_b"),
            amount: copyExportedFloatArray(wasm.exports, "interpolation_amount"),
        };
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        for (const ptr of pointers) wasm.free(ptr);
    }
}

export function tryWeldPointsWasm(points, tolerance) {
    if (!wasm) return null;
    const pointValues = points instanceof Float32Array ? points : Float32Array.from(points);
    let pointsPtr = 0;
    try {
        pointsPtr = copyInput(wasm, pointValues);
        const code = exportFunction(wasm.exports, "weld_points")(
            pointsPtr, pointValues.length, Number(tolerance),
        );
        if (code !== 0) throw new Error(`Weld WASM rejected the input (code ${code})`);
        return {
            canon: copyExportedArray(wasm.exports, "surface_poly_connectivity"),
            count: exportFunction(wasm.exports, "weld_unique_count")(),
            tolerance,
        };
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        if (pointsPtr) wasm.free(pointsPtr);
    }
}

export function tryParseAsciiWasm(text, type) {
    if (!wasm || text.length < 4096 || (type !== "Float32" && type !== "Int32")) return null;
    const bytes = new TextEncoder().encode(text);
    let bytesPtr = 0;
    try {
        bytesPtr = copyInput(wasm, bytes);
        const functionName = type === "Float32" ? "parse_ascii_f32" : "parse_ascii_i32";
        const code = exportFunction(wasm.exports, functionName)(bytesPtr, bytes.length);
        if (code !== 0) throw new Error(`ASCII WASM parser rejected input (code ${code})`);
        return type === "Float32"
            ? copyPointOutput(wasm.exports)
            : copyExportedArray(wasm.exports, "surface_poly_connectivity");
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        if (bytesPtr) wasm.free(bytesPtr);
    }
}

export function tryDecodeBase64Wasm(input) {
    if (!wasm) return null;
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    if (!ArrayBuffer.isView(bytes)) return null;
    let inputPtr = 0;
    try {
        inputPtr = copyInput(wasm, bytes);
        const code = exportFunction(wasm.exports, "decode_base64")(inputPtr, bytes.byteLength);
        if (code !== 0) return null;
        const ptr = exportFunction(wasm.exports, "byte_output_ptr")();
        const length = exportFunction(wasm.exports, "byte_output_len")();
        return new Uint8Array(wasm.exports.memory.buffer, ptr, length).slice();
    } catch (error) {
        lastError = error;
        return null;
    } finally {
        if (inputPtr) wasm.free(inputPtr);
    }
}
