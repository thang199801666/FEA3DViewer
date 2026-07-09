import * as THREE from "three";

export class MeasurementRulerActor {
  /**
   * @param {THREE.Scene} scene - The scene where the ruler graphics will be added.
   * @param {THREE.OrthographicCamera} camera - The main camera used to monitor zoom and scale.
   * @param {object} options - Configuration options for customization.
   */
  constructor(scene, camera, options = {}) {
    this.scene = scene;
    this.camera = camera;

    // Configuration options
    this.color = options.color ?? 0xffffff; // Default color is white
    this.targetPixelWidth = options.targetPixelWidth ?? 120;
    this.tickHeight = options.tickHeight ?? 0.05; 
    
    // Increase the base canvas font size to render high-resolution text and avoid blurriness
    this.fontSize = options.fontSize ?? 90; 

    // Create a group to hold all ruler graphic components
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Initialize geometry components placeholder
    this.lineGeometry = new THREE.BufferGeometry();
    
    // Create white material, disable depth test/write so the ruler always renders on top of 3D models
    this.lineMaterial = new THREE.LineBasicMaterial({ 
      color: this.color, 
      depthTest: false, 
      depthWrite: false
    });
    
    // Use LineSegments to stack lines, simulating pixel thickness for the ruler
    this.rulerLine = new THREE.LineSegments(this.lineGeometry, this.lineMaterial);
    this.rulerLine.renderOrder = 10;
    this.group.add(this.rulerLine);

    this.position = new THREE.Vector3(0, 0, 0);
    this._lastLabelText = null;
    this.labelSprite = null;
  }

  /**
   * Updates the ruler graphics geometry and texture based on the camera's current scale.
   */
  update(containerWidth) {
    if (!this.camera || !containerWidth || containerWidth === 0) return;

    // 1. Calculate pixel-to-world units ratio
    const totalWorldWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
    const unitsPerPixel = totalWorldWidth / containerWidth;

    const targetWorldUnits = this.targetPixelWidth * unitsPerPixel;
    const niceWorldUnits = this._getNiceNumber(targetWorldUnits);

    const halfW = niceWorldUnits / 2;

    // Height of the vertical ticks (fixed 7 pixels on screen)
    const desiredTickPixelHeight = 7; 
    const dynamicTickHeight = desiredTickPixelHeight * unitsPerPixel; 

    // Desired thickness for the ruler line (fixed 2.5 pixels on screen)
    const thickness = 2.5 * unitsPerPixel;

    // ----------------------------------------------------------------
    // Draw parallel double lines offset by `thickness` to simulate line weight
    // ----------------------------------------------------------------
    const vertices = new Float32Array([
      // --- Main base lines ---
      -halfW,  dynamicTickHeight, 0,   
      -halfW,  0,                 0,
      -halfW,  0,                 0,   
       halfW,  0,                 0,
       halfW,  0,                 0,   
       halfW,  dynamicTickHeight, 0,

      // --- Supplementary lines stacked along the Y axis for thickness ---
      -halfW + thickness,  dynamicTickHeight, 0,
      -halfW + thickness,  thickness,                 0,
      -halfW,  thickness,                 0,
       halfW,  thickness,                 0,
       halfW - thickness,  thickness,                 0,
       halfW - thickness,  dynamicTickHeight, 0,
    ]);

    this.lineGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    this.lineGeometry.computeBoundingSphere();

    // Format display string for the number
    const labelText = niceWorldUnits >= 1 
      ? `${Number(niceWorldUnits.toFixed(2))}` 
      : `${Number(niceWorldUnits.toFixed(5))}`;

    // Recreate text sprite only if the text content changes
    if (this._lastLabelText !== labelText) {
      this._lastLabelText = labelText;

      if (this.labelSprite) {
        this.group.remove(this.labelSprite);
        if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
        this.labelSprite.material.dispose();
      }

      this.labelSprite = this._makeTextSprite(labelText);
      this.group.add(this.labelSprite);
    }

    // Assign anchor node position
    this.group.position.copy(this.position);
    
    if (this.labelSprite) {
      const currentZoom = this.camera.zoom || 1;

      // ----------------------------------------------------------------
      // Adjust text sprite scale for clear visibility on screen
      // ----------------------------------------------------------------
      const baseSpriteWidth = 1.1; 
      const baseSpriteHeight = 0.55;

      this.labelSprite.scale.set(
        baseSpriteWidth / currentZoom, 
        baseSpriteHeight / currentZoom, 
        1
      );

      // ----------------------------------------------------------------
      // CHANGED: Reduced from 24 to 13 to bring the text closer to the ruler
      // ----------------------------------------------------------------
      const desiredLabelPixelOffset = 13; 
      const dynamicLabelY = desiredLabelPixelOffset * unitsPerPixel;

      this.labelSprite.position.set(0, dynamicLabelY, 0);
    }
  }

  /**
   * Internal utility to build a canvas-backed transparent text element.
   */
  _makeTextSprite(message) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // Large canvas size to ensure sharp pixel density resolution
    canvas.width = 256;
    canvas.height = 128;

    // Set font style to bold and large size
    ctx.font = `bold ${this.fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // ----------------------------------------------------------------
    // TEXT COLORING: Convert ThreeJS color format to standard CSS canvas color string
    // ----------------------------------------------------------------
    let colorStr = "#ffffff"; // Default white
    if (typeof this.color === "number") {
      colorStr = `#${this.color.toString(16).padStart(6, "0")}`;
    } else if (typeof this.color === "string") {
      colorStr = this.color;
    }
    ctx.fillStyle = colorStr;
    
    // Draw text at the center of the canvas
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
    this.scene.remove(this.group);
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
    if (this.labelSprite) {
      if (this.labelSprite.material.map) this.labelSprite.material.map.dispose();
      this.labelSprite.material.dispose();
    }
  }
}