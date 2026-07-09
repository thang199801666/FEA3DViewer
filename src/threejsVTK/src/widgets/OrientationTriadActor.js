// Actors/OrientationTriadActor.js
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

    // Hardcoded professional CAD/Abaqus primary colors.
    // Red (X), Green (Y), Blue (Z) at their exact deep technical shades.
    this.root.add(this.createAxis(new THREE.Vector3(1, 0, 0), 0xff0000, "X")); // Pure Red
    this.root.add(this.createAxis(new THREE.Vector3(0, 1, 0), 0x00cc00, "Y")); // Solid Green
    this.root.add(this.createAxis(new THREE.Vector3(0, 0, 1), 0x0066ff, "Z")); // Solid Blue
  }

  createLabel(text, colorHex) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    
    // Using explicit BOLD font style for high readability
    ctx.font = "bold 100px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#" + colorHex.toString(16).padStart(6, "0");
    ctx.fillText(text, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    
    // Ensure canvas texture matches the renderer color space setup to avoid washing out
    if (this.renderer.outputColorSpace) {
      texture.colorSpace = this.renderer.outputColorSpace;
    }
    
    const material = new THREE.SpriteMaterial({
      map: texture, 
      transparent: true, 
      depthTest: false, 
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.32, 0.32, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  createAxis(direction, colorHex, labelText) {
    const group = new THREE.Group();
    
    // Initialize color object and manage sRGB workflow conversion
    const finalColor = new THREE.Color(colorHex);
    if (this.renderer.colorManagement ?? true) {
      finalColor.convertSRGBToLinear();
    }

    const material = new THREE.MeshBasicMaterial({
      color: finalColor, 
      depthTest: false, 
      depthWrite: false,
    });

    // Reduced axis thickness for a sleeker look while remaining perfectly visible
    const bodyThickness = 0.045; 
    const bodyLength = 0.70;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyThickness, bodyThickness, bodyLength, 24), material);
    body.position.y = bodyLength / 2;
    body.renderOrder = 998;

    // Rescaled arrowhead (Cone) to proportionally match the slimmer shaft
    const headRadius = 0.11;
    const headHeight = 0.24;
    const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headHeight, 24), material);
    head.position.y = bodyLength + (headHeight / 2);
    head.renderOrder = 998;

    // Placed bold label with optimized offset above the arrowhead
    const label = this.createLabel(labelText, colorHex);
    label.position.set(0, bodyLength + headHeight + 0.15, 0);

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