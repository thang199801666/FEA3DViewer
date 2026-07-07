// IO/VTPReader.js
// Đọc file VTK XML PolyData (*.vtp). Hỗ trợ:
//   - format="ascii"
//   - format="binary" (base64 inline), có hoặc không nén vtkZLibDataCompressor
//   - format="appended" với encoding="base64" hoặc encoding="raw"
//     (raw yêu cầu truyền vào ArrayBuffer, không phải string)
//   - header_type UInt32 / UInt64
// Giải nén zlib cần thư viện pako (npm i pako) — truyền qua options hoặc để
// sẵn ở globalThis.pako.
//
// Cách dùng:
//   const reader = new VTPReader();          // hoặc new VTPReader({ pako })
//   const polyData = reader.parse(arrayBuffer);

import { PolyData, DataArray } from "../Core/PolyData.js";

const TYPED = {
    Int8: Int8Array, UInt8: Uint8Array,
    Int16: Int16Array, UInt16: Uint16Array,
    Int32: Int32Array, UInt32: Uint32Array,
    Float32: Float32Array, Float64: Float64Array
};

function base64ToBytes(b64) {
    const clean = b64.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/** Chuyển Uint8Array (little-endian) thành typed array theo tên kiểu VTK. */
function bytesToTyped(bytes, type) {
    const copy = bytes.slice(); // đảm bảo buffer riêng, offset 0 (căn chỉnh alignment)
    if (type === "Int64" || type === "UInt64") {
        // JS number đủ chính xác cho chỉ số mesh thông thường (< 2^53)
        const n = copy.byteLength / 8;
        const dv = new DataView(copy.buffer);
        const out = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            out[i] = type === "Int64"
                ? Number(dv.getBigInt64(i * 8, true))
                : Number(dv.getBigUint64(i * 8, true));
        }
        return out;
    }
    const T = TYPED[type];
    if (!T) throw new Error(`VTPReader: kiểu dữ liệu "${type}" chưa hỗ trợ`);
    return new T(copy.buffer);
}

