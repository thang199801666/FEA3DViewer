import * as THREE from "three";
import assert from "node:assert/strict";
import { weldVertices } from "../src/geometry/weld.js";

function attr(coords) {
  return new THREE.BufferAttribute(new Float32Array(coords), 3);
}
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("  ok  " + name); pass++; }
                          catch (e) { console.log("  FAIL " + name + "\n       " + e.message); fail++; } };

console.log("\nweldVertices");

t("hàn 2 đỉnh trùng khít", () => {
  const p = attr([0,0,0,  0,0,0,  1,0,0]);
  const { canon, count } = weldVertices(p, { tolerance: 1e-6 });
  assert.equal(count, 2);
  assert.equal(canon[0], canon[1]);
  assert.notEqual(canon[0], canon[2]);
});

t("KHÔNG hàn 2 đỉnh cách xa hơn tolerance", () => {
  const p = attr([0,0,0,  1e-3,0,0]);
  const { count } = weldVertices(p, { tolerance: 1e-6 });
  assert.equal(count, 2);
});

// ─── Bug thật: ranh giới bucket của Math.round ────────────────────────────
// Với tol, precision = 1/tol. Chọn a = 1.5*tol  -> a*precision = 1.5   -> round = 2
//                              b = a - tol*1e-5 -> b*precision ≈ 1.49999 -> round = 1
// Hai đỉnh cách nhau tol*1e-5 (nhỏ hơn tol 100.000 lần) nhưng rơi vào 2 bucket khác nhau.
// Đây chính là tình huống mesh FEA import từ 2 part rời, toạ độ mặt chung lệch nhau
// vài ulp sau khi biến đổi toạ độ.
const TOL = 1e-3;
const EPS_A = 1.5 * TOL;
const EPS_B = EPS_A - TOL * 1e-5;

t("weld handles two vertices across a bucket boundary", () => {
  const p = attr([EPS_A,0,0,  EPS_B,0,0]);
  const { canon, count } = weldVertices(p, { tolerance: TOL });
  const d = Math.abs(p.getX(0) - p.getX(1));
  assert.equal(count, 1, `khoảng cách = ${d.toExponential(2)} << tol=${TOL}`);
  assert.equal(canon[0], canon[1]);
});

t("đỉnh âm quanh gốc toạ độ (Math.floor vs truncate)", () => {
  const p = attr([-1e-9,0,0,  1e-9,0,0]);
  const { count } = weldVertices(p, { tolerance: 1e-6 });
  assert.equal(count, 1);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
