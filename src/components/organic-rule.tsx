/**
 * Filete de separación con un trazo levemente irregular, dibujado a mano.
 *
 * Una línea recta de 1px es correcta y anónima. Esta tiene una ondulación casi
 * imperceptible y grosor variable, así que se lee como trazo de lápiz sobre
 * papel — que es lo que separa un divisor con carácter de un `<hr>`.
 *
 * `preserveAspectRatio="none"` la estira a lo ancho sin engordar el trazo,
 * porque `vector-effect: non-scaling-stroke` mantiene el grosor constante.
 */
export function OrganicRule({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1440 12"
      preserveAspectRatio="none"
      className={`block h-3 w-full text-border ${className}`}
    >
      <path
        d="M0 7.2 C 120 5.1, 240 8.4, 360 7.6 S 600 4.6, 720 6.1 S 960 9.2, 1080 7.4 S 1320 3.8, 1440 5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
