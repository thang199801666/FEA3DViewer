// Interaction/Picking/ActorTopology.js
// ---------------------------------------------------------------------------
// Dựng & cache cấu trúc topology của 1 Actor (từ actor.surface.geometry) để
// SelectionHighlighter khoanh đúng phần tử/điểm bị pick (Surface/Element/
// Point/Node/Edge), và (nếu có) một picker screen-space dùng queryVerts để
// tìm điểm/cạnh gần con trỏ khi không raycast trúng mặt nào.
//
// TOÀN BỘ toạ độ trả ra (wpos, cornerOf().pos, nodePosition, weldedPosition,
// chain.positions, triCentroid) đều ở LOCAL SPACE của actor.surface.geometry
// — vì SelectionHighlighter luôn `actor.add(overlay)`, để actor.matrixWorld
// tự áp lên overlay. KHÔNG trả world space ở đây.
//
// Thuật ngữ:
//   - "raw vertex index" / "corner"  : index thẳng vào geometry.attributes.position.
//     Đây cũng chính là giá trị Picker.js trả về trong pickResult.localPointIndex
//     (hit.face.a/b/c), nên PickMode.POINT dùng thẳng id này, không cần map qua topology.
//   - "cell id" / "node id"          : id vật lý (FEA) lấy từ geometry.userData.cellMap /
//     .pointMap, giống hệt cách Picker.js._cellId / ._pointId tính — nếu actor không có
//     cellMap/pointMap thì cellId = faceIndex, nodeId = raw vertex index (identity).
//   - "welded vertex" ("w..." trong triRaw/tri/wpos/wcount) : vertex đã gộp theo
//     toạ độ (hàn theo dung sai hình học), KHÔNG liên quan gì đến node FEA — dùng
//     để dò biên/adjacency (boundary edge, cell outline) một cách ổn định dù mesh
//     bị duplicate vertex (flat shading non-indexed).
// ---------------------------------------------------------------------------
import * as THREE from "three";

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();

/** Cache theo actor. Value bị bỏ (rebuild) nếu geometry.uuid đổi (vd. sau actor.update()). */
const _cache = new WeakMap();

function edgeKey(u, v) {
    return u < v ? `${u}_${v}` : `${v}_${u}`;
}

/** Xây lưới băm không gian đơn giản để hàn (weld) các vertex trùng/gần vị trí. */
function buildWeldMap(posAttr, tolerance) {
    const n = posAttr.count;
    const cell = Math.max(tolerance, 1e-12);
    const buckets = new Map(); // "ix_iy_iz" -> [weldedId, ...] (ứng viên cùng ô)
    const rawToWelded = new Int32Array(n);
    const weldedFirstRaw = []; // weldedId -> raw index đại diện (để lấy vị trí)

    const quantize = (v) => Math.round(v / cell);
    const p = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(posAttr, i);
        const qx = quantize(p.x), qy = quantize(p.y), qz = quantize(p.z);

        let found = -1;
        // Chỉ cần quét ô hiện tại + 26 ô lân cận vì tolerance == kích thước ô
        for (let dx = -1; dx <= 1 && found < 0; dx++) {
            for (let dy = -1; dy <= 1 && found < 0; dy++) {
                for (let dz = -1; dz <= 1 && found < 0; dz++) {
                    const key = `${qx + dx}_${qy + dy}_${qz + dz}`;
                    const candidates = buckets.get(key);
                    if (!candidates) continue;
                    for (const weldedId of candidates) {
                        const rawRef = weldedFirstRaw[weldedId];
                        _va.fromBufferAttribute(posAttr, rawRef);
                        if (_va.distanceToSquared(p) <= tolerance * tolerance) {
                            found = weldedId;
                            break;
                        }
                    }
                }
            }
        }

        if (found < 0) {
            found = weldedFirstRaw.length;
            weldedFirstRaw.push(i);
            const ownKey = `${qx}_${qy}_${qz}`;
            if (!buckets.has(ownKey)) buckets.set(ownKey, []);
            buckets.get(ownKey).push(found);
        }
        rawToWelded[i] = found;
    }

    return { rawToWelded, weldedFirstRaw };
}

