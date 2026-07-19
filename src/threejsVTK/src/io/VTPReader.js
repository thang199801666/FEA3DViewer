// IO/VTPReader.js
//
// PERFORMANCE-OPTIMIZED VERSION
// - base64 decoding: lookup-table decoder replaces atob() + charCodeAt loop.
//   No intermediate binary string, no whitespace-stripping regex copies.
//   For base64 <AppendedData>, decoding happens directly from the raw file
//   bytes without ever materializing the payload as a JS string.
// - ASCII DataArrays: numbers are scanned in place from charCodes instead of
//   split(/\s+/).map(Number), avoiding millions of temporary strings.
// - Redundant Float32Array copies are skipped when data is already Float32.

import { PolyData, DataArray } from "../core/PolyData.js";
import { tryDecodeBase64Wasm, tryParseAsciiWasm } from "../wasm/surfaceExtractorWasm.js";
import { inflate } from "pako";

const TYPED = {
    Int8: Int8Array, UInt8: Uint8Array,
    Int16: Int16Array, Uint16: Uint16Array,
    Int32: Int32Array, UInt32: Uint32Array,
    Float32: Float32Array, Float64: Float64Array
};

// ---------------------------------------------------------------------------
// Fast base64 (lookup table, whitespace skipped inline)
// ---------------------------------------------------------------------------

const B64_LUT = (() => {
    const lut = new Int8Array(256).fill(-1);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < 64; i++) lut[alphabet.charCodeAt(i)] = i;
    return lut;
})();

/**
 * Decode base64 from a string. Whitespace, padding and the leading '_'
 * marker of VTK appended sections are skipped automatically.
 * Hot path decodes clean 4-char groups directly into 3 bytes (unrolled);
 * a bit-accumulator slow path handles groups interrupted by whitespace,
 * then re-enters the fast path. No atob(), no intermediate binary string,
 * no whitespace-stripping regex copy of the (potentially huge) input.
 */
function base64ToBytes(b64) {
    const len = b64.length;
    // Upper-bound allocation; exact length returned via subarray.
    const out = new Uint8Array(((len >> 2) + 1) * 3);
    let o = 0, i = 0;
    while (i + 4 <= len) {
        const a = B64_LUT[b64.charCodeAt(i)];
        const b = B64_LUT[b64.charCodeAt(i + 1)];
        const c = B64_LUT[b64.charCodeAt(i + 2)];
        const d = B64_LUT[b64.charCodeAt(i + 3)];
        if ((a | b | c | d) < 0) break;            // whitespace/padding ahead
        const v = (a << 18) | (b << 12) | (c << 6) | d;
        out[o] = v >> 16; out[o + 1] = (v >> 8) & 0xff; out[o + 2] = v & 0xff;
        o += 3; i += 4;
    }
    let acc = 0, bits = 0;
    while (i < len) {
        const v = B64_LUT[b64.charCodeAt(i)];
        if (v < 0) { i++; continue; }              // skip whitespace / '=' / '_'
        if (bits === 0 && i + 4 <= len) {          // try to re-enter fast path
            const b = B64_LUT[b64.charCodeAt(i + 1)];
            const c = B64_LUT[b64.charCodeAt(i + 2)];
            const d = B64_LUT[b64.charCodeAt(i + 3)];
            if ((b | c | d) >= 0) {
                const w = (v << 18) | (b << 12) | (c << 6) | d;
                out[o] = w >> 16; out[o + 1] = (w >> 8) & 0xff; out[o + 2] = w & 0xff;
                o += 3; i += 4; continue;
            }
        }
        acc = (acc << 6) | v; bits += 6; i++;
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
    }
    return out.subarray(0, o);
}

/**
 * Same decoder operating directly on raw bytes (e.g. a subarray of the file
 * buffer) — skips the bytes -> string round trip entirely.
 */
