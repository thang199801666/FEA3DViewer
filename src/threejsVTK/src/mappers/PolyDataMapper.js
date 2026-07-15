import * as THREE from "three";
import { LookupTable } from "../color/LookupTable.js";

/**
 * Simulates vtkPolyDataMapper. 
 * Maps PolyData into a THREE.BufferGeometry with proper scalar and color handling.
 */
export class PolyDataMapper {
    constructor() {
        this.isPolyDataMapper = true;
        this.input = null;
        this.lookupTable = null;
        this.scalarVisibility = true;   
        this.scalarRange = null;        // null triggers auto-computing based on min/max values
        this.colorArrayName = null;     // null defaults to active scalars
        this.colorComponent = 0;        // -1 represents magnitude for vectors

        // Interpolates scalars before color mapping (similar to vtkMapper::InterpolateScalarsBeforeMapping)
        // true  -> Sharp contour bands (Abaqus style), samples the LUT per pixel using a texture.
        // false -> Interpolates RGB colors at vertices, resulting in smooth/blurred color transitions.
        this.interpolateScalarsBeforeMapping = false;
        this.colorTextureLinear = false; // false = NearestFilter (sharp bands), true = LinearFilter (smooth transitions)
        this.colorTexture = null;        // THREE.DataTexture built from the LookupTable
    }

    setInputData(polyData) { 
        this.input = polyData; 
        return this; 
    }
    
    setLookupTable(lut) { 
        this.lookupTable = lut; 
        return this; 
    }
    
    setScalarVisibility(v) { 
        this.scalarVisibility = !!v; 
        return this; 
    }
    
    setScalarRange(min, max) { 
        this.scalarRange = [min, max]; 
        return this; 
    }

    /** Sets the data array by name and component index. Use -1 for magnitude. */
    setColorBy(arrayName, component = 0) {
        this.colorArrayName = arrayName;
        this.colorComponent = component;
        return this;
    }

    setInterpolateScalarsBeforeMapping(v) { 
        this.interpolateScalarsBeforeMapping = !!v; 
        return this; 
    }
    
    getInterpolateScalarsBeforeMapping() { 
        return this.interpolateScalarsBeforeMapping; 
    }

    setColorTextureLinear(v) { 
        this.colorTextureLinear = !!v; 
        return this; 
    }

    /** Returns the 1D color texture to be applied as material.map by the Actor. */
    getColorTexture() { 
        return this.colorTexture; 
    }

    getLookupTable() {
        if (!this.lookupTable) this.lookupTable = new LookupTable();
        return this.lookupTable;
    }

    _resolveScalars() {
        if (!this.input) return null;
        const pdta = this.input.pointData;
        return this.colorArrayName ? pdta.getArray(this.colorArrayName) : pdta.getScalars();
    }

    /** Active scalar range used for mapping and rendering components like the ScalarBar. */
    getEffectiveScalarRange() {
        if (this.scalarRange) return this.scalarRange;
        const s = this._resolveScalars();
        return s ? s.getRange(this.colorComponent) : [0, 1];
    }

