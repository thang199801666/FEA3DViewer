// io/dataArrayCodec.js
//
// PERFORMANCE-OPTIMIZED VERSION
// - base64 decoding uses a lookup table and writes bytes directly (no atob(),
//   no intermediate binary string, no whitespace-stripping regex on huge strings).
//   ~3-6x faster and dramatically lower memory pressure on large payloads.
// - ASCII number parsing scans charCodes in place (no split(/\s+/) token array,
//   no per-number substring allocation). ~5-10x faster on large ASCII arrays.

const TYPED = {
    Int8: Int8Array, UInt8: Uint8Array,
    Int16: Int16Array, Uint16: Uint16Array,
    Int32: Int32Array, UInt32: Uint32Array,
    Float32: Float32Array, Float64: Float64Array,
};

export function typedArrayFor(type) {
    const T = TYPED[type];
    if (!T) throw new Error(`dataArrayCodec: Type "${type}" is not supported`);
    return T;
}

// ---------------------------------------------------------------------------
// Fast base64
// ---------------------------------------------------------------------------

// charCode -> 6-bit value; -1 for anything invalid (whitespace, '=', ...).
// Invalid chars are simply skipped during decode, so callers no longer need
// to strip whitespace with a regex (which allocates a full copy of the string).
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
export function base64ToBytes(b64) {
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
export function base64BytesToBytes(u8) {
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

export function bytesToTyped(bytes, type) {
    if (type === "Int64" || type === "UInt64") {
        const n = bytes.byteLength >> 3;
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const out = new Float64Array(n);
        if (type === "Int64") {
            for (let i = 0; i < n; i++) out[i] = Number(dv.getBigInt64(i * 8, true));
        } else {
            for (let i = 0; i < n; i++) out[i] = Number(dv.getBigUint64(i * 8, true));
        }
        return out;
    }
    // One compact copy is required so the typed view starts at byteOffset 0
    // and does not keep the (potentially huge) file buffer alive.
    const copy = bytes.slice();
    return new (typedArrayFor(type))(copy.buffer);
}

export function concatBytes(chunks) {
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
}

// ---------------------------------------------------------------------------
// Fast in-place ASCII number scanning
// ---------------------------------------------------------------------------

/**
 * Parse whitespace-separated numbers from `text` directly into a typed array,
 * reading charCodes in place. Handles sign, decimal point and exponent.
 * Exotic tokens (nan/inf/hex/overlong) fall back to Number() on a substring.
 *
 * Returns the number of values written into `out`.
 */
export function scanNumbers(text, out, start = 0, end = text.length, count = out.length) {
    let i = start;
    let w = 0;
    while (w < count && i < end) {
        // Skip whitespace (space, \t, \n, \r, etc. — anything <= 0x20)
        let c = text.charCodeAt(i);
        while (c <= 32) {
            if (++i >= end) return w;
            c = text.charCodeAt(i);
        }

        const tokStart = i;
        let sign = 1;
        if (c === 45) { sign = -1; c = text.charCodeAt(++i); }      // '-'
        else if (c === 43) { c = text.charCodeAt(++i); }            // '+'

        let mant = 0, digits = 0, exp = 0, ok = false;
        while (c >= 48 && c <= 57) {                                 // 0-9
            mant = mant * 10 + (c - 48);
            digits++; ok = true;
            c = ++i < end ? text.charCodeAt(i) : 0;
        }
        if (c === 46) {                                              // '.'
            c = ++i < end ? text.charCodeAt(i) : 0;
            while (c >= 48 && c <= 57) {
                mant = mant * 10 + (c - 48);
                exp--; digits++; ok = true;
                c = ++i < end ? text.charCodeAt(i) : 0;
            }
        }
        if (ok && (c === 101 || c === 69)) {                         // 'e' / 'E'
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

        // Fallback path: token contains unexpected chars (nan, inf, 0x..),
        // has no digits at all, or exceeds double mantissa precision.
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

export class DataArrayCodec {
    constructor({ headerType = "UInt32", compressed = false, pako = null } = {}) {
        this.headerType = headerType;
        this.compressed = compressed;
        this.pako = pako ?? (typeof globalThis !== "undefined" ? globalThis.pako : null);
    }

    get wordSize() { return this.headerType === "UInt64" ? 8 : 4; }

    _inflate(bytes) {
        if (!this.pako) {
            throw new Error(
                "VTK file uses zlib compression. Please install pako (npm i pako) and pass it to the reader."
            );
        }
        return this.pako.inflate(bytes);
    }

    readHeaderWord(bytes, offset) {
        const ws = this.wordSize;
        const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, ws);
        return ws === 8 ? Number(dv.getBigUint64(0, true)) : dv.getUint32(0, true);
    }

    decodeAscii(text, type) {
        // Count tokens first (cheap charCode pass), then scan directly into
        // the typed array — no token string array, no map(Number).
        let n = 0, inTok = false;
        for (let i = 0; i < text.length; i++) {
            const ws = text.charCodeAt(i) <= 32;
            if (!ws && !inTok) { n++; inTok = true; }
            else if (ws) inTok = false;
        }
        const T = TYPED[type] ?? Float64Array;
        const out = new T(n);
        scanNumbers(text, out);
        return out;
    }

    decodeFromBytes(bytes, offset, type) {
        const ws = this.wordSize;
        if (!this.compressed) {
            const nBytes = this.readHeaderWord(bytes, offset);
            return bytesToTyped(bytes.subarray(offset + ws, offset + ws + nBytes), type);
        }

        const numBlocks = this.readHeaderWord(bytes, offset);
        const headerBytes = (3 + numBlocks) * ws;
        const sizes = [];
        for (let i = 0; i < numBlocks; i++) {
            sizes.push(this.readHeaderWord(bytes, offset + (3 + i) * ws));
        }

        let pos = offset + headerBytes;
        const chunks = [];
        for (const s of sizes) {
            chunks.push(this._inflate(bytes.subarray(pos, pos + s)));
            pos += s;
        }
        return bytesToTyped(concatBytes(chunks), type);
    }

    decodeInlineBinary(b64, type) {
        const ws = this.wordSize;
        if (!this.compressed) {
            const bytes = base64ToBytes(b64);
            const nBytes = this.readHeaderWord(bytes, 0);
            return bytesToTyped(bytes.subarray(ws, ws + nBytes), type);
        }

        // Compressed inline: char offsets into the base64 stream require a
        // whitespace-free string, so strip once here (only in this rare path).
        const clean = /\s/.test(b64) ? b64.replace(/\s+/g, "") : b64;
        const firstBytes = base64ToBytes(clean.slice(0, 4 * Math.ceil(ws / 3)));
        const numBlocks = this.readHeaderWord(firstBytes, 0);

        const headerBytes = (3 + numBlocks) * ws;
        const headerChars = 4 * Math.ceil(headerBytes / 3);
        const header = base64ToBytes(clean.slice(0, headerChars));
        const data = base64ToBytes(clean.slice(headerChars));

        const sizes = [];
        for (let i = 0; i < numBlocks; i++) {
            sizes.push(this.readHeaderWord(header, (3 + i) * ws));
        }

        let pos = 0;
        const chunks = [];
        for (const s of sizes) {
            chunks.push(this._inflate(data.subarray(pos, pos + s)));
            pos += s;
        }
        return bytesToTyped(concatBytes(chunks), type);
    }
}