export class ActorTopology {
    constructor(actor, { weldTolerance } = {}) {
        this.actor = actor;

        const mesh = actor.surface;
        const geometry = mesh?.geometry;
        if (!geometry) throw new Error("ActorTopology: actor.surface.geometry is missing");
        this.geometry = geometry;
        this._geometryUuid = geometry.uuid;

        const posAttr = geometry.getAttribute("position");
        if (!posAttr) throw new Error("ActorTopology: geometry has no position attribute");

        // ---- bbox / diag (dùng làm epsilon cho weld, offset chống z-fight, v.v.) ----
        this.bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
        const size = this.bbox.getSize(new THREE.Vector3());
        this.diag = size.length() || 1;

        // ---- triRaw: chỉ số vertex thô (index thẳng vào position attribute) ----
        const index = geometry.getIndex();
        let triRaw;
        if (index) {
            triRaw = index.array instanceof Uint32Array
                ? index.array.slice()
                : Uint32Array.from(index.array);
        } else {
            triRaw = new Uint32Array(posAttr.count);
            for (let i = 0; i < triRaw.length; i++) triRaw[i] = i;
        }
        this.triRaw = triRaw;
        this.triCount = triRaw.length / 3;

        // ---- weld: gộp vertex theo vị trí -> tri (index welded), wpos, wcount ----
        const tol = weldTolerance ?? Math.max(1e-6, this.diag * 1e-5);
        const { rawToWelded, weldedFirstRaw } = buildWeldMap(posAttr, tol);
        this.wcount = weldedFirstRaw.length;

        const wpos = new Float32Array(this.wcount * 3);
        for (let w = 0; w < this.wcount; w++) {
            const raw = weldedFirstRaw[w];
            wpos[w * 3] = posAttr.getX(raw);
            wpos[w * 3 + 1] = posAttr.getY(raw);
            wpos[w * 3 + 2] = posAttr.getZ(raw);
        }
        this.wpos = wpos;

        const tri = new Uint32Array(triRaw.length);
        for (let i = 0; i < triRaw.length; i++) tri[i] = rawToWelded[triRaw[i]];
        this.tri = tri;

        /** @type {Map<number, number[]>} weldedId -> danh sách raw vertex index đã gộp vào nó */
        this.weldedToCorner = new Map();
        for (let raw = 0; raw < rawToWelded.length; raw++) {
            const w = rawToWelded[raw];
            if (!this.weldedToCorner.has(w)) this.weldedToCorner.set(w, []);
            this.weldedToCorner.get(w).push(raw);
        }
        this._rawToWelded = rawToWelded;

        // ---- corners: truy cập trực tiếp position attribute theo raw vertex index ----
        this.corners = posAttr;

        // ---- cell / surface mapping (giống hệt logic Picker.js._cellId) ----
        const cellMap = geometry.userData?.cellMap ?? null;
        const pointMap = geometry.userData?.pointMap ?? null;
        const surfaceMap = geometry.userData?.surfaceMap ?? null;
        const groups = geometry.groups && geometry.groups.length ? geometry.groups : null;

        this._cellMap = cellMap;
        this._pointMap = pointMap;

        /** @type {Map<*, number[]>} cellId -> triangle indices */
        this.cellTris = new Map();
        /** @type {Map<*, number[]>} surfaceId -> triangle indices */
        this.surfaces = new Map();
        /** @type {Array<*>} tra cứu nhanh triIndex -> surfaceId (tránh quét this.surfaces mỗi lần) */
        this._triSurfaceOf = new Array(this.triCount);

        for (let t = 0; t < this.triCount; t++) {
            const cellId = cellMap ? cellMap[t] : t;
            if (!this.cellTris.has(cellId)) this.cellTris.set(cellId, []);
            this.cellTris.get(cellId).push(t);

            let surfaceId;
            if (surfaceMap) {
                surfaceId = surfaceMap[t];
            } else if (groups) {
                const vStart = t * 3;
                const g = groups.find((gr) => vStart >= gr.start && vStart < gr.start + gr.count);
                surfaceId = g ? (g.materialIndex ?? 0) : 0;
            } else {
                surfaceId = 0; // Actor hiện chỉ có 1 surface -> mọi tam giác thuộc surface "0"
            }
            this._triSurfaceOf[t] = surfaceId;
            if (!this.surfaces.has(surfaceId)) this.surfaces.set(surfaceId, []);
            this.surfaces.get(surfaceId).push(t);
        }

        // ---- node reverse-lookup: nodeId -> 1 raw vertex đại diện (để lấy vị trí) ----
        this._nodeToRaw = new Map();
        if (pointMap) {
            for (let raw = 0; raw < pointMap.length; raw++) {
                const nodeId = pointMap[raw];
                if (!this._nodeToRaw.has(nodeId)) this._nodeToRaw.set(nodeId, raw);
            }
        }
        // Không có pointMap -> nodeId chính là raw vertex index (identity), khỏi cần map.

        // ---- boundary edge chains (dùng cho PickMode.EDGE) ----
        // Cạnh "biên" = cạnh chỉ thuộc đúng 1 tam giác trong không gian welded (tri).
        // Đơn giản hoá: mỗi cạnh biên là 1 chain riêng (2 đỉnh), KHÔNG nối chuỗi các
        // cạnh liền kề thành 1 polyline dài — đủ dùng để khoanh sáng, nhưng nếu cần
        // polyline liền mạch (vd. để đo chiều dài 1 đường biên nhiều đoạn) sẽ cần
        // ghép thêm 1 bước graph-walk nữa.
        const edgeTriCount = new Map();
        for (let t = 0; t < this.triCount; t++) {
            const o = t * 3;
            const a = tri[o], b = tri[o + 1], c = tri[o + 2];
            for (const [u, v] of [[a, b], [b, c], [c, a]]) {
                const k = edgeKey(u, v);
                edgeTriCount.set(k, (edgeTriCount.get(k) || 0) + 1);
            }
        }
        /** @type {Map<string, {verts:number[], positions:Float32Array}>} */
        this.chains = new Map();
        for (const [k, count] of edgeTriCount) {
            if (count !== 1) continue;
            const [u, v] = k.split("_").map(Number);
            const positions = new Float32Array([
                wpos[u * 3], wpos[u * 3 + 1], wpos[u * 3 + 2],
                wpos[v * 3], wpos[v * 3 + 1], wpos[v * 3 + 2],
            ]);
            this.chains.set(k, { verts: [u, v], positions });
        }
    }

