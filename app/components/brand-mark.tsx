import Image from "next/image";

export function BrandMark({
  className = "h-12 w-12",
  sizes = "48px",
  preload = false,
}: {
  className?: string;
  sizes?: string;
  preload?: boolean;
}) {
  return (
    <Image
      src="/rapidrevver-logo.webp"
      alt="Rapid Revver logo"
      width={192}
      height={192}
      sizes={sizes}
      preload={preload}
      className={`shrink-0 ${className}`}
    />
  );
}
