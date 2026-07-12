import Image from 'next/image'
import Link from 'next/link'

type BrandLogoProps = {
  href?: string
  portalLabel?: string
  className?: string
  imageClassName?: string
  textClassName?: string
}

export default function BrandLogo({
  href = '/',
  portalLabel,
  className = 'flex items-center gap-2',
  imageClassName = 'h-9 w-auto',
  textClassName = 'text-xl font-normal tracking-tight',
}: BrandLogoProps) {
  return (
    <Link href={href} className={className}>
      <Image
        src="/waystay-logo.png"
        alt="Waystay"
        width={72}
        height={36}
        priority
        className={imageClassName}
      />
      <span
        className={textClassName}
        style={{ fontFamily: 'var(--font-inter), Inter, Arial, Helvetica, sans-serif' }}
      >
        <span className="text-[var(--waystay-orange)]">Way</span><span className="text-[var(--waystay-blue)]">stay</span>
      </span>
      {portalLabel ? <span className="sr-only">{portalLabel}</span> : null}
    </Link>
  )
}
