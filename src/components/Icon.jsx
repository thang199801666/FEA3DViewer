export default function Icon({
  name,
  size = 24,
  className = "",
  ...props
}) {
  const href = `${import.meta.env.BASE_URL}images/sprite.svg#icon-${name}`;

  return (
    <svg
      width={size}
      height={size}
      className={className}
      {...props}
    >
      <use href={href} xlinkHref={href} />
    </svg>
  );
}