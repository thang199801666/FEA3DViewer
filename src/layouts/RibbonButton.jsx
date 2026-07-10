import { useState, useRef, useEffect } from "react";
import Icon from "../components/Icon";

export default function RibbonButton({
    icon,
    label,
    hotkey,
    instruction,
    onClick,
    disabled = false,
    active = false,
    textColor = "#333333",
    activeBtnBg = "#e2e8f0",
    href,
    target,
    rel
}) {
    const [showTooltip, setShowTooltip] = useState(false);
    const timeoutRef = useRef(null);

    // Triggers custom enhanced tooltip display with a 400ms delay to avoid accidental hover triggers
    const handleMouseEnter = () => {
        if (disabled) return;
        timeoutRef.current = setTimeout(() => {
            setShowTooltip(true);
        }, 400); 
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setShowTooltip(false);
    };

    // Clean up timers on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    const buttonStyle = {
        color: textColor,
        background: active ? activeBtnBg : "transparent",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer"
    };

    // Helper to render icon depending on whether it is a custom string name or a raw character
    const renderIcon = (size) => {
        if (typeof icon === "string" && icon.length > 2) {
            return <Icon name={icon} size={size} className="ribbon-icon" />;
        }
        
        // --- THAY ĐỔI 1: Cập nhật fontSize cho trường hợp icon là text/emoji ---
        // Giả sử fontSize ban đầu (cho size=32) là 28px, và cho size=20 là 16px.
        // Một cách xấp xỉ đơn giản, chúng ta có thể giả định tỷ lệ fontSize ≈ 0.8 * size.
        // Vậy cho size=64, fontSize ≈ 0.8 * 64 ≈ 51px.
        // Bạn có thể tùy chỉnh giá trị này (ví dụ 48px, 52px, 56px) cho phù hợp với font emoji cụ thể.
        const emojiFontSize = size === 64 ? "52px" : (size === 20 ? "16px" : "28px"); 
        
        return <span style={{ fontSize: emojiFontSize, lineHeight: "20px" }}>{icon}</span>;
    };

    const isLink = !!href;
    const Component = isLink ? "a" : "button";
    const componentProps = isLink 
        ? { href, target, rel, style: { ...buttonStyle, textDecoration: "none" } }
        : { onClick: disabled ? undefined : onClick, disabled, style: buttonStyle };

    return (
        <div 
            className="ribbon-btn-wrapper"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ position: "relative", display: "inline-block" }}
        >
            <Component className="ribbon-btn" {...componentProps}>
                {renderIcon(20)}
                <span className="ribbon-label">{label}</span>
            </Component>

            {/* Custom Enhanced Tooltip Layout */}
            {showTooltip && (hotkey || instruction) && (
                <div className="ribbon-tooltip-box">
                    {/* Left Panel: Upscaled Icon Visual */}
                    <div className="ribbon-tooltip-left">
                        {/* --- THAY ĐỔI 2: Tăng kích thước icon lên gấp đôi (32 -> 64) --- */}
                        {renderIcon(64)} 
                    </div>
                    {/* Right Panel: Functional Context & Shortcut Information */}
                    <div className="ribbon-tooltip-right">
                        <div className="ribbon-tooltip-header">
                            <span className="ribbon-tooltip-title">{label}</span>
                            {hotkey && <span className="ribbon-tooltip-hotkey">({hotkey})</span>}
                        </div>
                        {instruction && <p className="ribbon-tooltip-instruction">{instruction}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}