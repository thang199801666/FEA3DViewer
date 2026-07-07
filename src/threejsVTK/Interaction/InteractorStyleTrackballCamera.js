// Interaction/InteractorStyleTrackballCamera.js  — vtkInteractorStyleTrackballCamera
// Left drag = rotate (Shift = pan), middle = pan, right = dolly, wheel = dolly.
// A left click without dragging fires a pick; set style.onPick to handle it.
// Camera motion is delegated to the renderer's vtkCamera (activeCamera).
import * as THREE from 'three';
import { InteractorStyle } from './InteractorStyle.js';

const ACTION = { NONE: 0, ROTATE: 1, PAN: 2, DOLLY: 3 };

export class InteractorStyleTrackballCamera extends InteractorStyle {
  constructor({ rotateSpeed = 200, panSpeed = 1.0, zoomSpeed = 1.0, clickThreshold = 0.005 } = {}) {
    super();
    this.rotateSpeed = rotateSpeed;   // degrees per normalized drag unit
    this.panSpeed = panSpeed;
    this.zoomSpeed = zoomSpeed;
    this.clickThreshold = clickThreshold;
    this.onPick = null;               // (pickResult|null) => void
    this._action = ACTION.NONE;
    this._downPointer = null;
  }

  get renderer() { return this.state.currentRenderer; }
  get camera() { return this.renderer?.activeCamera; } // vtkCamera

  onLeftButtonDown() {
    this.camera?.setFromThree?.();               // pick up gizmo/triad edits
    this._downPointer = { ...this.state.pointer };
    this._action = this.state.shift ? ACTION.PAN : ACTION.ROTATE;
  }
  onMiddleButtonDown() { this.camera?.setFromThree?.(); this._action = ACTION.PAN; }
  onRightButtonDown() { this.camera?.setFromThree?.(); this._action = ACTION.DOLLY; }

  onLeftButtonUp() {
    if (this._downPointer && this.interactor.picker && this.onPick && this.renderer) {
      const dx = this.state.pointer.x - this._downPointer.x;
      const dy = this.state.pointer.y - this._downPointer.y;
      if (Math.hypot(dx, dy) < this.clickThreshold) {
        const result = this.interactor.picker.pick(
          this.state.pointer.x, this.state.pointer.y, this.renderer);
        this.onPick(result);
        this.interactor.render();
      }
    }
    this._downPointer = null;
    this._action = ACTION.NONE;
  }
  onMiddleButtonUp() { this._action = ACTION.NONE; }
  onRightButtonUp() { this._action = ACTION.NONE; }

  onMouseMove() {
    if (this._action === ACTION.NONE || !this.camera) return;
    const dx = this.state.pointer.x - this.state.lastPointer.x;
    const dy = this.state.pointer.y - this.state.lastPointer.y;
    if (this._action === ACTION.ROTATE) this._rotate(dx, dy);
    else if (this._action === ACTION.PAN) this._pan(dx, dy);
    else if (this._action === ACTION.DOLLY) this.camera.scaleView(1 + dy * this.zoomSpeed);
    this.interactor.render();
  }

  onWheel(e) {
    if (!this.camera) return;
    this.camera.setFromThree?.();
    this.camera.scaleView(e.deltaY > 0 ? 1 / 1.1 : 1.1); // scroll up = zoom in
    this.interactor.render();
  }

  _rotate(dx, dy) {
    const c = this.camera;
    c.azimuth(-dx * this.rotateSpeed);
    c.elevation(dy * this.rotateSpeed);
    c.orthogonalizeViewUp();
  }

  _pan(dx, dy) {
    const c = this.camera;
    const worldY = c.getParallelProjection()
      ? 2 * c.getParallelScale()
      : 2 * c.getDistance() * Math.tan(THREE.MathUtils.degToRad(c.getViewAngle()) / 2);
    const worldX = worldY * c.getAspect();
    const move = new THREE.Vector3()
      .addScaledVector(c.getViewRight(), -dx * worldX * this.panSpeed)
      .addScaledVector(c.getViewUp(), -dy * worldY * this.panSpeed);
    c.translate(move);
  }
}