import * as THREE from "three";
import { BoxSource, LookupTable, PolyDataMapper, Actor } from "../threejsVTK";

/**
 * SceneController - Manages the Scene, Actors, and coordinates camera operations 
 * via vtkCamera (Rendering/Camera from threejsVTK) replacing the legacy CameraController.
 *
 * Scene.tsx calls attachRendering({...}) once the RenderWindow/Renderer/Camera infrastructure is ready.
 */
export default class SceneController {
  constructor(camera, _legacyCameraController = null, externalScene = null) {
    // Inject internal event dispatcher capabilities from Three.js
    // This enables the use of this.addEventListener and this.dispatchEvent
    Object.assign(this, new THREE.EventDispatcher());

    // Use the shared scene passed from the parent if available, otherwise initialize a new one
    this.scene = externalScene || new THREE.Scene();
    if (!externalScene) this.scene.background = new THREE.Color(0xffffff);

    this.camera = camera; // THREE.OrthographicCamera (the main viewing source)

    // Bound later via attachRendering()
    this.renderWindow = null;
    this.renderer = null;  // vtk Renderer instance
    this.vtkCamera = null;  // vtk Camera wrapper (adopts this.camera)
    this.domElement = null;

    this.frustumSize = 10;
    this._actorCounter = 0;

    this.initialize();
  }

  /**
   * Attaches the core rendering pipeline infrastructure from threejsVTK to this controller.
   */
  attachRendering({ renderWindow, renderer, vtkCamera, domElement }) {
    this.renderWindow = renderWindow || null;
    this.renderer = renderer || null;
    this.vtkCamera = vtkCamera || null;
    this.domElement = domElement || renderWindow?.domElement || null;
    this.updateClipping();
    return this;
  }

  /**
   * Requests a manual frame render on the active render window.
   */
  requestRender() {
    if (this.renderWindow) this.renderWindow.render();
  }

  /**
   * Initializes standard CAD-style studio lighting setup.
   * Replaces flat ambient lighting with balanced multi-directional highlights to enhance 3D contours.
   */
  initialize() {
    const hasAmbient = this.scene.children.some((c) => c.isAmbientLight);
    if (hasAmbient) return;

    // 1. Soft Ambient Light: Keeps shadows from turning pitch black while maintaining depth perception
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    // 2. Key Light: Positioned Top-Front-Right to create clear geometric highlights and define main shapes
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(30, 40, 30);
    this.scene.add(keyLight);

    // 3. Fill Light: Positioned on the opposite side to soften harsh shadows cast by the key light
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-30, 20, -20);
    this.scene.add(fillLight);

    // 4. Rim/Top Light: Accents technical edges, fillets, and chamfers to separate the model from the background
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
    rimLight.position.set(-10, 40, 20);
    this.scene.add(rimLight);

