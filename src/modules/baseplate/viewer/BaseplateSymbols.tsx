import { useEffect, useState } from "react";
import { RenderingBackend } from "../../../threejsVTK";
import type { BaseplateInputs } from "../domain/baseplateTypes";

type Point = { x: number; y: number };
type LoadKey = "Py" | "Vx" | "Vz" | "Mx" | "My" | "Mz";
type Projection = { origin: Point; tips: Record<LoadKey, Point>; visible: boolean };
const LOAD_KEYS: LoadKey[] = ["Py", "Vx", "Vz", "Mx", "My", "Mz"];

function sameProjection(a: Projection | null, b: Projection): boolean {
    if (!a || a.visible !== b.visible) return false;
    if (Math.abs(a.origin.x - b.origin.x) >= 0.2 || Math.abs(a.origin.y - b.origin.y) >= 0.2) return false;
    return LOAD_KEYS.every((key) => Math.abs(a.tips[key].x - b.tips[key].x) < 0.2 && Math.abs(a.tips[key].y - b.tips[key].y) < 0.2);
}

export default function BaseplateSymbols({ inputs, controller }: { inputs: BaseplateInputs; controller: any }) {
    const [projection, setProjection] = useState<Projection | null>(null);

    useEffect(() => {
        let frame = 0;
        const update = () => {
            const element = controller?.domElement as HTMLElement | undefined;
            const camera = controller?.camera;
            if (element && camera) {
                const width = element.clientWidth;
                const height = element.clientHeight;
                const worldTips = new Map<LoadKey, number[]>();
                let worldOrigin: number[] | null = null;
                const symbols: any[] = [];
                controller.scene?.updateMatrixWorld?.(true);
                controller.scene?.traverse?.((object: any) => {
                    const key = object?.userData?.loadKey as LoadKey | undefined;
                    if (key && LOAD_KEYS.includes(key) && object.getTipPosition) {
                        symbols.push(object);
                        worldTips.set(key, object.getTipPosition());
                        if (!worldOrigin && object.getOriginPosition) worldOrigin = object.getOriginPosition();
                    }
                });
                if (worldOrigin && symbols.length) {
                    let unitsPerPixel = 1;
                    if (camera.isOrthographicCamera) {
                        unitsPerPixel = Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom || 1, 1e-6) / Math.max(height, 1);
                    } else if (camera.isPerspectiveCamera) {
                        const dx = camera.position.x - worldOrigin[0];
                        const dy = camera.position.y - worldOrigin[1];
                        const dz = camera.position.z - worldOrigin[2];
                        const distance = Math.hypot(dx, dy, dz);
                        unitsPerPixel = 2 * distance * Math.tan((camera.fov || 50) * Math.PI / 360) / Math.max(height, 1);
                    }
                    const symbolScale = Math.max(0.25, Math.min(2.5, unitsPerPixel * 68));
                    const columnTipY = inputs.concreteHeight / 100 + inputs.plateThickness / 100 + 3.2;
                    const targetOriginY = columnTipY + symbolScale * 0.82;
                    let transformChanged = false;
                    for (const symbol of symbols) {
                        if (Math.abs(symbol.scale.x - symbolScale) > 0.002) {
                            symbol.scale.setScalar(symbolScale);
                            transformChanged = true;
                        }
                        if (Math.abs(symbol.position.y - targetOriginY) > 0.002) {
                            symbol.position.y = targetOriginY;
                            transformChanged = true;
                        }
                    }
                    if (transformChanged) {
                        controller.scene.updateMatrixWorld?.(true);
                        worldTips.clear();
                        for (const symbol of symbols) {
                            worldTips.set(symbol.userData.loadKey, symbol.getTipPosition());
                            if (!worldOrigin && symbol.getOriginPosition) worldOrigin = symbol.getOriginPosition();
                        }
                        worldOrigin = symbols[0].getOriginPosition?.() ?? worldOrigin;
                        controller.requestRender?.();
                    }
                }
                const origin = worldOrigin
                    ? RenderingBackend.projectWorldToScreen(camera, worldOrigin, width, height)
                    : null;
                if (origin && LOAD_KEYS.every((key) => worldTips.has(key))) {
                    const projected = {} as Record<LoadKey, Point>;
                    let allVisible = origin.visible;
                    for (const key of LOAD_KEYS) {
                        const tip = RenderingBackend.projectWorldToScreen(camera, worldTips.get(key)!, width, height);
                        if (!tip) { allVisible = false; break; }
                        projected[key] = tip;
                    }
                    if (Object.keys(projected).length === LOAD_KEYS.length) {
                        const next = { origin, tips: projected, visible: allVisible };
                        setProjection((previous) => sameProjection(previous, next) ? previous : next);
                    }
                }
            }
            frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
        return () => cancelAnimationFrame(frame);
    }, [controller, inputs.concreteHeight, inputs.plateThickness]);

    if (!projection?.visible) return null;
    const { origin, tips } = projection;
    const label = (key: LoadKey, value: number, unit: string) =>
        <text key={key} x={tips[key].x + 3} y={tips[key].y - 3}>{key} {value.toFixed(3)} {unit}</text>;

    return <svg className="bp-symbols" aria-label="Axial Y, shear X/Z and moment X/Y/Z symbols">
        <g className="bp-load-symbols">
            <circle className="axis-dot" cx={origin.x} cy={origin.y} r="3" />
            {label("Py", inputs.axialForce, "kN")}
            {label("Vx", inputs.shearX, "kN")}
            {label("Vz", inputs.shearZ, "kN")}
            {label("Mx", inputs.momentX, "kNm")}
            {label("My", inputs.momentY, "kNm")}
            {label("Mz", inputs.momentZ, "kNm")}
        </g>
    </svg>;
}
