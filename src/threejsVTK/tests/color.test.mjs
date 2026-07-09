import assert from "node:assert/strict";
import { LookupTable } from "../src/color/LookupTable.js";
import { ColorTransferFunction } from "../src/color/ColorTransferFunction.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok  " + n); pass++; }
                      catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };

console.log("\ncolor");

t("CTF là drop-in của LookupTable", () => {
  const ctf = new ColorTransferFunction({ preset: "viridis" });
  assert.ok(ctf instanceof LookupTable);
  for (const m of ["setRange", "mapScalars", "getUint8Table", "getColor"])
    assert.equal(typeof ctf[m], "function", `thiếu ${m}`);
});

t("preset không tồn tại -> lỗi liệt kê preset hợp lệ (bản cũ im lặng fallback null)", () => {
  assert.throws(() => new ColorTransferFunction({ preset: "nope" }), /viridis/);
});

t("coolToWarm: điểm giữa là màu xám nhạt", () => {
  const ctf = new ColorTransferFunction({ preset: "coolToWarm", range: [0, 1] });
  const [r, g, b] = ctf.getColor(0.5);
  assert.ok(Math.abs(r - g) < 0.02 && Math.abs(g - b) < 0.02, `(${r},${g},${b})`);
});

t("setDiscrete(5) -> 5 bậc màu", () => {
  const ctf = new ColorTransferFunction({ preset: "jet" }).setDiscrete(5);
  assert.equal(ctf.numberOfColors, 5);
  assert.equal(ctf.getUint8Table().length, 20);
});

t("rainbow (controlPoints=null) dùng hueRange", () => {
  const ctf = new ColorTransferFunction({ preset: "rainbow", range: [0, 1] });
  assert.equal(ctf.controlPoints, null);
  const lo = ctf.getColor(0), hi = ctf.getColor(1);
  assert.ok(lo[2] > lo[0], "đầu dải phải thiên xanh");
  assert.ok(hi[0] > hi[2], "cuối dải phải thiên đỏ");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
