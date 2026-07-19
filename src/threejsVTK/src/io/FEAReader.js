import { UnstructuredGrid } from "../core/UnstructuredGrid.js";
import { DataArray } from "../core/FieldData.js";

const TYPE = { FLOAT32: 1, FLOAT64: 2, INT32: 3, UINT32: 4, UINT8: 5 };
const KIND = { POINTS: 1, CONNECTIVITY: 2, OFFSETS: 3, CELL_TYPES: 4, FIELD: 100 };
const ASSOCIATION = { POINT: 1, CELL: 2 };
const NONE = 0xffffffff;

class MetadataReader {
    constructor(bytes) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.bytes = bytes; this.pos = 0; }
    u8() { return this.view.getUint8(this.pos++); }
    u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
    f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
    string() { const n = this.u32(), v = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + n)); this.pos += n; return v; }
    strings() { return Array.from({ length: this.u32() }, () => this.string()); }
    metadata() { return Array.from({ length: this.u32() }, () => ({ key: this.string(), value: this.string() })); }
}

function parseDatabaseMetadata(bytes) {
    const r = new MetadataReader(bytes);
    const schema = r.u32();
    if (schema < 2 || schema > 4) throw new Error("FEAReader: unsupported database schema");
    const db = { title: r.string(), description: r.string(), sourceSolver: r.string(), sourceVersion: r.string(), metadata: r.metadata(), materials: [], sections: [], instances: [], steps: [] };
    if (schema >= 4) {
        for (let n = r.u32(); n--; ) {
            const material = { name: r.string(), description: r.string(), metadata: r.metadata(), properties: [] };
            for (let p = r.u32(); p--; ) material.properties.push({ name: r.string(), description: r.string(), columnLabels: r.strings(), metadata: r.metadata(), table: r.u32() });
            db.materials.push(material);
        }
        for (let n = r.u32(); n--; ) db.sections.push({ name: r.string(), category: r.string(), materialName: r.string(), thickness: r.f64(), metadata: r.metadata() });
    }
    for (let n = r.u32(); n--; ) {
        const instance = { name: r.string(), partName: r.string(), metadata: r.metadata(), sectionAssignments: [], nodeBlocks: [], elementBlocks: [], sets: [], surfaces: [] };
        if (schema >= 4) for (let a = r.u32(); a--; ) instance.sectionAssignments.push({ regionName: r.string(), sectionName: r.string(), offsetType: r.string(), offset: r.f64(), suppressed: r.u8() !== 0, metadata: r.metadata() });
        for (let b = r.u32(); b--; ) instance.nodeBlocks.push({ name: r.string(), labels: r.u32(), coordinates: r.u32() });
        for (let b = r.u32(); b--; ) instance.elementBlocks.push({ name: r.string(), elementType: r.string(), nodesPerElement: r.u32(), metadata: r.metadata(), labels: r.u32(), connectivity: r.u32(), offsets: r.u32() });
        for (let b = r.u32(); b--; ) instance.sets.push({ name: r.string(), kind: r.u8(), labels: r.u32() });
        for (let b = r.u32(); b--; ) instance.surfaces.push({ name: r.string(), elementLabels: r.u32(), faceIds: r.u32() });
        db.instances.push(instance);
    }
    for (let n = r.u32(); n--; ) {
        const step = { name: r.string(), description: r.string(), procedure: r.string(), domain: r.u8(), timePeriod: r.f64(), frames: [], historyRegions: [] };
        for (let f = r.u32(); f--; ) {
            const frame = { incrementNumber: r.u32(), value: r.f64(), description: r.string(), fields: [] };
            for (let o = r.u32(); o--; ) {
                const field = { name: r.string(), description: r.string(), position: r.u8(), componentLabels: r.strings(), validInvariants: r.strings(), blocks: [] };
                for (let b = r.u32(); b--; ) field.blocks.push({ instanceName: r.string(), regionName: r.string(), sectionPoint: r.string(), values: r.u32(), labels: r.u32(), integrationPoints: r.u32() });
                frame.fields.push(field);
            }
            step.frames.push(frame);
        }
        if (schema >= 3) for (let h = r.u32(); h--; ) {
            const region = { name: r.string(), description: r.string(), position: r.string(), outputs: [] };
            for (let o = r.u32(); o--; ) region.outputs.push({
                name: r.string(), description: r.string(), type: r.string(),
                componentLabels: r.strings(), frameValues: r.u32(), values: r.u32()
            });
            step.historyRegions.push(region);
        }
        db.steps.push(step);
    }
    return db;
}

