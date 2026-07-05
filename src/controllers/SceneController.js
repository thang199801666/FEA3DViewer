import * as THREE from "three";
import { Actor } from "../models/Actor";

export default class SceneController {
    constructor(camera, cameraController = null, externalScene = null) {
        // Nếu có scene dùng chung truyền vào từ MainLayout thì dùng, ngược lại mới tạo mới
        this.scene = externalScene || new THREE.Scene();
        if (!externalScene) {
            this.scene.background = new THREE.Color(0xffffff);
        }

        this.camera = camera;
        this.cameraController = cameraController;

        this.frustumSize = 10;
        this._actorCounter = 0;

        this.initialize();
    }

    initialize() {

        const hasAmbient = this.scene.children.some(child => child.isAmbientLight);
        if (hasAmbient) return;
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
        const light1 = new THREE.DirectionalLight(0xffffff, 2);
        light1.position.set(15, 20, 15);
        this.scene.add(light1);
        const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
        light2.position.set(-10, -10, -10);
        this.scene.add(light2);
    }

    /**
     * Tạo một Actor dạng khối hộp (Box) mặc định và thêm ngay vào Scene.
     */
    addBoxActor(options = {}) {
        if (!this.scene) return null;

        const {
            size = 1,
            color = 0xd9d9d9,
            position = null
        } = options;

        this._actorCounter += 1;
        const name = `Box_${this._actorCounter}`;

        const geometry = new THREE.BoxGeometry(size, size, size);
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.7,
            metalness: 0.1
        });

        const actor = new Actor(geometry, material, name);

        if (position) {
            actor.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
        } else {
            actor.position.set((this._actorCounter - 1) * (size + 0.5), 0, 0);
        }

        this.scene.add(actor);
        this.updateClipping();

        return actor;
    }

    /**
     * Hàm nội bộ tính toán Bounding Box tinh khiết của các Model hình học trong Scene,
     * loại trừ hoàn toàn các thành phần bổ trợ như lưới tọa độ (system_grid).
     */
    _calculateModelBounds() {
        const box = new THREE.Box3();
        
        if (!this.scene) return box;
        this.scene.updateMatrixWorld(true);

        this.scene.traverse((child) => {
            if (child === this.scene || child.name === "system_grid" || child.isGridHelper) {
                return;
            }

            if (child.isMesh) {
                if (!child.geometry.boundingBox) {
                    child.geometry.computeBoundingBox();
                }
                const childBox = child.geometry.boundingBox.clone();
                childBox.applyMatrix4(child.matrixWorld);
                box.union(childBox);
            }
        });

        return box;
    }

    /**
     * Zoom Fit toàn bộ scene, giữ nguyên hướng nhìn hiện tại (Đã loại trừ Grid)
     */
    fitView(padding = 1.2) {
        if (!this.cameraController || !this.scene) return false;

        const box = this._calculateModelBounds();
        if (box.isEmpty()) return false;

        this.cameraController.zoomFit(box, { padding, animate: true });
        this.updateClipping();
        return true;
    }

    /**
     * Đặt camera về 1 trong các view chuẩn rồi tự động Fit View theo nội dung scene.
     */
    setView(viewName) {
        if (!this.cameraController) return false;

        const name = viewName.toLowerCase();
        const valid = ["front", "back", "left", "right", "top", "bottom", "iso"];
        if (!valid.includes(name)) {
            console.warn(`View orientation "${viewName}" not recognized.`);
            return false;
        }

        this.cameraController.setStandardView(name, true);
        window.setTimeout(() => this.fitView(), 420);
        return true;
    }

    /** Đưa camera về view mặc định (Iso) và fit lại toàn bộ scene. */
    resetView() {
        return this.setView("iso");
    }

    /**
     * Cập nhật bounding sphere cho bộ xử lý auto-clipping của CameraController (Đã loại trừ Grid)
     */
    updateClipping() {
        if (!this.cameraController || !this.scene) return;

        const box = this._calculateModelBounds();
        if (box.isEmpty()) return;

        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const currentZoom = (this.camera && this.camera.zoom) ? this.camera.zoom : 1;
        const baseGridSize = 2000; 

        const dynamicRadius = Math.max(sphere.radius * 3.0, baseGridSize / currentZoom);
        sphere.radius = dynamicRadius;

        this.cameraController.setBoundingSphere(sphere);
        
        if (this.camera && typeof this.camera.updateProjectionMatrix === "function") {
            this.camera.near = -dynamicRadius; 
            this.camera.far = dynamicRadius * 2;
            this.camera.updateProjectionMatrix();
        }
    }
}