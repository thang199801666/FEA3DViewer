import * as THREE from "three";

export class MeasurementRulerActor {
  /**
   * @param {THREE.WebGLRenderer} renderer - The main WebGL renderer.
   * @param {object} options - Configuration options for customization.
   */
  constructor(renderer, options = {}) {
    this.renderer = renderer;

    // Configuration options
    this.color = options.color ?? 0xffffff; 
    this.targetPixelWidth = options.targetPixelWidth ?? 120;
    
    // High-resolution canvas base font size to prevent blurriness
    this.fontSize = options.fontSize ?? 90; 

    // Isolated overlay scene and static 2D camera mapping to screen pixels
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    // Initialize line components
    this.lineGeometry = new THREE.BufferGeometry();
    this.lineMaterial = new THREE.LineBasicMaterial({ 
      color: this.color, 
      depthTest: false, 
      depthWrite: false
    });
    
    this.rulerLine = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.scene.add(this.rulerLine);

    this._lastLabelText = null;
    this.labelSprite = null;
  }

  /**
   * Updates the layout using exact screen pixel spaces
   */
  update(containerWidth, containerHeight, mainCamera) {
    if (!mainCamera || !containerWidth || !containerHeight) return;

    // 1. Update overlay projection matching the 1:1 screen pixels
    const halfWidth = containerWidth / 2;
    const halfHeight = containerHeight / 2;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();

    // 2. Map pixel spacing to main camera zoom scale
    const totalWorldWidth = (mainCamera.right - mainCamera.left) / mainCamera.zoom;
    const unitsPerPixel = totalWorldWidth / containerWidth;

    const targetWorldUnits = this.targetPixelWidth * unitsPerPixel;
    const niceWorldUnits = this._getNiceNumber(targetWorldUnits);

    const halfWInPixels = (niceWorldUnits / unitsPerPixel) / 2;
    
    // STABLE SIZES: Exact fixed screen pixel definitions
    const staticTickHeight = 8; // Vertical ticks stay exactly 8 pixels tall
    const thickness = 0.5;      // Pixel width line thickness stack
    
    // --- CHANGED: Pushed slightly lower toward the bottom edge ---
    const bottomMargin = 15;    

    const centerY = -halfHeight + bottomMargin; 

    // Generate line positions directly using stable screen pixel values
    const vertices = new Float32Array([
      // Main tick and baseline structure
      -halfWInPixels,             centerY + staticTickHeight, 0,   
      -halfWInPixels,             centerY,                    0,
      -halfWInPixels,             centerY,                    0,   
       halfWInPixels,             centerY,                    0,
       halfWInPixels,             centerY,                    0,   
       halfWInPixels,             centerY + staticTickHeight, 0,

      // Thickness offsets
      -halfWInPixels + thickness, centerY + staticTickHeight, 0,
      -halfWInPixels + thickness, centerY + thickness,         0,
      -halfWInPixels,             centerY + thickness,         0,
       halfWInPixels,             centerY + thickness,         0,
       halfWInPixels - thickness, centerY + thickness,         0,
       halfWInPixels - thickness, centerY + staticTickHeight, 0,
    ]);

    this.lineGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    this.lineGeometry.computeBoundingSphere();

    // Text label matching old precision layout
    const labelText = niceWorldUnits >= 1 
      ? `${Number(niceWorldUnits.toFixed(2))}` 
      : `${Number(niceWorldUnits.toFixed(5))}`;

    if (this._lastLabelText !== labelText) {
      this._lastLabelText = labelText;

      if (this.labelSprite) {
        this.scene.remove(this.labelSprite);
        if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
        this.labelSprite.material.dispose();
      }

      this.labelSprite = this._makeTextSprite(labelText);
      this.scene.add(this.labelSprite);
    }

    if (this.labelSprite) {
      this.labelSprite.scale.set(70, 35, 1); 
      // --- CHANGED: Reduced text offset from line (+12 down to +6) ---
      this.labelSprite.position.set(0, centerY + staticTickHeight + 6, 0);
    }
  }

  render() {
    const renderer = this.renderer;
    const pr = renderer.getPixelRatio();
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;

    const previousAutoClear = renderer.autoClear;
    const previousViewport = new THREE.Vector4();
    renderer.getViewport(previousViewport);
    const previousScissor = new THREE.Vector4();
    renderer.getScissor(previousScissor);
    const previousScissorTest = renderer.getScissorTest();

    renderer.autoClear = false;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, w * pr, h * pr);
    renderer.setViewport(0, 0, w * pr, h * pr);
    
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);

    renderer.setViewport(previousViewport);
    renderer.setScissor(previousScissor);
    renderer.setScissorTest(previousScissorTest);
    renderer.autoClear = previousAutoClear;
  }

  _makeTextSprite(message) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 512;
    canvas.height = 256;

    // --- CHANGED: Added 'bold' keyword ---
    ctx.font = `bold ${this.fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    let colorStr = "#ffffff";
    if (typeof this.color === "number") {
      colorStr = `#${this.color.toString(16).padStart(6, "0")}`;
    } else if (typeof this.color === "string") {
      colorStr = this.color;
    }
    ctx.fillStyle = colorStr;
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;

    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture, 
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    return new THREE.Sprite(spriteMaterial);
  }

  _getNiceNumber(val) {
    const exp = Math.floor(Math.log10(val));
    const f = val / Math.pow(10, exp);
    let nf;
    if (f < 1.5) nf = 1;
    else if (f < 3) nf = 2;
    else if (f < 7) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  dispose() {
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    if (this.labelSprite) {
      if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
      this.labelSprite.material.dispose();
    }
    this.scene.clear();
  }
}