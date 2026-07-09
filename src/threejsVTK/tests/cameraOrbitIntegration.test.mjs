import * as THREE from "three";
import assert from "node:assert/strict";
import { Camera } from "../src/camera/Camera.js";
import { InteractorStyleOrbit } from "../src/interaction/InteractorStyleOrbit.js";

// Tích hợp: KHÔNG mock facade. Cho InteractorStyleOrbit THẬT điều khiển Camera THẬT.
// Đây là kiểm chứng mạnh nhất rằng bề mặt facade dựng lại đúng.
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
globalThis.performance ??= { now: () => Date.now() };
// InteractorStyleOrbit gắn keydown lên window
globalThis.window ??= { addEventListener(){}, removeEventListener(){} };

let pass=0, fail=0;
const t=(n,f)=>{try{f();console.log("  ok  "+n);pass++}catch(e){console.log("  FAIL "+n+"\n       "+e.message);fail++}};

const W=800, H=600;
const domElement = {
  clientWidth: W, clientHeight: H,
  getBoundingClientRect: () => ({ left:0, top:0, width:W, height:H }),
  addEventListener(){}, removeEventListener(){},
  setPointerCapture(){}, releasePointerCapture(){}, hasPointerCapture(){return false},
  style: {},
};
const mk = () => {
  const three = new THREE.OrthographicCamera(-6.67, 6.67, 5, -5, 0.01, 10000);
  three.position.set(10,10,10); three.up.set(0,1,0); three.lookAt(0,0,0); three.updateMatrixWorld(true);
  const cam = new Camera(three, domElement, { animationDuration: 0 });
  const style = new InteractorStyleOrbit(cam, { enableDamping:false, enableZoomWindow:true });
  style.setInteractor?.({ render(){}, state:{} });
  return { cam, style, three };
};

console.log("\nTích hợp: InteractorStyleOrbit THẬT lái Camera THẬT");

t("khởi tạo không ném (facade có đủ domElement/state/three/animation)", () => {
  const { style } = mk();
  assert.ok(style);
});

t("style._rotate(dx,dy) -> facade.rotateLocal -> three xoay, target đứng yên", () => {
  const { cam, style, three } = mk();
  const p0 = three.position.clone();
  style._rotate(40, 25);
  assert.ok(three.position.distanceTo(p0) > 1e-3, "camera phải xoay");
  assert.ok(cam.state.target.length() < 1e-6, "target không được dịch");
  assert.ok(cam.state.isValid());
});

t("style._pan(dx,dy) -> facade.pan -> eye và target dịch bằng nhau", () => {
  const { cam, style } = mk();
  const e0 = cam.state.eye.clone(), t0 = cam.state.target.clone();
  style._pan(30, -20);
  const de = cam.state.eye.clone().sub(e0), dt = cam.state.target.clone().sub(t0);
  assert.ok(de.length() > 1e-6 && de.distanceTo(dt) < 1e-6);
});

t("style.onWheel -> facade.dolly(factor, ndc) -> zoom đổi, không NaN", () => {
  const { cam, style, three } = mk();
  const z0 = three.zoom;
  style.onWheel({ clientX: 400, clientY: 300, deltaY: -120, preventDefault(){} });
  assert.ok(three.zoom !== z0, "zoom phải đổi");
  assert.ok(Number.isFinite(three.zoom) && three.zoom > 0);
  assert.ok(cam.state.isValid());
});

t("style._syncFacadeWithThree() sau khi gizmo xoay three: KHÔNG dịch 1 pixel nào", () => {
  const { cam, style, three } = mk();
  // gizmo xoay three trực tiếp, bỏ qua facade
  three.position.set(0, 25, 0); three.lookAt(0,0,0); three.updateMatrixWorld(true);
  const pos = three.position.clone(), quat = three.quaternion.clone();

  style._syncFacadeWithThree();

  assert.ok(three.position.distanceTo(pos) < 1e-9, "vị trí phải giữ nguyên tuyệt đối");
  assert.ok(Math.abs(Math.abs(three.quaternion.dot(quat)) - 1) < 1e-9, "orientation phải giữ nguyên");
  assert.ok(cam.state.eye.distanceTo(pos) < 1e-6, "state.eye phải bám three");
  assert.ok(cam.state.distance > 0 && Number.isFinite(cam.state.distance));
});

t("_syncFacadeWithThree dùng _boundingSphere làm pivot khi có", () => {
  const { cam, style, three } = mk();
  cam.setBoundingSphere(new THREE.Sphere(new THREE.Vector3(0,0,0), 4));
  three.position.set(0, 100, 0); three.lookAt(0,0,0); three.updateMatrixWorld(true);
  style._syncFacadeWithThree();
  // depth = chiếu (center - eye) lên forward = 100
  assert.ok(Math.abs(cam.state.distance - 100) < 1e-3, `distance=${cam.state.distance}`);
});

t("zoomToWindow qua style (marquee) -> zoom tăng", () => {
  const { cam, style, three } = mk();
  cam.animationDuration = 0;
  const z0 = three.zoom;
  cam.zoomToWindow({ x: 250, y: 150, width: 300, height: 225 }, 0);
  assert.ok(three.zoom > z0);
  assert.ok(cam.state.isValid());
});

t("chuỗi rotate/pan/wheel 100 lần: state hợp lệ, zoom dương", () => {
  const { cam, style, three } = mk();
  for (let i=0;i<100;i++) {
    style._rotate(Math.sin(i)*20, Math.cos(i)*15);
    style._pan(i%9-4, i%6-3);
    style.onWheel({ clientX: 100+i, clientY: 100+i, deltaY: i%2?120:-120, preventDefault(){} });
  }
  assert.ok(cam.state.isValid(), "state suy biến sau chuỗi thao tác");
  assert.ok(three.zoom > 0 && Number.isFinite(three.zoom));
  assert.ok(three.position.distanceTo(cam.state.eye) < 1e-4, "three lệch khỏi state");
});

t("style.dispose() rồi cam.dispose() không ném", () => {
  const { cam, style } = mk();
  assert.doesNotThrow(() => { style.dispose(); cam.dispose(); });
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail?1:0);
