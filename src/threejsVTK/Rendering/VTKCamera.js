// Rendering/VTKCamera.js
// Adapter NHẸ bọc quanh MỘT THREE.Camera có sẵn (thường là Orthographic).
// Khác với Camera facade (Rendering/Camera.js sở hữu CameraState và điều khiển
// tương tác), VTKCamera chỉ "nhận nuôi" (adopt) một three camera để:
//   - Renderer giữ và lấy ra vẽ mỗi frame  (getThreeCamera / setAspect)
//   - Gizmo (CameraNavigationActor) xoay/snap quanh tiêu điểm (getFocalPoint / getDistance / setFromThree)
// Cả VTKCamera và Camera facade cùng bọc CHUNG một three camera nên luôn đồng bộ.
//
//   const vtkCamera = new VTKCamera({ threeCamera: orthoCam });   // hoặc new VTKCamera(orthoCam)

import * as THREE from "three";

export class VTKCamera {
    constructor(arg, options = {}) {
        // Chấp nhận cả `new VTKCamera(threeCam)` lẫn `new VTKCamera({ threeCamera })`.
        const three = arg?.isCamera ? arg : arg?.threeCamera;
        if (!three || !three.isCamera) {
            throw new Error("VTKCamera cần một THREE.Camera (truyền trực tiếp hoặc { threeCamera }).");
        }
        this.three = three;
        this.focalPoint = new THREE.Vector3(...(options.focalPoint ?? [0, 0, 0]));
        this._tmp = new THREE.Vector3();
    }

    getThreeCamera() { return this.three; }

    getFocalPoint() { return this.focalPoint.clone(); }
    setFocalPoint(x, y, z) {
        if (x?.isVector3) this.focalPoint.copy(x);
        else this.focalPoint.set(x, y, z);
        return this;
    }

    getDistance() {
        return this.three.position.distanceTo(this.focalPoint);
    }

    /** Đồng bộ trạng thái nội bộ từ three camera (gizmo gọi sau khi tự xoay camera). */
    setFromThree() {
        this.three.updateMatrixWorld(true);
        return this;
    }

    /** Cập nhật khung nhìn theo tỉ lệ khung hình (RenderWindow gọi mỗi frame). */
    setAspect(aspect) {
        const c = this.three;
        if (c.isOrthographicCamera) {
            const halfH = (c.top - c.bottom) / 2;
            c.left = -halfH * aspect;
            c.right = halfH * aspect;
            c.updateProjectionMatrix();
        } else if (c.isPerspectiveCamera) {
            c.aspect = aspect;
            c.updateProjectionMatrix();
        }
        return this;
    }

    /**
     * Đặt khoảng cắt near/far (SceneController.updateClipping dùng).
     * Với Orthographic, near ÂM là hợp lệ (giữ được mặt cắt kiểu CAD).
     */
    setClippingRange(near, far) {
        const c = this.three;
        c.near = near;
        c.far = far;
        c.updateProjectionMatrix();
        return this;
    }

    getClippingRange() { return [this.three.near, this.three.far]; }

    /** Đưa camera nhìn về `center` ở khoảng cách `distance` (Renderer.resetCamera dùng). */
    reset(center, distance) {
        this.focalPoint.copy(center);
        const dir = this._tmp.subVectors(this.three.position, center);
        if (dir.lengthSq() < 1e-8) dir.set(1, 1, 1);
        dir.normalize().multiplyScalar(distance || 1);
        this.three.position.copy(center).add(dir);
        this.three.lookAt(center);
        this.three.updateMatrixWorld(true);
        return this;
    }
}
