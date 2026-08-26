export type RelevanceSignals = {
  locationMatch: number
  hotelTextMatch: number
  distance: number
  ratingQuality: number
  reviewConfidence: number
  bookingPopularity: number
}

const RELEVANCE_WEIGHTS: Record<keyof RelevanceSignals, number> = {
  locationMatch: 0.45,
  hotelTextMatch: 0.2,
  distance: 0.15,
  ratingQuality: 0.1,
  reviewConfidence: 0.05,
  bookingPopularity: 0.05,
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
}

export function bayesianRating(
  averageRating: number,
  reviewCount: number,
  globalMean: number,
  priorReviewCount = 20,
) {
  const votes = Math.max(0, reviewCount)
  const prior = Math.max(1, priorReviewCount)
  return ((votes * averageRating) + (prior * globalMean)) / (votes + prior)
}

export function distanceRelevance(distanceKm: number | null, radiusKm: number) {
  if (distanceKm === null || !Number.isFinite(distanceKm)) return 0
  return clampUnit(1 - (Math.max(0, distanceKm) / Math.max(1, radiusKm)))
}

export function reviewConfidence(reviewCount: number, confidenceReviewCount = 20) {
  const votes = Math.max(0, reviewCount)
  return votes / (votes + Math.max(1, confidenceReviewCount))
}

export function bookingPopularity(bookingCount: number, highestBookingCount: number) {
  if (bookingCount <= 0 || highestBookingCount <= 0) return 0
  return clampUnit(Math.log1p(bookingCount) / Math.log1p(highestBookingCount))
}

export function calculateRelevanceScore(signals: RelevanceSignals) {
  const weightedScore = (Object.keys(RELEVANCE_WEIGHTS) as Array<keyof RelevanceSignals>)
    .reduce((total, signal) => total + (clampUnit(signals[signal]) * RELEVANCE_WEIGHTS[signal]), 0)

  return Number((weightedScore * 100).toFixed(2))
}
