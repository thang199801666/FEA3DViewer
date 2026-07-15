// sources/BoxSource.js
//
// This file was reconstructed from its call sites because the original
// BoxSource implementation was not included in the provided source.
// The contract below comes from SceneController.addBoxActor():
//
//     new BoxSource({ xLength, yLength, zLength, segments: 20 })
//     source.getOutputDataWithScalars("stress", (x, y, z) => 1 - Math.hypot(x,y,z) / maxD)
//     // maxD = half diagonal, so the scalar is 1 at the center and 0 at corners.
//     // Points are centered around the source origin.
//
// If the original implementation is recovered, compare it before replacing:
//     git log --all --diff-filter=D -- '**/BoxSource.js'
//
// vtkCubeSource equivalent: generates the outer surface of a rectangular box.
// Each face is split into segments x segments quads, two triangles per quad.

import { PolyData } from "../core/PolyData.js";

// Six faces: [normal, u axis, v axis] in box coordinates.
// u x v follows the outward normal, so winding is CCW from outside.
const FACES = [
    { n: [ 1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },   // +X
    { n: [-1, 0, 0], u: [0, 0,  1], v: [0, 1, 0] },   // -X
    { n: [0,  1, 0], u: [1, 0,  0], v: [0, 0, -1] },  // +Y
    { n: [0, -1, 0], u: [1, 0,  0], v: [0, 0,  1] },  // -Y
    { n: [0, 0,  1], u: [1, 0,  0], v: [0, 1,  0] },  // +Z
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1,  0] },  // -Z
];

export class BoxSource {
    /**
     * @param {object} [opts]
     * @param {number} [opts.xLength=1]
     * @param {number} [opts.yLength=1]
     * @param {number} [opts.zLength=1]
     * @param {number} [opts.segments=1]  Number of cells along each side of one face.
     * @param {number[]} [opts.center=[0,0,0]]
     */
    constructor({ xLength = 1, yLength = 1, zLength = 1, segments = 1, center = [0, 0, 0] } = {}) {
        this.xLength = xLength;
        this.yLength = yLength;
        this.zLength = zLength;
        this.segments = Math.max(1, segments | 0);
        this.center = center;
    }

    setSegments(n) { this.segments = Math.max(1, n | 0); return this; }
    setCenter(x, y, z) { this.center = [x, y, z]; return this; }

    /** @returns {PolyData} Outer box surface with points centered around `center`. */
    getOutputData() {
        const n = this.segments;
        const half = [this.xLength / 2, this.yLength / 2, this.zLength / 2];
        const [cx, cy, cz] = this.center;

        const points = [];
        const polys = [];

        for (const face of FACES) {
            const base = points.length / 3;

            // (n + 1) x (n + 1) vertex grid on this face.
            // p = normal * half + (s * u + t * v) * half, with s,t in [-1, 1].
            for (let j = 0; j <= n; j++) {
                const t = (j / n) * 2 - 1;
                for (let i = 0; i <= n; i++) {
                    const s = (i / n) * 2 - 1;
                    points.push(
                        cx + (face.n[0] + s * face.u[0] + t * face.v[0]) * half[0],
                        cy + (face.n[1] + s * face.u[1] + t * face.v[1]) * half[1],
                        cz + (face.n[2] + s * face.u[2] + t * face.v[2]) * half[2],
                    );
                }
            }

            const row = n + 1;
            for (let j = 0; j < n; j++) {
                for (let i = 0; i < n; i++) {
                    const a = base + j * row + i;
                    const b = a + 1;
                    const c = a + row;
                    const d = c + 1;
                    polys.push([a, b, d], [a, d, c]);
                }
            }
        }

        const pd = new PolyData();
        pd.setPoints(Float32Array.from(points));
        pd.polys = polys;
        return pd;
    }

    /**
     * Generates the box and attaches a point-scalar evaluated from coordinates
     * relative to the box center.
     *
     * @param {string} name Array name, for example "stress".
     * @param {(x:number,y:number,z:number)=>number} fn Receives center-relative coordinates.
     * @returns {PolyData} PolyData with the generated scalars set as active scalars.
     */
    getOutputDataWithScalars(name, fn) {
        if (typeof fn !== "function") {
            throw new TypeError("BoxSource.getOutputDataWithScalars: expected a function (x, y, z) => number");
        }
        const pd = this.getOutputData();
        const [cx, cy, cz] = this.center;
        const count = pd.points.length / 3;
        const values = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            values[i] = fn(
                pd.points[i * 3]     - cx,
                pd.points[i * 3 + 1] - cy,
                pd.points[i * 3 + 2] - cz,
            );
        }
        pd.addPointDataArray(name, values, 1, { setActiveScalar: true });
        return pd;
    }
}

export default BoxSource;
