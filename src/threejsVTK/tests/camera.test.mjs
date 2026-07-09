import * as THREE from "three";
import assert from "node:assert/strict";
import { Camera } from "../src/camera/Camera.js";
import { missingCameraApi } from "../src/camera/vtkCameraApi.js";

// rAF cho CameraAnimation (Node không có)
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);

let pass=0, fail=0;
const t=(n,f)=>{try{f();console.log("  ok  "+n);pass++}catch(e){console.log("  FAIL "+n+"\n       "+e.message);fail++}};

const W = 800, H = 600;
const domElement = {
  clientWidth: W, clientHeight: H,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
};
const mk = (opts = {}) => {
  const three = new THREE.OrthographicCamera(-5*(W/H), 5*(W/H), 5, -5, 0.01, 10000);
  three.position.set(10, 10, 10);
  three.up.set(0, 1, 0);
  three.lookAt(0, 0, 0);
  three.updateMatrixWorld(true);
  return new Camera(three, domElement, { animationDuration: 0, ...opts });
};

console.log("\nCamera facade (dựng lại)");

t("phủ đủ bề mặt Renderer + NavigationCube + SceneController", () => {
  assert.deepEqual(missingCameraApi(mk()), []);
});

t("khởi tạo: state khớp THREE camera, target = gốc", () => {
  const c = mk();
  assert.ok(c.state.eye.distanceTo(new THREE.Vector3(10,10,10)) < 1e-6);
  assert.ok(c.state.target.equals(new THREE.Vector3(0,0,0)));
  assert.ok(Math.abs(c.state.distance - Math.sqrt(300)) < 1e-4);
  assert.ok(c.state.isValid());
});

t("rotateLocal(0,0) = COMMIT: không xoay, vẫn ghi xuống three + bắn onChange", () => {
  let changed = 0;
  const c = mk({ onChange: () => changed++ });
  const before = c.three.position.clone();
  c.rotateLocal(0, 0);
  assert.ok(c.three.position.distanceTo(before) < 1e-5, "không được dịch camera");
  assert.equal(changed, 1, "onChange phải chạy");
});

t("rotateLocal xoay quanh target, giữ nguyên distance", () => {
  const c = mk();
  const d = c.state.distance;
  c.rotateLocal(0.3, 0.2);
  assert.ok(Math.abs(c.state.distance - d) < 1e-5);
  assert.ok(c.state.target.length() < 1e-6, "target không được dịch");
  assert.ok(c.three.position.distanceTo(c.state.eye) < 1e-5, "three phải bám state");
});

t("pan dịch CẢ eye và target cùng một vector", () => {
  const c = mk();
  const e0 = c.state.eye.clone(), t0 = c.state.target.clone();
  c.pan(100, 50);
  const de = c.state.eye.clone().sub(e0);
  const dt = c.state.target.clone().sub(t0);
  assert.ok(de.distanceTo(dt) < 1e-5, "eye và target phải dịch bằng nhau");
  assert.ok(de.length() > 1e-6, "pan phải có tác dụng");
});

t("dolly(2) tăng zoom gấp đôi", () => {
  const c = mk();
  const z = c.three.zoom;
  c.dolly(2);
  assert.ok(Math.abs(c.three.zoom - z*2) < 1e-6);
});

t("dolly zoom-to-cursor: điểm dưới con trỏ đứng yên", () => {
  const c = mk();
  const ndc = new THREE.Vector2(0.5, -0.3);
  const worldBefore = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(c.three);
  c.dolly(1.7, ndc);
  const worldAfter = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(c.three);
  // chiếu lên mặt phẳng qua target: so sánh thành phần vuông góc trục nhìn
  const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(c.state.quaternion);
  const proj = (p) => p.clone().sub(fwd.clone().multiplyScalar(p.clone().dot(fwd)));
  assert.ok(proj(worldBefore).distanceTo(proj(worldAfter)) < 1e-3,
    `điểm dưới con trỏ trôi ${proj(worldBefore).distanceTo(proj(worldAfter))}`);
});

t("getNDC: tâm viewport -> (0,0); góc trên-trái -> (-1,1)", () => {
  const c = mk();
  const mid = c.getNDC(W/2, H/2);
  assert.ok(Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9);
  const tl = c.getNDC(0, 0);
  assert.ok(Math.abs(tl.x + 1) < 1e-9 && Math.abs(tl.y - 1) < 1e-9);
});

t("zoomToWindow(rect px) tăng zoom và dời target vào tâm khung", () => {
  const c = mk();
  const z0 = c.three.zoom;
  c.zoomToWindow({ x: 300, y: 200, width: 200, height: 150 }, 0);
  assert.ok(c.three.zoom > z0, `zoom phải tăng: ${z0} -> ${c.three.zoom}`);
  assert.ok(c.state.isValid());
});

t("zoomToWindow khung quá bé -> no-op, không NaN", () => {
  const c = mk();
  const z0 = c.three.zoom;
  c.zoomToWindow({ x: 10, y: 10, width: 0, height: 0 }, 0);
  assert.equal(c.three.zoom, z0);
});

