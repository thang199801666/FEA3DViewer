import { useRef, useState, useEffect } from "react";
import DialogTemplate from "./DialogTemplate.jsx";

const CLIP_AXES = [
    { key: "x", label: "X", index: 0, color: 0xff5252 },
    { key: "y", label: "Y", index: 1, color: 0x4caf50 },
    { key: "z", label: "Z", index: 2, color: 0x448aff },
];

export default function SectionDialog({ isOpen, onClose, clip, clipBounds, setAxis, clearClip, theme }) {
    const [position, setPosition] = useState({ x: 20, y: 120 });
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const [textInputs, setTextInputs] = useState({ x: "0.000", y: "0.000", z: "0.000" });

    useEffect(() => {
        if (isOpen) {
            setTextInputs({
                x: Number(clip.x.pos).toFixed(3),
                y: Number(clip.y.pos).toFixed(3),
                z: Number(clip.z.pos).toFixed(3),
            });
        }
    }, [isOpen, clip.x.pos, clip.y.pos, clip.z.pos]);

    // Drag & Drop handlers
    const handleMouseDown = (e) => {
        if (e.target.tagName !== "BUTTON" && e.target.tagName !== "INPUT") {
            isDraggingRef.current = true;
            dragStartRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
            document.body.style.userSelect = "none";
        }
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDraggingRef.current) return;
            setPosition({ x: e.clientX - dragStartRef.current.x, y: e.clientY - dragStartRef.current.y });
        };

        const handleMouseUp = () => {
            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                document.body.style.userSelect = "";
            }
        };

        if (isOpen) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        }
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isOpen]);

    const isDark = theme === "dark";
    const colors = {
        bg: isDark ? "#2d2d2d" : "#ffffff",
        text: isDark ? "#e0e0e0" : "#333333",
        inputBg: isDark ? "#3d3d3d" : "#ffffff",
        inputBorder: isDark ? "#555555" : "#cccccc",
    };

    const handleCommitValue = (key, rawValue, min, max) => {
        let val = parseFloat(rawValue);
        if (isNaN(val)) {
            setTextInputs(prev => ({ ...prev, [key]: Number(clip[key].pos).toFixed(3) }));
            return;
        }
        if (val < min) val = min;
        if (val > max) val = max;
        setAxis(key, { pos: val });
        setTextInputs(prev => ({ ...prev, [key]: val.toFixed(3) }));
    };

    const footerButtons = (
        <>
            <div style={{ flex: 1 }} />
            <button 
                onClick={clearClip}
                style={{
                    padding: "6px 14px", borderRadius: "8px", border: "1px solid #cbd5e1",
                    backgroundColor: "#ffffff", color: "#0f172a", fontWeight: "600", fontSize: "12px", cursor: "pointer"
                }}
            >
                Clear
            </button>
            <button 
                onClick={onClose}
                style={{
                    padding: "6px 18px", borderRadius: "8px", border: "none",
                    backgroundColor: "#2563eb", color: "#ffffff", fontWeight: "600", fontSize: "12px", cursor: "pointer"
                }}
            >
                Close
            </button>
        </>
    );

    const customStyles = {
        overlay: { position: "fixed", pointerEvents: "none", backgroundColor: "transparent", backdropFilter: "none" },
        container: {
            position: "absolute", left: 0, top: 0,
            transform: `translate(${position.x}px, ${position.y}px)`,
            pointerEvents: "auto", minWidth: "400px", width: "400px", // Tăng nhẹ width để vừa thêm checkbox
            backgroundColor: isDark ? "#202020" : "#f1f3f5"
        },
        header: { cursor: "move" },
        body: { backgroundColor: colors.bg, color: colors.text, gap: "6px" },
        footer: { backgroundColor: isDark ? "#202020" : "#f1f3f5" }
    };

    return (
        <DialogTemplate
            isOpen={isOpen}
            onClose={onClose}
            title="Section / Clipping Planes"
            customStyle={customStyles}
            headerProps={{ onMouseDown: handleMouseDown }}
            footerActions={footerButtons}
        >
            {CLIP_AXES.map((ax) => {
                const s = clip[ax.key];
                const mn = clipBounds.min[ax.index];
                const mx = clipBounds.max[ax.index];
                const step = Math.max((mx - mn) / 200, 1e-4);
                
                return (
                    <div key={ax.key} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "3px 0" }}>
                        {/* Checkbox Kích hoạt mặt cắt (Clip) */}
                        <label style={{ minWidth: "42px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                            <input type="checkbox" checked={s.on} onChange={(e) => setAxis(ax.key, { on: e.target.checked })} />
                            <span style={{ color: `#${ax.color.toString(16).padStart(6, "0")}`, fontWeight: 700 }}>{ax.label}</span>
                        </label>

                        {/* Checkbox Ẩn/Hiện Plane Hình Học (Show) */}
                        <label style={{ display: "flex", alignItems: "center", gap: "2px", fontSize: "11px", cursor: "pointer", opacity: s.on ? 1 : 0.5 }}>
                            <input 
                                type="checkbox" 
                                checked={s.showPlane ?? true} // Giả định mặc định là true nếu chưa định nghĩa
                                disabled={!s.on}
                                onChange={(e) => setAxis(ax.key, { showPlane: e.target.checked })} 
                            />
                            <span>Show</span>
                        </label>

                        {/* Slider điều chỉnh vị trí */}
                        <input type="range" min={mn} max={mx} step={step} value={s.pos} disabled={!s.on}
                            onChange={(e) => setAxis(ax.key, { pos: parseFloat(e.target.value) || 0 })} style={{ flex: 1 }} />

                        {/* Input số nhập trực tiếp */}
                        <input type="number" min={mn} max={mx} step={step} value={textInputs[ax.key]} disabled={!s.on}
                            onChange={(e) => setTextInputs(prev => ({ ...prev, [ax.key]: e.target.value }))}
                            onBlur={(e) => handleCommitValue(ax.key, e.target.value, mn, mx)}
                            onKeyDown={(e) => e.key === "Enter" && handleCommitValue(ax.key, e.target.value, mn, mx)}
                            style={{ width: "65px", textAlign: "right", background: colors.inputBg, color: colors.text, border: `1px solid ${colors.inputBorder}`, borderRadius: "4px", padding: "2px" }}
                        />

                        {/* Nút lật hướng cắt (Flip) */}
                        <button disabled={!s.on} onClick={() => setAxis(ax.key, { flip: !s.flip })} style={{ padding: "2px 6px", fontSize: "11px" }}>
                            {s.flip ? "⇄" : "Flip"}
                        </button>
                    </div>
                );
            })}
        </DialogTemplate>
    );
}