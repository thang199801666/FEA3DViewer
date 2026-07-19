import assert from "node:assert/strict";
import { deflate } from "pako";
import { VTPReader } from "../src/io/VTPReader.js";

function header(values, wordSize, littleEndian) {
    const bytes = new Uint8Array(values.length * wordSize);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => {
        if (wordSize === 8) view.setBigUint64(i * 8, BigInt(value), littleEndian);
        else view.setUint32(i * 4, value, littleEndian);
    });
    return bytes;
}

function concat(chunks) {
    const out = new Uint8Array(chunks.reduce((sum, value) => sum + value.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
}

console.log("\nVTP binary/compressed");
{
    const reader = new VTPReader();
    reader._headerType = "UInt32";
    reader._littleEndian = false;
    reader._compressor = null;
    const values = new Uint8Array(12);
    const view = new DataView(values.buffer);
    [1.5, -2.25, 9].forEach((value, i) => view.setFloat32(i * 4, value, false));
    const decoded = reader._decodeFromBytes(concat([header([12], 4, false), values]), 0, "Float32");
    assert.deepEqual(Array.from(decoded), [1.5, -2.25, 9]);
    console.log("  ok  BigEndian header and Float32 payload");
}

{
    const reader = new VTPReader();
    reader._headerType = "UInt64";
    reader._littleEndian = true;
    reader._compressor = "vtkZLibDataCompressor";
    const raw = new Int32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const rawBytes = new Uint8Array(raw.buffer);
    const first = deflate(rawBytes.subarray(0, 16));
    const second = deflate(rawBytes.subarray(16));
    const payload = concat([
        header([2, 16, 16, first.byteLength, second.byteLength], 8, true), first, second,
    ]);
    const decoded = reader._decodeFromBytes(payload, 0, "Int32");
    assert.deepEqual(Array.from(decoded), Array.from(raw));
    console.log("  ok  UInt64 header and multi-block zlib payload");
}

{
    const reader = new VTPReader();
    reader._headerType = "UInt32";
    reader._littleEndian = true;
    reader._compressor = null;
    assert.throws(() => reader._decodeFromBytes(header([4096], 4, true), 0, "Float32"), /exceeds/);
    console.log("  ok  rejects truncated/oversized payloads");
}
