import * as THREE from "three";

/**
 * NavigationGizmo
 * ---------------
 * Một "view cube" kiểu Blender: 6 hình tròn (X/Y/Z + / -) xoay theo hướng
 * camera hiện tại, đặt cố định ở một góc màn hình (mặc định: top-right).
 * Click vào 1 trục sẽ snap camera chính về đúng hướng nhìn đó.
 *
 * Dùng chung 1 renderer với scene chính (giống cách OrientationTriad /
 * TextBlockController của bạn đang làm): dùng scissor + viewport để vẽ đè
 * lên 1 vùng nhỏ của canvas, sau khi scene chính đã render xong.
 */

const AXES = [
    { name: "+x", dir: new THREE.Vector3(1, 0, 0), color: 0xe6493f, label: "X", positive: true },
    { name: "-x", dir: new THREE.Vector3(-1, 0, 0), color: 0xe6493f, label: null, positive: false },
    { name: "+y", dir: new THREE.Vector3(0, 1, 0), color: 0x7cb342, label: "Y", positive: true },
    { name: "-y", dir: new THREE.Vector3(0, -1, 0), color: 0x7cb342, label: null, positive: false },
    { name: "+z", dir: new THREE.Vector3(0, 0, 1), color: 0x4b90d6, label: "Z", positive: true },
    { name: "-z", dir: new THREE.Vector3(0, 0, -1), color: 0x4b90d6, label: null, positive: false },
];