    // -------------------------------------------------------------- mapping

    cellOf(triIndex) { return this._cellMap ? this._cellMap[triIndex] : triIndex; }

    surfaceOf(triIndex) { return this._triSurfaceOf[triIndex] ?? null; }

    nodeOf(rawVertexIndex) {
        return this._pointMap ? this._pointMap[rawVertexIndex] : rawVertexIndex;
    }

    chainOf(edgeId) { return this.chains.get(edgeId) ?? null; }

    // ------------------------------------------------------ id -> triangles

    trianglesOfCell(cellId) { return this.cellTris.get(cellId) ?? []; }
    trianglesOfSurface(surfaceId) { return this.surfaces.get(surfaceId) ?? []; }

    // --------------------------------------------------------- id -> vị trí

    /** Vị trí (local space) của 1 raw vertex/corner — dùng cho PickMode.POINT. */
    cornerOf(rawVertexIndex) {
        if (rawVertexIndex == null || rawVertexIndex < 0 || rawVertexIndex >= this.corners.count) return null;
        return { pos: new THREE.Vector3().fromBufferAttribute(this.corners, rawVertexIndex) };
    }

    /** Vị trí (local space) của 1 node vật lý (id từ pointMap) — dùng cho PickMode.NODE. */
    nodePosition(nodeId, target = new THREE.Vector3()) {
        const raw = this._pointMap ? (this._nodeToRaw.get(nodeId) ?? nodeId) : nodeId;
        return target.fromBufferAttribute(this.corners, raw);
    }

