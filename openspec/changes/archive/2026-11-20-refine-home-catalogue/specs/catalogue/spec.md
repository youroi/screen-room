## MODIFIED Requirements

### Requirement: Featured catalogue gallery

The Home page SHALL show six distinct released featured titles spanning movies, series and animation as original portrait artwork paired with the title in a bottom-aligned editorial layout.

#### Scenario: The catalogue refreshes featured titles

- **WHEN** the refresh selects featured titles
- **THEN** it prioritizes recent actual audio and seek verification, recency, popularity, and usable artwork
- **AND** it expires old playback verification and makes no Circle request on Home

#### Scenario: A visitor changes the highlighted title

- **WHEN** the visitor swipes or chooses a pagination segment
- **THEN** the gallery shows the selected title and pauses automatic rotation
- **AND** the artwork and title open the corresponding details page

#### Scenario: Rotation is enabled

- **WHEN** the gallery is visible and a visitor is not interacting with it
- **THEN** the gallery advances automatically
- **AND** a paused preference survives temporary suspension and navigation

### Requirement: Catalogue discovery and navigation

Home SHALL show Popular Movies, Popular Series, Trending This Week, Latest Releases, Animation, and K-Dramas as manually browsable rows with up to 30 eligible titles each.

#### Scenario: A visitor returns from details

- **WHEN** the visitor returns after following a row title
- **THEN** vertical and horizontal browsing positions are restored

#### Scenario: A visitor switches sections

- **WHEN** the visitor selects Home, Movies, or Series from bottom navigation
- **THEN** that destination opens directly

### Requirement: Weekly trends and regional digital releases

Home SHALL display released weekly TMDB trends and recent regional digital movie releases from a validated snapshot.

#### Scenario: A visitor browses the new rows

- **WHEN** a valid snapshot is available
- **THEN** Trending preserves weekly feed order after removing titles without a regular public release
- **AND** Latest Releases sorts movies by confirmed regional digital release date
- **AND** an entry in Latest requires a streaming, rental, or purchase listing in the same market
- **AND** upcoming titles, premieres, and previews do not qualify
- **AND** the two rows preserve their source orders when a title qualifies in both

#### Scenario: An upstream request fails

- **WHEN** the refresh fails to produce a valid snapshot
- **THEN** the deployed site retains the previous snapshot

### Requirement: Official Hindi dub priority

The existing popular and genre rows SHALL prioritise officially confirmed Hindi dubs.

#### Scenario: A title has a confirmed dub

- **WHEN** a title's movie record or its featured season records an official Hindi dub
- **THEN** the title moves ahead of unconfirmed titles within its eligible row
- **AND** the priority implies no Circle source or audio availability

### Requirement: Released popular titles

Popular Movies and Popular Series SHALL come from the release-checked snapshot with global, Indian, Korean and Japanese candidates selected for relevance.

#### Scenario: The popularity feed contains an unreleased title

- **WHEN** a movie lacks a regular theatrical or digital release or a series lacks an aired full episode
- **THEN** the row takes the next eligible candidate from the popularity feed
- **AND** official Hindi dub priority applies within the eligible row