function base64BytesToBytes(u8) {
    const len = u8.length;
    const out = new Uint8Array(((len >> 2) + 1) * 3);
    let o = 0, i = 0;
    while (i + 4 <= len) {
        const a = B64_LUT[u8[i]];
        const b = B64_LUT[u8[i + 1]];
        const c = B64_LUT[u8[i + 2]];
        const d = B64_LUT[u8[i + 3]];
        if ((a | b | c | d) < 0) break;
        const v = (a << 18) | (b << 12) | (c << 6) | d;
        out[o] = v >> 16; out[o + 1] = (v >> 8) & 0xff; out[o + 2] = v & 0xff;
        o += 3; i += 4;
    }
    let acc = 0, bits = 0;
    while (i < len) {
        const v = B64_LUT[u8[i]];
        if (v < 0) { i++; continue; }
        if (bits === 0 && i + 4 <= len) {
            const b = B64_LUT[u8[i + 1]];
            const c = B64_LUT[u8[i + 2]];
            const d = B64_LUT[u8[i + 3]];
            if ((b | c | d) >= 0) {
                const w = (v << 18) | (b << 12) | (c << 6) | d;
                out[o] = w >> 16; out[o + 1] = (w >> 8) & 0xff; out[o + 2] = w & 0xff;
                o += 3; i += 4; continue;
            }
        }
        acc = (acc << 6) | v; bits += 6; i++;
        if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
    }
    return out.subarray(0, o);
}

function bytesToTyped(bytes, type, littleEndian = true) {
    if (type === "Int64" || type === "UInt64") {
        const n = bytes.byteLength >> 3;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = new Float64Array(n);
        if (type === "Int64") {
            for (let i = 0; i < n; i++) out[i] = Number(dv.getBigInt64(i * 8, littleEndian));
        } else {
            for (let i = 0; i < n; i++) out[i] = Number(dv.getBigUint64(i * 8, littleEndian));
        }
        return out;
    }
    const T = TYPED[type];
    if (!T) throw new Error(`VTPReader: Unsupported data type "${type}"`);
    if (!littleEndian && T.BYTES_PER_ELEMENT > 1) {
        if (bytes.byteLength % T.BYTES_PER_ELEMENT !== 0) {
            throw new Error(`VTPReader: ${type} byte block has invalid length ${bytes.byteLength}`);
        }
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = new T(bytes.byteLength / T.BYTES_PER_ELEMENT);
        const readers = new Map([
            [Int16Array, "getInt16"], [Uint16Array, "getUint16"],
            [Int32Array, "getInt32"], [Uint32Array, "getUint32"],
            [Float32Array, "getFloat32"], [Float64Array, "getFloat64"],
        ]);
        const reader = readers.get(T);
        for (let i = 0; i < out.length; ++i) out[i] = dv[reader](i * T.BYTES_PER_ELEMENT, false);
        return out;
    }
    // One compact copy: guarantees alignment and releases the big file buffer.
    const copy = bytes.slice();
    return new T(copy.buffer);
}

// ---------------------------------------------------------------------------
// Fast ASCII number scanning (see comments in VTKLegacyReader for details)
// ---------------------------------------------------------------------------

function countTokens(text) {
    let n = 0, inTok = false;
    for (let i = 0; i < text.length; i++) {
        const ws = text.charCodeAt(i) <= 32;
        if (!ws && !inTok) { n++; inTok = true; }
        else if (ws) inTok = false;
    }
    return n;
}