    /** Vị trí (local space) của 1 welded vertex (id nội bộ trong tri/wpos). */
    weldedPosition(weldedId, target = new THREE.Vector3()) {
        return target.set(
            this.wpos[weldedId * 3],
            this.wpos[weldedId * 3 + 1],
            this.wpos[weldedId * 3 + 2]
        );
    }

    /** Trọng tâm (local space) của 1 tam giác, theo raw vertex index (triRaw). */
    triCentroid(triIndex, target = new THREE.Vector3()) {
        const o = triIndex * 3;
        const a = this.triRaw[o], b = this.triRaw[o + 1], c = this.triRaw[o + 2];
        _va.fromBufferAttribute(this.corners, a);
        _vb.fromBufferAttribute(this.corners, b);
        _vc.fromBufferAttribute(this.corners, c);
        return target.copy(_va).add(_vb).add(_vc).multiplyScalar(1 / 3);
    }

    /**
     * Tìm các raw vertex index nằm trong bán kính `radius` (local space) quanh
     * `point` — dùng bởi picker screen-space (PickMode EDGE/POINT/NODE, xem
     * PickMode.isScreenSpaceMode) khi raycast không trúng mặt nào để bù trừ
     * việc bắt điểm/cạnh "lơ lửng" ngoài rìa mesh.
     * ⚠ Chưa có nơi gọi thực tế trong các file hiện có — chữ ký được suy ra
     *   từ tên hàm + REQUIRED interface, điều chỉnh lại nếu call site thật có
     *   dạng khác (vd. truyền NDC + camera thay vì điểm local + bán kính).
     * @param {THREE.Vector3} point  Điểm truy vấn, local space.
     * @param {number} radius        Bán kính truy vấn, local space.
     * @returns {number[]} Danh sách raw vertex index trong bán kính.
     */
    queryVerts(point, radius) {
        const out = [];
        const r2 = radius * radius;
        const pos = this.corners;
        for (let i = 0; i < pos.count; i++) {
            _va.fromBufferAttribute(pos, i);
            if (_va.distanceToSquared(point) <= r2) out.push(i);
        }
        return out;
    }

    // ------------------------------------------------------------- lifecycle

    /** True nếu geometry của actor đã đổi kể từ lúc topology này được dựng. */
    isStale() {
        return this.geometry !== this.actor.surface?.geometry
            || this._geometryUuid !== this.actor.surface?.geometry?.uuid;
    }

    /**
     * Lấy (và cache) topology của 1 actor. Tự rebuild nếu geometry đã đổi
     * (vd. sau actor.update() nạp lại mesh).
     * @param {THREE.Object3D} actor
     * @param {Object} [options]
     * @param {number} [options.weldTolerance]  Ghi đè dung sai hàn vertex mặc định.
     */
    static get(actor, options) {
        if (!actor?.surface?.geometry) {
            throw new Error("ActorTopology.get: actor không có surface.geometry hợp lệ");
        }
        let topo = _cache.get(actor);
        if (!topo || topo.isStale()) {
            topo = new ActorTopology(actor, options);
            _cache.set(actor, topo);
        }
        return topo;
    }

    /** Xoá cache topology của 1 actor (vd. trước khi actor.dispose()). */
    static invalidate(actor) {
        _cache.delete(actor);
    }

    static get REQUIRED_INTERFACE() {
        return [
            "triRaw", "tri", "wpos", "triCount", "wcount", "bbox", "diag",
            "cellTris", "surfaces", "corners", "chains", "weldedToCorner",
            "cellOf", "surfaceOf", "nodeOf", "chainOf",
            "trianglesOfCell", "trianglesOfSurface",
            "cornerOf", "nodePosition", "weldedPosition", "triCentroid", "queryVerts",
        ];
    }
}

export default ActorTopology;