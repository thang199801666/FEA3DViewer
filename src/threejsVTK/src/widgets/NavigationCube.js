// Actors/CameraNavigationActor.js
// Blender-style navigation gizmo overlay. It drives a vtkCamera (Rendering/Camera):
//   - clicking an axis TIP snaps to that view (smooth animation in update());
//   - dragging an axis TIP rotates the view around the camera's focal point;
//   - dragging an axis SHAFT translates the scene model along that axis
//     (emitted through the onTranslate callback, since this actor has no model ref);
//   - anything else inside the gizmo does nothing.
// Render it into a corner each frame.
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
    // Speed of the click-to-snap camera animation (0..1 per frame; 1 = instant).
    this.animateSpeed = options.animateSpeed ?? 0.15;
    // Pick tolerance (in gizmo-scene units) for grabbing the thin shaft lines.
    this.lineThreshold = options.lineThreshold ?? 0.12;

    this.onChange = options.onChange || null;
    this.onDragStart = options.onDragStart || null;
    // Called when a tip is clicked (not dragged): (axisDir, axisName).
    this.onSelect = options.onSelect || null;
    // Called while dragging an axis shaft. Receives an incremental world-space
    // translation vector (THREE.Vector3) and the axis name ("+x", "+y", "+z").
    // The host must add this to the target model's position and re-render.
    this.onTranslate = options.onTranslate || null;

    // overlay scene + camera for the gizmo widget itself
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.gizmoCam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 100);
    this.camDist = 5;

    // Interaction mode: null (idle), "rotate" (dragging an axis tip),
    // or "translate" (dragging an axis shaft).
    this._mode = null;
    // A tip pressed but not yet dragged past the threshold -> pending click (snap).
    this._pendingHandle = null;
    // Smooth click-to-snap animation state (advanced inside update()).
    this._snapping = false;
    this._snapTarget = null;
    this.previousPointerPosition = { x: 0, y: 0 };

    this.lineGroup = new THREE.Group();
    this.scene.add(this.lineGroup);

    this.handles = []; // axis tips (rotate handles)
    this.shafts = [];  // positive-axis lines (translate handles)
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
        line.userData.axis = axis;
        this.lineGroup.add(line);
        this.shafts.push({ axis, line, baseColor: new THREE.Color(axis.color) });
      }
    });

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = this.lineThreshold;
    this.pointerNDC = new THREE.Vector2();
    this.hovered = null;
    this._hoverKey = null;

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

    const previousAutoClear = renderer.autoClear;
    const previousViewport = new THREE.Vector4();
    renderer.getViewport(previousViewport);
    const previousScissor = new THREE.Vector4();
    renderer.getScissor(previousScissor);
    const previousScissorTest = renderer.getScissorTest();

    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, w, h);
    renderer.setViewport(x, y, w, h);
    renderer.clearDepth();
    renderer.render(this.scene, this.gizmoCam);

    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
  }

  // --- click-to-snap animation, driving the vtkCamera ---
  _advanceSnap() {
    const vcam = this.vtkCamera;
    const cam = vcam.getThreeCamera();
    const focal = vcam.getFocalPoint();
    const dist =
      (typeof vcam.getDistance === "function" ? vcam.getDistance() : 0) ||
      cam.position.distanceTo(focal) ||
      1;

    const qCur = cam.quaternion.clone().slerp(this._snapTarget, this.animateSpeed);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(qCur);
    cam.position.copy(focal).addScaledVector(back, dist);
    cam.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(qCur));
    cam.lookAt(focal);
    vcam.setFromThree(focal);
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

  // Returns { type: "tip"|"shaft", axis, handle?, shaft? } or null.
  // Tips take priority over shafts where they overlap (near the axis end).
  _pick(clientX, clientY) {
    const ndc = this._pointerInRect(clientX, clientY);
    if (!ndc) return null;
    this.pointerNDC.set(ndc.ndcX, ndc.ndcY);
    this.raycaster.setFromCamera(this.pointerNDC, this.gizmoCam);

    const sprites = this.handles.map((h) => h.sprite);
    const tipHits = this.raycaster.intersectObjects(sprites, false);
    if (tipHits.length > 0) {
      const handle = this.handles.find((h) => h.sprite === tipHits[0].object);
      if (handle) return { type: "tip", axis: handle.axis, handle };
    }

    const lines = this.shafts.map((s) => s.line);
    const shaftHits = this.raycaster.intersectObjects(lines, false);
    if (shaftHits.length > 0) {
      const shaft = this.shafts.find((s) => s.line === shaftHits[0].object);
      if (shaft) return { type: "shaft", axis: shaft.axis, shaft };
    }
    return null;
  }

  _setHover(pick) {
    const key = pick ? `${pick.type}:${pick.axis.name}` : null;
    if (this._hoverKey === key) return;

    // clear previous highlight
    if (this.hovered) {
      if (this.hovered.type === "tip") this._refreshSprite(this.hovered.handle, false);
      else this._setShaftHighlight(this.hovered.shaft, false);
    }

    this.hovered = pick;
    this._hoverKey = key;

    if (pick) {
      if (pick.type === "tip") this._refreshSprite(pick.handle, true);
      else this._setShaftHighlight(pick.shaft, true);
      this.renderer.domElement.style.cursor = "grab";
    } else {
      this.renderer.domElement.style.cursor = this._mode ? "grabbing" : "";
    }
  }

  _refreshSprite(handle, highlight) {
    const newSprite = makeAxisSprite({ ...handle.axis, highlight });
    handle.sprite.material.map.dispose();
    handle.sprite.material.map = newSprite.material.map;
    handle.sprite.material.needsUpdate = true;
    newSprite.material.dispose();
  }

  _setShaftHighlight(shaft, highlight) {
    if (highlight) {
      shaft.line.material.color.copy(shaft.baseColor).lerp(new THREE.Color(0xffffff), 0.55);
      shaft.line.material.opacity = 1;
    } else {
      shaft.line.material.color.copy(shaft.baseColor);
      shaft.line.material.opacity = 0.95;
    }
    shaft.line.material.needsUpdate = true;
  }

  // Capture a stable orbit pivot ON the current view axis. The vtkCamera's stored
  // focal point can be stale / off-axis after the main interactor orbits (and for
  // an ortho camera the focal distance isn't recoverable from the THREE camera),
  // which makes the first rotate frame's lookAt() reorient the view -> a visible
  // "jump". Anchoring the pivot to the current forward direction avoids that.
  _beginRotate() {
    const vcam = this.vtkCamera;
    const cam = vcam?.getThreeCamera();
    if (!cam) { this._rotFocal = new THREE.Vector3(); return; }

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
    const stored = vcam.getFocalPoint ? vcam.getFocalPoint() : new THREE.Vector3();
    // Focal depth = projection of the stored focal onto the current view axis,
    // so the pivot sits exactly ahead of the camera (no first-frame reorientation).
    let dist = stored.clone().sub(cam.position).dot(forward);
    if (!(dist > 1e-6)) {
      dist =
        (typeof vcam.getDistance === "function" ? vcam.getDistance() : 0) ||
        cam.position.distanceTo(stored) ||
        1;
    }
    this._rotFocal = cam.position.clone().addScaledVector(forward, dist);
  }

  // Precompute how a world-space move of one unit along `axis` maps to screen
  // pixels, anchored at the camera focal point (near the model). We reuse this
  // for the whole drag so translation stays stable and linear.
  _beginTranslate(axis) {
    const vcam = this.vtkCamera;
    const cam = vcam?.getThreeCamera();
    this._transValid = false;
    if (!cam) return;

    const focal = vcam.getFocalPoint();
    const axisDir = axis.dir.clone().normalize();
    const W = this.container.clientWidth;
    const H = this.container.clientHeight;

    const a = focal.clone().project(cam);
    const b = focal.clone().add(axisDir).project(cam);
    const sa = new THREE.Vector2((a.x * 0.5 + 0.5) * W, (-a.y * 0.5 + 0.5) * H);
    const sb = new THREE.Vector2((b.x * 0.5 + 0.5) * W, (-b.y * 0.5 + 0.5) * H);
    const screenVec = sb.sub(sa);
    const pxPerWorld = screenVec.length();

    // Axis nearly parallel to the view direction → projects to ~0 on screen,
    // so dragging can't sensibly translate along it. Disable this drag.
    if (pxPerWorld < 1e-2) return;

    this._transAxisDir = axisDir;
    this._transAxisName = axis.name;
    this._transScreenDir = screenVec.multiplyScalar(1 / pxPerWorld); // unit screen dir
    this._transPxPerWorld = pxPerWorld;
    this._transValid = true;
  }

  _onPointerMove(e) {
    // A pending tip press becomes a rotate only after moving past the threshold;
    // a release before that counts as a click (handled in _onPointerUp -> snap).
    if (this._pendingHandle && !this._mode) {
      const dx = e.clientX - this._dragStartPosition.x;
      const dy = e.clientY - this._dragStartPosition.y;
      if (Math.hypot(dx, dy) > 4) {
        this._pendingHandle = null;
        this._mode = "rotate";
        this._beginRotate();
        this.renderer.domElement.style.cursor = "grabbing";
        this._setHover(null);
        this.onDragStart?.();
        this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      } else {
        return;
      }
    }

    // --- dragging an axis tip → rotate the view ---
    if (this._mode === "rotate") {
      const vcam = this.vtkCamera;
      const cam = vcam?.getThreeCamera();
      if (!cam) { this.previousPointerPosition = { x: e.clientX, y: e.clientY }; return; }

      const deltaX = e.clientX - this.previousPointerPosition.x;
      const deltaY = e.clientY - this.previousPointerPosition.y;
      const target = this._rotFocal || vcam.getFocalPoint();

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
      vcam.setFromThree(target);
      this.onChange?.();

      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      return;
    }

    // --- dragging an axis shaft → translate the model along that axis ---
    if (this._mode === "translate") {
      if (this._transValid) {
        const dx = e.clientX - this.previousPointerPosition.x;
        const dy = e.clientY - this.previousPointerPosition.y;
        const along = dx * this._transScreenDir.x + dy * this._transScreenDir.y; // px along axis
        const worldDelta = along / this._transPxPerWorld;
        if (worldDelta !== 0) {
          const t = this._transAxisDir.clone().multiplyScalar(worldDelta);
          this.onTranslate?.(t, this._transAxisName);
          this.onChange?.();
        }
      }
      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
      return;
    }

    // --- idle: just hover feedback over tips/shafts ---
    this._setHover(this._pick(e.clientX, e.clientY));
  }

  _onPointerDown(e) {
    const insideRect = this._pointerInRect(e.clientX, e.clientY);
    if (!insideRect) return;

    // The gizmo owns its corner: swallow the event so the main
    // RenderWindowInteractor doesn't also start an orbit. Requires this actor's
    // listeners to be registered BEFORE interactor.initialize().
    e.stopImmediatePropagation();
    e.stopPropagation();

    const pick = this._pick(e.clientX, e.clientY);
    // Empty space inside the gizmo → do nothing.
    if (!pick) return;

    if (typeof e.pointerId === "number" && this.renderer.domElement.setPointerCapture) {
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this._capturedPointerId = e.pointerId;
      } catch (err) {}
    }

    this.previousPointerPosition = { x: e.clientX, y: e.clientY };

    if (pick.type === "tip") {
      // Defer: a click (no drag) snaps to this view; a drag rotates.
      this._pendingHandle = pick.handle;
      this._dragStartPosition = { x: e.clientX, y: e.clientY };
    } else {
      // Grab an axis shaft → translate the model along that axis.
      this._beginTranslate(pick.axis);
      this._mode = "translate";
      this.renderer.domElement.style.cursor = "grabbing";
      this.onDragStart?.();
    }
  }

  _onPointerUp() {
    // Tip pressed and released without dragging → snap to that axis view.
    if (this._pendingHandle) {
      const handle = this._pendingHandle;
      this._pendingHandle = null;

      const targetDir = handle.axis.dir.clone();
      const upDir = Math.abs(targetDir.y) === 1 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
      const m = new THREE.Matrix4().lookAt(targetDir, new THREE.Vector3(0, 0, 0), upDir);
      this._snapTarget = new THREE.Quaternion().setFromRotationMatrix(m);
      this._snapping = true;

      this.onSelect?.(handle.axis.dir.clone(), handle.axis.name);
    }

    if (this._mode) {
      this._mode = null;
      this._transValid = false;
      this.renderer.domElement.style.cursor = "";
    }

    if (this._capturedPointerId !== undefined && this.renderer.domElement.releasePointerCapture) {
      try { this.renderer.domElement.releasePointerCapture(this._capturedPointerId); } catch (err) {}
      this._capturedPointerId = undefined;
    }
  }

  _onPointerLeave() {
    if (!this._mode) {
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
