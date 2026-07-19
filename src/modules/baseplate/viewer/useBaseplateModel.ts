import { useEffect, useRef } from "react";
import { ExtrudedProfileSource, HexBoltSource, LoadArrowActor, MomentArrowActor, PerforatedPlateSource } from "../../../threejsVTK";
import type { BaseplateInputs } from "../domain/baseplateTypes";
import { solveBaseplateFEA, type BaseplateFEASummary } from "../analysis/solveBaseplateFEA";

const MODEL_SCALE = 1 / 100;
const LOAD_SYMBOL_CLEARANCE = 0.8;
const MODEL_COLORS = { concrete: 0xb9bec6, plate: 0x3f78a8, column: 0x8895a7, bolt: 0x4b5563 };

function actorStyle(color: number) {
    return {
        color,
        solidColor: color,
        showScalar: false,
        displayMode: "modelWithEdges",
        featureEdgeColor: 0x1f2933,
        featureEdgeThickness: 1,
        roughness: 0.55,
        metalness: 0.05,
    };
}

export function useBaseplateModel(controller: any, inputs: BaseplateInputs, showContour: boolean, onResults?: (results: BaseplateFEASummary | null) => void) {
    const actorsRef = useRef<any[]>([]);

    useEffect(() => {
        if (!controller) return;

        actorsRef.current.forEach((actor) => actor?.removeFromParent?.());
        const concreteHeight = inputs.concreteHeight * MODEL_SCALE;
        const plateThickness = inputs.plateThickness * MODEL_SCALE;
        const loadOrigin: [number, number, number] = [0, concreteHeight + plateThickness + 3.2 + LOAD_SYMBOL_CLEARANCE, 0];
        const columnHeight = 3.2;
        const columnWidth = inputs.columnWidth * MODEL_SCALE;
        const columnDepth = inputs.columnDepth * MODEL_SCALE;
        const columnCenterY = concreteHeight + plateThickness + columnHeight / 2;
        const boltCount = Number.parseInt(inputs.boltPattern, 10);
        const boltRows = boltCount / 2;
        const boltRadius = Math.max(inputs.boltRadius * MODEL_SCALE, 0.04);
        const holeRadius = boltRadius + Math.max(0.02, boltRadius * 0.12);
        const boltXPositions = [-inputs.plateWidth * MODEL_SCALE * 0.36, inputs.plateWidth * MODEL_SCALE * 0.36];
        const boltZExtent = inputs.plateLength * MODEL_SCALE * 0.36;
        const boltCenters: Array<{ x: number; z: number }> = [];
        for (let row = 0; row < boltRows; row++) {
            const z = boltRows === 1 ? 0 : -boltZExtent + 2 * boltZExtent * row / (boltRows - 1);
            boltXPositions.forEach((x) => boltCenters.push({ x, z }));
        }
        const rigidActors: any[] = [];
        const loadArrows = [
            new LoadArrowActor({ origin: loadOrigin, direction: [Math.sign(inputs.shearX) || 1, 0, 0], color: 0xff0000, loadKey: "Vx" }),
            new LoadArrowActor({ origin: loadOrigin, direction: [0, Math.sign(inputs.axialForce) || 1, 0], color: 0x00cc00, loadKey: "Py" }),
            new LoadArrowActor({ origin: loadOrigin, direction: [0, 0, Math.sign(inputs.shearZ) || 1], color: 0x0066ff, loadKey: "Vz" }),
            // Separate quarter-circle sectors keep the three projected arcs
            // clear around the shared physical center in the default ISO view.
            new MomentArrowActor({ origin: loadOrigin, axis: [1, 0, 0], radius: 0.56, startAngle: Math.PI * 0.25, direction: inputs.momentX, color: 0xff0000, loadKey: "Mx" }),
            new MomentArrowActor({ origin: loadOrigin, axis: [0, 1, 0], radius: 0.48, startAngle: 0, direction: inputs.momentY, color: 0x00cc00, loadKey: "My" }),
            new MomentArrowActor({ origin: loadOrigin, axis: [0, 0, 1], radius: 0.41, startAngle: Math.PI * 0.5, direction: inputs.momentZ, color: 0x0066ff, loadKey: "Mz" }),
        ];
        loadArrows.forEach((arrow) => controller.scene.add(arrow));
        const concrete = controller.addBoxActor(
            inputs.plateWidth * 1.45 * MODEL_SCALE,
            concreteHeight,
            inputs.plateLength * 1.45 * MODEL_SCALE,
            { ...actorStyle(MODEL_COLORS.concrete), position: { x: 0, y: concreteHeight / 2, z: 0 } },
        );
        const plateData = new PerforatedPlateSource({
            width: inputs.plateWidth * MODEL_SCALE,
            length: inputs.plateLength * MODEL_SCALE,
            thickness: plateThickness,
            holes: boltCenters.map((center) => ({ ...center, radius: holeRadius })),
            center: [0, concreteHeight + plateThickness / 2, 0],
        }).getOutputDataWithScalars("stress");
        plateData.pointData.removeArray("stress");
        plateData.pointData.activeScalars = null;
        onResults?.(showContour ? solveBaseplateFEA(plateData, inputs) : null);
        const plate = controller.addPolyDataActor(plateData, "BasePlate", actorStyle(MODEL_COLORS.plate));

        let outerProfile: number[][];
        let profileHoles: number[][][] = [];
        if (inputs.columnType === "i-section") {
            const flangeThickness = Math.max(columnDepth * 0.1, 0.12);
            const webThickness = Math.max(columnWidth * 0.08, 0.1);
            const x = columnWidth / 2;
            const z = columnDepth / 2;
            const wx = webThickness / 2;
            outerProfile = [
                [-x, -z], [x, -z], [x, -z + flangeThickness], [wx, -z + flangeThickness],
                [wx, z - flangeThickness], [x, z - flangeThickness], [x, z], [-x, z],
                [-x, z - flangeThickness], [-wx, z - flangeThickness], [-wx, -z + flangeThickness], [-x, -z + flangeThickness],
            ];
        } else if (inputs.columnType === "rhs") {
            const wall = Math.max(Math.min(columnWidth, columnDepth) * 0.08, 0.1);
            const x = columnWidth / 2;
            const z = columnDepth / 2;
            outerProfile = [[-x, -z], [x, -z], [x, z], [-x, z]];
            profileHoles = [[[-x + wall, -z + wall], [-x + wall, z - wall], [x - wall, z - wall], [x - wall, -z + wall]]];
        } else {
            const x = columnWidth / 2;
            const z = columnDepth / 2;
            outerProfile = [[-x, -z], [x, -z], [x, z], [-x, z]];
        }

        const columnData = new ExtrudedProfileSource({
            outer: outerProfile,
            holes: profileHoles,
            height: columnHeight,
            center: [0, columnCenterY, 0],
        }).getOutputData();
        const column = controller.addPolyDataActor(columnData, "Column", actorStyle(MODEL_COLORS.column));
        if (column) {
            column.userData.baseplateRole = "rigid-column";
            column.userData.__excludeFromContour = true;
            column.userData.__hasSelectedContourField = false;
            rigidActors.push(column);
        }

        const embedDepth = Math.max(boltRadius * 0.5, 0.05);
        // The shaft starts slightly inside the concrete and ends exactly at
        // the plate top, so the hex head underside bears directly on the plate.
        const shaftLength = embedDepth + plateThickness;
        for (const center of boltCenters) {
            const boltData = new HexBoltSource({
                radius: boltRadius,
                shaftLength,
                headRadius: boltRadius * 1.65,
                headHeight: boltRadius * 1.5,
            }).getOutputData();
            const bolt = controller.addPolyDataActor(boltData, "AnchorBolt", {
                ...actorStyle(MODEL_COLORS.bolt),
                position: { x: center.x, y: concreteHeight - embedDepth, z: center.z },
            });
            if (bolt) {
                bolt.userData.baseplateRole = "rigid-anchor-bolt";
                bolt.userData.__excludeFromContour = true;
                bolt.userData.__hasSelectedContourField = false;
                rigidActors.push(bolt);
            }
        }

        if (concrete) {
            concrete.userData.baseplateRole = "rigid-concrete";
            concrete.userData.__excludeFromContour = true;
            concrete.userData.__hasSelectedContourField = false;
        }
        if (plate) {
            plate.userData.baseplateRole = "deformable-plate";
            plate.userData.__excludeFromContour = false;
            plate.userData.__hasSelectedContourField = true;
        }
        actorsRef.current = [concrete, plate, ...rigidActors, ...loadArrows].filter(Boolean);
        window.dispatchEvent(new CustomEvent("fea-field-data-changed"));
        if (showContour) {
            controller.SetContourField?.("U", "magnitude");
            controller.PlotContour?.(true);
        }
        controller.fitView?.();
        controller.requestRender?.();

        return () => {
            actorsRef.current.forEach((actor) => {
                actor?.removeFromParent?.();
                if (actor?.userData?.isLoadSymbol) actor.dispose?.();
            });
            actorsRef.current = [];
        };
    }, [controller, inputs, showContour, onResults]);

    useEffect(() => {
        if (!controller) return;
        if (controller.PlotContour) {
            controller.PlotContour(showContour);
        } else {
            actorsRef.current.forEach((actor) => {
                const canShowContour = actor?.userData?.__excludeFromContour !== true;
                actor?.setScalarVisibility?.(showContour && canShowContour);
            });
            controller.scalarBar?.setVisible?.(showContour);
            controller.requestRender?.();
        }
    }, [controller, showContour]);
}
