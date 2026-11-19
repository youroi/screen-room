// Movie availability is title-level. A series entry identifies the seasons with evidence.
const verifiedDubs = {
  tt4154796: { source: 'https://www.youtube.com/watch?v=AxPP8I5_l7g' }, // Avengers: Endgame
  tt7631058: { seasons: { 1: 'https://www.primevideo.com/detail/0TUVXIO58IUNEPNBF8363Z7YGL' } }, // The Rings of Power
  tt27995113: { seasons: { 1: 'https://www.netflix.com/in/title/81682935' } }, // Black Doves
  tt20869502: { seasons: { 1: 'https://www.netflix.com/in/browse/genre/81610864' } }, // Extraordinary Attorney Woo
  tt21344706: { seasons: { 1: 'https://www.netflix.com/in/title/81519223' } }, // The Glory
  tt27668559: { seasons: { 1: 'https://www.netflix.com/in/title/81707950' } }, // Queen of Tears
  tt13309742: { seasons: { 1: 'https://www.netflix.com/in/title/81144203' } }, // Blue Eye Samurai
  tt2560140: { seasons: { 1: 'https://www.youtube.com/watch?v=QjJ4iPOQF_Y' } } // Attack on Titan
}

export function hasHindiDub(item, season) {
  const entry = verifiedDubs[item.id]
  if (item.kind === 'movie') return Boolean(entry?.source)
  const seasons = entry?.seasons
  return Boolean(seasons && (season === undefined ? Object.keys(seasons).length : Object.hasOwn(seasons, season)))
}

export function prioritizeHindi(items) {
  const dubbed = []
  const remaining = []
  for (const item of items) {
    (hasHindiDub(item) ? dubbed : remaining).push(item)
  }
  return dubbed.concat(remaining)
}
