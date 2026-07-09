import assert from "node:assert/strict";
import { BoxSource } from "../src/sources/BoxSource.js";

let pass=0, fail=0;
const t=(n,f)=>{try{f();console.log("  ok  "+n);pass++}catch(e){console.log("  FAIL "+n+"\n       "+e.message);fail++}};
const bounds = (pd) => {
  const mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  for(let i=0;i<pd.points.length;i+=3) for(let k=0;k<3;k++){
    mn[k]=Math.min(mn[k],pd.points[i+k]); mx[k]=Math.max(mx[k],pd.points[i+k]);
  }
  return {mn,mx};
};

console.log("\nBoxSource");

t("segments=1 -> 6 mặt × 2 tam giác = 12 polys, 24 điểm", () => {
  const pd = new BoxSource({ segments: 1 }).getOutputData();
  assert.equal(pd.polys.length, 12);
  assert.equal(pd.points.length / 3, 24);   // 4 đỉnh/mặt, không weld
});

t("segments=20 -> 6 × 20² × 2 = 4800 polys (như SceneController dùng)", () => {
  const pd = new BoxSource({ segments: 20 }).getOutputData();
  assert.equal(pd.polys.length, 6 * 400 * 2);
});

t("điểm CENTERED quanh gốc: bounds = ±L/2", () => {
  const { mn, mx } = bounds(new BoxSource({ xLength: 2, yLength: 4, zLength: 6, segments: 3 }).getOutputData());
  assert.deepEqual(mn.map(v=>+v.toFixed(6)), [-1,-2,-3]);
  assert.deepEqual(mx.map(v=>+v.toFixed(6)), [ 1, 2, 3]);
});

t("center tuỳ chọn dịch đúng bounds", () => {
  const { mn, mx } = bounds(new BoxSource({ xLength: 2, segments: 1, center: [10,0,0] }).getOutputData());
  assert.equal(+mn[0].toFixed(6), 9);
  assert.equal(+mx[0].toFixed(6), 11);
});

t("mọi điểm nằm TRÊN mặt hộp (|coord| = half ở ít nhất 1 trục)", () => {
  const L=2,W=4,H=6, half=[L/2,W/2,H/2];
  const pd = new BoxSource({ xLength:L, yLength:W, zLength:H, segments: 4 }).getOutputData();
  for (let i=0;i<pd.points.length;i+=3) {
    const p=[pd.points[i],pd.points[i+1],pd.points[i+2]];
    const onFace = p.some((v,k)=>Math.abs(Math.abs(v)-half[k])<1e-5);
    assert.ok(onFace, `điểm (${p}) không nằm trên mặt nào`);
    for (let k=0;k<3;k++) assert.ok(Math.abs(p[k]) <= half[k]+1e-5, "điểm lọt ra ngoài hộp");
  }
});

// ── Hợp đồng CHÍNH XÁC của SceneController.addBoxActor ──────────────────────
t("getOutputDataWithScalars: scalar 'stress' = 0 ở GÓC, ~1 ở tâm mặt", () => {
  const L=1,W=1,H=1;
  const maxD = Math.hypot(L/2, W/2, H/2);
  const pd = new BoxSource({ xLength:L, yLength:W, zLength:H, segments: 20 })
    .getOutputDataWithScalars("stress", (x,y,z) => 1 - Math.hypot(x,y,z)/maxD);

  const s = pd.pointData.getArray("stress");
  assert.ok(s, "không có array 'stress'");
  assert.equal(s.getNumberOfTuples(), pd.points.length/3);

  const [lo, hi] = s.getRange(0);
  assert.ok(Math.abs(lo) < 1e-5, `min phải ~0 tại góc, được ${lo}`);
  // tâm của một mặt: |p| = half = 0.5 -> 1 - 0.5/0.866 = 0.4226
  assert.ok(Math.abs(hi - (1 - 0.5/maxD)) < 1e-4, `max phải là tâm mặt, được ${hi}`);
});

t("scalar được set làm ACTIVE scalars (PolyDataMapper tô màu được ngay)", () => {
  const pd = new BoxSource({ segments: 2 }).getOutputDataWithScalars("stress", () => 1);
  assert.ok(pd.pointData.getScalars(), "activeScalars chưa được set");
  assert.equal(pd.pointData.getScalars().name, "stress");
});

t("fn nhận toạ độ TƯƠNG ĐỐI với center, không phải toạ độ world", () => {
  const seen = [];
  new BoxSource({ xLength:2, segments:1, center:[100,0,0] })
    .getOutputDataWithScalars("v", (x,y,z) => { seen.push(x); return 0; });
  assert.ok(Math.max(...seen.map(Math.abs)) <= 1 + 1e-6, `x phải ∈ [-1,1], thấy ${Math.max(...seen)}`);
});

t("fn không phải hàm -> lỗi rõ ràng", () => {
  assert.throws(() => new BoxSource().getOutputDataWithScalars("v", null), /cần một hàm/);
});

t("winding CCW nhìn từ ngoài: pháp tuyến tam giác hướng RA NGOÀI", () => {
  const pd = new BoxSource({ segments: 2 }).getOutputData();
  const P = (i) => [pd.points[i*3], pd.points[i*3+1], pd.points[i*3+2]];
  let bad = 0;
  for (const [a,b,c] of pd.polys) {
    const A=P(a),B=P(b),C=P(c);
    const e1=[B[0]-A[0],B[1]-A[1],B[2]-A[2]], e2=[C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    const nrm=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]];
    const cen=[(A[0]+B[0]+C[0])/3,(A[1]+B[1]+C[1])/3,(A[2]+B[2]+C[2])/3];
    if (nrm[0]*cen[0]+nrm[1]*cen[1]+nrm[2]*cen[2] <= 0) bad++;
  }
  assert.equal(bad, 0, `${bad}/${pd.polys.length} tam giác quay ngược (mặt sẽ đen)`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
