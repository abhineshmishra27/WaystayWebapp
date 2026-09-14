import Image from 'next/image'
import Link from 'next/link'
import styles from './BrandLogo.module.css'

type BrandLogoProps = {
  href?: string
  portalLabel?: string
  className?: string
}

export default function BrandLogo({
  href = '/',
  portalLabel,
  className = '',
}: BrandLogoProps) {
  return (
    <Link href={href} aria-label="Go to Waystay home" className={`${styles.brand} ${className}`}>
      <Image
        src="/waystay-logo.png"
        alt="Waystay"
        width={72}
        height={36}
        priority
        className={styles.logo}
      />
      <span className={styles.wordmark}>
        <span className="text-[var(--waystay-orange)]">Way</span><span className="text-[var(--waystay-blue)]">stay</span>
      </span>
      {portalLabel ? <span className="sr-only">{portalLabel}</span> : null}
    </Link>
  )
}
