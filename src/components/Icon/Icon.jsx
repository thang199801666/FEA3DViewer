export default function Icon({
    name,
    size = 20,
    color,
    className = "",
    ...props
}) {
    return (
        <svg
            className={`icon ${className}`}
            width={size}
            height={size}
            style={color ? { color } : undefined}
            aria-hidden="true"
            {...props}
        >
            <use href={`/images/sprite.svg#${name}`} />
        </svg>
    );
}