function scanNumbers(text, out) {
    const end = text.length;
    const count = out.length;
    let i = 0, w = 0;
    while (w < count && i < end) {
        let c = text.charCodeAt(i);
        while (c <= 32) {
            if (++i >= end) return w;
            c = text.charCodeAt(i);
        }
        const tokStart = i;
        let sign = 1;
        if (c === 45) { sign = -1; c = ++i < end ? text.charCodeAt(i) : 0; }
        else if (c === 43) { c = ++i < end ? text.charCodeAt(i) : 0; }

        let mant = 0, digits = 0, exp = 0, ok = false;
        while (c >= 48 && c <= 57) {
            mant = mant * 10 + (c - 48);
            digits++; ok = true;
            c = ++i < end ? text.charCodeAt(i) : 0;
        }
        if (c === 46) {
            c = ++i < end ? text.charCodeAt(i) : 0;
            while (c >= 48 && c <= 57) {
                mant = mant * 10 + (c - 48);
                exp--; digits++; ok = true;
                c = ++i < end ? text.charCodeAt(i) : 0;
            }
        }
        if (ok && (c === 101 || c === 69)) {
            let j = i + 1, esign = 1, e = 0, ed = false;
            let c2 = j < end ? text.charCodeAt(j) : 0;
            if (c2 === 45) { esign = -1; c2 = ++j < end ? text.charCodeAt(j) : 0; }
            else if (c2 === 43) { c2 = ++j < end ? text.charCodeAt(j) : 0; }
            while (c2 >= 48 && c2 <= 57) {
                e = e * 10 + (c2 - 48);
                ed = true;
                c2 = ++j < end ? text.charCodeAt(j) : 0;
            }
            if (ed) { exp += esign * e; i = j; c = c2; }
        }

        // Fallback for nan/inf/junk suffix or >15 significant digits
        if (!ok || digits > 15 || (i < end && c > 32)) {
            let j = i;
            while (j < end && text.charCodeAt(j) > 32) j++;
            out[w++] = Number(text.slice(tokStart, j));
            i = j;
            continue;
        }
        out[w++] = exp === 0 ? sign * mant : sign * mant * Math.pow(10, exp);
    }
    return w;
}

// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();