    /**
     * Rebuilds and returns a new THREE.BufferGeometry from the current input data.
     * Ensure to dispose of the old geometry when calling this method on data updates.
     */
    buildGeometry() {
        if (!this.input) throw new Error("PolyDataMapper: input data is not set. Call setInputData first.");
        const pd = this.input;

        const geometry = new THREE.BufferGeometry();
        const hasSurface = pd.hasSurface();
        const hasLines = !hasSurface && pd.lines && pd.lines.length > 0;
        const hasVerts = !hasSurface && !hasLines && pd.verts && pd.verts.length > 0;
        let pointIds = null;
        let tris = [];

        if (hasSurface) {
            geometry.setAttribute("position", new THREE.BufferAttribute(pd.points, 3));
            tris = pd.getTriangles();
            if (tris.length > 0) geometry.setIndex(tris);
            geometry.userData.primitiveType = "surface";
        } else if (hasLines) {
            const built = this._buildLinePositions(pd);
            geometry.setAttribute("position", new THREE.BufferAttribute(built.positions, 3));
            pointIds = built.pointIds;
            geometry.userData.primitiveType = "line";
            geometry.userData.isLine = true;
        } else if (hasVerts) {
            const built = this._buildPointPositions(pd);
            geometry.setAttribute("position", new THREE.BufferAttribute(built.positions, 3));
            pointIds = built.pointIds;
            geometry.userData.primitiveType = "point";
            geometry.userData.isPoint = true;
        } else {
            geometry.setAttribute("position", new THREE.BufferAttribute(pd.points, 3));
            geometry.userData.primitiveType = "point";
            geometry.userData.isPoint = true;
        }

        const scalars = this.scalarVisibility ? this._resolveScalars() : null;
        if (scalars && scalars.getNumberOfTuples() === pd.getNumberOfPoints()) {
            const lut = this.getLookupTable();
            const [mn, mx] = this.getEffectiveScalarRange();
            lut.setRange(mn, mx);

            if (this.interpolateScalarsBeforeMapping && hasSurface) {
                // Per-vertex texture coordinates mapping: u = normalized scalar [0..1]
                // The GPU interpolates 'u' across the fragment, creating sharp color bands.
                const uv = this._buildTexCoords(scalars, mn, mx, pointIds);
                geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
                this._buildColorTexture(lut);
            } else {
                // Standard behavior: colors map at the vertex level, GPU performs linear RGB blending.
                const colors = pointIds
                    ? this._mapDuplicatedScalars(lut, scalars, pointIds)
                    : lut.mapScalars(scalars, this.colorComponent);
                geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            }
        }

        if (tris.length > 0) geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    _buildLinePositions(pd) {
        let segments = 0;
        for (const line of pd.lines) segments += Math.max(0, line.length - 1);

        const positions = new Float32Array(segments * 2 * 3);
        const pointIds = new Int32Array(segments * 2);
        let pw = 0, iw = 0;
        const pts = pd.points;

        for (const line of pd.lines) {
            for (let i = 0; i + 1 < line.length; i++) {
                const a = line[i], b = line[i + 1];
                pointIds[iw++] = a;
                pointIds[iw++] = b;
                positions[pw++] = pts[a * 3];
                positions[pw++] = pts[a * 3 + 1];
                positions[pw++] = pts[a * 3 + 2];
                positions[pw++] = pts[b * 3];
                positions[pw++] = pts[b * 3 + 1];
                positions[pw++] = pts[b * 3 + 2];
            }
        }

        return { positions, pointIds };
    }

    _buildPointPositions(pd) {
        let n = 0;
        for (const vert of pd.verts) n += vert.length;

        const positions = new Float32Array(n * 3);
        const pointIds = new Int32Array(n);
        let pw = 0, iw = 0;
        const pts = pd.points;

        for (const vert of pd.verts) {
            for (let i = 0; i < vert.length; i++) {
                const id = vert[i];
                pointIds[iw++] = id;
                positions[pw++] = pts[id * 3];
                positions[pw++] = pts[id * 3 + 1];
                positions[pw++] = pts[id * 3 + 2];
            }
        }

        return { positions, pointIds };
    }

    _mapDuplicatedScalars(lut, scalars, pointIds) {
        const colors = new Float32Array(pointIds.length * 3);
        const tmp = [0, 0, 0];
        let w = 0;
        for (let i = 0; i < pointIds.length; i++) {
            const id = pointIds[i];
            const v = this.colorComponent === -1
                ? scalars.getMagnitude(id)
                : scalars.getComponent(id, this.colorComponent);
            lut.getColor(v, tmp);
            colors[w++] = tmp[0];
            colors[w++] = tmp[1];
            colors[w++] = tmp[2];
        }
        return colors;
    }

    _buildTexCoords(scalars, mn, mx, pointIds = null) {
        const n = pointIds ? pointIds.length : scalars.getNumberOfTuples();
        const uv = new Float32Array(n * 2);
        const span = mx - mn;
        
        for (let i = 0; i < n; i++) {
            const id = pointIds ? pointIds[i] : i;
            const v = this.colorComponent === -1
                ? scalars.getMagnitude(id)
                : scalars.getComponent(id, this.colorComponent);
                
            let t = span === 0 ? 0.5 : (v - mn) / span;
            if (Number.isNaN(t)) t = 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            
            uv[i * 2] = t;
            uv[i * 2 + 1] = 0.5;
        }
        return uv;
    }

    /** Generates a 1D (N x 1) THREE.DataTexture representation of the LookupTable. */
    _buildColorTexture(lut) {
        const data = lut.getUint8Table(); // Expects Uint8Array(N*4) RGBA
        const n = lut.numberOfColors;
        if (this.colorTexture) this.colorTexture.dispose();

        const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
        const filter = this.colorTextureLinear ? THREE.LinearFilter : THREE.NearestFilter;
        
        tex.minFilter = filter;
        tex.magFilter = filter; 
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;

        // Keep color mapping linear to prevent shifting issues when switching modes
        if (THREE.NoColorSpace !== undefined) tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;

        this.colorTexture = tex;
        return tex;
    }

    dispose() {
        if (this.colorTexture) { 
            this.colorTexture.dispose(); 
            this.colorTexture = null; 
        }
    }
}
