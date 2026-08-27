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
      {/* Sello un poco más grande a pedido del centro: 44px se perdía dentro de
          los 80px de alto del header. A 52px sigue entrando con aire arriba y
          abajo, y equilibra mejor el bloque de dos líneas que tiene al lado. */}
      {/* <Logo /> */}
      <Logo className="h-13 w-13" />
      <span className="leading-none">
        {/* Wordmark en dorado, para que el texto tipografiado use el mismo color
            que el del logo en vez de leerse como texto de interfaz.

            El dorado va sólo en la variante `light` (la que se apoya sobre el
            oliva) y no en `dark`: sobre el beige del cuerpo el dorado del logo
            queda en 1.9:1 de contraste, ilegible. Hoy las tres vistas que usan
            este componente — header del sitio, /auth y /recuperar — pasan
            tone="light", así que en pantalla el wordmark siempre sale dorado;
            la rama `dark` queda con los colores de antes por si algún día se
            usa sobre fondo claro. Sobre el oliva el dorado da 4.54:1, que pasa
            AA para texto normal. */}
        {/* tone === "light" ? "text-primary-foreground" : "text-foreground" */}
        <span
          className={`block font-display text-xl tracking-[0.3em] ${
            tone === "light" ? "text-gold" : "text-foreground"
          }`}
        >
          SHIRAF
        </span>
        {/* La bajada iba en /60 sobre el oliva. En dorado va al 100%: bajarle la
            opacidad la tiraba a 3.3:1 y a 10px eso ya no se lee. */}
        {/* tone === "light" ? "text-primary-foreground/60" : "text-muted-foreground" */}
        <span
          className={`mt-1 block text-[10px] tracking-[0.18em] ${
            tone === "light" ? "text-gold" : "text-muted-foreground"
          }`}
        >
          {/* Antes: "calma · belleza · bienestar", todo en minúscula. Va con las
              tres iniciales en mayúscula: acá las tres palabras están separadas
              por puntos medios, no encadenadas en una frase, así que funcionan
              como tres etiquetas y cada una empieza en mayúscula. (El lockup del
              archivo dice "Calma, belleza y bienestar" en formato oración, pero
              ahí sí es una frase corrida.) */}
          Calma · Belleza · Bienestar
        </span>
      </span>
    </span>
  );
}