t("syncFromThree: gizmo xoay three trực tiếp -> state bám theo", () => {
  const c = mk();
  c.three.position.set(0, 20, 0);
  c.three.lookAt(0, 0, 0);
  c.three.updateMatrixWorld(true);
  c.syncFromThree();
  assert.ok(c.state.eye.distanceTo(new THREE.Vector3(0,20,0)) < 1e-5);
  assert.ok(Math.abs(c.state.distance - 20) < 1e-4);
  assert.ok(c.state.isValid());
});

t("setFromThree là alias của syncFromThree", () => {
  const c = mk();
  c.three.position.set(3, 4, 0);
  c.setFromThree();
  assert.ok(Math.abs(c.state.distance - 5) < 1e-4);
});

t("dispatchEvent(name, payload) — chữ ký CameraAnimation dùng", () => {
  const c = mk();
  let got = null;
  c.addEventListener("animationend", (s) => got = s);
  c.dispatchEvent("animationend", c.state);
  assert.equal(got, c.state);
});

t("CameraAnimation.animateTo(duration=0) áp tức thì, không cần rAF", () => {
  const c = mk();
  const target = c.state.clone();
  target.target.set(1, 2, 3);
  c.animation.animateTo(target, 2.5, 0);
  assert.ok(c.state.target.equals(new THREE.Vector3(1,2,3)));
  assert.equal(c.three.zoom, 2.5);
});

t("setStandardView('top') nhìn từ trên xuống", () => {
  const c = mk();
  c.setStandardView("top", 0);
  const fwd = new THREE.Vector3(0,0,-1).applyQuaternion(c.state.quaternion);
  assert.ok(fwd.y < -0.99, `hướng nhìn phải là -Y, được ${fwd.toArray()}`);
});

t("_boundingSphere mặc định null (InteractorStyleOrbit đọc, fallback về target)", () => {
  const c = mk();
  assert.equal(c._boundingSphere, null);
  c.setBoundingSphere(new THREE.Sphere(new THREE.Vector3(1,1,1), 5));
  assert.equal(c._boundingSphere.radius, 5);
});

t("autoClipping=false -> _afterStateChange KHÔNG đụng near/far", () => {
  const c = mk({ autoClipping: false });
  const [n, f] = c.getClippingRange();
  c.rotateLocal(0.1, 0.1);
  assert.deepEqual(c.getClippingRange(), [n, f]);
});

t("autoClipping=true -> near/far cập nhật theo bounding sphere", () => {
  const c = mk({ autoClipping: true });
  c.setBoundingSphere(new THREE.Sphere(new THREE.Vector3(0,0,0), 3));
  c.rotateLocal(0.1, 0);
  const [n, f] = c.getClippingRange();
  assert.ok(n < f && Number.isFinite(n) && Number.isFinite(f));
});

t("setClippingRange chấp nhận near ÂM (mặt cắt CAD)", () => {
  const c = mk();
  c.setClippingRange(-50, 100);
  assert.deepEqual(c.getClippingRange(), [-50, 100]);
});

t("setAspect giữ chiều cao, co giãn chiều rộng", () => {
  const c = mk();
  const h = c.three.top - c.three.bottom;
  c.setAspect(2);
  assert.equal(c.three.top - c.three.bottom, h);
  assert.ok(Math.abs((c.three.right - c.three.left) - h*2) < 1e-9);
});

t("reset(center, d): target=center, distance=d, giữ hướng (eyeCũ - centerMới)", () => {
  const c = mk();
  const eye0 = c.three.position.clone();
  const center = new THREE.Vector3(5, 0, 0);
  const expected = eye0.clone().sub(center).normalize();
  c.reset(center, 20);
  assert.ok(c.state.target.equals(center));
  assert.ok(Math.abs(c.getDistance() - 20) < 1e-4);
  const after = c.three.position.clone().sub(center).normalize();
  assert.ok(after.distanceTo(expected) < 1e-5);
});

t("state không bao giờ NaN sau chuỗi thao tác hỗn hợp", () => {
  const c = mk();
  for (let i = 0; i < 50; i++) {
    c.rotateLocal(Math.sin(i)*0.4, Math.cos(i)*0.3);
    c.pan(i % 7 - 3, i % 5 - 2);
    c.dolly(1 + (i % 3) * 0.1, i % 2 ? new THREE.Vector2(0.2, -0.4) : null);
  }
  assert.ok(c.state.isValid(), "state suy biến");
  assert.ok(Number.isFinite(c.three.zoom) && c.three.zoom > 0);
});

t("dispose dừng animation và gỡ listener", () => {
  const c = mk();
  let n = 0;
  c.addEventListener("change", () => n++);
  c.dispose();
  c.dispatchEvent("change");
  assert.equal(n, 0);
  assert.equal(c.animation.isAnimating, false);
});

t("ném lỗi rõ ràng nếu không truyền THREE.Camera", () => {
  assert.throws(() => new Camera({}, domElement), /THREE.Camera/);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
