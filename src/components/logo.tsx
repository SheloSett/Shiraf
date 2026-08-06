const LOGO_SRC = "/logo_shiraf.jpeg";

/*
 * El archivo es un lockup completo: monograma + "SHIRAF" + "Calma, belleza y
 * bienestar", todo sobre un cuadrado verde oliva y sin transparencia (es JPEG).
 * Eso obliga a usarlo de dos maneras distintas según el tamaño:
 *
 *   <Logo>        recorta sólo el monograma y lo presenta como sello circular.
 *                 A 44px el lockup entero es ilegible, y el fondo oliva del
 *                 JPEG deja de ser un problema y pasa a ser el sello.
 *
 *   <LogoLockup>  el archivo entero, sin recortar, para superficies grandes en
 *                 oliva (footer, login). Ahí el fondo del JPEG casi coincide
 *                 con --primary y se funde con la superficie.
 *
 * Los valores del recorte están calculados sobre el original de 1254×1254 para
 * encuadrar el monograma dejando aire alrededor.
 */
const MONOGRAM_CROP = {
  backgroundImage: `url("${LOGO_SRC}")`,
  backgroundSize: "165%",
  backgroundPosition: "53.5% 20%",
  backgroundRepeat: "no-repeat",
} as const;

export function Logo({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Logo de Shiraf"
      style={MONOGRAM_CROP}
      className={`${className} inline-block shrink-0 rounded-full`}
    />
  );
}

/** Lockup completo. Pensado para fondos oliva y tamaños grandes. */
export function LogoLockup({ className = "w-44" }: { className?: string }) {
  return (
    <img
      src={LOGO_SRC}
      alt="Shiraf — calma, belleza y bienestar"
      width={1254}
      height={1254}
      className={`${className} h-auto rounded-sm`}
    />
  );
}

/**
 * Sello + wordmark tipografiado. El texto va aparte y no duplica al del
 * archivo, porque <Logo> muestra únicamente el monograma.
 */
export function LogoWordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <span className="flex items-center gap-3">
      <Logo />
      <span className="leading-none">
        <span
          className={`block font-display text-xl tracking-[0.3em] ${
            tone === "light" ? "text-primary-foreground" : "text-foreground"
          }`}
        >
          SHIRAF
        </span>
        <span
          className={`mt-1 block text-[10px] tracking-[0.18em] ${
            tone === "light" ? "text-primary-foreground/60" : "text-muted-foreground"
          }`}
        >
          calma · belleza · bienestar
        </span>
      </span>
    </span>
  );
}
