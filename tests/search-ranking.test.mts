import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bayesianRating,
  bookingPopularity,
  calculateRelevanceScore,
  distanceRelevance,
  reviewConfidence,
} from '../src/lib/search-ranking.ts'

test('Bayesian rating prevents one perfect review from beating a proven hotel', () => {
  const onePerfectReview = bayesianRating(5, 1, 4, 20)
  const manyStrongReviews = bayesianRating(4.6, 200, 4, 20)
  assert.ok(manyStrongReviews > onePerfectReview)
})

test('distance, reviews, and popularity are normalized', () => {
  assert.equal(distanceRelevance(0, 10), 1)
  assert.equal(distanceRelevance(10, 10), 0)
  assert.equal(reviewConfidence(0), 0)
  assert.equal(bookingPopularity(10, 10), 1)
})

test('relevance score applies the configured 45/20/15/10/5/5 weights', () => {
  assert.equal(calculateRelevanceScore({
    locationMatch: 1,
    hotelTextMatch: 1,
    distance: 1,
    ratingQuality: 1,
    reviewConfidence: 1,
    bookingPopularity: 1,
  }), 100)
  assert.equal(calculateRelevanceScore({
    locationMatch: 1,
    hotelTextMatch: 0,
    distance: 0,
    ratingQuality: 0,
    reviewConfidence: 0,
    bookingPopularity: 0,
  }), 45)
})
