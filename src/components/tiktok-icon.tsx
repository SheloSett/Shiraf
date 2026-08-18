/**
 * lucide-react trae `Instagram` pero no TikTok —sacaron casi todos los logos de
 * marca—, así que el glifo va acá, dibujado a mano y con la misma API que el
 * resto de los íconos: hereda el color y se mide con `className`.
 */
export function TiktokIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M16.6 2h-3.2v13.4a2.7 2.7 0 1 1-2.7-2.7c.2 0 .5 0 .7.1V9.5a6 6 0 1 0 5.2 6V8.9c1 .8 2.3 1.2 3.6 1.3V7c-2-.1-3.5-1.7-3.6-3.7V2Z" />
    </svg>
  );
}
