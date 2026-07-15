import { useEffect, useState } from "react";
import Icon from "../components/Icon";

export default function ModelTree({ sceneController, sceneVersion, theme, selectedIds, onSelectionChange, onModelsDeleted }) {
    const [nodes, setNodes] = useState<any[]>([]);
    const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: any } | null>(null);
    const isDark = theme === "dark";

    const refreshTree = () => {
        const list: any[] = [];
        sceneController?.scene?.traverse?.((actor: any) => {
            if (actor?.isActor) list.push({ id: actor.uuid, actor, name: (actor.name || "Unnamed Model").replace(/\.[^/.]+$/, ""), visible: actor.visible !== false });
        });
        setNodes(list);
    };
    useEffect(refreshTree, [sceneController, sceneVersion]);
    useEffect(() => {
        const close = () => setContextMenu(null);
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, []);

    const select = (event: React.MouseEvent, index: number) => {
        const id = nodes[index].id;
        let next: string[];
        if (event.shiftKey && anchorIndex !== null) {
            const [a, b] = [anchorIndex, index].sort((x, y) => x - y);
            const range = nodes.slice(a, b + 1).map((node) => node.id);
            next = event.ctrlKey || event.metaKey ? [...new Set([...selectedIds, ...range])] : range;
        } else if (event.ctrlKey || event.metaKey) {
            next = selectedIds.includes(id) ? selectedIds.filter((value) => value !== id) : [...selectedIds, id];
            setAnchorIndex(index);
        } else {
            next = [id];
            setAnchorIndex(index);
        }
        const actors = next.map((selectedId) => nodes.find((node) => node.id === selectedId)?.actor).filter(Boolean);
        sceneController?.pickingController?.selectActors?.(actors, false);
        onSelectionChange?.(next, nodes[index].actor);
        sceneController?.requestRender?.();
    };

    const toggleVisibility = (event: React.MouseEvent, node: any) => {
        event.stopPropagation();
        node.actor.visible = !node.actor.visible;
        sceneController?.requestRender?.();
        refreshTree();
    };

    const removeIds = (ids: string[]) => {
        const targets = nodes.filter((node) => ids.includes(node.id));
        if (!targets.length) return;
        sceneController?.pickingController?.clearSelection?.();
        for (const { actor } of targets) {
            if (sceneController?.renderer?.removeActor) sceneController.renderer.removeActor(actor);
            else actor.parent?.remove(actor);
            actor.dispose?.();
        }
        onSelectionChange?.([], null);
        onModelsDeleted?.();
        window.dispatchEvent(new Event("fea-field-data-changed"));
        sceneController?.updateClipping?.();
        sceneController?.requestRender?.();
        refreshTree();
    };
    const removeSelected = () => removeIds(selectedIds);

    const openContextMenu = (event: React.MouseEvent, node: any, index: number) => {
        event.preventDefault();
        event.stopPropagation();
        sceneController?.pickingController?.selectActors?.([node.actor], false);
        onSelectionChange?.([node.id], node.actor);
        setAnchorIndex(index);
        setContextMenu({ x: event.clientX, y: event.clientY, node });
        sceneController?.requestRender?.();
    };

    return (
        <div tabIndex={0} onKeyDown={(e) => e.key === "Delete" && removeSelected()}
            style={{ padding: "10px 12px", height: "100%", overflowY: "auto", color: isDark ? "#e0e0e0" : "#111", fontFamily: "sans-serif", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h3 style={{ fontSize: 11, margin: 0, color: isDark ? "#888" : "#666", letterSpacing: ".5px" }}>MODEL TREE</h3>
                <button onClick={removeSelected} disabled={!selectedIds.length} title="Delete selected models"
                    style={{ border: 0, background: "transparent", color: selectedIds.length ? "#d33" : "#999", cursor: selectedIds.length ? "pointer" : "default", fontSize: 16 }}>×</button>
            </div>
            {!nodes.length && <div style={{ color: "#888", fontSize: 12, fontStyle: "italic" }}>No actors loaded</div>}
            {nodes.map((node, index) => {
                const selected = selectedIds.includes(node.id);
                return <div key={node.id} onClick={(e) => select(e, index)} onContextMenu={(e) => openContextMenu(e, node, index)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", marginBottom: 2, borderRadius: 3, cursor: "pointer", border: selected ? "1px solid #2196f3" : "1px solid transparent", background: selected ? "rgba(33,150,243,.18)" : "transparent" }}>
                    <Icon name="part" size={16} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, opacity: node.visible ? 1 : .45, textDecoration: node.visible ? "none" : "line-through" }}>{node.name}</span>
                    <button onClick={(e) => toggleVisibility(e, node)} style={{ border: 0, background: "transparent", padding: 1, cursor: "pointer" }}>
                        <Icon name={node.visible ? "treeitemvisible" : "treeiteminvisible"} size={16} />
                    </button>
                </div>;
            })}
            {contextMenu && <div onPointerDown={(e) => e.stopPropagation()} style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y, zIndex: 1000, minWidth: 130, padding: 4, border: isDark ? "1px solid #555" : "1px solid #bbb", borderRadius: 5, background: isDark ? "#292929" : "#fff", boxShadow: "0 5px 16px rgba(0,0,0,.28)" }}>
                <button onClick={() => { removeIds([contextMenu.node.id]); setContextMenu(null); }} style={{ display: "block", width: "100%", padding: "6px 12px", border: 0, borderRadius: 3, textAlign: "left", background: "transparent", color: "#d33", cursor: "pointer" }}>Delete</button>
            </div>}
        </div>
    );
}
