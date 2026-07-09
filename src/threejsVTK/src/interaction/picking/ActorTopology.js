// Interaction/Picking/ActorTopology.js

const REQUIRED = [
    "triRaw", "tri", "wpos", "triCount", "wcount", "bbox", "diag",
    "cellTris", "surfaces", "corners", "chains", "weldedToCorner",
    "cellOf", "surfaceOf", "nodeOf", "chainOf",
    "trianglesOfCell", "trianglesOfSurface",
    "cornerOf", "nodePosition", "weldedPosition", "triCentroid", "queryVerts",
];

export class ActorTopology {
    /**
     * Retrieves the structural topology cache instance mapping to a given actor mesh.
     * @param {THREE.Object3D} _actor 
     */
    static get(_actor) {
        throw new Error(
            "ActorTopology is not implemented yet. Please restore the implementation file.\n" +
            "Sub-entity topological picking (CELL / SURFACE / NODE) remains inactive until provided.\n" +
            "Command suggestion: git log --all --diff-filter=D -- '**/ActorTopology.js'\n" +
            `Required API interface members (${REQUIRED.length}): ${REQUIRED.join(", ")}`
        );
    }
    static get REQUIRED_INTERFACE() { return [...REQUIRED]; }
}

export default ActorTopology;