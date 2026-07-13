import * as THREE from "three";

/**
 * Tạo một đối tượng THREE.Vector3 từ mảng hoặc các tham số tọa độ
 * Giúp che giấu hoàn toàn API gốc của ThreeJS với tầng ứng dụng bên ngoài.
 */
export function createVector3(x = 0, y = 0, z = 0) {
    if (Array.isArray(x)) {
        return new THREE.Vector3(x[0], x[1], x[2]);
    }
    return new THREE.Vector3(x, y, z);
}