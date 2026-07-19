import * as THREE from "three";

function copyAttribute(attribute, pointIds) {
    const T = attribute.array.constructor;
    const out = new T(pointIds.length * attribute.itemSize);
    for (let i = 0; i < pointIds.length; ++i) {
        const source = pointIds[i] * attribute.itemSize;
        out.set(attribute.array.subarray(source, source + attribute.itemSize), i * attribute.itemSize);
    }
    return new THREE.BufferAttribute(out, attribute.itemSize, attribute.normalized);
}

/** Splits an indexed triangle mesh into independently culled GPU geometries. */
export function partitionGeometry(geometry, { maxTriangles = 250000 } = {}) {
    const sourceIndex = geometry.index?.array;
    if (!sourceIndex || sourceIndex.length <= maxTriangles * 3) return [geometry];
    const chunks = [];
    for (let begin = 0; begin < sourceIndex.length; begin += maxTriangles * 3) {
        const end = Math.min(sourceIndex.length, begin + maxTriangles * 3);
        const remap = new Map();
        const pointIds = [];
        const localIndex = new Uint32Array(end - begin);
        for (let i = begin; i < end; ++i) {
            const sourceId = sourceIndex[i];
            let localId = remap.get(sourceId);
            if (localId === undefined) {
                localId = pointIds.length;
                remap.set(sourceId, localId);
                pointIds.push(sourceId);
            }
            localIndex[i - begin] = localId;
        }
        const chunk = new THREE.BufferGeometry();
        for (const [name, attribute] of Object.entries(geometry.attributes)) {
            chunk.setAttribute(name, copyAttribute(attribute, pointIds));
        }
        const chunkIndex = pointIds.length <= 65535 ? new Uint16Array(localIndex) : localIndex;
        chunk.setIndex(new THREE.BufferAttribute(chunkIndex, 1));
        const sourceMap = geometry.userData?.cellMap;
        chunk.userData = { ...geometry.userData, partition: chunks.length };
        if (sourceMap) chunk.userData.cellMap = sourceMap.slice(begin / 3, end / 3);
        chunk.computeBoundingBox();
        chunk.computeBoundingSphere();
        chunks.push(chunk);
    }
    return chunks;
}

function clusterSimplify(geometry, ratio) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const position = geometry.getAttribute("position");
    const index = geometry.index.array;
    const spans = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    const dimensions = Math.max(1, spans.filter((span) => span > 1e-12).length);
    const targetVertices = Math.max(4, Math.floor(position.count * ratio));
    const resolution = Math.max(1, Math.ceil(targetVertices ** (1 / dimensions)));
    const representatives = new Map();
    const sourceIds = [];
    const pointMap = new Int32Array(position.count);
    for (let i = 0; i < position.count; ++i) {
        const coords = [position.getX(i), position.getY(i), position.getZ(i)];
        const cell = coords.map((value, axis) => spans[axis] > 1e-12
            ? Math.min(resolution - 1, Math.floor((value - box.min.getComponent(axis)) / spans[axis] * resolution))
            : 0);
        const key = `${cell[0]},${cell[1]},${cell[2]}`;
        let id = representatives.get(key);
        if (id === undefined) {
            id = sourceIds.length;
            representatives.set(key, id);
            sourceIds.push(i);
        }
        pointMap[i] = id;
    }
    const reduced = [];
    const sourceCells = [];
    const cellMap = geometry.userData?.cellMap;
    for (let i = 0; i + 2 < index.length; i += 3) {
        const a = pointMap[index[i]], b = pointMap[index[i + 1]], c = pointMap[index[i + 2]];
        if (a === b || b === c || c === a) continue;
        reduced.push(a, b, c);
        if (cellMap) sourceCells.push(cellMap[i / 3]);
    }
    if (reduced.length === 0) {
        const fallback = geometry.clone();
        fallback.userData = { ...geometry.userData, lodRatio: ratio, simplifier: "vertex-clustering-fallback" };
        return fallback;
    }
    const output = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        output.setAttribute(name, copyAttribute(attribute, sourceIds));
    }
    const IndexType = sourceIds.length <= 65535 ? Uint16Array : Uint32Array;
    output.setIndex(new THREE.BufferAttribute(new IndexType(reduced), 1));
    output.userData = { ...geometry.userData, lodRatio: ratio, simplifier: "vertex-clustering" };
    if (cellMap) output.userData.cellMap = Int32Array.from(sourceCells);
    output.computeBoundingBox();
    output.computeBoundingSphere();
    return output;
}

/** Creates topology-preserving clustered levels for interactive navigation; level 0 is lossless. */
export function buildLODGeometries(geometry, { ratios = [1, 0.25, 0.06] } = {}) {
    const index = geometry.index?.array;
    if (!index) return [geometry];
    return ratios.map((ratio, level) => {
        if (level === 0 || ratio >= 1) return geometry;
        return clusterSimplify(geometry, ratio);
    });
}

export function createLargeModelLOD(geometry, material, {
    ratios = [1, 0.25, 0.06], distances = [0, 100, 400], maxTriangles = 250000,
} = {}) {
    const lod = new THREE.LOD();
    buildLODGeometries(geometry, { ratios }).forEach((levelGeometry, level) => {
        const group = new THREE.Group();
        for (const partition of partitionGeometry(levelGeometry, { maxTriangles })) {
            group.add(new THREE.Mesh(partition, material));
        }
        lod.addLevel(group, distances[level] ?? distances[distances.length - 1]);
    });
    lod.userData.isLargeModelLOD = true;
    return lod;
}
