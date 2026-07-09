import { Filter } from "./Filter.js";
import { PolyData, DataArray } from "../core/PolyData.js";
import earcut from "earcut";

export class CutterFilter extends Filter {
    constructor() {
        super();
        this.normal = [1, 0, 0];
        this.origin = [0, 0, 0];
        this.fill = true;
        this.passData = true;
        this.edges = true;
        this.computeNormals = true;
    }

    setPlane(normal, origin) { this.normal = [...normal]; this.origin = [...origin]; return this; }
    setFill(v) { this.fill = !!v; return this; }
    setPassData(v) { this.passData = !!v; return this; }
    setEdges(v) { this.edges = !!v; return this; }
    setComputeNormals(v) { this.computeNormals = !!v; return this; }

    getOutputData() {
        const pd = this.input;
        if (!pd) throw new Error("CutterFilter: Input is not set.");

        const pts = pd.points;
        const n = _normalize(this.normal);
        const [nx, ny, nz] = n;
        const [ox, oy, oz] = this.origin;
        const dist = (i) => nx * (pts[i * 3] - ox) + ny * (pts[i * 3 + 1] - oy) + nz * (pts[i * 3 + 2] - oz);

        const srcArrays = this.passData ? [...pd.pointData.arrays.values()] : [];

        const b = pd.getBounds();
        const diag = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) || 1;
        const eps = Math.max(diag * 1e-6, 1e-9);
        const eps2 = eps * eps;

        const wPos = [];
        const wVals = srcArrays.map(() => []);
        const buckets = new Map();
        const cellOf = (x) => Math.floor(x / eps);
        const cKey = (a, b2, c) => `${a},${b2},${c}`;

        const weld = ({ p, vals }) => {
            const ci = cellOf(p[0]), cj = cellOf(p[1]), ck = cellOf(p[2]);
            for (let di = -1; di <= 1; di++)
                for (let dj = -1; dj <= 1; dj++)
                    for (let dk = -1; dk <= 1; dk++) {
                        const arr = buckets.get(cKey(ci + di, cj + dj, ck + dk));
                        if (!arr) continue;
                        for (const idx of arr) {
                            const dx = wPos[idx * 3] - p[0];
                            const dy = wPos[idx * 3 + 1] - p[1];
                            const dz = wPos[idx * 3 + 2] - p[2];
                            if (dx * dx + dy * dy + dz * dz <= eps2) return idx;
                        }
                    }
            const idx = wPos.length / 3;
            wPos.push(p[0], p[1], p[2]);
            for (let a = 0; a < srcArrays.length; a++) wVals[a].push(...vals[a]);
            const key = cKey(ci, cj, ck);
            let bucket = buckets.get(key);
            if (!bucket) { bucket = []; buckets.set(key, bucket); }
            bucket.push(idx);
            return idx;
        };

        const interpAt = (i0, i1, t) => {
            const p = [0, 0, 0];
            for (let k = 0; k < 3; k++) p[k] = pts[i0 * 3 + k] + t * (pts[i1 * 3 + k] - pts[i0 * 3 + k]);
            const vals = srcArrays.map(a => {
                const nC = a.numberOfComponents, out = [];
                for (let c = 0; c < nC; c++) {
                    const v0 = a.getComponent(i0, c), v1 = a.getComponent(i1, c);
                    out.push(v0 + t * (v1 - v0));
                }
                return out;
            });
            return { p, vals };
        };

        const segSet = new Set();
        const segments = [];
        const addSeg = (a, b2) => {
            if (a === b2) return;
            const k = a < b2 ? `${a}_${b2}` : `${b2}_${a}`;
            if (segSet.has(k)) return;
            segSet.add(k);
            segments.push([a, b2]);
        };

