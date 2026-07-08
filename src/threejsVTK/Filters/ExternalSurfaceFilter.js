// Filters/ExternalSurfaceFilter.js
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh"; // npm i three-mesh-bvh

/**
 * ExternalSurfaceFilter — Rút VỎ NGOÀI CÙNG (outer visible shell) của một mesh.
 *
 * Khác với GeometryFilter (đếm mặt trùng khít, count===2 = vách trong):
 * bộ lọc này quyết định giữ/bỏ từng tam giác dựa trên "có nhìn thấy được
 * từ bên ngoài hay không" (occlusion ray test). Nhờ vậy nó bỏ được cả:
 *   - Gân / vách gia cường / gusset nằm gọn bên trong khối
 *   - Mặt trong của thân rỗng (khi thu hẹp góc nón escape)
 * -> cắt bằng clipping plane + stencil cap ra tiết diện ĐẶC, sạch.
 *
 * Đánh đổi: chậm hơn nhiều (raycast BVH), chạy như một bước offline 1 lần.
 */
export class ExternalSurfaceFilter {
    constructor() {
        this.inputData = null;
        this.outputData = null;

        // --- Cấu hình ---
        this.weldTolerance = 1e-6;      // gom đỉnh trùng trước khi dedupe mặt
        this.dedupeCoincident = true;   // gộp các tam giác chồng khít về 1 bản
        this.recomputeNormals = true;

        // Số hướng tia mẫu trên mặt cầu (phân bố Fibonacci). Cao hơn = chính xác + chậm hơn.
        this.rayCount = 64;

        // Chỉ tính "escape" khi tia nằm trong nón này quanh pháp tuyến mặt (độ).
        //  ~90  = bán cầu đầy đủ (occlusion thuần; mặt trong thân rỗng hở đầu CÓ THỂ bị giữ).
        //  ~70  = siết lại; mặt trong khoang chỉ "thấy ngoài" qua góc phương → bị loại → tiết diện đặc.
        this.escapeConeAngle = 72;

        this.testBothSides = true;       // giữ mặt nếu MỘT trong hai phía thấy được bên ngoài
        this._rayEpsScale = 1e-4;        // hệ số offset gốc tia theo bán kính bao (chống tự-cắt)
    }

    // ------------------------------------------------------------------
    // Pipeline API (đồng bộ với GeometryFilter)
    // ------------------------------------------------------------------
    setInputData(geometry) {
        this.inputData = (geometry && geometry.isBufferGeometry) ? geometry : null;
        this.outputData = null;
        return this;
    }
    setWeldTolerance(t) { this.weldTolerance = Array.isArray(t) ? t[0] : Number(t); return this; }
    setRayCount(n) { this.rayCount = Math.max(8, n | 0); return this; }
    setEscapeConeAngle(deg) { this.escapeConeAngle = Math.min(90, Math.max(5, Number(deg))); return this; }
    setTestBothSides(b) { this.testBothSides = !!b; return this; }
    setRecomputeNormals(b) { this.recomputeNormals = !!b; return this; }

    getOutputData() {
        if (this.outputData) return this.outputData;
        if (!this.inputData) {
            console.warn("[ExternalSurfaceFilter] No input geometry.");
            return null;
        }
        this._update();
        return this.outputData;
    }
    update() { return this.getOutputData(); }

