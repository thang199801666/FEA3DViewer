// Actors/OrientationTriadActor.js
// Orientation triad overlay (X/Y/Z arrows) rendered into a corner of the
// shared WebGLRenderer. Self-contained: only needs the renderer. Call
// update(mainCamera) then render() each frame.
import * as THREE from "three";

export class OrientationTriadActor {
  constructor(renderer, options = {}) {
    this.renderer = renderer;
    this.size = options.size ?? 120;
    this.margin = options.margin ?? 16;
    this.position = options.position ?? "bottom-left";

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.4, -1.4, 0.1, 10);
    this.camera.position.set(0, 0, 3);
    this.camera.lookAt(0, 0, 0);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(4, 4, 5);
    this.scene.add(dir);

    this.root.add(this.createAxis(new THREE.Vector3(1, 0, 0), 0x8b0000, "X"));
    this.root.add(this.createAxis(new THREE.Vector3(0, 1, 0), 0x006400, "Y"));
    this.root.add(this.createAxis(new THREE.Vector3(0, 0, 1), 0x00008b, "Z"));
  }

  createLabel(text, color) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = "bold 100px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
    ctx.fillText(text, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.32, 0.32, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  createAxis(direction, color, labelText) {
    const group = new THREE.Group();
    const material = new THREE.MeshPhongMaterial({
      color, emissive: color, emissiveIntensity: 0.4, shininess: 30,
    });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 24), material);
    body.position.y = 0.375;

    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 24), material);
    head.position.y = 0.86;

    const label = this.createLabel(labelText, color);
    label.position.set(0, 1.18, 0);

    group.add(body);
    group.add(head);
    group.add(label);

    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    group.quaternion.copy(q);
    return group;
  }

  // Keep the triad aligned with the inverse of the main camera orientation.
  update(mainCamera) {
    this.root.quaternion.copy(mainCamera.quaternion).invert();
  }

  _rect(fullWidth, fullHeight) {
    const s = this.size, m = this.margin;
    let x = m, y = m; // WebGL viewport origin is bottom-left
    if (this.position === "top-right") { x = fullWidth - s - m; y = fullHeight - s - m; }
    else if (this.position === "top-left") { x = m; y = fullHeight - s - m; }
    else if (this.position === "bottom-right") { x = fullWidth - s - m; y = m; }
    return { x, y, w: s, h: s };
  }

  render() {
    const renderer = this.renderer;
    const canvas = renderer.domElement;
    const fullWidth = canvas.width;
    const fullHeight = canvas.height;
    const { x, y, w, h } = this._rect(fullWidth, fullHeight);

    const previousAutoClear = renderer.autoClear;
    const previousViewport = new THREE.Vector4();
    renderer.getViewport(previousViewport);
    const previousScissor = new THREE.Vector4();
    renderer.getScissor(previousScissor);
    const previousScissorTest = renderer.getScissorTest();

    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.render(this.scene, this.camera);

    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.scene.clear();
  }
}