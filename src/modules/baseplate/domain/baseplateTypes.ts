export type ColumnType = "i-section" | "rhs" | "rectangular";
export type BoltPattern = "4-bolt" | "6-bolt" | "8-bolt";

export type BaseplateInputs = {
    plateWidth: number;
    plateLength: number;
    plateThickness: number;
    columnWidth: number;
    columnDepth: number;
    concreteHeight: number;
    axialForce: number;
    shearX: number;
    shearZ: number;
    momentX: number;
    momentY: number;
    momentZ: number;
    steelFy: number;
    concreteFc: number;
    boltRadius: number;
    columnType: ColumnType;
    boltPattern: BoltPattern;
};

export type BaseplateChecks = {
    bearing: number;
    bearingUtil: number;
    plateUtil: number;
    anchorUtil: number;
};
