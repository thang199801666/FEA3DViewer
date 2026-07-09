// geometry/weld.js

/**
 * Welds coincident vertices within a specified tolerance using spatial hashing.
 * * @param {import('three').BufferAttribute} pos - The 'position' attribute.
 * @param {object} [opts]
 * @param {number|null} [opts.tolerance=null] - Welding tolerance. If null, computed from bounding box (diag * 1e-5).
 * @param {import('three').Box3|null} [opts.boundingBox=null] - Used to compute tolerance if not explicitly provided.
 * @returns {{ canon: Int32Array, count: number, tolerance: number }}
 * canon[i] = the canonical (unique) vertex ID for the original vertex i.
 */
export function weldVertices(pos, { tolerance = null, boundingBox = null } = {}) {
    let tol = tolerance;
    if (tol == null || !(tol > 0)) {
        const diag = boundingBox ? boundingBox.min.distanceTo(boundingBox.max) : 0;
        tol = (diag > 0 ? diag : 1) * 1e-5;
    }

    const tolSq = tol * tol;
    const cellSize = tol;
    const buckets = new Map(); // "cx,cy,cz" -> [representative vertex indices]
    const canon = new Int32Array(pos.count).fill(-1);
    let count = 0;

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const cx = Math.floor(x / cellSize);
        const cy = Math.floor(y / cellSize);
        const cz = Math.floor(z / cellSize);

        let matched = -1;

        // Scan the 27 neighboring cells (3x3x3 grid)
        for (let dx = -1; dx <= 1 && matched < 0; dx++) {
            for (let dy = -1; dy <= 1 && matched < 0; dy++) {
                for (let dz = -1; dz <= 1 && matched < 0; dz++) {
                    const bucket = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const o = bucket[k];
                        const ox = pos.getX(o), oy = pos.getY(o), oz = pos.getZ(o);
                        const dSq = (x - ox) ** 2 + (y - oy) ** 2 + (z - oz) ** 2;
                        if (dSq <= tolSq) { 
                            matched = canon[o]; 
                            break; 
                        }
                    }
                }
            }
        }

        if (matched < 0) {
            matched = count++;
            const key = `${cx},${cy},${cz}`;
            let b = buckets.get(key);
            if (!b) buckets.set(key, (b = []));
            b.push(i);
        }
        canon[i] = matched;
    }

    return { canon, count, tolerance: tol };
}