function indexOfBytes(haystack, needleStr, from = 0) {
    const needle = TEXT_ENCODER.encode(needleStr);
    const n0 = needle[0];
    const last = haystack.length - needle.length;
    outer: for (let i = from; i <= last; i++) {
        if (haystack[i] !== n0) continue;                // cheap first-byte filter
        for (let j = 1; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

export class VTPReader {
    constructor(options = {}) {
        this.pako = options.pako || (typeof globalThis !== "undefined" ? globalThis.pako : null) || { inflate };
    }

    parse(input) {
        let bytes = null;
        let xmlText;

        if (input instanceof ArrayBuffer) {
            bytes = new Uint8Array(input);
        } else if (typeof input === "string") {
            xmlText = input;
        } else {
            throw new Error("VTPReader.parse expects a string or ArrayBuffer");
        }

        let appendedBytes = null;
        if (bytes) {
            const tagIdx = indexOfBytes(bytes, "<AppendedData");
            if (tagIdx >= 0) {
                const dec = new TextDecoder();
                // Only the XML head (usually a few KB) is decoded to a string;
                // the appended payload never goes through TextDecoder.
                const headText = dec.decode(bytes.subarray(0, tagIdx));
                const tagEnd = indexOfBytes(bytes, ">", tagIdx);
                const tagText = dec.decode(bytes.subarray(tagIdx, tagEnd + 1));
                const encoding = /encoding\s*=\s*"(\w+)"/.exec(tagText)?.[1] || "base64";

                const usIdx = indexOfBytes(bytes, "_", tagEnd);
                let endIdx = indexOfBytes(bytes, "</AppendedData>", usIdx);
                if (endIdx < 0) endIdx = bytes.length;

                const raw = bytes.subarray(usIdx + 1, endIdx);
                // base64: decode straight from bytes (no giant intermediate string)
                appendedBytes = encoding === "base64"
                    ? (tryDecodeBase64Wasm(raw) ?? base64BytesToBytes(raw))
                    : raw.slice();

                xmlText = headText + "</VTKFile>";
            } else {
                xmlText = new TextDecoder().decode(bytes);
            }
        } else {
            const m = /<AppendedData[^>]*encoding\s*=\s*"base64"[^>]*>([\s\S]*?)<\/AppendedData>/.exec(xmlText);
            if (m) {
                // No trim/replace: the decoder skips whitespace and '_' inline.
                appendedBytes = tryDecodeBase64Wasm(m[1]) ?? base64ToBytes(m[1]);
                xmlText = xmlText.slice(0, m.index) + "</VTKFile>";
            }
        }

        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        const root = doc.querySelector("VTKFile");
        if (!root) throw new Error("Invalid .vtp file (missing <VTKFile> tag)");
        if (root.getAttribute("type") !== "PolyData") {
            throw new Error(`VTPReader only supports type="PolyData" (found: ${root.getAttribute("type")})`);
        }
        this._littleEndian = (root.getAttribute("byte_order") || "LittleEndian") === "LittleEndian";

        this._headerType = root.getAttribute("header_type") || "UInt32";
        this._compressor = root.getAttribute("compressor") || null;
        this._appended = appendedBytes;

        const piece = doc.querySelector("PolyData > Piece");
        if (!piece) throw new Error("Missing <Piece> tag in .vtp file");

        const pd = new PolyData();

        const ptsArrayEl = piece.querySelector("Points > DataArray");
        if (ptsArrayEl) {
            const vals = this._readDataArray(ptsArrayEl);
            pd.setPoints(vals instanceof Float32Array ? vals : Float32Array.from(vals));
        }

        pd.verts = this._readCells(piece.querySelector("Verts"));
        pd.lines = this._readCells(piece.querySelector("Lines"));
        pd.polys = this._readCells(piece.querySelector("Polys"));
        pd.strips = this._readCells(piece.querySelector("Strips"));

        this._readAttributes(piece.querySelector("PointData"), pd.pointData);
        this._readAttributes(piece.querySelector("CellData"), pd.cellData);

        return pd;
    }

    _readAttributes(sectionEl, attrSet) {
        if (!sectionEl) return;
        const activeScalars = sectionEl.getAttribute("Scalars");
        const activeVectors = sectionEl.getAttribute("Vectors");
        for (const el of sectionEl.querySelectorAll(":scope > DataArray")) {
            const name = el.getAttribute("Name") || "unnamed";
            const nComp = parseInt(el.getAttribute("NumberOfComponents") || "1", 10);
            const vals = this._readDataArray(el);
            // Skip the copy when the decoded array is already Float32
            const data = vals instanceof Float32Array ? vals : Float32Array.from(vals);
            attrSet.addArray(
                new DataArray(name, data, nComp),
                { asScalars: name === activeScalars, asVectors: name === activeVectors }
            );
        }
    }

    _readCells(sectionEl) {
        if (!sectionEl) return [];
        let conn = null, offsets = null;
        for (const el of sectionEl.querySelectorAll(":scope > DataArray")) {
            const name = el.getAttribute("Name");
            if (name === "connectivity") conn = this._readDataArray(el);
            else if (name === "offsets") offsets = this._readDataArray(el);
        }
        if (!conn || !offsets) return [];
        const nCells = offsets.length;
        const cells = new Array(nCells);
        let start = 0;
        for (let i = 0; i < nCells; i++) {
            const end = offsets[i];
            const cell = new Array(end - start);
            for (let j = start; j < end; j++) cell[j - start] = conn[j];
            cells[i] = cell;
            start = end;
        }
        return cells;
    }

    _readDataArray(el) {
        const type = el.getAttribute("type") || "Float32";
        const format = el.getAttribute("format") || "ascii";

        if (format === "ascii") {
            // In-place scan: no split(), no filter(), no map(Number)
            const text = el.textContent || "";
            const accelerated = tryParseAsciiWasm(text, type);
            if (accelerated) return accelerated;
            const T = TYPED[type] || Float64Array;
            const out = new T(countTokens(text));
            scanNumbers(text, out);
            return out;
        }

        if (format === "binary") {
            return this._decodeInlineBinary((el.textContent || "").trim(), type);
        }

        if (format === "appended") {
            if (!this._appended) throw new Error("VTPReader: File uses appended data but <AppendedData> section was not read successfully.");
            const offset = parseInt(el.getAttribute("offset") || "0", 10);
            return this._decodeFromBytes(this._appended, offset, type);
        }

        throw new Error(`VTPReader: Unsupported format "${format}"`);
    }

    get _wordSize() { return this._headerType === "UInt64" ? 8 : 4; }

    _readHeaderWord(bytes, offset) {
        if (!Number.isSafeInteger(offset) || offset < 0 || offset + this._wordSize > bytes.byteLength) {
            throw new Error(`VTPReader: header offset ${offset} is outside the data block`);
        }
        const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, this._wordSize);
        const value = this._wordSize === 8
            ? Number(dv.getBigUint64(0, this._littleEndian !== false))
            : dv.getUint32(0, this._littleEndian !== false);
        if (!Number.isSafeInteger(value) || value < 0) throw new Error("VTPReader: unsafe block size in header");
        return value;
    }

    _decodeFromBytes(bytes, offset, type) {
        const ws = this._wordSize;
        if (!this._compressor) {
            const nBytes = this._readHeaderWord(bytes, offset);
            if (offset + ws + nBytes > bytes.byteLength) throw new Error("VTPReader: data block exceeds appended payload");
            return bytesToTyped(bytes.subarray(offset + ws, offset + ws + nBytes), type, this._littleEndian !== false);
        }

        const numBlocks = this._readHeaderWord(bytes, offset);
        if (numBlocks > 1000000) throw new Error(`VTPReader: unreasonable compressed block count ${numBlocks}`);
        const headerBytes = (3 + numBlocks) * ws;
        if (offset + headerBytes > bytes.byteLength) throw new Error("VTPReader: compressed header exceeds appended payload");
        const sizes = [];
        for (let i = 0; i < numBlocks; i++) {
            sizes.push(this._readHeaderWord(bytes, offset + (3 + i) * ws));
        }
        let pos = offset + headerBytes;
        const chunks = [];
        for (const s of sizes) {
            if (pos + s > bytes.byteLength) throw new Error("VTPReader: compressed block exceeds appended payload");
            chunks.push(this._inflate(bytes.subarray(pos, pos + s)));
            pos += s;
        }
        return bytesToTyped(this._concat(chunks), type, this._littleEndian !== false);
    }

    _decodeInlineBinary(b64, type) {
        const ws = this._wordSize;
        if (!this._compressor) {
            const bytes = tryDecodeBase64Wasm(b64) ?? base64ToBytes(b64);
            const nBytes = this._readHeaderWord(bytes, 0);
            if (ws + nBytes > bytes.byteLength) throw new Error("VTPReader: inline block exceeds decoded payload");
            return bytesToTyped(bytes.subarray(ws, ws + nBytes), type, this._littleEndian !== false);
        }

        // Compressed inline: char offsets into the base64 stream require a
        // whitespace-free string. Strip only when whitespace is present.
        const clean = /\s/.test(b64) ? b64.replace(/\s+/g, "") : b64;
        const firstChars = 4 * Math.ceil(ws / 3);
        const firstBytes = base64ToBytes(clean.slice(0, firstChars));
        const numBlocks = this._readHeaderWord(firstBytes, 0);

        const headerBytes = (3 + numBlocks) * ws;
        const headerChars = 4 * Math.ceil(headerBytes / 3);
        const header = base64ToBytes(clean.slice(0, headerChars));
        const data = base64ToBytes(clean.slice(headerChars));

        const sizes = [];
        for (let i = 0; i < numBlocks; i++) {
            sizes.push(this._readHeaderWord(header, (3 + i) * ws));
        }
        let pos = 0;
        const chunks = [];
        for (const s of sizes) {
            chunks.push(this._inflate(data.subarray(pos, pos + s)));
            pos += s;
        }
        return bytesToTyped(this._concat(chunks), type, this._littleEndian !== false);
    }

    _inflate(compressed) {
        if (!this.pako) {
            throw new Error(
                "File is zlib-compressed. Please install and configure pako (npm i pako)."
            );
        }
        return this.pako.inflate(compressed);
    }

    _concat(chunks) {
        const total = chunks.reduce((s, c) => s + c.length, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        for (const c of chunks) { out.set(c, pos); pos += c.length; }
        return out;
    }
}
