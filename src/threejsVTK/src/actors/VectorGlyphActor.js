import * as THREE from "three";

export class VectorGlyphActor extends THREE.Group {
    constructor(dataSet, options = {}) {
        super();
        this.isActor = true;
        this.name = options.name ?? "VectorGlyph";

        this.scaleFactor = options.scaleFactor ?? 1.0;
        this.vectorArrayName = options.vectorArrayName ?? null;
        this.maskRatio = Math.max(1, options.maskRatio ?? 1);
        this.lookupTable = options.lookupTable ?? null;
        this.scaleByMagnitude = options.scaleByMagnitude ?? true;
        this.color = new THREE.Color(options.color ?? 0xffcc00);
        this._shaftRadius = options.shaftRadius ?? 0.04;

        this._mesh = null;
        if (dataSet) this.setInputData(dataSet);
    }

    setInputData(dataSet) {
        this._dataSet = dataSet;
        this._buildGlyphs();
    }

    _buildGlyphs() {
        if (this._mesh) { this.remove(this._mesh); this.dispose(); }
        const pd = this._dataSet;
        if (!pd || !pd.points) return;

        const vectors = this.vectorArrayName ? pd.pointData?.getArray(this.vectorArrayName) : pd.pointData?.getVectors();
        if (!vectors) return;

        const numPts = pd.points.length / 3;
        const targetIndices = [];
        for (let i = 0; i < numPts; i += this.maskRatio) {
            targetIndices.push(i);
        }
        if (targetIndices.length === 0) return;

        const cone = new THREE.ConeGeometry(0.12, 0.3, 6);
        cone.translate(0, 0.85, 0);
        const cylinder = new THREE.CylinderGeometry(this._shaftRadius, this._shaftRadius, 0.7, 5);
        cylinder.translate(0, 0.35, 0);

        const glyphGeo = mergeGeometries([cone, cylinder]);
        glyphGeo.rotateX(Math.PI / 2);
        cone.dispose();
        cylinder.dispose();

        const useLut = !!this.lookupTable;
        const material = new THREE.MeshLambertMaterial({
            color: useLut ? 0xffffff : this.color,
        });

        const mesh = new THREE.InstancedMesh(glyphGeo, material, targetIndices.length);
        mesh.name = `${this.name}_instances`;

        const dummy = new THREE.Object3D();
        const p = new THREE.Vector3();
        const v = new THREE.Vector3();
        const up = new THREE.Vector3(0, 0, 1);
        const q = new THREE.Quaternion();

        const scalars = pd.pointData?.getScalars();
        let mn = 0, mx = 1;
        if (useLut && scalars) [mn, mx] = scalars.getRange();

        const colorAttr = useLut ? new Float32Array(targetIndices.length * 3) : null;
        const tmpColor = [];

        targetIndices.forEach((i, k) => {
            p.set(pd.points[i * 3], pd.points[i * 3 + 1], pd.points[i * 3 + 2]);
            v.set(vectors.array[i * 3], vectors.array[i * 3 + 1], vectors.array[i * 3 + 2]);

            const mag = v.length();
            if (mag < 1e-7) {
                mesh.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
                return;
            }

            dummy.position.copy(p);
            q.setFromUnitVectors(up, v.clone().normalize());
            dummy.quaternion.copy(q);

            const s = this.scaleByMagnitude ? (mag * this.scaleFactor) : this.scaleFactor;
            dummy.scale.set(s, s, s);
            dummy.updateMatrix();
            mesh.setMatrixAt(k, dummy.matrix);

            if (colorAttr) {
                const span = mx - mn;
                const t = span === 0 ? 0.5 : (mag - mn) / span;
                this.lookupTable.getColor(mn + t * span, tmpColor);
                colorAttr[k * 3] = tmpColor[0];
                colorAttr[k * 3 + 1] = tmpColor[1];
                colorAttr[k * 3 + 2] = tmpColor[2];
            }
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (colorAttr) mesh.instanceColor = new THREE.InstancedBufferAttribute(colorAttr, 3);

        this._mesh = mesh;
        this.add(mesh);
    }

    dispose() {
        if (this._mesh) {
            this._mesh.geometry.dispose();
            this._mesh.material.dispose();
        }
    }
}

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
    const res = new THREE.BufferGeometry();
    res.setAttribute("position", new THREE.BufferAttribute(position, 3));
    res.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    for (const g of nonIndexed) if (g !== geoms[geoms.indexOf(g)]) g.dispose();
    return res;
}