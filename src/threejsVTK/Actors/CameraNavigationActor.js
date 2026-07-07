// Actors/CameraNavigationActor.js
// Blender-style navigation gizmo overlay. Instead of an external controller,
// it drives a vtkCamera (Rendering/Camera): drag rotates the view around the
// camera's focal point; clicking an axis snaps to that view with a smooth
// animation advanced inside update(). Render it into a corner each frame.
import * as THREE from "three";

const AXES = [
  { name: "+x", dir: new THREE.Vector3(1, 0, 0), color: 0x8b0000, label: "X", positive: true },
  { name: "-x", dir: new THREE.Vector3(-1, 0, 0), color: 0x8b0000, label: null, positive: false },
  { name: "+y", dir: new THREE.Vector3(0, 1, 0), color: 0x006400, label: "Y", positive: true },
  { name: "-y", dir: new THREE.Vector3(0, -1, 0), color: 0x006400, label: null, positive: false },
  { name: "+z", dir: new THREE.Vector3(0, 0, 1), color: 0x00008b, label: "Z", positive: true },
  { name: "-z", dir: new THREE.Vector3(0, 0, -1), color: 0x00008b, label: null, positive: false },
];

function makeAxisSprite({ color, label, positive, highlight = false }) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2, cy = size / 2, r = size * 0.42;
  ctx.clearRect(0, 0, size, size);
  const colorHex = "#" + color.toString(16).padStart(6, "0");

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (positive) {
    ctx.fillStyle = highlight ? "#ffffff" : colorHex;
    ctx.fill();
    if (highlight) { ctx.lineWidth = size * 0.05; ctx.strokeStyle = colorHex; ctx.stroke(); }
  } else {
    ctx.fillStyle = "#2b2b2b";
    ctx.fill();
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = highlight ? "#ffffff" : colorHex;
    ctx.stroke();
  }
  if (label) {
    ctx.fillStyle = positive ? "#ffffff" : colorHex;
    ctx.font = `bold ${size * 0.55}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, cy + size * 0.02);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = positive ? 2 : 1;
  return sprite;
}

export class CameraNavigationActor {
  // camera: a vtkCamera (Rendering/Camera) — the source of truth for the view.
  constructor(renderer, container, camera, options = {}) {
    this.renderer = renderer;
    this.container = container;
    this.vtkCamera = camera;

    this.position = options.position || "top-right";
    this.size = options.size ?? 110;
    this.margin = options.margin ?? 16;
    this.axisLength = options.axisLength ?? 1;
    this.spriteScale = options.spriteScale ?? 0.34;
    this.dragRotateSpeed = options.dragRotateSpeed ?? 0.6;
    this.animateSpeed = options.animateSpeed ?? 0.15;
    this.onSelect = options.onSelect || null;
    this.onChange = options.onChange || null;
    this.onDragStart = options.onDragStart || null;

    // overlay scene + camera for the gizmo widget itself
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.gizmoCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 100);
    this.camDist = 5;

    this.isDragging = false;
    this.previousPointerPosition = { x: 0, y: 0 };
    this._snapping = false;
    this._snapTarget = null;

    this.lineGroup = new THREE.Group();
    this.scene.add(this.lineGroup);

    this.handles = [];
    AXES.forEach((axis) => {
      const sprite = makeAxisSprite(axis);
      sprite.position.copy(axis.dir).multiplyScalar(this.axisLength);
      sprite.scale.setScalar(this.spriteScale);
      sprite.userData.axis = axis;
      this.scene.add(sprite);
      this.handles.push({ axis, sprite });

      if (axis.positive) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          axis.dir.clone().multiplyScalar(this.axisLength),
        ]);
        const lineMat = new THREE.LineBasicMaterial({ color: axis.color, transparent: true, opacity: 0.95, depthTest: false });
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 0;
        this.lineGroup.add(line);
      }
    });

    this.raycaster = new THREE.Raycaster();
    this.pointerNDC = new THREE.Vector2();
    this.hovered = null;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    const dom = this.renderer.domElement;
    dom.addEventListener("pointermove", this._onPointerMove);
    dom.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointerup", this._onPointerUp);
    dom.addEventListener("pointerleave", this._onPointerLeave);
  }

  _rect() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const s = this.size, m = this.margin;
    let x, y;
    if (this.position === "top-right") { x = w - s - m; y = h - s - m; }
    else if (this.position === "top-left") { x = m; y = h - s - m; }
    else if (this.position === "bottom-right") { x = w - s - m; y = m; }
    else { x = m; y = m; }
    return { x, y, w: s, h: s };
  }

  update(mainCamera) {
    if (this._snapping) this._advanceSnap();
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mainCamera.quaternion);
    this.gizmoCam.position.copy(dir.multiplyScalar(this.camDist));
    this.gizmoCam.up.copy(mainCamera.up);
    this.gizmoCam.lookAt(0, 0, 0);
    this.gizmoCam.updateMatrixWorld();
  }

  render() {
    const renderer = this.renderer;
    const { x, y, w, h } = this._rect();
    const pr = renderer.getPixelRatio();

    const previousAutoClear = renderer.autoClear;
    const previousViewport = new THREE.Vector4();
    renderer.getViewport(previousViewport);
    const previousScissor = new THREE.Vector4();
    renderer.getScissor(previousScissor);
    const previousScissorTest = renderer.getScissorTest();

    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x * pr, y * pr, w * pr, h * pr);
    renderer.setViewport(x * pr, y * pr, w * pr, h * pr);
    renderer.clearDepth();
    renderer.render(this.scene, this.gizmoCam);

    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
  }

  // --- snap-to-axis animation, driving the vtkCamera ---
  _advanceSnap() {
    const vcam = this.vtkCamera;
    const cam = vcam.getThreeCamera();
    const focal = vcam.getFocalPoint();
    const dist = vcam.getDistance() || cam.position.distanceTo(focal) || 1;

    const qCur = cam.quaternion.clone().slerp(this._snapTarget, this.animateSpeed);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(qCur);
    cam.position.copy(focal).addScaledVector(back, dist);
    cam.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(qCur));
    cam.lookAt(focal);
    vcam.setFromThree();
    this.onChange?.();

    if (cam.quaternion.angleTo(this._snapTarget) < 1e-3) {
      this._snapping = false;
      this._snapTarget = null;
    }
  }

  _pointerInRect(clientX, clientY) {
    const bounds = this.container.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const { x, y, w, h } = this._rect();
    const domTop = this.container.clientHeight - y - h;
    const domBottom = domTop + h;
    if (localX < x || localX > x + w || localY < domTop || localY > domBottom) return null;
    const ndcX = ((localX - x) / w) * 2 - 1;
    const ndcY = -(((localY - domTop) / h) * 2 - 1);
    return { ndcX, ndcY, localX, localY };
  }

  _pick(clientX, clientY) {
    const ndc = this._pointerInRect(clientX, clientY);
    if (!ndc) return null;
    this.pointerNDC.set(ndc.ndcX, ndc.ndcY);
    this.raycaster.setFromCamera(this.pointerNDC, this.gizmoCam);
    const sprites = this.handles.map((h) => h.sprite);
    const hits = this.raycaster.intersectObjects(sprites, false);
    if (hits.length === 0) return null;
    return this.handles.find((h) => h.sprite === hits[0].object) || null;
  }

  _setHover(handle) {
    if (this.hovered === handle) return;
    if (this.hovered) this._refreshSprite(this.hovered, false);
    this.hovered = handle;
    if (this.hovered) {
      this._refreshSprite(this.hovered, true);
      this.renderer.domElement.style.cursor = "pointer";
    } else {
      this.renderer.domElement.style.cursor = this.isDragging ? "grabbing" : "";
    }
  }

  _refreshSprite(handle, highlight) {
    const newSprite = makeAxisSprite({ ...handle.axis, highlight });
    handle.sprite.material.map.dispose();
    handle.sprite.material.map = newSprite.material.map;
    handle.sprite.material.needsUpdate = true;
    newSprite.material.dispose();
  }

  _onPointerMove(e) {
    if (this._pendingHandle && !this.isDragging) {
      const dx = e.clientX - this._dragStartPosition.x;
      const dy = e.clientY - this._dragStartPosition.y;
      if (Math.hypot(dx, dy) > 4) {
        this._pendingHandle = null;
        this.isDragging = true;
        this.renderer.domElement.style.cursor = "grabbing";
        this._setHover(null);
        this.onDragStart?.();
        this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      } else {
        return;
      }
    }

    if (this.isDragging) {
      const vcam = this.vtkCamera;
      const cam = vcam?.getThreeCamera();
      if (!cam) { this.previousPointerPosition = { x: e.clientX, y: e.clientY }; return; }

      const deltaX = e.clientX - this.previousPointerPosition.x;
      const deltaY = e.clientY - this.previousPointerPosition.y;
      const target = vcam.getFocalPoint();

      const thetaAngle = -(deltaX / this.size) * Math.PI * this.dragRotateSpeed;
      const phiAngle = -(deltaY / this.size) * Math.PI * this.dragRotateSpeed;

      const offset = cam.position.clone().sub(target);
      const q = new THREE.Quaternion();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(cam.up, thetaAngle));
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
      q.multiply(new THREE.Quaternion().setFromAxisAngle(camRight, phiAngle));

      offset.applyQuaternion(q);
      cam.position.copy(target).add(offset);
      cam.up.applyQuaternion(q).normalize();
      cam.lookAt(target);
      vcam.setFromThree();
      this.onChange?.();

      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      return;
    }

    this._setHover(this._pick(e.clientX, e.clientY));
  }

  _onPointerDown(e) {
    const insideRect = this._pointerInRect(e.clientX, e.clientY);
    if (!insideRect) return;

    // Prevent the main RenderWindowInteractor (registered later) from also
    // starting an orbit when pressing inside the gizmo. Requires this actor's
    // listeners to be registered BEFORE interactor.initialize().
    e.stopImmediatePropagation();
    e.stopPropagation();

    if (typeof e.pointerId === "number" && this.renderer.domElement.setPointerCapture) {
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this._capturedPointerId = e.pointerId;
      } catch (err) {}
    }

    const handle = this._pick(e.clientX, e.clientY);
    if (handle) {
      this._pendingHandle = handle;
      this._dragStartPosition = { x: e.clientX, y: e.clientY };
      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
    } else {
      this.isDragging = true;
      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      this.renderer.domElement.style.cursor = "grabbing";
      this.onDragStart?.();
    }
  }

  _onPointerUp() {
    if (this._pendingHandle) {
      const handle = this._pendingHandle;
      this._pendingHandle = null;

      const targetDir = handle.axis.dir.clone();
      const upDir = Math.abs(targetDir.y) === 1 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const m = new THREE.Matrix4().lookAt(targetDir, new THREE.Vector3(0, 0, 0), upDir);
      this._snapTarget = new THREE.Quaternion().setFromRotationMatrix(m);
      this._snapping = true;

      if (this.onSelect) this.onSelect(handle.axis.dir.clone(), handle.axis.name);
    }

    if (this.isDragging) {
      this.isDragging = false;
      this.renderer.domElement.style.cursor = "";
    }

    if (this._capturedPointerId !== undefined && this.renderer.domElement.releasePointerCapture) {
      try { this.renderer.domElement.releasePointerCapture(this._capturedPointerId); } catch (err) {}
      this._capturedPointerId = undefined;
    }
  }

  _onPointerLeave() {
    if (!this.isDragging) {
      this._setHover(null);
      this._pendingHandle = null;
    }
  }

  dispose() {
    const dom = this.renderer.domElement;
    dom.removeEventListener("pointermove", this._onPointerMove);
    dom.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointerup", this._onPointerUp);
    dom.removeEventListener("pointerleave", this._onPointerLeave);
    dom.style.cursor = "";

    this.handles.forEach(({ sprite }) => {
      sprite.material.map?.dispose();
      sprite.material.dispose();
    });
    this.lineGroup.children.forEach((line) => {
      line.geometry.dispose();
      line.material.dispose();
    });
    this.scene.clear();
  }
}