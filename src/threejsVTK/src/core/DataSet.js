// Core/DataSet.js

import { DataObject } from "./DataObject.js";
import { PointData, CellData } from "./FieldData.js";

export class DataSet extends DataObject {
    constructor() {
        super();
        this.points = new Float32Array(0);
        this.pointData = new PointData();
        this.cellData = new CellData();
    }

    setPoints(flatArray) {
        this.points = flatArray instanceof Float32Array ? flatArray : Float32Array.from(flatArray);
        this.modified();
        return this;
    }

    getPoints() {
        return this.points;
    }

    getNumberOfPoints() {
        return this.points.length / 3;
    }

    getPoint(i, out = [0, 0, 0]) {
        out[0] = this.points[i * 3];
        out[1] = this.points[i * 3 + 1];
        out[2] = this.points[i * 3 + 2];
        return out;
    }

    getNumberOfCells() {
        return 0;
    }

    getBounds() {
        const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        const p = this.points;
        for (let i = 0; i < p.length; i += 3) {
            if (p[i]     < b[0]) b[0] = p[i];
            if (p[i + 1] < b[1]) b[1] = p[i + 1];
            if (p[i + 2] < b[2]) b[2] = p[i + 2];
            if (p[i]     > b[3]) b[3] = p[i];
            if (p[i + 1] > b[4]) b[4] = p[i + 1];
            if (p[i + 2] > b[5]) b[5] = p[i + 2];
        }
        if (!Number.isFinite(b[0])) return [0, 0, 0, 0, 0, 0];
        return b;
    }

    getCenter() {
        const b = this.getBounds();
        return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    }

    getLength() {
        const b = this.getBounds();
        return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    }
}




























// // Core/DataSet.js

// import { DataObject } from "./DataObject.js";
// import { PointData, CellData } from "./FieldData.js";

// export class DataSet extends DataObject {
//     constructor() {
//         super();
//         this.points = new Float32Array(0);
//         this.pointData = new PointData();
//         this.cellData = new CellData();
//     }

//     setPoints(flatArray) {
//         this.points = flatArray instanceof Float32Array ? flatArray : Float32Array.from(flatArray);
//         this.modified();
//         return this;
//     }

//     getNumberOfPoints() {
//         return this.points.length / 3;
//     }

//     getPoint(i, out = [0, 0, 0]) {
//         out[0] = this.points[i * 3];
//         out[1] = this.points[i * 3 + 1];
//         out[2] = this.points[i * 3 + 2];
//         return out;
//     }

//     getNumberOfCells() {
//         return 0;
//     }

//     getBounds() {
//         const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
//         const p = this.points;
//         for (let i = 0; i < p.length; i += 3) {
//             if (p[i]     < b[0]) b[0] = p[i];
//             if (p[i + 1] < b[1]) b[1] = p[i + 1];
//             if (p[i + 2] < b[2]) b[2] = p[i + 2];
//             if (p[i]     > b[3]) b[3] = p[i];
//             if (p[i + 1] > b[4]) b[4] = p[i + 1];
//             if (p[i + 2] > b[5]) b[5] = p[i + 2];
//         }
//         if (!Number.isFinite(b[0])) return [0, 0, 0, 0, 0, 0];
//         return b;
//     }

//     getCenter() {
//         const b = this.getBounds();
//         return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
//     }

//     getLength() {
//         const b = this.getBounds();
//         return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
//     }
// }