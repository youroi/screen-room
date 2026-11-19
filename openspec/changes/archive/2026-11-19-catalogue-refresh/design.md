## Decisions

- Trending preserves the TMDB weekly order of supported movies and series with IMDb IDs.
- Latest uses the original digital date in Bangladesh, India, or the United States in that market order. Confirm date and release type on the title record. Use the last four weeks and sort newest first. On equal dates prefer a title absent from Trending.
- Hindi evidence lists each movie or explicitly confirmed season and its distributor source. A confirmed season qualifies its series for promotion. The order within each priority group stays stable.
- Existing artwork and catalogue data render independently. Home fetches one same-origin snapshot and inserts the two rows below the first two shelves.
- A successful refresh writes atomically, saves the validated snapshot to `gh-pages`, and deploys it through GitHub Pages Actions. Code-only deployments reuse the saved snapshot.
