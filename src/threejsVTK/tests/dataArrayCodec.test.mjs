import assert from "node:assert/strict";
import { DataArrayCodec, base64ToBytes, bytesToTyped } from "../src/io/dataArrayCodec.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok  " + n); pass++; }
                      catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };

console.log("\nDataArrayCodec");

t("ascii Float32", () => {
  const a = new DataArrayCodec().decodeAscii(" 1.5  2.5\n3.5 ", "Float32");
  assert.deepEqual([...a], [1.5, 2.5, 3.5]);
});

t("ascii Int64 -> Float64Array", () => {
  const a = new DataArrayCodec().decodeAscii("1 2 3", "Int64");
  assert.ok(a instanceof Float64Array);
});

t("inline binary không nén, header UInt32", () => {
  const data = Float32Array.from([1, 2, 3]);
  const bytes = new Uint8Array(4 + data.byteLength);
  new DataView(bytes.buffer).setUint32(0, data.byteLength, true);
  bytes.set(new Uint8Array(data.buffer), 4);
  const b64 = Buffer.from(bytes).toString("base64");
  const out = new DataArrayCodec().decodeInlineBinary(b64, "Float32");
  assert.deepEqual([...out], [1, 2, 3]);
});

t("appended, header UInt64", () => {
  const data = Int32Array.from([7, 8]);
  const bytes = new Uint8Array(8 + data.byteLength);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(data.byteLength), true);
  bytes.set(new Uint8Array(data.buffer), 8);
  const c = new DataArrayCodec({ headerType: "UInt64" });
  assert.deepEqual([...c.decodeFromBytes(bytes, 0, "Int32")], [7, 8]);
});

t("compressed nhưng thiếu pako -> lỗi hướng dẫn được", () => {
  const c = new DataArrayCodec({ compressed: true, pako: null });
  assert.throws(() => c._inflate(new Uint8Array(4)), /npm i pako/);
});

t("kiểu lạ -> lỗi rõ ràng", () => {
  assert.throws(() => bytesToTyped(new Uint8Array(4), "Float128"), /is not supported/);
});

t("base64ToBytes chạy trên Node (không có atob global)", () => {
  const b = base64ToBytes(Buffer.from([1, 2, 250]).toString("base64"));
  assert.deepEqual([...b], [1, 2, 250]);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
