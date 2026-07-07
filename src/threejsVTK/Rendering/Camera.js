// Rendering/Camera.js  — vtkCamera
// Source of truth for camera state. Can either MANAGE its own perspective/
// orthographic THREE cameras, or ADOPT an existing THREE camera (so an app
// that already owns an OrthographicCamera keeps using the same object while
// gaining vtk-style motions). Overlays read getThreeCamera(); after an
// overlay (e.g. a gizmo) mutates that camera directly, call setFromThree().
import * as THREE from 'three';

const D2R = THREE.MathUtils.degToRad;

export class Camera {
  constructor({ threeCamera = null } = {}) {
    this._position = new THREE.Vector3(0, 0, 5);
    this._focalPoint = new THREE.Vector3(0, 0, 0);
    this._viewUp = new THREE.Vector3(0, 1, 0);
    this._viewAngle = 50;
    this._clip = [0.01, 1000];
    this._aspect = 1;
    this._parallel = false;
    this._parallelScale = 1;
    this._adopted = null;

    if (threeCamera) {
      this._adopt(threeCamera);
    } else {
      this._persp = new THREE.PerspectiveCamera(this._viewAngle, 1, this._clip[0], this._clip[1]);
      this._ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, this._clip[0], this._clip[1]);
      this._apply();
    }
  }

  getThreeCamera() {
    if (this._adopted) return this._adopted;
    return this._parallel ? this._ortho : this._persp;
  }

  _adopt(cam) {
    this._adopted = cam;
    this._parallel = !!cam.isOrthographicCamera;
    this._position.copy(cam.position);
    this._viewUp.copy(cam.up);
    if (cam.isPerspectiveCamera) this._viewAngle = cam.fov;
    if (cam.isOrthographicCamera) this._parallelScale = (cam.top - cam.bottom) / 2;
    if (cam.near != null) this._clip[0] = cam.near;
    if (cam.far != null) this._clip[1] = cam.far;
    // focal = point the camera currently looks at, at its current distance
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const dist = cam.position.length() || 10;
    this._focalPoint.copy(cam.position).addScaledVector(dir, dist);
  }

  // ---- getters ----
  getPosition() { return this._position.clone(); }
  getFocalPoint() { return this._focalPoint.clone(); }
  getViewUp() { return this._viewUp.clone(); }
  getViewAngle() { return this._viewAngle; }
  getAspect() { return this._aspect; }
  getParallelProjection() { return this._parallel; }
  getParallelScale() { return this._parallelScale; }
  getDistance() { return this._position.distanceTo(this._focalPoint); }
  getDirectionOfProjection() {
    return new THREE.Vector3().subVectors(this._focalPoint, this._position).normalize();
  }
  getViewRight() {
    return new THREE.Vector3().crossVectors(this.getDirectionOfProjection(), this._viewUp).normalize();
  }

  // ---- setters ----
  setPosition(x, y, z) { this._position.set(x, y, z); return this._apply(); }
  setFocalPoint(x, y, z) { this._focalPoint.set(x, y, z); return this._apply(); }
  setViewUp(x, y, z) { this._viewUp.set(x, y, z).normalize(); return this._apply(); }
  setViewAngle(deg) { this._viewAngle = deg; return this._apply(); }
  setClippingRange(n, f) { this._clip = [n, f]; return this._apply(); }
  setAspect(a) { if (a > 0) this._aspect = a; return this._apply(); }
  setParallelProjection(on) { if (this._adopted) return this; this._parallel = !!on; return this._apply(); }
  setParallelScale(s) { this._parallelScale = s; return this._apply(); }

  // Re-read state from the THREE camera after an external mutation (gizmo/triad).
  // Keeps the orbit center on the current view axis at the current distance.
  setFromThree() {
    const c = this.getThreeCamera();
    this._position.copy(c.position);
    this._viewUp.copy(c.up);
    const dir = new THREE.Vector3(); c.getWorldDirection(dir);
    const dist = this.getDistance() || c.position.length() || 10;
    this._focalPoint.copy(c.position).addScaledVector(dir, dist);
    return this;
  }

  // ---- motions (degrees) ----
  azimuth(deg) {
    const q = new THREE.Quaternion().setFromAxisAngle(this._viewUp.clone().normalize(), D2R(deg));
    const off = this._position.clone().sub(this._focalPoint).applyQuaternion(q);
    this._position.copy(this._focalPoint).add(off);
    return this._apply();
  }
  elevation(deg) {
    const right = this.getViewRight();
    const q = new THREE.Quaternion().setFromAxisAngle(right, D2R(deg));
    const off = this._position.clone().sub(this._focalPoint).applyQuaternion(q);
    this._position.copy(this._focalPoint).add(off);
    this._viewUp.applyQuaternion(q).normalize();
    return this._apply();
  }
  roll(deg) {
    const q = new THREE.Quaternion().setFromAxisAngle(this.getDirectionOfProjection(), D2R(deg));
    this._viewUp.applyQuaternion(q).normalize();
    return this._apply();
  }
  translate(vec) { this._position.add(vec); this._focalPoint.add(vec); return this._apply(); }
  orthogonalizeViewUp() {
    const dop = this.getDirectionOfProjection();
    this._viewUp.sub(dop.multiplyScalar(this._viewUp.dot(dop))).normalize();
    return this._apply();
  }
  dolly(value) { // perspective move toward focal; value > 1 = closer
    if (value <= 0) return this;
    const off = this._position.clone().sub(this._focalPoint).multiplyScalar(1 / value);
    const len = off.length();
    if (len < 1e-4 || len > 1e7) return this;
    this._position.copy(this._focalPoint).add(off);
    return this._apply();
  }
  // factor > 1 zooms in. Ortho -> THREE camera.zoom (what CAD grids read);
  // perspective -> dolly toward the focal point.
  scaleView(factor) {
    if (factor <= 0) return this;
    if (this._parallel) {
      const c = this.getThreeCamera();
      c.zoom *= factor;
      c.updateProjectionMatrix();
    } else {
      this.dolly(factor);
    }
    return this;
  }

  reset(center, radius) {
    let dop = this.getDirectionOfProjection();
    if (dop.lengthSq() < 1e-8) dop = new THREE.Vector3(0, 0, -1);
    const dist = radius / Math.sin(D2R(this._viewAngle) / 2);
    this._focalPoint.copy(center);
    this._position.copy(center).addScaledVector(dop, -dist);
    this._parallelScale = radius;
    this._clip = [Math.max(dist * 0.001, 1e-4), dist * 100];
    return this._apply();
  }

  _apply() {
    const c = this.getThreeCamera();
    c.position.copy(this._position);
    c.up.copy(this._viewUp);
    if (this._parallel) {
      // Only rewrite the frustum for cameras we OWN; adopted ortho cameras
      // keep their app-managed frustum + zoom.
      if (!this._adopted) {
        const halfH = this._parallelScale, halfW = halfH * this._aspect;
        c.left = -halfW; c.right = halfW; c.top = halfH; c.bottom = -halfH;
      }
    } else {
      c.fov = this._viewAngle;
      c.aspect = this._aspect;
    }
    c.near = this._clip[0];
    c.far = this._clip[1];
    c.lookAt(this._focalPoint);
    c.updateProjectionMatrix();
    return this;
  }
}