function makeAxisSprite({ color, label, positive, highlight = false }) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.42;

    ctx.clearRect(0, 0, size, size);

    const colorHex = "#" + color.toString(16).padStart(6, "0");

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);

    if (positive) {
        ctx.fillStyle = highlight ? "#ffffff" : colorHex;
        ctx.fill();
        if (highlight) {
            ctx.lineWidth = size * 0.05;
            ctx.strokeStyle = colorHex;
            ctx.stroke();
        }
    } else {
        ctx.fillStyle = "#2b2b2b";
        ctx.fill();
        ctx.lineWidth = size * 0.06;
        ctx.strokeStyle = highlight ? "#ffffff" : colorHex;
        ctx.stroke();
    }

    if (label) {
        ctx.fillStyle = positive ? "#1a1a1a" : colorHex;
        ctx.font = `bold ${size * 0.42}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx, cy + size * 0.02);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = positive ? 2 : 1;
    return sprite;
}

export default class NavigationGizmo {
    /**
     * @param {THREE.WebGLRenderer} renderer
     * @param {HTMLElement} container - phần tử DOM chứa canvas (dùng để đo kích thước & bắt sự kiện chuột)
     * @param {object} options
     * @param {"top-right"|"top-left"|"bottom-right"|"bottom-left"} [options.position="top-right"]
     * @param {number} [options.size=110] - kích thước vùng vẽ gizmo, tính bằng CSS px
     * @param {number} [options.margin=16]
     * @param {number} [options.axisLength=1] - bán kính (khoảng cách từ tâm ra các quả cầu trục)
     * @param {number} [options.spriteScale=0.34] - kích thước tương đối của các quả cầu trục
     * @param {(dir: THREE.Vector3, axisName: string) => void} [options.onSelect] - gọi khi user click chọn 1 trục
     */
    constructor(renderer, container, options = {}) {
        this.renderer = renderer;
        this.container = container;
        this.position = options.position || "top-right";
        this.size = options.size ?? 110;
        this.margin = options.margin ?? 16;
        this.axisLength = options.axisLength ?? 1;
        this.spriteScale = options.spriteScale ?? 0.34;
        this.onSelect = options.onSelect || null;
        this.debug = options.debug || false;

        this.scene = new THREE.Scene();

        const camDist = 5;
        this.camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 100);
        this.camDist = camDist;

        // Đường nối tâm -> trục (chỉ vẽ về phía dương cho gọn, giống Blender)
        this.lineGroup = new THREE.Group();
        this.scene.add(this.lineGroup);

        this.handles = []; // { name, dir, sprite, base sprite props }
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
                const lineMat = new THREE.LineBasicMaterial({
                    color: axis.color,
                    transparent: true,
                    opacity: 0.85,
                    depthTest: false,
                });
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
        this._onPointerLeave = this._onPointerLeave.bind(this);

        const dom = this.renderer.domElement;
        dom.addEventListener("pointermove", this._onPointerMove);
        dom.addEventListener("pointerdown", this._onPointerDown);
        dom.addEventListener("pointerleave", this._onPointerLeave);
    }

    _rect() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const s = this.size;
        const m = this.margin;

        let x, y; // gốc (0,0) tính từ dưới-trái, đúng chuẩn hệ toạ độ WebGL viewport
        if (this.position === "top-right") {
            x = w - s - m;
            y = h - s - m;
        } else if (this.position === "top-left") {
            x = m;
            y = h - s - m;
        } else if (this.position === "bottom-right") {
            x = w - s - m;
            y = m;
        } else {
            x = m;
            y = m;
        }
        return { x, y, w: s, h: s };
    }

    /** Gọi mỗi frame, trước hoặc sau khi render scene chính đều được. */
    update(mainCamera) {
        // Camera của gizmo copy hướng nhìn của camera chính, chỉ khác vị trí/khoảng cách
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(mainCamera.quaternion);
        this.camera.position.copy(dir.multiplyScalar(this.camDist));
        this.camera.up.copy(mainCamera.up);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateMatrixWorld();
    }

    /** Gọi mỗi frame, SAU khi renderer đã render xong scene chính. */
    render() {
        const renderer = this.renderer;
        const { x, y, w, h } = this._rect();
        const pr = renderer.getPixelRatio();

        renderer.setScissorTest(true);
        renderer.setScissor(x * pr, y * pr, w * pr, h * pr);
        renderer.setViewport(x * pr, y * pr, w * pr, h * pr);
        renderer.clearDepth();

        if (this.debug) {
            // Tạm bật để kiểm tra vùng scissor có đúng vị trí/kích thước không.
            // Nếu thấy 1 ô đỏ ở đúng góc top-right -> cơ chế viewport/scissor OK,
            // lỗi nằm ở sprite/texture. Nếu KHÔNG thấy gì -> lỗi nằm ở rect/pixelRatio.
            renderer.setClearColor(0xff0000, 1);
            renderer.clear(true, true, false);
            renderer.setClearColor(0x000000, 0);
        }

        renderer.render(this.scene, this.camera);

        renderer.setScissorTest(false);
        // Khôi phục viewport đầy đủ cho frame render tiếp theo của scene chính
        const fullW = this.container.clientWidth * pr;
        const fullH = this.container.clientHeight * pr;
        renderer.setViewport(0, 0, fullW, fullH);
    }

    _pointerInRect(clientX, clientY) {
        const bounds = this.container.getBoundingClientRect();
        const localX = clientX - bounds.left;
        const localY = clientY - bounds.top;
        const { x, y, w, h } = this._rect();

        // _rect() dùng gốc dưới-trái (chuẩn WebGL), còn toạ độ DOM có gốc trên-trái
        const domTop = this.container.clientHeight - y - h;
        const domBottom = domTop + h;

        if (localX < x || localX > x + w || localY < domTop || localY > domBottom) {
            return null;
        }

        const ndcX = ((localX - x) / w) * 2 - 1;
        const ndcY = -(((localY - domTop) / h) * 2 - 1);
        return { ndcX, ndcY };
    }

    _pick(clientX, clientY) {
        const ndc = this._pointerInRect(clientX, clientY);
        if (!ndc) return null;

        this.pointerNDC.set(ndc.ndcX, ndc.ndcY);
        this.raycaster.setFromCamera(this.pointerNDC, this.camera);
        const sprites = this.handles.map((h) => h.sprite);
        const hits = this.raycaster.intersectObjects(sprites, false);
        if (hits.length === 0) return null;

        return this.handles.find((h) => h.sprite === hits[0].object) || null;
    }

    _setHover(handle) {
        if (this.hovered === handle) return;

        if (this.hovered) {
            this._refreshSprite(this.hovered, false);
        }
        this.hovered = handle;
        if (this.hovered) {
            this._refreshSprite(this.hovered, true);
            this.renderer.domElement.style.cursor = "pointer";
        } else {
            this.renderer.domElement.style.cursor = "";
        }
    }

    _refreshSprite(handle, highlight) {
        const old = handle.sprite.material.map;
        const newSprite = makeAxisSprite({ ...handle.axis, highlight });
        handle.sprite.material.map.dispose();
        handle.sprite.material.map = newSprite.material.map;
        handle.sprite.material.needsUpdate = true;
        newSprite.material.dispose();
    }

    _onPointerMove(e) {
        const handle = this._pick(e.clientX, e.clientY);
        this._setHover(handle);
    }

    _onPointerLeave() {
        this._setHover(null);
    }

    _onPointerDown(e) {
        const handle = this._pick(e.clientX, e.clientY);
        if (handle && this.onSelect) {
            this.onSelect(handle.axis.dir.clone(), handle.axis.name);
        }
    }

    dispose() {
        const dom = this.renderer.domElement;
        dom.removeEventListener("pointermove", this._onPointerMove);
        dom.removeEventListener("pointerdown", this._onPointerDown);
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