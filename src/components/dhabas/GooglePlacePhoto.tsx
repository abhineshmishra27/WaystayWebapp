'use client'

import { useState, type ReactNode } from 'react'

type PhotoAttribution = {
  displayName: string
  uri: string | null
}

type GooglePlacePhotoProps = {
  photoName: string | null
  attributions: PhotoAttribution[]
  alt: string
  imageClassName: string
  wrapperClassName: string
  attributionClassName: string
  fallback: ReactNode
}

export default function GooglePlacePhoto({
  photoName,
  attributions,
  alt,
  imageClassName,
  wrapperClassName,
  attributionClassName,
  fallback,
}: GooglePlacePhotoProps) {
  const [failed, setFailed] = useState(false)
  if (!photoName || failed) return <>{fallback}</>

  const source = `/api/google-place-photo?name=${encodeURIComponent(photoName)}`
  return (
    <div className={wrapperClassName}>
      {/* The server route obtains the Google photo without exposing the API key. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={imageClassName} src={source} alt={alt} loading="lazy" onError={() => setFailed(true)} />
      {attributions.length > 0 && (
        <span className={attributionClassName}>
          Photo by {attributions.map((attribution, index) => (
            <span key={`${attribution.displayName}-${index}`}>
              {index > 0 && ', '}
              {attribution.uri ? <a href={attribution.uri} target="_blank" rel="noreferrer">{attribution.displayName}</a> : attribution.displayName}
            </span>
          ))}
        </span>
      )}
    </div>
  )
}
