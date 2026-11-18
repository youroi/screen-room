# catalogue Specification

## Purpose
Browse independent title metadata and play a matching video from Circle in the browser.

## Requirements

### Requirement: Independent catalogue

Screen Room SHALL show movies, series, search results and title details from an independent metadata source.

#### Scenario: A visitor opens the hosted app

- **WHEN** the visitor opens Browse, Search or a Title page
- **THEN** the page displays metadata without a Circle request or connection setup

### Requirement: Circle playback lookup

Screen Room SHALL look for a matching Circle video when the visitor opens Watch.

#### Scenario: The requested stream is unavailable

- **WHEN** Circle cannot be reached, the matching video is absent or the browser cannot open its URL
- **THEN** the Watch page explains the playback issue and keeps navigation available

#### Scenario: A visitor opens Screen Room in a Circle browser tab

- **WHEN** the visitor runs the Screen Room bookmark on an approved Circle HTTP origin
- **THEN** the browser loads the Screen Room UI and resolves playback from that Circle origin

#### Scenario: Circle stalls during a seek

- **WHEN** a seek remains incomplete for eight seconds
- **THEN** the player reopens the same stream and retries the requested position once
- **AND** if the retry stalls, it stops the spinner and offers to retry or resume from the last playable position
