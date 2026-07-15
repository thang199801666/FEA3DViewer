import { useEffect, useState } from "react";
import Icon from "../components/Icon";

export default function ModelTree({
    sceneController,
    sceneVersion,
    theme,
}) {
    const [nodes, setNodes] = useState([]);
    const [selectedNodeId, setSelectedNodeId] = useState(null);

    const isDark = theme === "dark";

    // Remove file extensions for cleaner display
    const cleanActorName = (name) => {
        if (!name) return "Unnamed Model";
        return name.replace(/\.[^/.]+$/, "");
    };

    // Read all actors from the scene
    const refreshTree = () => {
        if (!sceneController?.scene) {
            setNodes([]);
            return;
        }

        const list = [];

        sceneController.scene.traverse((object) => {
            if (object?.isActor) {
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

    // Toggle actor visibility
    const toggleVisibility = (e, nodeId) => {
        e.stopPropagation();

        if (!sceneController?.scene) return;

        sceneController.scene.traverse((object) => {
            if (object?.isActor && object.uuid === nodeId) {
                object.visible = !object.visible;
            }
        });

        sceneController.requestRender?.();
        refreshTree();
    };

    // Select actor
    const handleSelectNode = (nodeId) => {
        setSelectedNodeId(nodeId);

        if (!sceneController?.scene) return;

        sceneController.scene.traverse((object) => {
            if (object?.isActor && object.uuid === nodeId) {
                if (sceneController.selectActor) {
                    sceneController.selectActor(object);
                } else if (sceneController.highlightObject) {
                    sceneController.highlightObject(object);
                } else {
                    console.log("Selected actor:", object.name);
                }
            }
        });

        sceneController.requestRender?.();
    };

    return (
        <div
            style={{
                padding: "10px 12px",
                height: "100%",
                overflowY: "auto",
                color: isDark ? "#e0e0e0" : "#111",
                fontFamily: "sans-serif"
            }}
        >
            <h3
                style={{
                    fontSize: 11,
                    fontWeight: "bold",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginTop: 0,
                    marginBottom: 10,
                    color: isDark ? "#888" : "#666",
                }}
            >
                Model Tree
            </h3>

            <ul
                style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    fontSize: 12,
                }}
            >
                {nodes.length === 0 && (
                    <li
                        style={{
                            color: isDark ? "#666" : "#888",
                            fontStyle: "italic",
                            padding: "4px 0",
                        }}
                    >
                        No actors loaded
                    </li>
                )}

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
                                padding: "3px 6px",
                                marginBottom: 2,
                                borderRadius: 3,
                                cursor: "pointer",
                                border: isSelected
                                    ? "1px solid #2196F3"
                                    : "1px solid transparent",
                                background: isSelected
                                    ? isDark
                                        ? "rgba(33,150,243,.25)"
                                        : "rgba(33,150,243,.12)"
                                    : isDark
                                      ? "rgba(255,255,255,.02)"
                                      : "rgba(0,0,0,.015)",
                                transition:
                                    "background-color .1s, border-color .1s",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    overflow: "hidden",
                                    flex: 1,
                                }}
                            >
                                <span style={{ display: "flex", alignItems: "center" }}>
                                    <Icon
                                        name={"part"}
                                        size={16}
                                    />
                                </span>

                                <span
                                    style={{
                                        textDecoration: node.visible
                                            ? "none"
                                            : "line-through",
                                        opacity: node.visible ? 1 : 0.45,
                                        fontWeight: isSelected
                                            ? "600"
                                            : "400",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        lineHeight: "16px",
                                    }}
                                >
                                    {node.name}
                                </span>
                            </div>

                            <button
                                onClick={(e) =>
                                    toggleVisibility(e, node.id)
                                }
                                title={
                                    node.visible
                                        ? "Hide Actor"
                                        : "Show Actor"
                                }
                                style={{
                                    background: "transparent",
                                    border: "none",
                                    padding: 1,
                                    marginLeft: 6,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    color: node.visible
                                        ? isDark
                                            ? "#4da3ff"
                                            : "#0066cc"
                                        : isDark
                                          ? "#666"
                                          : "#aaa",
                                    transition: "color .1s",
                                }}
                            >
                                <Icon
                                    name={
                                        node.visible
                                            ? "treeitemvisible"
                                            : "treeiteminvisible"
                                    }
                                    size={16}
                                />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}