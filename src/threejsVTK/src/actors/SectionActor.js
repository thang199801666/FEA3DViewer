import * as THREE from "three";
import { makeContourMaterial } from "../rendering/materials/ContourShaderMaterial.js";
import { makeHatchMaterial } from "../rendering/materials/HatchMaterial.js";
import { ContourFilter } from "../filters/ContourFilter.js";

export class SectionActor extends THREE.Group {
    constructor(capPolyData, options = {}) {
        super();
        this.isActor = true;
        this.name = options.name ?? "Section";
        this.mode = options.mode ?? "surface";
        this.options = {
            color: 0xb0bec5,
            lookupTable: null,
            range: null,
            scalarName: null,
            numBands: 12,
            isolines: true,
            hatch: {},
            ...options,
        };
        this._capData = capPolyData;
        this._mesh = null;
        this._isoLines = null;
        this._geo = this._buildGeometry(capPolyData);

        this.setMode(this.mode);
    }

    _buildGeometry(pd) {
        if (!pd || !pd.points || !pd.polys) return new THREE.BufferGeometry();
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(pd.points), 3));
        const idx = [];
        for (const p of pd.polys) {
            if (p.length === 3) idx.push(p[0], p[1], p[2]);
            else if (p.length === 4) idx.push(p[0], p[1], p[2], p[0], p[2], p[3]);
            else {
                for (let i = 1; i < p.length - 1; i++) idx.push(p[0], p[i], p[i + 1]);
            }
        }
        geo.setIndex(idx);
        if (pd.pointData && pd.pointData.getScalars()) {
            const arrName = this.options.scalarName;
            const scalars = arrName ? pd.pointData.getArray(arrName) : pd.pointData.getScalars();
            if (scalars) {
                const raw = scalars.values ?? scalars.array ?? [];
                const sArr = ArrayBuffer.isView(raw) ? raw : Array.from(raw);
                geo.setAttribute("aScalar", new THREE.BufferAttribute(Float32Array.from(sArr), 1));
            }
        }
        geo.computeVertexNormals();
        return geo;
    }

    setMode(mode) {
        this.mode = mode;
        if (this._mesh) { this.remove(this._mesh); this._mesh = null; }
        if (this._isoLines) { this.remove(this._isoLines); this._isoLines = null; }

        if (!this._capData || !this._capData.points.length) return this;

        let material;
        if (mode === "contour" && this.options.lookupTable) {
            const scalars = this.options.scalarName
                ? this._capData.pointData?.getArray(this.options.scalarName)
                : this._capData.pointData?.getScalars();
            const range = this.options.range ?? (scalars ? scalars.getRange() : [0, 1]);
            const contour = makeContourMaterial(this.options.lookupTable, {
                lookupTable: this.options.lookupTable,
                range: range,
                numBands: this.options.numBands,
                showIsolines: this.options.isolines,
            });
            if (scalars) contour.attachScalar(this._geo, scalars, range);
            material = contour.material;
            if (this.options.isolines) {
                this._addIsolines(range);
            }
        } else if (mode === "hatch") {
            material = makeHatchMaterial(this.options.hatch);
        } else {
            material = new THREE.MeshStandardMaterial({
                color: this.options.color,
                side: THREE.DoubleSide,
                flatShading: true,
                roughness: 0.6,
                metalness: 0.1,
            });
        }

        const mesh = new THREE.Mesh(this._geo, material);
        mesh.name = `${this.name}_${mode}`;
        this._mesh = mesh;
        this.add(mesh);
        return this;
    }

    _addIsolines(range) {
        const iso = new ContourFilter().setInputData(this._capData);
        iso.generateValues(this.options.numBands, range);
        const line = iso.getOutputData();
        if (!line.lines.length) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(line.points), 3));
        const seg = [];
        for (const l of line.lines) {
            for (let i = 0; i + 1 < l.length; i++) {
                seg.push(l[i], l[i + 1]);
            }
        }
        geo.setIndex(seg);
        const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 });
        this._isoLines = new THREE.LineSegments(geo, mat);
        this._isoLines.renderOrder = 1;
        this.add(this._isoLines);
    }

    dispose() {
        if (this._geo) this._geo.dispose();
        if (this._mesh) {
            if (this._mesh.material) this._mesh.material.dispose();
            this.remove(this._mesh);
        }
        if (this._isoLines) {
            if (this._isoLines.geometry) this._isoLines.geometry.dispose();
            if (this._isoLines.material) this._isoLines.material.dispose();
            this.remove(this._isoLines);
        }
    }
}
