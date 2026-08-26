export type SearchLocationType = 'CITY' | 'LOCALITY' | 'LANDMARK' | 'AIRPORT'

export type SearchLocationCandidate = {
  id: string
  name: string
  normalizedName: string
  type: SearchLocationType
  state?: string | null
  parentLocationId: string | null
  latitude: number
  longitude: number
  radiusKm: number | null
  aliases: Array<{ alias: string; normalizedAlias: string }>
}

export type LocationResolution = {
  location: SearchLocationCandidate
  matchedText: string
  matchedBy: 'CANONICAL' | 'ALIAS' | 'FUZZY'
  score: number
}

export type LocationRadiusPlan = {
  initialKm: number
  expandedKm: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function locationRadiusPlan(
  type: SearchLocationType,
  configuredRadiusKm: number | null,
): LocationRadiusPlan {
  if (type === 'CITY') {
    const initialKm = Math.round(clamp(configuredRadiusKm ?? 40, 25, 50))
    return { initialKm, expandedKm: Math.round(Math.min(75, Math.max(initialKm + 10, initialKm * 1.5))) }
  }
  if (type === 'LOCALITY') {
    const initialKm = Math.round(clamp(configuredRadiusKm ?? 5, 3, 7))
    return { initialKm, expandedKm: Math.round(Math.min(15, Math.max(10, initialKm * 2))) }
  }

  const initialKm = Math.round(clamp(configuredRadiusKm ?? 10, 5, 15))
  return { initialKm, expandedKm: Math.round(Math.min(30, Math.max(10, initialKm * 2))) }
}

export function normalizeLocationQuery(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function levenshteinDistance(first: string, second: string) {
  if (first === second) return 0
  if (first.length === 0) return second.length
  if (second.length === 0) return first.length

  let previous = Array.from({ length: second.length + 1 }, (_, index) => index)
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    const current = [firstIndex]
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const substitutionCost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1
      current[secondIndex] = Math.min(
        current[secondIndex - 1] + 1,
        previous[secondIndex] + 1,
        previous[secondIndex - 1] + substitutionCost,
      )
    }
    previous = current
  }
  return previous[second.length]
}

function similarity(first: string, second: string) {
  const longestLength = Math.max(first.length, second.length)
  return longestLength === 0 ? 1 : 1 - (levenshteinDistance(first, second) / longestLength)
}

function termScore(query: string, term: string) {
  if (query === term) return 1
  if (/^\d+$/.test(query)) return 0

  const lengthDifference = Math.abs(query.length - term.length)
  if (query.length >= 3 && (term.startsWith(query) || query.startsWith(term))) {
    return Math.max(0.76, 0.9 - (lengthDifference * 0.015))
  }

  const queryTokens = new Set(query.split(' '))
  const termTokens = new Set(term.split(' '))
  const sharedTokens = [...queryTokens].filter(token => termTokens.has(token)).length
  const tokenScore = sharedTokens > 0
    ? sharedTokens / new Set([...queryTokens, ...termTokens]).size
    : 0

  return Math.max(similarity(query, term), tokenScore * 0.86)
}

export function resolveLocation(
  input: string,
  locations: SearchLocationCandidate[],
): LocationResolution | null {
  const query = normalizeLocationQuery(input)
  if (!query) return null

  let best: LocationResolution | null = null
  for (const location of locations) {
    const terms = [
      { text: location.name, normalized: location.normalizedName, source: 'CANONICAL' as const },
      ...location.aliases.map(alias => ({
        text: alias.alias,
        normalized: alias.normalizedAlias,
        source: 'ALIAS' as const,
      })),
    ]

    for (const term of terms) {
      const normalizedTerm = normalizeLocationQuery(term.normalized || term.text)
      const score = termScore(query, normalizedTerm)
      const matchedBy = score === 1 ? term.source : 'FUZZY'
      if (!best || score > best.score || (score === best.score && term.source === 'CANONICAL')) {
        best = { location, matchedText: term.text, matchedBy, score }
      }
    }
  }

  const minimumScore = /^\d+$/.test(query) ? 1 : query.length < 4 ? 0.85 : 0.7
  return best && best.score >= minimumScore ? best : null
}

export function descendantLocationIds(locations: SearchLocationCandidate[], rootLocationId: string) {
  const result = new Set([rootLocationId])
  let addedLocation = true
  while (addedLocation) {
    addedLocation = false
    for (const location of locations) {
      if (location.parentLocationId && result.has(location.parentLocationId) && !result.has(location.id)) {
        result.add(location.id)
        addedLocation = true
      }
    }
  }
  return result
}
