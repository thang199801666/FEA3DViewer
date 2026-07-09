import { GeometryFilter } from "../legacy/GeometryFilter.js";
import { extractByTopology } from "../src/geometry/surfaceTopology.js";
import { twoTetsSharedFace, triCount } from "./fixtures.mjs";

const TOL = 1e-3;
const cases = [
  ["mặt chung trùng khít       (d=0)",     0],
  ["mặt chung lệch 1e-6        (d=1e-6)",  1e-6],
  ["mặt chung lệch 1e-5        (d=1e-5)",  1e-5],
];

console.log("\n  Kỳ vọng: 6 tam giác biên. weldTolerance = 1e-3, mọi d << tol.\n");
console.log("  " + "case".padEnd(40) + "GeometryFilter(cũ)".padEnd(22) + "extractByTopology(mới)");
console.log("  " + "-".repeat(84));
let oldFails = 0;
for (const [name, d] of cases) {
  const old = new GeometryFilter().setWeldTolerance(TOL).setInputData(twoTetsSharedFace(d));
  const o = triCount(old.getOutputData());
  const n = triCount(extractByTopology(twoTetsSharedFace(d), { weldTolerance: TOL }));
  if (o !== 6) oldFails++;
  const m = (v) => (v === 6 ? `${v}  ok` : `${v}  SAI (giữ vách trong)`);
  console.log("  " + name.padEnd(40) + m(o).padEnd(22) + m(n));
}
console.log(`\n  GeometryFilter sai ${oldFails}/${cases.length} case.\n`);