function readCString(memory, ptr) {
    const bytes = new Uint8Array(memory.buffer);
    let end = ptr;
    while (end < bytes.length && bytes[end] !== 0) end++;
    return new TextDecoder().decode(bytes.subarray(ptr, end));
}

function copyArray(memory, ptr, length, type) {
    const source = memory.buffer;
    if (type === TYPE.FLOAT32) return new Float32Array(source.slice(ptr, ptr + length * 4));
    if (type === TYPE.FLOAT64) return new Float64Array(source.slice(ptr, ptr + length * 8));
    if (type === TYPE.INT32) return new Int32Array(source.slice(ptr, ptr + length * 4));
    if (type === TYPE.UINT32) return new Uint32Array(source.slice(ptr, ptr + length * 4));
    if (type === TYPE.UINT8) return new Uint8Array(source.slice(ptr, ptr + length));
    throw new Error(`FEAReader: unsupported scalar type ${type}`);
}

/** Reads FEA v1 with the same C++ parser used by native desktop tools. */
export class FEAReader {
    constructor({ wasmUrl = "/wasm/fea_reader.wasm", instance = 0, step = -1, frame = -1 } = {}) {
        this.wasmUrl = wasmUrl; this.instance = instance; this.step = step; this.frame = frame; this.database = null;
    }

    async parseFile(file) { return this.parse(await file.arrayBuffer()); }

