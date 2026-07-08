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
    headerProps = {}, // <--- Thêm prop này để nhận sự kiện chuột từ SectionDialog
    headerActions,
    footerActions,
    children
}) {
    // Đóng dialog khi bấm Escape
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
                    borderRadius: "20px",
                    boxShadow: "0 12px 40px rgba(0, 0, 0, 0.12)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    ...customStyle.container
                }}
            >
                {/* Header Section */}
                <div 
                    className="modal-header"
                    {...headerProps} // <--- Đưa các sự kiện MouseDown vào đây để kéo được
                    style={{ 
                        display: "flex", 
                        alignItems: "center", 
                        justifyContent: "space-between", 
                        padding: "14px 20px",
                        borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
                        ...customStyle.header
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {icon && icon}
                        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1e293b" }}>
                            {title}
                        </h3>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", pointerEvents: "auto" }}>
                        {headerActions}
                        <button 
                            onClick={onClose}
                            style={{
                                border: "none",
                                backgroundColor: "#ffffff",
                                width: "28px",
                                height: "28px",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
                                fontSize: "14px",
                                fontWeight: "bold",
                                color: "#1e293b"
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Content Body Section */}
                <div
                    className="modal-body-inputs"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        maxHeight: maxHeight,
                        overflowY: "auto",
                        padding: "12px 20px",
                        backgroundColor: backgroundColor,
                        ...customStyle.body
                    }}
                >
                    {children}
                </div>

                {/* Footer Section */}
                {footerActions && (
                    <div 
                        className="modal-actions" 
                        style={{ 
                            padding: "12px 20px 14px 20px", 
                            display: "flex", 
                            alignItems: "center",
                            gap: "10px",
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