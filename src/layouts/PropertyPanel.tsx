import { useEffect, useState } from "react";
import * as THREE from "three";

const fmt = (n: number) => Number.isFinite(n) ? Number(n.toFixed(4)).toString() : "—";

export default function PropertyPanel({ theme, actor, onOpacityChange }) {
    const [opacity, setOpacity] = useState(actor?.getOpacity?.() ?? actor?.userData?.actorOpacity ?? 1);
    useEffect(() => setOpacity(actor?.getOpacity?.() ?? actor?.userData?.actorOpacity ?? 1), [actor]);
    const isDark = theme === "dark";
    const rowStyle = { borderBottom: isDark ? "1px solid #2d2d2d" : "1px solid #d5d5d5" };
    const labelStyle = { padding: "6px 4px", color: isDark ? "#999" : "#666", width: "40%", userSelect: "none" };
    const valueStyle = { padding: "6px 4px", fontWeight: "500", color: isDark ? "#e0e0e0" : "#111" };

    if (!actor) return <div style={{ padding: 15, fontSize: 12, color: isDark ? "#777" : "#888" }}>No model selected</div>;

    actor.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(actor);
    const size = box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
    const data = actor.userData?.__sourceInput ?? actor.userData?.__undeformedInput ?? actor.mapper?.input;
    const nodes = data?.getNumberOfPoints?.() ?? ((data?.points?.length ?? 0) / 3);
    const elements = data?.getNumberOfCells?.() ?? data?.cells?.length ?? 0;

    return (
        <div style={{ padding: "10px 15px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                    <tr style={rowStyle}><td style={labelStyle}>Name</td><td style={valueStyle}>{actor.name || "Unnamed Model"}</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Position</td><td style={valueStyle}>{fmt(actor.position.x)}, {fmt(actor.position.y)}, {fmt(actor.position.z)}</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Bounds size</td><td style={valueStyle}>{fmt(size.x)} × {fmt(size.y)} × {fmt(size.z)}</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Nodes</td><td style={valueStyle}>{nodes}</td></tr>
                    <tr style={rowStyle}><td style={labelStyle}>Elements</td><td style={valueStyle}>{elements}</td></tr>
                    <tr style={rowStyle}>
                        <td style={labelStyle}>Opacity</td>
                        <td style={valueStyle}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <input type="range" min="0" max="1" step="0.05" value={opacity}
                                    onChange={(e) => {
                                        const value = Number(e.target.value);
                                        setOpacity(value);
                                        onOpacityChange?.(value);
                                    }} style={{ width: 90 }} />
                                <span>{Number(opacity).toFixed(2)}</span>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}
