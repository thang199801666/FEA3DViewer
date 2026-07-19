import type { BaseplateInputs } from "../domain/baseplateTypes";
import type { BaseplateFEASummary } from "../analysis/solveBaseplateFEA";
import { FEAWriter } from "../../../threejsVTK/src";

type FEAArray = { components: number; values: number[] };

/** Creates the Baseplate data passed to the solver-neutral libfea WASM writer. */
export function createFEAFile(controller: any, inputs: BaseplateInputs, summary: BaseplateFEASummary) {
    let plate: any = null;
    controller?.scene?.traverse?.((object: any) => {
        if (object?.isActor && object.userData?.baseplateRole === "deformable-plate") plate = object;
    });
    const data = plate?.userData?.__undeformedInput ?? plate?.mapper?.input;
    if (!data) throw new Error("Base plate result mesh is not available.");

    const fields: Record<string, FEAArray> = {};
    for (const name of ["U", "S", "PE"]) {
        const array = data.pointData?.getArray?.(name);
        if (array) fields[name] = {
            components: array.numberOfComponents,
            values: Array.from(array.values as ArrayLike<number>),
        };
    }

    return {
        format: "FEA3DViewer Baseplate Results",
        version: 1,
        createdAt: new Date().toISOString(),
        units: { length: "mm", force: "kN", moment: "kNm", stress: "MPa", strain: "mm/mm" },
        analysis: { type: "linear-elastic-preliminary", material: { youngModulus: 200000, poissonRatio: 0.3 } },
        inputs,
        summary,
        mesh: {
            coordinateScaleToMm: 100,
            points: Array.from(data.points as ArrayLike<number>),
            polygons: {
                offsets: Array.from(data.polys?.getOffsetsArray?.() ?? []),
                connectivity: Array.from(data.polys?.getConnectivityArray?.() ?? []),
            },
        },
        pointData: fields,
    };
}

export async function downloadFEAFile(controller: any, inputs: BaseplateInputs, summary: BaseplateFEASummary, filename = "baseplate-results.fea") {
    const source = createFEAFile(controller, inputs, summary);
    const points = Float32Array.from(source.mesh.points);
    const offsets = Int32Array.from(source.mesh.polygons.offsets);
    const connectivity = Int32Array.from(source.mesh.polygons.connectivity);
    const cellTypes = new Uint8Array(Math.max(0, offsets.length - 1));
    for (let i = 0; i < cellTypes.length; i++) {
        const n = offsets[i + 1] - offsets[i];
        cellTypes[i] = n === 3 ? 5 : n === 4 ? 9 : 7; // VTK triangle, quad, polygon
    }
    const pointData = Object.fromEntries(Object.entries(source.pointData).map(([name, field]) =>
        [name, { components: field.components, values: Float32Array.from(field.values) }]));
    const buffer = await new FEAWriter().writeMesh({
        points, connectivity, offsets, cellTypes, pointData,
        metadata: { format: source.format, version: source.version, createdAt: source.createdAt, units: source.units, analysis: source.analysis, inputs, summary },
    });
    const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.fea3dviewer" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename.endsWith(".fea") ? filename : `${filename}.fea`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
