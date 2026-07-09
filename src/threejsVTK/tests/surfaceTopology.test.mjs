import * as THREE from "three";
import assert from "node:assert/strict";
import { extractByTopology } from "../src/geometry/surfaceTopology.js";
import { twoTetsSharedFace } from "./fixtures.mjs";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok  " + n); pass++; }
                      catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };
const triCount = (g) => (g.getIndex() ? g.getIndex().count : g.getAttribute("position").count) / 3;

function geom(verts, tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(tris), 1));
  return g;
}

// Hai tứ diện chung mặt (v0,v1,v2). Tổng 8 tam giác; mặt chung xuất hiện 2 lần.
// Kết quả đúng: 6 tam giác biên.
const twoTets = twoTetsSharedFace;

console.log("\nextractByTopology");

t("2 tứ diện, toạ độ mặt chung TRÙNG KHÍT -> loại vách trong (8 -> 6)", () => {
  const out = extractByTopology(twoTets(0), { weldTolerance: 1e-6 });
  assert.equal(triCount(out), 6);
});

// REGRESSION: GeometryFilter cũ trả 8 ở đây. Xem tests/regression_old_vs_new.mjs
for (const d of [1e-6, 1e-5, 1e-4]) {
  t(`2 tứ diện, mặt chung lệch ${d.toExponential(0)} (tol=1e-3) -> vẫn loại vách trong`, () => {
    const out = extractByTopology(twoTets(d), { weldTolerance: 1e-3 });
    assert.equal(triCount(out), 6, "vách trong không bị loại => weld thất bại");
  });
}

t("removeInternalWalls=false -> giữ nguyên", () => {
  const g = twoTets(0);
  const out = extractByTopology(g, { removeInternalWalls: false });
  assert.equal(out, g);
});

t("mesh không có vách trong -> trả nguyên bản (không copy thừa)", () => {
  const g = geom([0,0,0, 1,0,0, 0,1,0, 0,0,1], [0,1,2, 0,1,3, 1,2,3, 2,0,3]);
  assert.equal(extractByTopology(g, { weldTolerance: 1e-6 }), g);
});

t("tam giác suy biến bị bỏ qua, không crash", () => {
  const g = geom([0,0,0, 1,0,0, 0,1,0], [0,1,2, 0,0,1]);
  const out = extractByTopology(g, { weldTolerance: 1e-6 });
  assert.equal(triCount(out), 1);
});

t("keepOuterShell: bỏ vỏ con rời nằm trong", () => {
  // vỏ ngoài = tứ diện lớn; vỏ trong = tứ diện nhỏ rời, không dùng chung đỉnh
  const big = [0,0,0, 4,0,0, 0,4,0, 0,0,4];
  const sm  = [1,1,1, 1.2,1,1, 1,1.2,1, 1,1,1.2];
  const g = geom([...big, ...sm], [
    0,1,2, 0,1,3, 1,2,3, 2,0,3,
    4,5,6, 4,5,7, 5,6,7, 6,4,7,
  ]);
  const out = extractByTopology(g, { weldTolerance: 1e-6, keepOuterShell: true });
  assert.equal(triCount(out), 4, "chỉ còn 4 mặt của tứ diện lớn");
});

t("giữ nguyên mọi attribute khác (color, uv)", () => {
  const g = twoTets(0);
  const n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
  const out = extractByTopology(g, { weldTolerance: 1e-6 });
  assert.ok(out.getAttribute("color"), "attribute color bị mất");
  assert.equal(out.getAttribute("color").count, n);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
