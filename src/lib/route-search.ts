export type RouteCoordinate = {
  latitude: number
  longitude: number
}

export type RouteProjection = {
  detourKm: number
  progress: number
  distanceFromStartKm: number
}

const EARTH_RADIUS_KM = 6371

function degreesToRadians(value: number) {
  return value * (Math.PI / 180)
}

export function haversineKm(first: RouteCoordinate, second: RouteCoordinate) {
  const latitudeDelta = degreesToRadians(second.latitude - first.latitude)
  const longitudeDelta = degreesToRadians(second.longitude - first.longitude)
  const firstLatitude = degreesToRadians(first.latitude)
  const secondLatitude = degreesToRadians(second.latitude)

  const haversine = (
    Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  )

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

/**
 * Projects a stop onto the direct corridor between two locations.
 *
 * This is deliberately a lightweight route approximation for discovery. The UI
 * labels the distances as estimates; turn-by-turn routing can replace this helper
 * later without changing the API contract or homepage component.
 */
export function projectStopOntoRoute(
  start: RouteCoordinate,
  end: RouteCoordinate,
  stop: RouteCoordinate,
): RouteProjection {
  const referenceLatitude = degreesToRadians((start.latitude + end.latitude) / 2)
  const longitudeScale = Math.cos(referenceLatitude)
  const toLocalPoint = (coordinate: RouteCoordinate) => ({
    x: coordinate.longitude * longitudeScale,
    y: coordinate.latitude,
  })

  const startPoint = toLocalPoint(start)
  const endPoint = toLocalPoint(end)
  const stopPoint = toLocalPoint(stop)
  const routeX = endPoint.x - startPoint.x
  const routeY = endPoint.y - startPoint.y
  const routeLengthSquared = (routeX ** 2) + (routeY ** 2)
  const rawProgress = routeLengthSquared === 0
    ? 0
    : (((stopPoint.x - startPoint.x) * routeX) + ((stopPoint.y - startPoint.y) * routeY)) / routeLengthSquared
  const progress = Math.min(1, Math.max(0, rawProgress))
  const closestPoint = {
    latitude: start.latitude + ((end.latitude - start.latitude) * progress),
    longitude: start.longitude + ((end.longitude - start.longitude) * progress),
  }
  const routeDistanceKm = haversineKm(start, end)

  return {
    detourKm: haversineKm(stop, closestPoint),
    progress,
    distanceFromStartKm: routeDistanceKm * progress,
  }
}

export function routeCorridorKm(routeDistanceKm: number) {
  return Math.round(Math.min(60, Math.max(25, routeDistanceKm * 0.12)))
}

/**
 * Decodes the compact polyline returned by Google Routes. Keeping this here makes the
 * one-kilometre route filter work on the actual road geometry, not a straight line
 * between a traveller's origin and destination.
 */
export function decodeGoogleEncodedPolyline(encodedPolyline: string): RouteCoordinate[] {
  const points: RouteCoordinate[] = []
  let index = 0
  let latitude = 0
  let longitude = 0

  function readValue() {
    let shift = 0
    let value = 0
    let current: number
    do {
      if (index >= encodedPolyline.length) throw new Error('Invalid encoded route polyline.')
      current = encodedPolyline.charCodeAt(index++) - 63
      value |= (current & 0x1f) << shift
      shift += 5
    } while (current >= 0x20)
    return (value & 1) ? ~(value >> 1) : (value >> 1)
  }

  while (index < encodedPolyline.length) {
    latitude += readValue()
    longitude += readValue()
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 })
  }

  return points
}

/** Projects a place onto the nearest segment of a driving-route polyline. */
export function projectStopOntoPolyline(route: RouteCoordinate[], stop: RouteCoordinate): RouteProjection {
  if (route.length < 2) throw new Error('A route needs at least two coordinates.')

  const segmentLengths = route.slice(1).map((point, index) => haversineKm(route[index], point))
  const totalDistanceKm = segmentLengths.reduce((total, distance) => total + distance, 0)
  const referenceLatitude = degreesToRadians(route.reduce((total, point) => total + point.latitude, 0) / route.length)
  const longitudeScale = Math.cos(referenceLatitude)
  const toLocalPoint = (coordinate: RouteCoordinate) => ({
    x: coordinate.longitude * longitudeScale,
    y: coordinate.latitude,
  })
  const stopPoint = toLocalPoint(stop)
  let distanceBeforeSegmentKm = 0
  let closestDistanceKm = Number.POSITIVE_INFINITY
  let closestDistanceFromStartKm = 0

  route.slice(1).forEach((end, index) => {
    const start = route[index]
    const startPoint = toLocalPoint(start)
    const endPoint = toLocalPoint(end)
    const segmentX = endPoint.x - startPoint.x
    const segmentY = endPoint.y - startPoint.y
    const segmentLengthSquared = (segmentX ** 2) + (segmentY ** 2)
    const rawProgress = segmentLengthSquared === 0
      ? 0
      : (((stopPoint.x - startPoint.x) * segmentX) + ((stopPoint.y - startPoint.y) * segmentY)) / segmentLengthSquared
    const progressOnSegment = Math.min(1, Math.max(0, rawProgress))
    const closestPoint = {
      latitude: start.latitude + ((end.latitude - start.latitude) * progressOnSegment),
      longitude: start.longitude + ((end.longitude - start.longitude) * progressOnSegment),
    }
    const distanceKm = haversineKm(stop, closestPoint)
    if (distanceKm < closestDistanceKm) {
      closestDistanceKm = distanceKm
      closestDistanceFromStartKm = distanceBeforeSegmentKm + (segmentLengths[index] * progressOnSegment)
    }
    distanceBeforeSegmentKm += segmentLengths[index]
  })

  return {
    detourKm: closestDistanceKm,
    progress: totalDistanceKm === 0 ? 0 : closestDistanceFromStartKm / totalDistanceKm,
    distanceFromStartKm: closestDistanceFromStartKm,
  }
}
