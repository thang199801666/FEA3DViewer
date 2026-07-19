import type { BaseplateChecks, BaseplateInputs } from "../domain/baseplateTypes";

/**
 * Fast component-level screening checks used while editing the model.
 * These are intentionally separate from the future nonlinear FEA solver.
 */
export function calculatePreliminaryChecks(inputs: BaseplateInputs): BaseplateChecks {
    const area = Math.max(inputs.plateWidth * inputs.plateLength, 1);
    const bearing = inputs.axialForce * 1000 / area;
    const bearingCapacity = 0.6 * inputs.concreteFc;
    const projection = Math.max(
        (inputs.plateWidth - inputs.columnWidth) / 2,
        (inputs.plateLength - inputs.columnDepth) / 2,
        0,
    );
    const bendingDemand = bearing * projection ** 2 / 2;
    const bendingCapacity = inputs.steelFy * inputs.plateThickness ** 2 / 6;
    const resultantShear = Math.hypot(inputs.shearX, inputs.shearZ);
    const boltCount = Number.parseInt(inputs.boltPattern, 10);
    const totalAnchorArea = boltCount * Math.PI * inputs.boltRadius ** 2;
    const anchorCapacity = totalAnchorArea * 0.6 * inputs.steelFy / 1000;

    return {
        bearing,
        bearingUtil: bearing / Math.max(bearingCapacity, 0.001),
        plateUtil: bendingDemand / Math.max(bendingCapacity, 0.001),
        anchorUtil: resultantShear / Math.max(anchorCapacity, 0.001),
    };
}
