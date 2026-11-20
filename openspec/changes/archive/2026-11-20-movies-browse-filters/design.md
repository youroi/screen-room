## Decisions

- Use production-country membership from the movie metadata. The TMDB origin-country Discover query excludes secondary production countries.
- Sort the eligible corpus by popularity before grouping. A co-production is included in every supported country that produced it. Publish compact result shards and counts for each combined filter.
- Keep a small manifest and one result shard on the Movies read path. Reuse native selects, poster cards and the existing single-page navigation and Back restoration.
- Build and validate Movies data separately from the Home snapshot. Publish the previous validated index if Movies generation fails.
