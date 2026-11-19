## MODIFIED Requirements

### Requirement: Weekly trends and regional digital releases

Home SHALL display released weekly TMDB trends and recent regional public movie releases from a validated snapshot.

#### Scenario: A visitor browses the new rows

- **WHEN** a valid snapshot is available
- **THEN** Trending preserves weekly feed order after removing titles without a regular public release
- **AND** Latest Releases sorts movies by confirmed regional regular theatrical or digital release date
- **AND** upcoming titles, premieres, and previews do not qualify
- **AND** the two rows preserve their source orders when a title qualifies in both
- **AND** the app displays the approved TMDB logo and attribution notice

#### Scenario: An upstream request fails

- **WHEN** the refresh fails to produce a valid snapshot
- **THEN** the deployed site retains the previous snapshot

## ADDED Requirements

### Requirement: Released popular titles

Popular Movies and Popular Series SHALL come from the release-checked snapshot.

#### Scenario: The popularity feed contains an unreleased title

- **WHEN** a movie lacks a regular theatrical or digital release or a series lacks an aired full episode
- **THEN** the row takes the next eligible candidate from the popularity feed
- **AND** official Hindi dub priority applies within the eligible row
