import type { BaseplateInputs } from "../domain/baseplateTypes";

export type BaseplateFEASummary = {
    maxDisplacement: number;
    maxEquivalentStress: number;
    maxEquivalentStrain: number;
};

const STEEL_E = 200_000; // MPa
const STEEL_NU = 0.3;
const MODEL_TO_MM = 100;

/**
 * Preliminary linear-elastic nodal solution for the base plate. The current
 * display mesh is used as the FE output mesh; stresses follow section
 * equilibrium and strains follow isotropic Hooke's law.
 */
export function solveBaseplateFEA(polyData: any, inputs: BaseplateInputs): BaseplateFEASummary {
    const points: ArrayLike<number> = polyData?.points ?? [];
    const count = Math.floor(points.length / 3);
    const u = new Float32Array(count * 3);
    const stress = new Float32Array(count * 6);
    const strain = new Float32Array(count * 6);

    const width = Math.max(inputs.plateWidth, 1);
    const length = Math.max(inputs.plateLength, 1);
    const thickness = Math.max(inputs.plateThickness, 1);
    const area = width * length;
    const ix = width * length ** 3 / 12;
    const iz = length * width ** 3 / 12;
    const polar = ix + iz;
    const shearModulus = STEEL_E / (2 * (1 + STEEL_NU));
    const plateFlexibility = 12 * (1 - STEEL_NU ** 2) / (STEEL_E * thickness ** 3);

    let maxDisplacement = 0;
    let maxEquivalentStress = 0;
    let maxEquivalentStrain = 0;

    for (let i = 0; i < count; i++) {
        const x = Number(points[i * 3]) * MODEL_TO_MM;
        const z = Number(points[i * 3 + 2]) * MODEL_TO_MM;
        const nx = x / (width / 2);
        const nz = z / (length / 2);

        // Force inputs are kN and moment inputs are kNm; output stress is MPa.
        const s22 = -inputs.axialForce * 1_000 / area
            - inputs.momentX * 1_000_000 * z / ix
            - inputs.momentZ * 1_000_000 * x / iz;
        const torsionX = -inputs.momentY * 1_000_000 * z / polar;
        const torsionZ = inputs.momentY * 1_000_000 * x / polar;
        const s12 = inputs.shearX * 1_000 / area + torsionX;
        const s23 = inputs.shearZ * 1_000 / area + torsionZ;
        const s11 = 0;
        const s33 = 0;
        const s13 = 0;

        const e11 = (s11 - STEEL_NU * (s22 + s33)) / STEEL_E;
        const e22 = (s22 - STEEL_NU * (s11 + s33)) / STEEL_E;
        const e33 = (s33 - STEEL_NU * (s11 + s22)) / STEEL_E;
        const e12 = s12 / (2 * shearModulus);
        const e23 = s23 / (2 * shearModulus);
        const e13 = s13 / (2 * shearModulus);

        // Nodal displacement in model units (1 model unit = 100 mm).
        const uxMm = inputs.shearX * 1_000 * thickness / (area * shearModulus) * (1 + 0.25 * nz);
        const uzMm = inputs.shearZ * 1_000 * thickness / (area * shearModulus) * (1 + 0.25 * nx);
        const bendingLoad = inputs.axialForce * 1_000 / area
            + inputs.momentX * 1_000_000 * z / ix
            + inputs.momentZ * 1_000_000 * x / iz;
        const uyMm = -bendingLoad * plateFlexibility
            * (width * length / 16) ** 2
            * Math.max(0, (1 - nx * nx) * (1 - nz * nz));

        u.set([uxMm / MODEL_TO_MM, uyMm / MODEL_TO_MM, uzMm / MODEL_TO_MM], i * 3);
        stress.set([s11, s22, s33, s12, s23, s13], i * 6);
        strain.set([e11, e22, e33, e12, e23, e13], i * 6);

        const uMagnitude = Math.hypot(uxMm, uyMm, uzMm);
        const mises = Math.sqrt(0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) + 3 * (s12 ** 2 + s23 ** 2 + s13 ** 2));
        const equivalentStrain = mises / STEEL_E;
        maxDisplacement = Math.max(maxDisplacement, uMagnitude);
        maxEquivalentStress = Math.max(maxEquivalentStress, mises);
        maxEquivalentStrain = Math.max(maxEquivalentStrain, equivalentStrain);
    }

    polyData.addPointDataArray("U", u, 3);
    polyData.addPointDataArray("S", stress, 6, { setActiveScalar: true });
    polyData.addPointDataArray("PE", strain, 6);
    return { maxDisplacement, maxEquivalentStress, maxEquivalentStrain };
}
