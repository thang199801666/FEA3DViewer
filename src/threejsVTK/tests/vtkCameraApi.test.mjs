import * as THREE from "three";
import assert from "node:assert/strict";
import { applyVTKCameraApi, missingCameraApi, REQUIRED_BY_RENDERER, REQUIRED_BY_GIZMO }
  from "../src/camera/vtkCameraApi.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("  ok  " + n); pass++; }
                      catch (e) { console.log("  FAIL " + n + "\n       " + e.message); fail++; } };

// Facade giả: chỉ có những gì Camera.js thật CHẮC CHẮN có (CameraAnimation dùng cam.three, cam.state)
function makeFacade({ withSync = false } = {}) {
  class FakeCamera {
    constructor() {
      this.three = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 1000);
      this.three.position.set(10, 10, 10);
      this.state = { target: new THREE.Vector3(0, 0, 0) };
      this.synced = 0;
      this.afterState = 0;
    }
    _afterStateChange() { this.afterState++; }
  }
  if (withSync) FakeCamera.prototype.syncFromThree = function () { this.synced++; return this; };
  applyVTKCameraApi(FakeCamera);
  return new FakeCamera();
}

console.log("\nvtkCameraApi (hợp nhất VTKCamera vào Camera facade)");

t("phủ đủ bề mặt Renderer + NavigationCube yêu cầu", () => {
  const cam = makeFacade();
  assert.deepEqual(missingCameraApi(cam), []);
  for (const m of [...REQUIRED_BY_RENDERER, ...REQUIRED_BY_GIZMO])
    assert.equal(typeof cam[m], "function", `thiếu ${m}`);
});

t("facade TRỐNG -> missingCameraApi liệt kê đủ", () => {
  assert.deepEqual(missingCameraApi({}).sort(),
    ["getDistance","getFocalPoint","getThreeCamera","reset","setAspect","setFromThree"]);
});

t("getThreeCamera trả đúng THREE.Camera facade đang bọc", () => {
  const cam = makeFacade();
  assert.equal(cam.getThreeCamera(), cam.three);
});

t("getDistance = |eye - target|", () => {
  const cam = makeFacade();
  assert.ok(Math.abs(cam.getDistance() - Math.sqrt(300)) < 1e-6);
});

t("setAspect(2) giữ chiều cao, co giãn chiều rộng (ortho)", () => {
  const cam = makeFacade();
  const h = cam.three.top - cam.three.bottom;
  cam.setAspect(2);
  assert.equal(cam.three.top - cam.three.bottom, h, "chiều cao phải giữ nguyên");
  assert.equal(cam.three.right - cam.three.left, h * 2);
});

t("setAspect matches the resize formula used in Scene.tsx", () => {
  const cam = makeFacade();
  const a = 1920 / 1080;
  const halfH = (cam.three.top - cam.three.bottom) / 2;   // công thức cũ trong Scene
  cam.setAspect(a);
  assert.ok(Math.abs(cam.three.left - (-halfH * a)) < 1e-9);
  assert.ok(Math.abs(cam.three.right - (halfH * a)) < 1e-9);
});

t("setClippingRange chấp nhận negative near (ortho, mặt cắt CAD)", () => {
  const cam = makeFacade();
  cam.setClippingRange(-50, 50);
  assert.deepEqual(cam.getClippingRange(), [-50, 50]);
});

t("setFromThree uỷ quyền cho syncFromThree() nếu facade đã có", () => {
  const cam = makeFacade({ withSync: true });
  cam.setFromThree();
  assert.equal(cam.synced, 1, "phải gọi syncFromThree của facade");
});

t("setFromThree không có syncFromThree -> chỉ updateMatrixWorld, không ném", () => {
  const cam = makeFacade();
  assert.doesNotThrow(() => cam.setFromThree());
});

// VTKCamera.reset() gốc: dir = (eyeCŨ - centerMỚI). Nó giữ hướng NHÌN TỪ CENTER MỚI
// tới vị trí eye cũ — KHÔNG phải giữ hướng so với target cũ. Test bám đúng hành vi gốc.
t("reset(center, d): target = center, distance = d, hướng = (eyeCũ - centerMới)", () => {
  const cam = makeFacade();
  const eyeBefore = cam.three.position.clone();
  const center = new THREE.Vector3(5, 0, 0);
  const expected = eyeBefore.clone().sub(center).normalize();

  cam.reset(center, 20);

  assert.ok(cam.state.target.equals(center));
  assert.ok(Math.abs(cam.getDistance() - 20) < 1e-4, `distance = ${cam.getDistance()}`);
  const dirAfter = cam.three.position.clone().sub(center).normalize();
  assert.ok(dirAfter.distanceTo(expected) < 1e-5);
});

t("reset khi eye trùng center -> fallback (1,1,1), không NaN", () => {
  const cam = makeFacade();
  const center = cam.three.position.clone();          // eye === center
  cam.reset(center, 10);
  assert.ok(Number.isFinite(cam.three.position.x), "NaN lọt vào position");
  assert.ok(Math.abs(cam.getDistance() - 10) < 1e-4);
});

t("KHÔNG ghi đè method facade đã tự định nghĩa", () => {
  class Custom { constructor() { this.three = new THREE.OrthographicCamera(); } getDistance() { return 42; } }
  applyVTKCameraApi(Custom);
  assert.equal(new Custom().getDistance(), 42);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
