import Image from "next/image"
import Link from "next/link"

const sizes = {
  header: "h-14 w-auto sm:h-16",
  login: "h-32 w-auto sm:h-40",
}

export function BrandLogo({
  href,
  size = "header",
}: {
  href?: string
  size?: keyof typeof sizes
}) {
  const image = (
    <Image
      src="/fibre-logo.png"
      alt="Fibre Construction Inc"
      width={640}
      height={560}
      priority={size === "login" || size === "header"}
      className={`${sizes[size]} object-contain`}
    />
  )

  if (!href) return image

  return (
    <Link href={href} className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      {image}
    </Link>
  )
}
