import 'server-only'

import cloudinary from '@/lib/cloudinary'
import { logger } from '@/lib/logger'

/**
 * Brings channel-supplied photographs into WayStay's own image hosting.
 *
 * Imported listings otherwise show a placeholder. The obvious alternative - allowlisting
 * the provider's hostname in next.config.ts - is rejected for two reasons: it hotlinks a
 * partner's CDN, so their URL changes silently blank our listings, and every new provider
 * would need another entry. Re-hosting means the URL is ours, already allowlisted, and
 * served with the same transformations as every other image on the site.
 *
 * Cloudinary fetches the remote URL itself, so nothing is streamed through this process.
 */

/** Enough to furnish a listing without pulling an entire gallery on every import. */
const MAX_IMAGES_PER_SUBJECT = 8
const UPLOAD_TIMEOUT_MS = 20_000

export type IngestedImage = { url: string; publicId: string }

export function cloudinaryIsConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
  )
}

/**
 * A stable id per source image, so re-importing overwrites rather than accumulating.
 *
 * Without this every sync would upload the same photographs again under new ids, and a
 * property synced nightly would quietly grow an unbounded pile of duplicates.
 */
function publicIdFor(subjectKey: string, index: number) {
  return `waystayy/channels/${subjectKey.replace(/[^a-zA-Z0-9_-]+/g, '-')}/${index}`
}

function isFetchableImageUrl(candidate: string) {
  try {
    const url = new URL(candidate)
    // Cloudinary must be able to reach it, and we should not be asking it to fetch
    // arbitrary internal addresses on our behalf.
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Re-hosts up to a handful of images and returns the ones that made it.
 *
 * Never throws. A listing with no photograph is worse than one with photographs but it
 * is still sellable, whereas an import that fails because a partner's CDN was slow
 * leaves nothing at all. Failures are logged and the import continues.
 */
export async function ingestImages(sourceUrls: string[], subjectKey: string): Promise<IngestedImage[]> {
  if (!cloudinaryIsConfigured()) {
    logger.warn('channels.images.skipped', undefined, { reason: 'cloudinary not configured', subjectKey })
    return []
  }

  const candidates = sourceUrls.filter(isFetchableImageUrl).slice(0, MAX_IMAGES_PER_SUBJECT)
  if (candidates.length === 0) return []

  const results: IngestedImage[] = []
  for (const [index, sourceUrl] of candidates.entries()) {
    try {
      const uploaded = await cloudinary.uploader.upload(sourceUrl, {
        public_id: publicIdFor(subjectKey, index),
        // Deterministic id plus overwrite makes a re-import replace in place.
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        timeout: UPLOAD_TIMEOUT_MS,
        transformation: [{ width: 1200, crop: 'limit' }, { quality: 'auto' }, { format: 'auto' }],
      })
      results.push({ url: uploaded.secure_url, publicId: uploaded.public_id })
    } catch (error) {
      // One unreachable photograph should not cost us the others.
      logger.warn('channels.images.upload_failed', error, { subjectKey, index })
    }
  }

  return results
}