function indexOfBytes(haystack, needleStr, from = 0) {
    const needle = new TextEncoder().encode(needleStr);
    outer: for (let i = from; i <= haystack.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

export class VTPReader {
    constructor(options = {}) {
        this.pako = options.pako || (typeof globalThis !== "undefined" ? globalThis.pako : null);
    }

    /**
     * @param {string|ArrayBuffer} input nội dung file .vtp
     * @returns {PolyData}
     */
    parse(input) {
        let bytes = null;
        let xmlText;

        if (input instanceof ArrayBuffer) {
            bytes = new Uint8Array(input);
        } else if (typeof input === "string") {
            xmlText = input;
        } else {
            throw new Error("VTPReader.parse nhận string hoặc ArrayBuffer");
        }

        // Tách phần <AppendedData> nếu là encoding raw (bytes nhị phân làm hỏng XML parser)
        let appendedBytes = null;
        if (bytes) {
            const tagIdx = indexOfBytes(bytes, "<AppendedData");
            if (tagIdx >= 0) {
                const dec = new TextDecoder();
                const headText = dec.decode(bytes.subarray(0, tagIdx));
                // Đọc thuộc tính encoding từ tag
                const tagEnd = indexOfBytes(bytes, ">", tagIdx);
                const tagText = dec.decode(bytes.subarray(tagIdx, tagEnd + 1));
                const encoding = /encoding\s*=\s*"(\w+)"/.exec(tagText)?.[1] || "base64";

                // Dữ liệu bắt đầu sau ký tự '_' đầu tiên
                const usIdx = indexOfBytes(bytes, "_", tagEnd);
                // Kết thúc trước "</AppendedData>"
                let endIdx = indexOfBytes(bytes, "</AppendedData>", usIdx);
                if (endIdx < 0) endIdx = bytes.length;

                const raw = bytes.subarray(usIdx + 1, endIdx);
                appendedBytes = encoding === "base64"
                    ? base64ToBytes(dec.decode(raw))
                    : raw.slice();

                xmlText = headText + "</VTKFile>";
            } else {
                xmlText = new TextDecoder().decode(bytes);
            }
        } else {
            // Input là string: vẫn có thể có AppendedData base64
            const m = /<AppendedData[^>]*encoding\s*=\s*"base64"[^>]*>([\s\S]*?)<\/AppendedData>/.exec(xmlText);
            if (m) {
                const content = m[1].trim().replace(/^_/, "");
                appendedBytes = base64ToBytes(content);
                xmlText = xmlText.slice(0, m.index) + "</VTKFile>";
            }
        }

        const doc = new DOMParser().parseFromString(xmlText, "application/xml");
        const root = doc.querySelector("VTKFile");
        if (!root) throw new Error("File .vtp không hợp lệ (không tìm thấy <VTKFile>)");
        if (root.getAttribute("type") !== "PolyData") {
            throw new Error(`VTPReader chỉ hỗ trợ type="PolyData" (file này là ${root.getAttribute("type")})`);
        }
        if ((root.getAttribute("byte_order") || "LittleEndian") !== "LittleEndian") {
            console.warn("VTPReader: file BigEndian có thể đọc sai — nên export LittleEndian");
        }

        this._headerType = root.getAttribute("header_type") || "UInt32";
        this._compressor = root.getAttribute("compressor") || null;
        this._appended = appendedBytes;

        const piece = doc.querySelector("PolyData > Piece");
        if (!piece) throw new Error("Không tìm thấy <Piece> trong file .vtp");

        const pd = new PolyData();

        // ---- Points ----
        const ptsArrayEl = piece.querySelector("Points > DataArray");
        if (ptsArrayEl) {
            const vals = this._readDataArray(ptsArrayEl);
            pd.setPoints(vals instanceof Float32Array ? vals : Float32Array.from(vals));
        }

        // ---- Topology: Verts / Lines / Polys / Strips ----
        pd.verts = this._readCells(piece.querySelector("Verts"));
        pd.lines = this._readCells(piece.querySelector("Lines"));
        pd.polys = this._readCells(piece.querySelector("Polys"));
        pd.strips = this._readCells(piece.querySelector("Strips"));

        // ---- PointData / CellData ----
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
            attrSet.addArray(
                new DataArray(name, Float32Array.from(vals), nComp),
                { asScalars: name === activeScalars, asVectors: name === activeVectors }
            );
        }
    }

    /** Đọc connectivity + offsets -> mảng cell. */
    _readCells(sectionEl) {
        if (!sectionEl) return [];
        let conn = null, offsets = null;
        for (const el of sectionEl.querySelectorAll(":scope > DataArray")) {
            const name = el.getAttribute("Name");
            if (name === "connectivity") conn = this._readDataArray(el);
            else if (name === "offsets") offsets = this._readDataArray(el);
        }
        if (!conn || !offsets) return [];
        const cells = [];
        let start = 0;
        for (let i = 0; i < offsets.length; i++) {
            const end = offsets[i];
            const cell = new Array(end - start);
            for (let j = start; j < end; j++) cell[j - start] = conn[j];
            cells.push(cell);
            start = end;
        }
        return cells;
    }

    /** Đọc 1 <DataArray> theo format ascii / binary / appended. */
    _readDataArray(el) {
        const type = el.getAttribute("type") || "Float32";
        const format = el.getAttribute("format") || "ascii";

        if (format === "ascii") {
            const nums = (el.textContent || "").trim().split(/\s+/).filter(Boolean).map(Number);
            const T = TYPED[type] || Float64Array; // Int64/UInt64 -> Float64Array (đủ cho index mesh)
            return T.from(nums);
        }

        if (format === "binary") {
            return this._decodeInlineBinary((el.textContent || "").trim(), type);
        }

        if (format === "appended") {
            if (!this._appended) throw new Error("VTPReader: file dùng appended data nhưng không đọc được khối <AppendedData> (hãy đọc file dưới dạng ArrayBuffer)");
            const offset = parseInt(el.getAttribute("offset") || "0", 10);
            return this._decodeFromBytes(this._appended, offset, type);
        }

        throw new Error(`VTPReader: format "${format}" chưa hỗ trợ`);
    }

    get _wordSize() { return this._headerType === "UInt64" ? 8 : 4; }

    _readHeaderWord(bytes, offset) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, this._wordSize);
        return this._wordSize === 8 ? Number(dv.getBigUint64(0, true)) : dv.getUint32(0, true);
    }

    /** Đọc array từ 1 khối bytes (appended) bắt đầu tại offset. */
    _decodeFromBytes(bytes, offset, type) {
        const ws = this._wordSize;
        if (!this._compressor) {
            const nBytes = this._readHeaderWord(bytes, offset);
            return bytesToTyped(bytes.subarray(offset + ws, offset + ws + nBytes), type);
        }
        // Có nén: header = [numBlocks, blockSize, lastBlockSize, size_0..size_{n-1}]
        const numBlocks = this._readHeaderWord(bytes, offset);
        const headerBytes = (3 + numBlocks) * ws;
        const sizes = [];
        for (let i = 0; i < numBlocks; i++) {
            sizes.push(this._readHeaderWord(bytes, offset + (3 + i) * ws));
        }
        let pos = offset + headerBytes;
        const chunks = [];
        for (const s of sizes) {
            chunks.push(this._inflate(bytes.subarray(pos, pos + s)));
            pos += s;
        }
        return bytesToTyped(this._concat(chunks), type);
    }

    /** Giải mã inline binary (base64). Với file nén, header và data được base64 riêng biệt. */
    _decodeInlineBinary(b64, type) {
        const ws = this._wordSize;
        if (!this._compressor) {
            const bytes = base64ToBytes(b64);
            const nBytes = this._readHeaderWord(bytes, 0);
            return bytesToTyped(bytes.subarray(ws, ws + nBytes), type);
        }
        // Nén: giải mã word đầu để biết numBlocks
        const clean = b64.replace(/\s+/g, "");
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
        return bytesToTyped(this._concat(chunks), type);
    }

    _inflate(compressed) {
        if (!this.pako) {
            throw new Error(
                "File .vtp được nén zlib — cần thư viện pako: npm i pako, rồi " +
                "new VTPReader({ pako }) hoặc gán globalThis.pako"
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