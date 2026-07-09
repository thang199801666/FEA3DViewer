import { useEffect } from "react";

export default function DialogTemplate({
    isOpen,
    onClose,
    title,
    icon,
    width = "440px",
    maxHeight = "50vh",
    backgroundColor = "#ffffff",
    customStyle = {},
    headerProps = {},
    headerActions,
    footerActions,
    children
}) {
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div 
            className="modal-overlay" 
            style={{ 
                position: "fixed",
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: "rgba(15, 23, 42, 0.15)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
                ...customStyle.overlay
            }}
        >
            <div 
                className="modal-container" 
                style={{ 
                    width: width,
                    maxWidth: "92vw",
                    backgroundColor: "#f1f3f5",
                    borderRadius: "16px",
                    boxShadow: "0 8px 30px rgba(0, 0, 0, 0.12)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    ...customStyle.container
                }}
            >
                {/* Header Section */}
                <div 
                    className="modal-header"
                    {...headerProps}
                    style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between", 
                        // Reduced padding for a more compact header
                        padding: "10px 14px", 
                        borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
                        ...customStyle.header
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {icon && icon}
                        <h3 style={{ margin: 0, fontSize: "15px", fontWeight: "700", color: "#1e293b" }}>
                            {title}
                        </h3>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", pointerEvents: "auto" }}>
                        {headerActions}
                        <button 
                            onClick={onClose}
                            style={{
                                border: "none", backgroundColor: "#ffffff",
                                width: "26px", height: "26px", borderRadius: "50%",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                cursor: "pointer", boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                fontSize: "12px", color: "#1e293b"
                            }}
                        >✕</button>
                    </div>
                </div>

                {/* Content Body Section */}
                <div
                    className="modal-body"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        // Consistent vertical gap
                        gap: "8px", 
                        maxHeight: maxHeight,
                        overflowY: "auto",
                        // Reduced padding for better alignment with boundaries
                        padding: "12px 14px", 
                        backgroundColor: backgroundColor,
                        ...customStyle.body
                    }}
                >
                    {children}
                </div>

                {/* Footer Section */}
                {footerActions && (
                    <div 
                        className="modal-footer" 
                        style={{ 
                            // Compact footer padding
                            padding: "10px 14px", 
                            display: "flex", 
                            alignItems: "center",
                            gap: "8px",
                            backgroundColor: "#f1f3f5",
                            ...customStyle.footer
                        }}
                    >
                        {footerActions}
                    </div>
                )}
            </div>
        </div>
    );
}