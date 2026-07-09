import assert from "node:assert/strict";
import { PolyData } from "../src/core/PolyData.js";
import { SurfaceFilter, SURFACE_STRATEGY } from "../src/filters/SurfaceFilter.js";
import { DataArray } from "../src/core/FieldData.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok  " + n); pass++; }
                      catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };

// 2 tứ diện chung mặt, toạ độ mặt chung lệch 1e-6 (bug cũ)
function twoTetsPolyData() {
  const B = 0.0015, L = 1.0015, d = 1e-6;
  const pd = new PolyData();
  pd.setPoints(new Float32Array([
    B,B,B,  L,B,B,  B,L,B,  B,B,L,  B,B,-0.9985,
    B-d,B-d,B-d,  L-d,B-d,B-d,  B-d,L-d,B-d,
  ]));
  pd.setPolys([[0,1,2],[0,1,3],[1,2,3],[2,0,3],[5,6,7],[5,6,4],[6,7,4],[7,5,4]]);
  // pointData: 8 đỉnh
  pd.addPointDataArray("temp", Float32Array.from([10,20,30,40,50,60,70,80]), 1, { setActiveScalar: true });
  // cellData: 8 cell
  pd.cellData.addArray(new DataArray("stress", Float32Array.from([1,2,3,4,5,6,7,8]), 1));
  return pd;
}

console.log("\nSurfaceFilter");

t("topology: loại vách trong (8 -> 6 polys)", () => {
  const f = new SurfaceFilter({ strategy: SURFACE_STRATEGY.TOPOLOGY, weldTolerance: 1e-3 });
  const out = f.setInputData(twoTetsPolyData()).getOutputData();
  assert.equal(out.polys.length, 6);
});

t("pointData được giữ nguyên (bug cũ: mất sạch)", () => {
  const f = new SurfaceFilter({ weldTolerance: 1e-3 });
  const out = f.setInputData(twoTetsPolyData()).getOutputData();
  const temp = out.pointData.getArray("temp");
  assert.ok(temp, "mất pointData 'temp'");
  assert.equal(temp.getNumberOfTuples(), 8);
  assert.equal(temp.getComponent(3, 0), 40);
});

t("cellData được remap theo tam giác giữ lại", () => {
  const f = new SurfaceFilter({ weldTolerance: 1e-3 });
  const out = f.setInputData(twoTetsPolyData()).getOutputData();
  const st = out.cellData.getArray("stress");
  assert.ok(st, "mất cellData 'stress'");
  assert.equal(st.getNumberOfTuples(), 6, "cellData phải khớp số cell mới");
  // cell 0 (mặt chung của tet A) và cell 4 (bản sao) đều bị loại
  const vals = [...st.values];
  assert.ok(!vals.includes(1) && !vals.includes(5), `mặt chung vẫn còn: ${vals}`);
});

t("cache theo MTime: gọi 2 lần trả cùng object", () => {
  const f = new SurfaceFilter({ weldTolerance: 1e-3 }).setInputData(twoTetsPolyData());
  assert.equal(f.getOutputData(), f.getOutputData());
});

t("input.modified() làm mất hiệu lực cache", () => {
  const pd = twoTetsPolyData();
  const f = new SurfaceFilter({ weldTolerance: 1e-3 }).setInputData(pd);
  const a = f.getOutputData();
  pd.modified();
  assert.notEqual(f.getOutputData(), a);
});

t("strategy không hợp lệ -> ném lỗi rõ ràng", () => {
  assert.throws(() => new SurfaceFilter().setStrategy("bogus"), /không hợp lệ/);
});

t("visibility: chạy được, loại vách trong", () => {
  const f = new SurfaceFilter({ strategy: SURFACE_STRATEGY.VISIBILITY, weldTolerance: 1e-3, rayCount: 32 });
  const out = f.setInputData(twoTetsPolyData()).getOutputData();
  assert.ok(out.polys.length <= 6, `visibility trả ${out.polys.length} polys`);
  assert.ok(out.polys.length >= 4);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
