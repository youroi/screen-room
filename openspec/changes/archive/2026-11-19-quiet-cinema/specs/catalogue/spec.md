## MODIFIED Requirements

### Requirement: Featured catalogue gallery

The Home page SHALL show featured titles as original portrait artwork paired with the title in a bottom-aligned editorial layout.

#### Scenario: A visitor changes the highlighted title

- **WHEN** the visitor swipes or chooses a pagination segment
- **THEN** the gallery shows the selected title and pauses automatic rotation
- **AND** the artwork and title open the corresponding details page

#### Scenario: Rotation is enabled

- **WHEN** the gallery is visible and a visitor is not interacting with it
- **THEN** the gallery advances automatically
- **AND** a paused preference survives temporary suspension and navigation

## ADDED Requirements

### Requirement: Catalogue discovery and navigation

Home SHALL show Popular Movies, Popular Series, Top Rated Movies, Animation, and K-Dramas as manually browsable rows.

#### Scenario: A visitor returns from details

- **WHEN** the visitor returns after following a row title
- **THEN** vertical and horizontal browsing positions are restored

#### Scenario: A visitor switches sections

- **WHEN** the visitor selects Home, Movies, or Series from bottom navigation
- **THEN** that destination opens directly

### Requirement: Live title search

Search SHALL present matching movies and series as the visitor types and keep a local list of recent searches.

#### Scenario: A visitor opens search

- **WHEN** the visitor selects the search icon
- **THEN** the search field takes focus
- **AND** the visitor can reopen or clear recent searches when present
