// Sources/SphereSource.js
// Sinh mặt cầu (UV sphere) dưới dạng PolyData — tương đương vtkSphereSource.

import { Source } from "./Source.js";
import { PolyData } from "../Core/PolyData.js";

export class SphereSource extends Source {
    constructor(options = {}) {
        super();
        this.radius = options.radius ?? 0.5;
        this.center = options.center ?? [0, 0, 0];
        this.thetaResolution = options.thetaResolution ?? 16; // kinh tuyến
        this.phiResolution = options.phiResolution ?? 16;     // vĩ tuyến
    }

    getOutputData() {
        const [cx, cy, cz] = this.center;
        const nT = this.thetaResolution, nP = this.phiResolution;
        const pts = [];
        for (let i = 0; i <= nP; i++) {
            const phi = Math.PI * i / nP;
            const sp = Math.sin(phi), cp = Math.cos(phi);
            for (let j = 0; j <= nT; j++) {
                const theta = 2 * Math.PI * j / nT;
                pts.push(
                    cx + this.radius * sp * Math.cos(theta),
                    cy + this.radius * cp,
                    cz + this.radius * sp * Math.sin(theta),
                );
            }
        }
        const polys = [];
        const rowLen = nT + 1;
        for (let i = 0; i < nP; i++) {
            for (let j = 0; j < nT; j++) {
                const a = i * rowLen + j, b = a + 1, c = a + rowLen, d = c + 1;
                polys.push([a, c, b]);
                polys.push([b, c, d]);
            }
        }
        const pd = new PolyData();
        pd.setPoints(Float32Array.from(pts));
        pd.polys = polys;
        return pd;
    }
}
