import { CellArray } from "../core/CellArray.js";
import { DataArray } from "../core/FieldData.js";
import { PolyData } from "../core/PolyData.js";
import { UnstructuredGrid } from "../core/UnstructuredGrid.js";

function serializeFieldData(field) {
    return {
        activeScalars: field.activeScalars,
        activeVectors: field.activeVectors,
        arrays: Array.from(field.arrays.values(), (array) => ({
            name: array.name,
            values: array.values,
            numberOfComponents: array.numberOfComponents,
        })),
    };
}

function deserializeFieldData(serialized, target) {
    for (const array of serialized?.arrays ?? []) {
        target.addArray(new DataArray(array.name, array.values, array.numberOfComponents), {
            asScalars: serialized.activeScalars === array.name,
            asVectors: serialized.activeVectors === array.name,
        });
    }
}

function serializeCellArray(cells) {
    return { offsets: cells.offsets, connectivity: cells.connectivity };
}

function deserializeCellArray(cells) {
    return CellArray.fromOffsetsConnectivity(cells.offsets, cells.connectivity);
}

function serializeUserData(userData = {}) {
    const out = {};
    for (const [key, value] of Object.entries(userData)) {
        if (value instanceof CellArray) out[key] = { __cellArray: true, ...serializeCellArray(value) };
        else out[key] = value;
    }
    return out;
}

function deserializeUserData(userData = {}) {
    const out = {};
    for (const [key, value] of Object.entries(userData)) {
        out[key] = value?.__cellArray ? deserializeCellArray(value) : value;
    }
    return out;
}

export function serializeDataSet(dataSet) {
    const common = {
        points: dataSet.points,
        pointData: serializeFieldData(dataSet.pointData),
        cellData: serializeFieldData(dataSet.cellData),
        metadata: Array.from(dataSet.metadata?.entries?.() ?? []),
        userData: serializeUserData(dataSet.userData),
    };
    if (dataSet instanceof UnstructuredGrid) {
        return {
            kind: "UnstructuredGrid",
            ...common,
            connectivity: dataSet.connectivity,
            offsets: dataSet.offsets,
            cellTypes: dataSet.cellTypes,
        };
    }
    if (dataSet instanceof PolyData) {
        return {
            kind: "PolyData",
            ...common,
            verts: serializeCellArray(dataSet.verts),
            lines: serializeCellArray(dataSet.lines),
            polys: serializeCellArray(dataSet.polys),
            strips: serializeCellArray(dataSet.strips),
        };
    }
    throw new TypeError(`Cannot transfer dataset type: ${dataSet?.constructor?.name}`);
}

export function deserializeDataSet(serialized) {
    const out = serialized.kind === "UnstructuredGrid" ? new UnstructuredGrid() : new PolyData();
    out.setPoints(serialized.points);
    if (out instanceof UnstructuredGrid) {
        out.setCells(serialized.connectivity, serialized.offsets, serialized.cellTypes);
    } else {
        out.setVerts(deserializeCellArray(serialized.verts));
        out.setLines(deserializeCellArray(serialized.lines));
        out.setPolys(deserializeCellArray(serialized.polys));
        out.setStrips(deserializeCellArray(serialized.strips));
    }
    deserializeFieldData(serialized.pointData, out.pointData);
    deserializeFieldData(serialized.cellData, out.cellData);
    out.metadata = new Map(serialized.metadata ?? []);
    out.userData = deserializeUserData(serialized.userData);
    return out;
}

export function collectTransferables(value, output = [], seen = new Set()) {
    if (!value || typeof value !== "object") return output;
    if (ArrayBuffer.isView(value)) {
        if (!seen.has(value.buffer)) { seen.add(value.buffer); output.push(value.buffer); }
        return output;
    }
    if (value instanceof ArrayBuffer) {
        if (!seen.has(value)) { seen.add(value); output.push(value); }
        return output;
    }
    for (const child of Object.values(value)) collectTransferables(child, output, seen);
    return output;
}
