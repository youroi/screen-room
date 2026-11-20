## ADDED Requirements

### Requirement: Browse by production country and genre

Movies SHALL provide Country and Genre selections that can be combined over the movie catalogue and keep descending popularity order.

#### Scenario: A user filters a co-production

- **WHEN** the user selects a production country and a genre
- **THEN** every indexed movie with the selected genre and that production country can appear
- **AND** pagination applies after both filters
- **AND** the original language does not determine country membership

#### Scenario: A user changes filters

- **WHEN** either selection changes
- **THEN** the filtered browser opens page one
- **AND** an empty result offers to clear filters

#### Scenario: A user returns from movie details

- **WHEN** a user navigates Back from a movie
- **THEN** Movies restores the selections, page number, and vertical scroll position

### Requirement: Independent Movies page

Movies SHALL use the Quiet Cinema poster grid with responsive selectors and reserve poster space before artwork loads.

#### Scenario: A user browses Movies

- **WHEN** the user opens Movies or a movie detail
- **THEN** metadata and artwork load without contacting Circle
- **AND** Circle is contacted when the user selects Play
