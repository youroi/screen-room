## Decisions

- Quiet Cinema uses near-black surfaces, local Inter, a lowercase wordmark, and muted champagne for active controls. Portrait artwork and the bottom-aligned title form the hero.
- The Home carousel rotates every seven seconds while visible. Pause preference survives navigation independently of temporary touch, hover, and visibility suspensions.
- Home shows Popular Movies, Popular Series, Top Rated Movies, Animation, and K-Dramas. Cinemeta supplies the popularity feeds. Editorial selections supply featured titles and the other rows using verified IMDb IDs.
- Home, Movies, and Series are primary destinations. Search opens a separate view. Row positions survive a return from details.
- Prioritize the opening artwork, use responsive sources and lazy row posters, and reuse recent metadata requests.
