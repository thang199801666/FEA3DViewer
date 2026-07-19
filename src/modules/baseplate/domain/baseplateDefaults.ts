import type { BaseplateInputs } from "./baseplateTypes";

export const DEFAULT_BASEPLATE_INPUTS: BaseplateInputs = {
    plateWidth: 450,
    plateLength: 500,
    plateThickness: 25,
    columnWidth: 250,
    columnDepth: 250,
    concreteHeight: 220,
    axialForce: 850,
    shearX: 35,
    shearZ: 20,
    momentX: 45,
    momentY: 30,
    momentZ: 15,
    steelFy: 355,
    concreteFc: 30,
    boltRadius: 12,
    columnType: "i-section",
    boltPattern: "4-bolt",
};
