import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Revela el contenido cuando entra en viewport. Se dispara una sola vez y se
 * desconecta: no queremos que los bloques vuelvan a animarse al scrollear hacia
 * arriba, que es lo que hace que un sitio se sienta inquieto.
 *
 * Respeta `prefers-reduced-motion`: en ese caso muestra todo de entrada sin
 * transición.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  /** Escalonado en ms. 60–80ms entre ítems hermanos funciona bien. */
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${shown ? "reveal-shown" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
