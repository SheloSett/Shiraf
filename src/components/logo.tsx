import logoAsset from "@/assets/shiraf-logo.jpg.asset.json";

export function Logo({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="Logo de Shiraf"
      className={`${className} rounded-full object-cover`}
    />
  );
}

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
        <span className="mt-1 block text-[10px] tracking-[0.18em] text-muted-foreground">
          calma · belleza · bienestar
        </span>
      </span>
    </span>
  );
}