    // 5. Bottom Bounce Light: Gently illuminates underside faces so structural features remain visible from below
    const bottomLight = new THREE.DirectionalLight(0xffffff, 0.25);
    bottomLight.position.set(0, -40, 0);
    this.scene.add(bottomLight);
  }

  // ------------------------------------------------------------------
  // Actor Operations
  // ------------------------------------------------------------------

  /**
   * Generates a structural box actor with internal grids and a simulated "stress" scalar field.
   */
  addBoxActor(length = 1, width = 1, height = 1, options = {}) {
    if (!this.scene) return null;
    this._actorCounter += 1;

    // Build a box with 20x20x20 segments and evaluate simulated scalar values (highest at the center)
    const source = new BoxSource({
      xLength: length,
      yLength: width,
      zLength: height,
      segments: 20,
    });
    const maxD = Math.sqrt((length / 2) ** 2 + (width / 2) ** 2 + (height / 2) ** 2);
    const polyData = source.getOutputDataWithScalars(
      "stress",
      (x, y, z) => 1 - Math.sqrt(x * x + y * y + z * z) / maxD
    );

    const mapper = new PolyDataMapper()
      .setInputData(polyData)
      .setLookupTable(new LookupTable());

    const actor = new Actor(mapper, `Box_${this._actorCounter}`, {
      roughness: 0.4,
      metalness: 0.1,
    });

    const pos = options.position;
    if (pos) {
      actor.position.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0);
    } else {
      // Stagger consecutive actors along the X axis based on width to prevent overlapping
      actor.position.set((this._actorCounter - 1) * (length + 0.5), 0, 0);
    }

    // Prioritize adding via the vtk Renderer so the system Picker can trace properties cleanly
    if (this.renderer && typeof this.renderer.addActor === "function") {
      this.renderer.addActor(actor);
    } else {
      this.scene.add(actor);
    }

    this.updateClipping();
    return actor;
  }

  // ------------------------------------------------------------------
  // Bounds / View Orientation / Clipping Logic
  // ------------------------------------------------------------------

  /**
   * Internal helper to calculate the strict bounding box of the geometric models,
   * strictly filtering out systemic helpers like 'system_grid' or GridHelpers.
   */
  _calculateModelBounds() {
    const box = new THREE.Box3();
    if (!this.scene) return box;
    this.scene.updateMatrixWorld(true);

    this.scene.traverse((child) => {
      if (child === this.scene || child.name === "system_grid" || child.isGridHelper) return;
      let owner = child;
      while (owner) {
        if (owner.userData?.isMeasurementOverlay) return;
        owner = owner.parent;
      }
      if (child.isMesh) {
        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
        const b = child.geometry.boundingBox.clone();
        b.applyMatrix4(child.matrixWorld);
        box.union(b);
      }
    });
    return box;
  }

  /** World AABB of geometry belonging to actors that are currently rendered. */
  _calculateVisibleActorBounds() {
    const box = new THREE.Box3();
    if (!this.scene) return box;
    this.scene.updateMatrixWorld(true);

    const actorIsVisible = (actor) => {
      for (let node = actor; node; node = node.parent) {
        if (!node.visible) return false;
      }
      return true;
    };

    this.scene.traverse((actor) => {
      if (!actor.isActor || !actorIsVisible(actor)) return;
      actor.traverseVisible((object) => {
        if (!(object.isMesh || object.isLine || object.isLineSegments || object.isPoints)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.length && materials.every((material) => material && material.visible === false)) return;
        const geometry = object.geometry;
        if (!geometry?.getAttribute?.("position")) return;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (!geometry.boundingBox?.isEmpty()) {
          box.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
        }
      });
    });
    return box;
  }

  /** * Triggers a Zoom Fit action while preserving the active viewport viewing angle.
   */
  fitView(marginPx = 25) {
    if (!this.vtkCamera || !this.scene) return false;
    const box = this._calculateVisibleActorBounds();
    if (box.isEmpty()) return false;
    this._fitBox(box, marginPx);
    this.updateClipping();
    return true;
  }

  /**
   * Core logic to project, bound, and recalculate ortho view frustums against a targets BoundingBox.
   */
  _fitBox(box, marginPx = 25) {
    const cam = this.camera;
    if (!cam || !box || box.isEmpty()) return false;

    const width = Math.max(this.domElement?.clientWidth || 1, 1);
    const height = Math.max(this.domElement?.clientHeight || 1, 1);
    const safeMargin = THREE.MathUtils.clamp(Number(marginPx) || 25, 0, Math.min(width, height) / 2 - 1);
    const limitX = Math.max(1e-6, 1 - (2 * safeMargin) / width);
    const limitY = Math.max(1e-6, 1 - (2 * safeMargin) / height);
    const center = box.getCenter(new THREE.Vector3());
    const inverseRotation = cam.quaternion.clone().invert();
    const corners = [];
    for (let i = 0; i < 8; i++) {
      corners.push(
        new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z
        ).sub(center).applyQuaternion(inverseRotation)
      );
    }
    let distance = Math.max(this.vtkCamera.getDistance() || 1, 1e-3);

    if (cam.isOrthographicCamera) {
      let halfX = 1e-9;
      let halfY = 1e-9;
      for (const point of corners) {
        halfX = Math.max(halfX, Math.abs(point.x));
        halfY = Math.max(halfY, Math.abs(point.y));
      }
      const baseHalfW = Math.abs(cam.right - cam.left) / 2;
      const baseHalfH = Math.abs(cam.top - cam.bottom) / 2;
      cam.zoom = Math.max(1e-9, Math.min(
        (baseHalfW * limitX) / halfX,
        (baseHalfH * limitY) / halfY
      ));
    } else if (cam.isPerspectiveCamera) {
      const tanHalfY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
      const tanHalfX = tanHalfY * cam.aspect;
      distance = 1e-3;
      for (const point of corners) {
        // depth = distance - point.z. Solve the perspective inequalities
        // directly for all eight AABB corners and both inset viewport axes.
        distance = Math.max(
          distance,
          point.z + Math.abs(point.x) / Math.max(tanHalfX * limitX, 1e-12),
          point.z + Math.abs(point.y) / Math.max(tanHalfY * limitY, 1e-12)
        );
      }
    }

    const eyeOffset = new THREE.Vector3(0, 0, distance).applyQuaternion(cam.quaternion);
    cam.position.copy(center).add(eyeOffset);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    this.vtkCamera.setFromThree();

    this.requestRender();
    return true;
  }

  /** * Snaps the camera posture to standard CAD projection orientations, then recalculates bounds.
   */
  setView(viewName) {
    if (!this.vtkCamera) return false;
    const name = String(viewName).toLowerCase();
    const dirs = {
      front:  { dir: [0, 0, 1],   up: [0, 1, 0] },
      back:   { dir: [0, 0, -1],  up: [0, 1, 0] },
      right:  { dir: [1, 0, 0],   up: [0, 1, 0] },
      left:   { dir: [-1, 0, 0],  up: [0, 1, 0] },
      top:    { dir: [0, 1, 0],   up: [0, 0, -1] },
      bottom: { dir: [0, -1, 0],  up: [0, 0, 1] },
      iso:    { dir: [1, 1, 1],   up: [0, 1, 0] },
    };
    const spec = dirs[name];
    if (!spec) {
      console.warn(`View orientation "${viewName}" not recognized.`);
      return false;
    }

    const cam = this.camera;
    const box = this._calculateModelBounds();
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty() ? 10 : box.getBoundingSphere(new THREE.Sphere()).radius || 10;
    const distance = Math.max(this.vtkCamera.getDistance() || 0, radius * 4);

    const dir = new THREE.Vector3(...spec.dir).normalize();
    cam.position.copy(center).addScaledVector(dir, distance);
    cam.up.set(...spec.up).normalize();
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    this.vtkCamera.setFromThree();

    if (!box.isEmpty()) this._fitBox(box);
    this.updateClipping();
    this.requestRender();
    return true;
  }

  /**
   * Resets the viewport back to default Isometric view projection.
   */
  resetView() {
    return this.setView("iso");
  }

  /** * Updates dynamic clipping intervals (near/far) inside vtkCamera (Grid dimensions decoupled).
   */
  updateClipping() {
    if (!this.vtkCamera || !this.scene) return;
    const box = this._calculateModelBounds();
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dynamicRadius = Math.max(sphere.radius * 3.0, 1);
    const viewDirection = new THREE.Vector3();
    this.camera.getWorldDirection(viewDirection).normalize();
    const depthToCenter = sphere.center.clone()
      .sub(this.camera.position)
      .dot(viewDirection);
    const nearDepth = depthToCenter - dynamicRadius;
    const farDepth = depthToCenter + dynamicRadius;

    // Clipping planes are camera-space depths, not offsets around zero. Using
    // the focal distance here could clip components whose bounds are not
    // centered exactly at the focal point, especially in orthographic mode.
    if (this.camera?.isPerspectiveCamera) {
      const safeNear = Math.max(1e-3, nearDepth);
      this.vtkCamera.setClippingRange(
        safeNear,
        Math.max(farDepth, safeNear + Math.max(dynamicRadius, 1))
      );
    } else {
      this.vtkCamera.setClippingRange(
        nearDepth,
        Math.max(farDepth, nearDepth + Math.max(dynamicRadius, 1))
      );
    }
  }
}
