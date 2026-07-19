import { inflate } from "pako";
import { PolyData, DataArray, CellArray } from "../core/PolyData.js";

const TYPES = { Int8: Int8Array, UInt8: Uint8Array, Int16: Int16Array, UInt16: Uint16Array,
    Int32: Int32Array, UInt32: Uint32Array, Float32: Float32Array, Float64: Float64Array };

async function findAppendedPayload(file) {
    const chunkSize = 1024 * 1024;
    let scanned = new Uint8Array(0);
    for (let offset = 0; offset < Math.min(file.size, 32 * chunkSize); offset += chunkSize) {
        const next = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer());
        const merged = new Uint8Array(scanned.length + next.length); merged.set(scanned); merged.set(next, scanned.length); scanned = merged;
        const text = new TextDecoder().decode(scanned);
        const tag = text.indexOf("<AppendedData");
        if (tag < 0) continue;
        const tagEnd = text.indexOf(">", tag);
        const marker = tagEnd >= 0 ? text.indexOf("_", tagEnd) : -1;
        if (marker < 0) continue;
        const tagText = text.slice(tag, tagEnd + 1);
        if (!/encoding\s*=\s*["']raw["']/i.test(tagText)) return null;
        return { payloadOffset: marker + 1, xml: text.slice(0, tag) + "</VTKFile>" };
    }
    return null;
}

function typed(bytes, type, littleEndian) {
    const T = TYPES[type];
    if (!T) throw new Error(`VTP streaming: unsupported type ${type}`);
    if (littleEndian || T.BYTES_PER_ELEMENT === 1) return new T(bytes.slice().buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new T(bytes.byteLength / T.BYTES_PER_ELEMENT);
    const method = new Map([[Int16Array,"getInt16"],[Uint16Array,"getUint16"],[Int32Array,"getInt32"],
        [Uint32Array,"getUint32"],[Float32Array,"getFloat32"],[Float64Array,"getFloat64"]]).get(T);
    for (let i = 0; i < out.length; ++i) out[i] = view[method](i * T.BYTES_PER_ELEMENT, false);
    return out;
}

export class VTPStreamReader {
    static async canParse(file) { return !!(await findAppendedPayload(file)); }

    async parseFile(file, { onProgress } = {}) {
        const located = await findAppendedPayload(file);
        if (!located) throw new Error("VTP streaming requires AppendedData encoding=raw");
        const doc = new DOMParser().parseFromString(located.xml, "application/xml");
        const root = doc.querySelector("VTKFile");
        const piece = doc.querySelector("PolyData > Piece");
        if (!root || !piece) throw new Error("Invalid streaming VTP XML header");
        const little = (root.getAttribute("byte_order") || "LittleEndian") === "LittleEndian";
        const wordSize = root.getAttribute("header_type") === "UInt64" ? 8 : 4;
        const compressed = !!root.getAttribute("compressor");
        const readWord = async (absolute) => {
            const bytes = await file.slice(absolute, absolute + wordSize).arrayBuffer();
            if (bytes.byteLength !== wordSize) throw new Error("Truncated VTP streaming header");
            const view = new DataView(bytes);
            return wordSize === 8 ? Number(view.getBigUint64(0, little)) : view.getUint32(0, little);
        };
        let arraysRead = 0;
        const elements = Array.from(piece.querySelectorAll("DataArray[format='appended']"));
        const readArray = async (element) => {
            const relative = Number(element.getAttribute("offset") || 0);
            const start = located.payloadOffset + relative;
            let raw;
            if (!compressed) {
                const size = await readWord(start);
                raw = new Uint8Array(await file.slice(start + wordSize, start + wordSize + size).arrayBuffer());
            } else {
                const blocks = await readWord(start);
                if (blocks > 1000000) throw new Error("Unreasonable VTP compressed block count");
                const headerSize = (3 + blocks) * wordSize;
                const header = new Uint8Array(await file.slice(start, start + headerSize).arrayBuffer());
                const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
                const word = (offset) => wordSize === 8 ? Number(view.getBigUint64(offset, little)) : view.getUint32(offset, little);
                const sizes = Array.from({ length: blocks }, (_, i) => word((3 + i) * wordSize));
                const chunks = []; let position = start + headerSize, total = 0;
                for (const size of sizes) {
                    const zipped = new Uint8Array(await file.slice(position, position + size).arrayBuffer());
                    const chunk = inflate(zipped); chunks.push(chunk); total += chunk.byteLength; position += size;
                }
                raw = new Uint8Array(total); let write = 0;
                for (const chunk of chunks) { raw.set(chunk, write); write += chunk.byteLength; }
            }
            arraysRead++;
            onProgress?.({ stage: "vtp-array-stream", progress: elements.length ? arraysRead / elements.length : 1,
                arraysRead, totalArrays: elements.length });
            return typed(raw, element.getAttribute("type") || "Float32", little);
        };
        const cells = async (section) => {
            if (!section) return new CellArray();
            let connectivity, offsets;
            for (const element of section.querySelectorAll(":scope > DataArray")) {
                const data = await readArray(element);
                if (element.getAttribute("Name") === "connectivity") connectivity = data;
                else if (element.getAttribute("Name") === "offsets") offsets = data;
            }
            return connectivity && offsets ? CellArray.fromOffsetsConnectivity(Int32Array.from([0, ...offsets]), Int32Array.from(connectivity)) : new CellArray();
        };
        const output = new PolyData();
        const points = piece.querySelector("Points > DataArray");
        if (points) output.setPoints(Float32Array.from(await readArray(points)));
        output.verts = await cells(piece.querySelector("Verts")); output.lines = await cells(piece.querySelector("Lines"));
        output.polys = await cells(piece.querySelector("Polys")); output.strips = await cells(piece.querySelector("Strips"));
        for (const [selector, target] of [["PointData", output.pointData], ["CellData", output.cellData]]) {
            const section = piece.querySelector(selector); if (!section) continue;
            for (const element of section.querySelectorAll(":scope > DataArray")) {
                const name = element.getAttribute("Name") || "unnamed";
                target.addArray(new DataArray(name, Float32Array.from(await readArray(element)), Number(element.getAttribute("NumberOfComponents") || 1)),
                    { asScalars: section.getAttribute("Scalars") === name, asVectors: section.getAttribute("Vectors") === name });
            }
        }
        return output;
    }
}
