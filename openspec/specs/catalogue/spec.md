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

Screen Room SHALL look for a matching Circle video when the visitor opens the playback tab.

#### Scenario: A visitor selects Play from the public site

- **WHEN** the visitor selects Play on a title or episode
- **THEN** the player opens directly in the same tab
- **AND** Circle receives no requests during Browse, Search or title details
- **AND** browser Back and the player's Browse, Search and title details links return to the public site

#### Scenario: The requested stream is unavailable

- **WHEN** Circle cannot be reached, the matching video is absent or the browser cannot open its URL
- **THEN** the Watch page explains the playback issue and keeps navigation available

#### Scenario: A visitor opens Screen Room in a Circle browser tab

- **WHEN** the visitor runs the Screen Room bookmark on an approved Circle HTTP origin
- **THEN** the browser loads the Screen Room UI and resolves playback from that Circle origin

#### Scenario: Circle lists a release under a different name

- **WHEN** the primary title lookup returns no playable match and the title has an IMDb identifier
- **THEN** the app tries original and alternate names linked to that identifier in Wikidata
- **AND** it rejects releases with a conflicting identifier, release year, or requested episode

#### Scenario: The browser cannot play the audio of a matched stream

- **WHEN** the visitor requests another stream from the Circle playback tab
- **THEN** the app tries a different matching Circle link and keeps the current player if no alternative is found

#### Scenario: The browser plays video without decoding audio at startup

- **WHEN** the browser reports several seconds of unmuted video playback without decoded audio
- **THEN** the player tries one matching alternative while the visitor is still near the start
- **AND** reopening the same title in the tab prefers the stream that last decoded audio

#### Scenario: Circle stalls during a seek

- **WHEN** a seek remains incomplete for eight seconds
- **THEN** the player cancels loading and offers to retry or resume from the last playable position
- **AND** playback details show the requested position, the range response available to the browser and the buffered positions

#### Scenario: Circle sends a full file for a byte-range request

- **WHEN** the player checks an unbuffered seek and receives a full-file response to the byte-range probe
- **THEN** the player cancels the probe, keeps the existing playback position and allows seeking within the buffered video

### Requirement: Preferred browser audio

Screen Room SHALL prepare playable Circle MKV audio without waiting for native audio playback to fail.

#### Scenario: Hindi and original audio are available

- **WHEN** a Circle MKV contains a Hindi track that the player can decode
- **THEN** the player selects Hindi first
- **AND** the original or default track is the automatic fallback

#### Scenario: The viewer seeks

- **WHEN** the viewer seeks in a stream with browser-decoded audio
- **THEN** the player prepares audio at the requested position while video seeks
- **AND** resumes video when the selected audio is ready, keeping both on the video's playback clock

#### Scenario: Decoded audio runs low during playback

- **WHEN** the next browser-decoded audio samples are delayed
- **THEN** the player briefly buffers both audio and video
- **AND** it resumes from the same position using the buffered audio

### Requirement: Watch controls

The Watch player SHALL expose seeking, ten-second jumps, speed, volume, audio track selection when available, and fullscreen.

#### Scenario: The player opens on a phone

- **WHEN** the viewport is narrow
- **THEN** the main controls remain reachable and secondary controls open in a disclosure

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