        const tris = pd.getTriangles();
        for (let t = 0; t < tris.length; t += 3) {
            const idx3 = [tris[t], tris[t + 1], tris[t + 2]];
            const d = idx3.map(dist);
            const crossPts = [];
            for (let e = 0; e < 3; e++) {
                const a = e, b2 = (e + 1) % 3;
                const da = d[a], db = d[b2];
                if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
                    const tt = da / (da - db);
                    crossPts.push(weld(interpAt(idx3[a], idx3[b2], tt)));
                }
            }
            if (crossPts.length === 2) addSeg(crossPts[0], crossPts[1]);
        }

        const out = new PolyData();
        out.setPoints(Float32Array.from(wPos));
        for (let a = 0; a < srcArrays.length; a++) {
            out.pointData.addArray(
                new DataArray(srcArrays[a].name, Float32Array.from(wVals[a]), srcArrays[a].numberOfComponents),
                {
                    asScalars: pd.pointData.activeScalars === srcArrays[a].name,
                    asVectors: pd.pointData.activeVectors === srcArrays[a].name,
                }
            );
        }

        const basis = _planeBasis(n);
        const to2D = (wi) => [
            (wPos[wi * 3] - ox) * basis.u[0] + (wPos[wi * 3 + 1] - oy) * basis.u[1] + (wPos[wi * 3 + 2] - oz) * basis.u[2],
            (wPos[wi * 3] - ox) * basis.v[0] + (wPos[wi * 3 + 1] - oy) * basis.v[1] + (wPos[wi * 3 + 2] - oz) * basis.v[2],
        ];

        const loops = _assembleLoops(segments, to2D);

        if (this.edges || !this.fill) {
            out.lines = loops.length
                ? loops.map(loop => [...loop, loop[0]])
                : segments.map(s => [s[0], s[1]]);
        }

        if (!this.fill) return out;
        if (loops.length === 0) { out.polys = []; return out; }

        const rings = loops.map(loop => {
            const pts2 = loop.map(to2D);
            return { loop, pts2, area: _signedArea(pts2) };
        });
        for (const r of rings) r.rep = _repPoint(r.pts2);
        for (const r of rings) {
            r.depth = 0;
            for (const o of rings) {
                if (o === r) continue;
                if (_pointInPoly(r.rep, o.pts2)) r.depth++;
            }
        }
        const outers = rings.filter(r => r.depth % 2 === 0);
        const holes = rings.filter(r => r.depth % 2 === 1);
        for (const o of outers) o.holes = [];
        for (const h of holes) {
            let parent = null;
            for (const o of outers) {
                if (o.depth === h.depth - 1 && _pointInPoly(h.rep, o.pts2)) {
                    if (!parent || Math.abs(o.area) < Math.abs(parent.area)) parent = o;
                }
            }
            (parent ?? outers[0])?.holes.push(h);
        }

        const outPolys = [];
        for (const o of outers) {
            const outerRing = o.area > 0 ? o.loop : [...o.loop].reverse();
            const outer2 = o.area > 0 ? o.pts2 : [...o.pts2].reverse();

            const coords = [];
            const localToWelded = [];
            for (let i = 0; i < outer2.length; i++) { coords.push(outer2[i][0], outer2[i][1]); localToWelded.push(outerRing[i]); }

            const holeIndices = [];
            for (const h of (o.holes ?? [])) {
                holeIndices.push(coords.length / 2);
                const hRing = h.area < 0 ? h.loop : [...h.loop].reverse();
                const h2 = h.area < 0 ? h.pts2 : [...h.pts2].reverse();
                for (let i = 0; i < h2.length; i++) { coords.push(h2[i][0], h2[i][1]); localToWelded.push(hRing[i]); }
            }

            const idx = earcut(coords, holeIndices, 2);
            for (let i = 0; i < idx.length; i += 3) {
                outPolys.push([localToWelded[idx[i]], localToWelded[idx[i + 1]], localToWelded[idx[i + 2]]]);
            }
        }
        out.polys = outPolys;

        if (this.computeNormals) {
            const N = wPos.length / 3;
            const nv = new Float32Array(N * 3);
            for (let i = 0; i < N; i++) { nv[i * 3] = nx; nv[i * 3 + 1] = ny; nv[i * 3 + 2] = nz; }
            out.pointData.addArray(new DataArray("Normals", nv, 3), { asVectors: true });
        }

        return out;
    }
}

function _normalize(n) {
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / L, n[1] / L, n[2] / L];
}

function _assembleLoops(segments, to2D) {
    const adj = new Map();
    const add = (a, b) => {
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.get(a).includes(b)) adj.get(a).push(b);
    };
    for (const [a, b] of segments) { add(a, b); add(b, a); }

    const used = new Set();
    const ek = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const ang = (from, to) => { const p = to2D(from), q = to2D(to); return Math.atan2(q[1] - p[1], q[0] - p[0]); };

    const loops = [];
    for (const [s0, s1] of segments) {
        if (used.has(ek(s0, s1))) continue;
        const loop = [s0];
        let prev = s0, cur = s1;
        used.add(ek(s0, s1));
        let guard = 0, max = segments.length * 4 + 8;

        while (guard++ < max) {
            loop.push(cur);
            if (cur === s0) { loop.pop(); break; }

            const nbrs = (adj.get(cur) || []).filter(x => !used.has(ek(cur, x)));
            if (nbrs.length === 0) break;
            let next;
            if (nbrs.length === 1) {
                next = nbrs[0];
            } else {
                const aIn = ang(cur, prev);
                let best = nbrs[0], bestTurn = Infinity;
                for (const c of nbrs) {
                    let turn = ang(cur, c) - aIn;
                    while (turn <= 1e-9) turn += 2 * Math.PI;
                    if (turn < bestTurn) { bestTurn = turn; best = c; }
                }
                next = best;
            }
            used.add(ek(cur, next));
            prev = cur; cur = next;
        }
        if (loop.length >= 3) loops.push(loop);
    }
    return loops;
}

function _planeBasis(n) {
    const a = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = _cross(n, a); const Lu = Math.hypot(...u) || 1; u[0] /= Lu; u[1] /= Lu; u[2] /= Lu;
    const v = _cross(n, u);
    return { u, v };
}
function _cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function _signedArea(p) { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const j = (i + 1) % n; s += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return s / 2; }
function _centroid(p) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
function _repPoint(p) {
    const c = _centroid(p);
    return [p[0][0] + (c[0] - p[0][0]) * 1e-4, p[0][1] + (c[1] - p[0][1]) * 1e-4];
}
function _pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        const hit = (yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-30) + xi;
        if (hit) inside = !inside;
    }
    return inside;
}