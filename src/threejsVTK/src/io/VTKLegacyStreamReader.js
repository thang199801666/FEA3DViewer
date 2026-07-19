import { PolyData, DataArray, CellArray } from "../core/PolyData.js";
import { VTKLegacyReader } from "./VTKLegacyReader.js";

async function* tokensFromFile(file, onProgress) {
    const reader = file.stream().getReader();
    const decoder = new TextDecoder();
    let carry = "", loaded = 0, skippedLines = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        let text = carry + decoder.decode(value, { stream: true });
        if (skippedLines < 3) {
            let position = 0;
            while (skippedLines < 3) {
                const newline = text.indexOf("\n", position);
                if (newline < 0) break;
                skippedLines++; position = newline + 1;
            }
            if (skippedLines < 3) { carry = text; continue; }
            text = text.slice(position);
        }
        const endsInWhitespace = /\s$/.test(text);
        const parts = text.split(/\s+/);
        if (parts[0] === "") parts.shift();
        carry = endsInWhitespace ? "" : (parts.pop() ?? "");
        for (const token of parts) if (token) yield token;
        onProgress?.({ stage: "parse-stream", progress: file.size ? loaded / file.size : 0, loadedBytes: loaded, totalBytes: file.size });
    }
    carry += decoder.decode();
    if (carry.trim()) yield carry.trim();
}

/** Out-of-core tokenizer/parser for large ASCII legacy VTK datasets. */
export class VTKLegacyStreamReader {
    async parseFile(file, { onProgress } = {}) {
        const iterator = tokensFromFile(file, onProgress)[Symbol.asyncIterator]();
        const next = async () => {
            const item = await iterator.next();
            if (item.done) throw new Error("Unexpected end of streaming VTK file");
            return item.value;
        };
        const int = async () => Number.parseInt(await next(), 10);
        const number = async () => Number(await next());
        const floats = async (count) => {
            const out = new Float32Array(count);
            for (let i = 0; i < count; ++i) out[i] = await number();
            return out;
        };
        const ints = async (count) => {
            const out = new Int32Array(count);
            for (let i = 0; i < count; ++i) out[i] = await int();
            return out;
        };
        const cells = async (count, size) => {
            const offsets = new Int32Array(count + 1);
            const connectivity = new Int32Array(size - count);
            let write = 0;
            for (let cell = 0; cell < count; ++cell) {
                const n = await int();
                for (let i = 0; i < n; ++i) connectivity[write++] = await int();
                offsets[cell + 1] = write;
            }
            return CellArray.fromOffsetsConnectivity(offsets, connectivity);
        };

        const output = new PolyData();
        let rawCells = null, currentData = output.pointData, tupleCount = 0;
        while (true) {
            const item = await iterator.next();
            if (item.done) break;
            const keyword = item.value.toUpperCase();
            switch (keyword) {
                case "DATASET": await next(); break;
                case "POINTS": { const count = await int(); await next(); output.setPoints(await floats(count * 3)); break; }
                case "VERTICES": { const n = await int(), size = await int(); output.setVerts(await cells(n, size)); break; }
                case "LINES": { const n = await int(), size = await int(); output.setLines(await cells(n, size)); break; }
                case "POLYGONS": { const n = await int(), size = await int(); output.setPolys(await cells(n, size)); break; }
                case "TRIANGLE_STRIPS": { const n = await int(), size = await int(); output.setStrips(await cells(n, size)); break; }
                case "CELLS": { const n = await int(), size = await int(); rawCells = await cells(n, size); break; }
                case "CELL_TYPES": {
                    const count = await int();
                    new VTKLegacyReader()._convertUnstructured(output, rawCells, await ints(count));
                    break;
                }
                case "POINT_DATA": tupleCount = await int(); currentData = output.pointData; break;
                case "CELL_DATA": tupleCount = await int(); currentData = output.cellData; break;
                case "SCALARS": {
                    const name = await next(); await next();
                    let components = 1;
                    const probe = await next();
                    if (/^\d+$/.test(probe)) {
                        components = Number(probe);
                        if ((await next()).toUpperCase() !== "LOOKUP_TABLE") throw new Error("Streaming SCALARS missing LOOKUP_TABLE");
                        await next();
                    } else if (probe.toUpperCase() === "LOOKUP_TABLE") await next();
                    else throw new Error(`Unsupported streaming scalar token ${probe}`);
                    currentData.addArray(new DataArray(name, await floats(tupleCount * components), components), { asScalars: true });
                    break;
                }
                case "VECTORS": {
                    const name = await next(); await next();
                    currentData.addArray(new DataArray(name, await floats(tupleCount * 3), 3), { asVectors: true });
                    break;
                }
                case "NORMALS": { const name = await next(); await next(); currentData.addArray(new DataArray(name, await floats(tupleCount * 3), 3)); break; }
                default: throw new Error(`Streaming parser does not support keyword ${keyword}`);
            }
        }
        onProgress?.({ stage: "parse-stream", progress: 1, loadedBytes: file.size, totalBytes: file.size });
        return output;
    }
}
