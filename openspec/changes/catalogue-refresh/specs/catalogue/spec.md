## ADDED Requirements

### Requirement: Weekly trends and regional digital releases

Home SHALL display weekly TMDB trends and recent confirmed regional digital movie releases from a validated snapshot.

#### Scenario: A visitor browses the new rows

- **WHEN** a valid snapshot is available
- **THEN** the app preserves the weekly feed order and sorts Latest Releases by confirmed digital date
- **AND** the app displays the approved TMDB logo and attribution notice
- **AND** both rows remain independently ranked when a title appears in both

#### Scenario: An upstream request fails

- **WHEN** the scheduled refresh fails to produce a valid snapshot
- **THEN** the deployed site retains the previous snapshot

### Requirement: Official Hindi dub priority

The existing popular and genre rows SHALL prioritise officially confirmed Hindi dubs.

#### Scenario: A title has a confirmed dub

- **WHEN** a title's movie record or a season records an official Hindi dub
- **THEN** the title moves ahead of unconfirmed titles within its eligible row
- **AND** the priority implies no Circle source or audio availability
- **AND** the Top Rated row retains the chart's relative order
