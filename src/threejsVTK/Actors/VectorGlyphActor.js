// Actors/VectorGlyphActor.js
// Vẽ mũi tên cho trường vector (lực, vận tốc, chuyển vị) — tương đương vtkGlyph3D.
// Dùng THREE.InstancedMesh (1 draw call cho hàng chục nghìn mũi tên) => hiệu năng cao.
//
//   const glyph = new VectorGlyphActor(dataSet, {
//       vectorArrayName: "Displacement", scaleFactor: 10, maskRatio: 4, lookupTable: ctf,
//   });
//   renderer.addActor(glyph);

import * as THREE from "three";

export class VectorGlyphActor extends THREE.Group {
    constructor(dataSet, options = {}) {
        super();
        this.isActor = true;
        this.name = options.name ?? "VectorGlyph";

        this.scaleFactor = options.scaleFactor ?? 1.0;
        this.vectorArrayName = options.vectorArrayName ?? null; // null=activeVectors
        this.maskRatio = Math.max(1, options.maskRatio ?? 1);   // vẽ 1/maskRatio điểm
        this.lookupTable = options.lookupTable ?? null;         // tô màu theo magnitude
        this.scaleByMagnitude = options.scaleByMagnitude ?? true;
        this.color = new THREE.Color(options.color ?? 0xffcc00);
        this._shaftRadius = options.shaftRadius ?? 0.04; // theo tỉ lệ chiều dài mũi tên

        this._mesh = null;
        if (dataSet) this.setInputData(dataSet);
    }

    setInputData(dataSet) {
        this._dataSet = dataSet;
        this._build();
        return this;
    }

    setScaleFactor(s) { this.scaleFactor = s; this._build(); return this; }

    _resolveVectors() {
        const pd = this._dataSet.pointData;
        return this.vectorArrayName ? pd.getArray(this.vectorArrayName) : pd.getVectors();
    }

    _arrowGeometry() {
        // Mũi tên hướng +Y, chiều dài 1: shaft (0..0.75) + head cone (0.75..1).
        const r = this._shaftRadius;
        const shaft = new THREE.CylinderGeometry(r, r, 0.75, 8);
        shaft.translate(0, 0.375, 0);
        const head = new THREE.ConeGeometry(r * 2.5, 0.25, 10);
        head.translate(0, 0.875, 0);
        // Gộp bằng cách nối attribute (không cần BufferGeometryUtils để giảm phụ thuộc)
        return mergeGeometries([shaft, head]);
    }

    _build() {
        if (this._mesh) { this.remove(this._mesh); this._mesh.geometry.dispose(); this._mesh.material.dispose(); this._mesh = null; }
        const ds = this._dataSet;
        const vec = this._resolveVectors();
        if (!ds || !vec) { console.warn("[VectorGlyphActor] thiếu dataSet hoặc vectors."); return; }

        const nPts = ds.getNumberOfPoints();
        const indices = [];
        for (let i = 0; i < nPts; i += this.maskRatio) indices.push(i);
        const count = indices.length;

        const geo = this._arrowGeometry();
        const mat = new THREE.MeshLambertMaterial({ vertexColors: !!this.lookupTable });
        if (!this.lookupTable) mat.color.copy(this.color);

        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const up = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const pos = new THREE.Vector3();
        const scl = new THREE.Vector3();
        const m = new THREE.Matrix4();
        const tmpColor = [0, 0, 0];
        const [mn, mx] = this.lookupTable ? this.lookupTable.range : [0, 1];

        // Chiều dài tham chiếu để mũi tên không quá to/nhỏ
        const bbox = ds.getBounds();
        const modelLen = Math.hypot(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]) || 1;
        const baseLen = modelLen * 0.03; // mũi tên "đơn vị" ~3% kích thước model

        let colorAttr = null;
        if (this.lookupTable) colorAttr = new Float32Array(count * 3);

        indices.forEach((pi, k) => {
            const vx = vec.getComponent(pi, 0), vy = vec.getComponent(pi, 1), vz = vec.getComponent(pi, 2);
            const mag = Math.hypot(vx, vy, vz);
            dir.set(vx, vy, vz);
            if (mag > 1e-12) dir.multiplyScalar(1 / mag);
            else dir.copy(up);
            quat.setFromUnitVectors(up, dir);

            const len = baseLen * (this.scaleByMagnitude ? mag : 1) * this.scaleFactor;
            scl.set(len, len, len);
            pos.set(ds.points[pi * 3], ds.points[pi * 3 + 1], ds.points[pi * 3 + 2]);
            m.compose(pos, quat, scl);
            mesh.setMatrixAt(k, m);

            if (colorAttr) {
                const span = mx - mn;
                const t = span === 0 ? 0.5 : (mag - mn) / span;
                this.lookupTable.getColor(mn + t * span, tmpColor);
                colorAttr[k * 3] = tmpColor[0]; colorAttr[k * 3 + 1] = tmpColor[1]; colorAttr[k * 3 + 2] = tmpColor[2];
            }
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (colorAttr) mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);

        this._mesh = mesh;
        this.add(mesh);
    }

    dispose() {
        if (this._mesh) { this._mesh.geometry.dispose(); this._mesh.material.dispose(); }
    }
}

// Gộp nhiều BufferGeometry cùng attribute (position + normal, non-indexed) — tránh phụ thuộc BufferGeometryUtils.
function mergeGeometries(geoms) {
    const nonIndexed = geoms.map(g => g.index ? g.toNonIndexed() : g);
    let total = 0;
    for (const g of nonIndexed) total += g.getAttribute("position").count;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    let o = 0;
    for (const g of nonIndexed) {
        const p = g.getAttribute("position"), n = g.getAttribute("normal");
        position.set(p.array, o * 3);
        if (n) normal.set(n.array, o * 3);
        o += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(position, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    return out;
}
