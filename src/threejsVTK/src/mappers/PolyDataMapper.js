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
        geometry.setAttribute("position", new THREE.BufferAttribute(pd.points, 3));

        const tris = pd.getTriangles();
        if (tris.length > 0) geometry.setIndex(tris);

        const scalars = this.scalarVisibility ? this._resolveScalars() : null;
        if (scalars && scalars.getNumberOfTuples() === pd.getNumberOfPoints()) {
            const lut = this.getLookupTable();
            const [mn, mx] = this.getEffectiveScalarRange();
            lut.setRange(mn, mx);

            if (this.interpolateScalarsBeforeMapping) {
                // Per-vertex texture coordinates mapping: u = normalized scalar [0..1]
                // The GPU interpolates 'u' across the fragment, creating sharp color bands.
                const uv = this._buildTexCoords(scalars, mn, mx);
                geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
                this._buildColorTexture(lut);
            } else {
                // Standard behavior: colors map at the vertex level, GPU performs linear RGB blending.
                const colors = lut.mapScalars(scalars, this.colorComponent);
                geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            }
        }

        if (tris.length > 0) geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        return geometry;
    }

    _buildTexCoords(scalars, mn, mx) {
        const n = scalars.getNumberOfTuples();
        const uv = new Float32Array(n * 2);
        const span = mx - mn;
        
        for (let i = 0; i < n; i++) {
            const v = this.colorComponent === -1
                ? scalars.getMagnitude(i)
                : scalars.getComponent(i, this.colorComponent);
                
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