    // ------------------------------------------------------------------
    // Core
    // ------------------------------------------------------------------
    _update() {
        const geometry = this.inputData;
        const posAttr = geometry.getAttribute("position");
        if (!posAttr || posAttr.count < 3) { this.outputData = geometry; return; }

        const indexAttr = geometry.getIndex();
        const triCount = indexAttr ? (indexAttr.count / 3) : (posAttr.count / 3);
        const vId = indexAttr
            ? (t, k) => indexAttr.getX(t * 3 + k)   // -> chỉ số đỉnh gốc
            : (t, k) => t * 3 + k;

        // --- 1) Hàn đỉnh (welded id) để so khớp topo bền với sai số float ---
        const precision = 1 / this.weldTolerance;
        const vertexMap = new Map();
        const weld = new Int32Array(posAttr.count);
        for (let i = 0; i < posAttr.count; i++) {
            const rx = Math.round(posAttr.getX(i) * precision) / precision;
            const ry = Math.round(posAttr.getY(i) * precision) / precision;
            const rz = Math.round(posAttr.getZ(i) * precision) / precision;
            const key = `${rx}_${ry}_${rz}`;
            let id = vertexMap.get(key);
            if (id === undefined) { id = vertexMap.size; vertexMap.set(key, id); }
            weld[i] = id;
        }

        // --- 2) Dedupe tam giác chồng khít -> giữ 1 bản (không xóa cả cặp!) ---
        // (Tránh xóa nhầm vỏ ngoài double-sided; occlusion sẽ quyết định phần còn lại.)
        const dedupeTris = []; // mảng chỉ số tam giác gốc được giữ để dựng BVH
        if (this.dedupeCoincident) {
            const seen = new Set();
            for (let t = 0; t < triCount; t++) {
                let a = weld[vId(t, 0)], b = weld[vId(t, 1)], c = weld[vId(t, 2)], tmp;
                if (a === b || b === c || a === c) continue; // suy biến
                if (a > b) { tmp = a; a = b; b = tmp; }
                if (b > c) { tmp = b; b = c; c = tmp; }
                if (a > b) { tmp = a; a = b; b = tmp; }
                const fk = `${a}_${b}_${c}`;
                if (seen.has(fk)) continue;
                seen.add(fk);
                dedupeTris.push(t);
            }
        } else {
            for (let t = 0; t < triCount; t++) dedupeTris.push(t);
        }

        // --- 3) Dựng mesh occluder + BVH từ tập tam giác đã dedupe ---
        const occIndex = new Uint32Array(dedupeTris.length * 3);
        for (let i = 0; i < dedupeTris.length; i++) {
            const t = dedupeTris[i];
            occIndex[i * 3] = vId(t, 0);
            occIndex[i * 3 + 1] = vId(t, 1);
            occIndex[i * 3 + 2] = vId(t, 2);
        }
        const occGeom = new THREE.BufferGeometry();
        occGeom.setAttribute("position", posAttr);
        occGeom.setIndex(new THREE.BufferAttribute(occIndex, 1));
        const bvh = new MeshBVH(occGeom);

        occGeom.computeBoundingSphere();
        const R = occGeom.boundingSphere.radius || 1;
        const escapeDist = R * 2.2;
        const normalEps = R * this._rayEpsScale;
        const originEps = R * this._rayEpsScale;
        const cosCone = Math.cos(THREE.MathUtils.degToRad(this.escapeConeAngle));

        const dirs = this._fibonacciSphere(this.rayCount);

        // --- 4) Occlusion test từng tam giác đã dedupe ---
        const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
        const centroid = new THREE.Vector3(), normal = new THREE.Vector3();
        const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        const originBase = new THREE.Vector3(), origin = new THREE.Vector3();
        const ray = new THREE.Ray();

        const keptTris = [];
        const sides = this.testBothSides ? [1, -1] : [1];

        for (let i = 0; i < dedupeTris.length; i++) {
            const t = dedupeTris[i];
            A.fromBufferAttribute(posAttr, vId(t, 0));
            B.fromBufferAttribute(posAttr, vId(t, 1));
            C.fromBufferAttribute(posAttr, vId(t, 2));
            centroid.copy(A).add(B).add(C).multiplyScalar(1 / 3);
            e1.subVectors(B, A); e2.subVectors(C, A);
            normal.crossVectors(e1, e2);
            if (normal.lengthSq() < 1e-20) continue; // suy biến
            normal.normalize();

            let visible = false;
            for (const s of sides) {
                const nx = normal.x * s, ny = normal.y * s, nz = normal.z * s;
                originBase.set(
                    centroid.x + nx * normalEps,
                    centroid.y + ny * normalEps,
                    centroid.z + nz * normalEps
                );
                for (let d = 0; d < dirs.length; d++) {
                    const dir = dirs[d];
                    // chỉ xét tia trong nón quanh pháp tuyến phía đang test
                    if (dir.x * nx + dir.y * ny + dir.z * nz < cosCone) continue;
                    origin.copy(dir).multiplyScalar(originEps).add(originBase);
                    ray.origin.copy(origin);
                    ray.direction.copy(dir);
                    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
                    if (!hit || hit.distance > escapeDist) { visible = true; break; }
                }
                if (visible) break;
            }

            if (visible) {
                keptTris.push(vId(t, 0), vId(t, 1), vId(t, 2));
            }
        }

        occGeom.disposeBoundsTree?.();

        // --- 5) Dựng geometry đầu ra ---
        if (keptTris.length === triCount * 3) { this.outputData = geometry; return; }

        const out = new THREE.BufferGeometry();
        for (const name of Object.keys(geometry.attributes)) {
            out.setAttribute(name, geometry.attributes[name].clone());
        }
        out.setIndex(new THREE.BufferAttribute(new Uint32Array(keptTris), 1));
        if (this.recomputeNormals) out.computeVertexNormals();

        this.outputData = out;
    }

    _fibonacciSphere(n) {
        const pts = [];
        const golden = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
            const y = 1 - (i / (n - 1)) * 2;
            const r = Math.sqrt(Math.max(0, 1 - y * y));
            const th = golden * i;
            pts.push(new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize());
        }
        return pts;
    }
}