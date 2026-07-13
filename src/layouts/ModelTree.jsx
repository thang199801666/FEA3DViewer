import { useEffect, useState } from "react";

export default function ModelTree({ sceneController, sceneVersion, theme }) {
    const [nodes, setNodes] = useState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const isDark = theme === "dark";

    // Clean up names: remove extensions (.vtk, .vtp) and provide nice fallbacks
    const cleanActorName = (name) => {
        if (!name) return "Unnamed Model";
        // Remove trailing extensions like .vtk, .vtp, etc.
        return name.replace(/\.[^/.]+$/, "");
    };

    // Scan the scene for active actor elements
    const refreshTree = () => {
        if (!sceneController || !sceneController.scene) {
            setNodes([]);
            return;
        }

        const list = [];
        sceneController.scene.traverse((object) => {
            if (object && object.isActor) {
                list.push({
                    id: object.uuid,
                    name: cleanActorName(object.name),
                    visible: object.visible !== false,
                });
            }
        });
        
        setNodes(list);
    };

    useEffect(() => {
        refreshTree();
    }, [sceneController, sceneVersion]);

    // Handle show/hide toggle click
    const toggleVisibility = (e, nodeId) => {
        e.stopPropagation(); // Stop selection trigger when pressing the eye icon
        if (!sceneController || !sceneController.scene) return;

        sceneController.scene.traverse((object) => {
            if (object && object.isActor && object.uuid === nodeId) {
                object.visible = !object.visible;
            }
        });

        if (typeof sceneController.requestRender === "function") {
            sceneController.requestRender();
        }

        refreshTree();
    };

    // Handle selecting an item to highlight it inside the viewport scene
    const handleSelectNode = (nodeId) => {
        setSelectedNodeId(nodeId);

        if (!sceneController || !sceneController.scene) return;

        sceneController.scene.traverse((object) => {
            if (object && object.isActor && object.uuid === nodeId) {
                // If the sceneController provides a native selection/highlight layout function:
                if (typeof sceneController.selectActor === "function") {
                    sceneController.selectActor(object);
                } else if (typeof sceneController.highlightObject === "function") {
                    sceneController.highlightObject(object);
                } else {
                    // Fallback: Custom outline highlight behavior or dispatching event if applicable
                    console.log("Selected & Highlighted actor:", object.name);
                }
            }
        });

        if (typeof sceneController.requestRender === "function") {
            sceneController.requestRender();
        }
    };

    return (
        <div style={{ 
            padding: "15px", 
            color: isDark ? "#e0e0e0" : "#111111", 
            height: "100%", 
            overflowY: "auto",
            transition: "color 0.2s"
        }}>
            <h3 style={{ 
                fontSize: "14px", 
                textTransform: "uppercase", 
                letterSpacing: "1px", 
                marginBottom: "15px", 
                color: isDark ? "#888888" : "#666666" 
            }}>
                Model Tree
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "13px" }}>
                {nodes.map((node) => {
                    const isSelected = selectedNodeId === node.id;
                    
                    return (
                        <li 
                            key={node.id} 
                            onClick={() => handleSelectNode(node.id)}
                            style={{ 
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 8px", 
                                borderRadius: "4px",
                                backgroundColor: isSelected 
                                    ? (isDark ? "rgba(33, 150, 243, 0.25)" : "rgba(33, 150, 243, 0.15)")
                                    : (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"),
                                border: isSelected 
                                    ? "1px solid #2196F3" 
                                    : "1px solid transparent",
                                marginBottom: "4px",
                                cursor: "pointer",
                                transition: "background-color 0.15s, border-color 0.15s"
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span>📦</span>
                                <span style={{ 
                                    textDecoration: node.visible ? "none" : "line-through",
                                    opacity: node.visible ? 1 : 0.4,
                                    fontWeight: isSelected ? "bold" : "normal"
                                }}>
                                    {node.name}
                                </span>
                            </div>
                            
                            <button
                                onClick={(e) => toggleVisibility(e, node.id)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: "14px",
                                    padding: "2px 6px",
                                    outline: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    color: node.visible ? (isDark ? "#4da3ff" : "#0066cc") : (isDark ? "#666" : "#ccc"),
                                    opacity: node.visible ? 1 : 0.6,
                                    transition: "color 0.15s"
                                }}
                                title={node.visible ? "Hide Actor" : "Show Actor"}
                            >
                                {node.visible ? "👁️" : "👁️‍🗨️"}
                            </button>
                        </li>
                    );
                })}
                {nodes.length === 0 && (
                    <li style={{ color: isDark ? "#555" : "#666", fontStyle: "italic" }}>
                        No actors loaded
                    </li>
                )}
            </ul>
        </div>
    );
}