    async parse(buffer) {
        if (!(buffer instanceof ArrayBuffer)) throw new TypeError("FEAReader.parse expects an ArrayBuffer");
        const response = await fetch(this.wasmUrl);
        if (!response.ok) throw new Error(`FEAReader: cannot load WASM (${response.status})`);
        const imports = { env: { emscripten_notify_memory_growth() {} } };
        const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), imports);
        const x = instance.exports;
        const ptr = x.malloc(buffer.byteLength);
        if (!ptr) throw new Error("FEAReader: WASM allocation failed");
        new Uint8Array(x.memory.buffer, ptr, buffer.byteLength).set(new Uint8Array(buffer));
        const ok = x.fea_open(ptr, buffer.byteLength);
        x.free(ptr);
        if (!ok) throw new Error(`FEAReader: ${readCString(x.memory, x.fea_last_error())}`);
        try {
            const grid = new UnstructuredGrid();
            const blocks = new Map(), arrays = [], flatFields = [];
            const count = x.fea_array_count();
            for (let i = 0; i < count; i++) {
                const kind = x.fea_array_kind(i), type = x.fea_array_type(i);
                const association = x.fea_array_association(i), components = x.fea_array_components(i);
                const name = readCString(x.memory, x.fea_array_name(i));
                const values = copyArray(x.memory, x.fea_array_data(i), x.fea_array_value_count(i), type);
                arrays.push({ kind, type, association, components, name, values });
                if (kind !== KIND.FIELD) blocks.set(kind, values);
                else flatFields.push({ name, values, components, association });
            }
            const metadataArray = arrays.find(a => a.kind === 1000);
            let points, connectivity, offsets, cellTypes;
            if (metadataArray) {
                this.database = parseDatabaseMetadata(metadataArray.values);
                const instance = this.database.instances[this.instance];
                if (!instance) throw new Error(`FEAReader: instance ${this.instance} does not exist`);
                const get = index => index === NONE ? null : arrays[index]?.values;
                const nodeArrays = instance.nodeBlocks.map(b => ({ labels: get(b.labels), coordinates: get(b.coordinates) }));
                points = Float32Array.from(nodeArrays.flatMap(b => Array.from(b.coordinates ?? [])));
                const nodeLabels = nodeArrays.flatMap(b => Array.from(b.labels ?? []));
                const elementLabels = [], conn = [], offs = [0], types = [];
                const abaqusToVtk = { C3D4: 10, C3D10: 24, C3D8: 12, C3D8R: 12, C3D20: 25, C3D20R: 25, C3D6: 13, C3D15: 26, S3: 5, S4: 9, S4R: 9 };
                for (const block of instance.elementBlocks) {
                    const blockConn = get(block.connectivity) ?? [], blockOffsets = get(block.offsets), labels = get(block.labels) ?? [];
                    elementLabels.push(...labels);
                    if (blockOffsets) {
                        for (let e = 0; e + 1 < blockOffsets.length; e++) {
                            conn.push(...blockConn.slice(blockOffsets[e], blockOffsets[e + 1])); offs.push(conn.length); types.push(abaqusToVtk[block.elementType] ?? 0);
                        }
                    } else {
                        for (let start = 0; start < blockConn.length; start += block.nodesPerElement) {
                            conn.push(...blockConn.slice(start, start + block.nodesPerElement)); offs.push(conn.length); types.push(abaqusToVtk[block.elementType] ?? 0);
                        }
                    }
                }
                connectivity = Int32Array.from(conn); offsets = Int32Array.from(offs); cellTypes = Uint8Array.from(types);
                const stepIndex = this.step < 0 ? this.database.steps.length - 1 : this.step;
                const step = this.database.steps[stepIndex], frameIndex = this.frame < 0 ? (step?.frames.length ?? 0) - 1 : this.frame;
                for (const field of step?.frames[frameIndex]?.fields ?? []) {
                    const fieldBlocks = field.blocks.filter(b => b.instanceName === instance.name && b.values !== NONE);
                    if (!fieldBlocks.length || (field.position !== 1 && field.position !== 4)) continue;
                    const targetLabels = field.position === 1 ? nodeLabels : elementLabels;
                    const labelToIndex = new Map(targetLabels.map((label, index) => [label, index]));
                    const components = arrays[fieldBlocks[0].values].components, values = new Float32Array(targetLabels.length * components); values.fill(Number.NaN);
                    for (const block of fieldBlocks) {
                        const raw = arrays[block.values], labels = get(block.labels);
                        if (!labels && raw.values.length === values.length) values.set(raw.values);
                        else for (let tuple = 0; tuple < (labels?.length ?? 0); tuple++) {
                            const target = labelToIndex.get(labels[tuple]); if (target === undefined) continue;
                            for (let c = 0; c < components; c++) values[target * components + c] = raw.values[tuple * components + c];
                        }
                    }
                    const data = new DataArray(field.name, values, components);
                    if (field.position === 1) grid.pointData.addArray(data); else grid.cellData.addArray(data);
                }
                grid.userData ??= {};
                grid.userData.feaDatabase = this.database;
            } else {
                points = blocks.get(KIND.POINTS); connectivity = blocks.get(KIND.CONNECTIVITY);
                offsets = blocks.get(KIND.OFFSETS); cellTypes = blocks.get(KIND.CELL_TYPES);
                for (const field of flatFields) {
                    const data = new DataArray(field.name, field.values, field.components);
                    if (field.association === ASSOCIATION.POINT) grid.pointData.addArray(data);
                    else if (field.association === ASSOCIATION.CELL) grid.cellData.addArray(data);
                }
            }
            if (!points || !connectivity || !offsets || !cellTypes) throw new Error("FEAReader: required mesh arrays are missing");
            if (points.length % 3 !== 0 || offsets.length !== cellTypes.length + 1 || offsets[0] !== 0 || offsets[offsets.length - 1] !== connectivity.length)
                throw new Error("FEAReader: inconsistent mesh array sizes");
            grid.setPoints(points instanceof Float32Array ? points : Float32Array.from(points));
            grid.setCells(Int32Array.from(connectivity), Int32Array.from(offsets), Uint8Array.from(cellTypes));
            return grid;
        } finally { x.fea_close(); }
    }
}
