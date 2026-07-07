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
    this.color = options.color ?? 0xffffff; // Đổi mặc định sang màu trắng
    this.targetPixelWidth = options.targetPixelWidth ?? 120;
    this.tickHeight = options.tickHeight ?? 0.05; 
    
    // Tăng canvas font size gốc lên để render chữ độ phân giải cao, tránh bị nhòe vỡ hình
    this.fontSize = options.fontSize ?? 90; 

    // Create a group to hold all ruler graphic components
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // Initialize geometry components placeholder
    this.lineGeometry = new THREE.BufferGeometry();
    
    // Tạo chất liệu màu trắng, tắt depth để thước luôn hiển thị đè lên trên mô hình 3D
    this.lineMaterial = new THREE.LineBasicMaterial({ 
      color: this.color, 
      depthTest: false, 
      depthWrite: false
    });
    
    // Dùng LineSegments để xếp chồng các nét, giúp giả lập độ dày pixel cho thước
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

    // 1. Tính toán tỉ lệ pixel sang world units
    const totalWorldWidth = (this.camera.right - this.camera.left) / this.camera.zoom;
    const unitsPerPixel = totalWorldWidth / containerWidth;

    const targetWorldUnits = this.targetPixelWidth * unitsPerPixel;
    const niceWorldUnits = this._getNiceNumber(targetWorldUnits);

    const halfW = niceWorldUnits / 2;

    // Chiều cao vạch đứng (7 pixel cố định trên màn hình)
    const desiredTickPixelHeight = 7; 
    const dynamicTickHeight = desiredTickPixelHeight * unitsPerPixel; 

    // Độ dày mong muốn cho thanh thước (2.5 pixel cố định trên màn hình)
    const thickness = 2.5 * unitsPerPixel;

    // ----------------------------------------------------------------
    // Vẽ các đường kép song song lệch nhau một khoảng `thickness` để tạo độ dày đậm
    // ----------------------------------------------------------------
    const vertices = new Float32Array([
      // --- Nét cơ bản chính ---
      -halfW,  dynamicTickHeight, 0,   
      -halfW,  0,                 0,
      -halfW,  0,                 0,   
       halfW,  0,                 0,
       halfW,  0,                 0,   
       halfW,  dynamicTickHeight, 0,

      // --- Nét phụ xếp chồng tạo độ dày đậm theo trục Y ---
      -halfW + thickness,  dynamicTickHeight, 0,
      -halfW + thickness,  thickness,                 0,
      -halfW,  thickness,                 0,
       halfW,  thickness,                 0,
       halfW - thickness,  thickness,                 0,
       halfW - thickness,  dynamicTickHeight, 0,
    ]);

    this.lineGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    this.lineGeometry.computeBoundingSphere();

    // Định dạng chuỗi hiển thị số
    const labelText = niceWorldUnits >= 1 
      ? `${Number(niceWorldUnits.toFixed(2))}` 
      : `${Number(niceWorldUnits.toFixed(5))}`;

    // Tạo lại text sprite nếu chuỗi chữ có sự thay đổi giá trị số
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

    // Gán vị trí anchor node
    this.group.position.copy(this.position);
    
    if (this.labelSprite) {
      const currentZoom = this.camera.zoom || 1;

      // ----------------------------------------------------------------
      // TIẾP TỤC PHÓNG TO KÍCH THƯỚC CHỮ (Màn hình hiển thị)
      // Tăng từ (0.85 x 0.42) lên (1.1 x 0.55) để chữ to rõ ràng vượt trội
      // ----------------------------------------------------------------
      const baseSpriteWidth = 1.1; 
      const baseSpriteHeight = 0.55;

      this.labelSprite.scale.set(
        baseSpriteWidth / currentZoom, 
        baseSpriteHeight / currentZoom, 
        1
      );

      // Khoảng cách đẩy chữ lên trên cách thước (24 pixel cố định trên màn hình)
      const desiredLabelPixelOffset = 24; 
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

    // Canvas kích thước lớn để đảm bảo độ phân giải mật độ điểm ảnh sắc nét
    canvas.width = 256;
    canvas.height = 128;

    // Thiết lập font chữ đậm (bold) và kích thước lớn
    ctx.font = `bold ${this.fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // ----------------------------------------------------------------
    // ĐỔ MÀU CHỮ: Tự động chuyển đổi màu của ThreeJS sang mã màu CSS Canvas công thức chuẩn
    // ----------------------------------------------------------------
    let colorStr = "#ffffff"; // Mặc định trắng
    if (typeof this.color === "number") {
      colorStr = `#${this.color.toString(16).padStart(6, "0")}`;
    } else if (typeof this.color === "string") {
      colorStr = this.color;
    }
    ctx.fillStyle = colorStr;
    
    // Vẽ chữ vào tâm canvas
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