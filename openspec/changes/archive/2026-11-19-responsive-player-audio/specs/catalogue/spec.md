## ADDED Requirements

### Requirement: Preferred browser audio

Screen Room SHALL prepare playable Circle MKV audio without waiting for native audio playback to fail.

#### Scenario: Hindi and original audio are available

- **WHEN** a Circle MKV contains a Hindi track that the player can decode
- **THEN** the player selects Hindi first
- **AND** the original or default track is the automatic fallback

#### Scenario: The viewer seeks

- **WHEN** the viewer seeks in a stream with browser-decoded audio
- **THEN** the player prepares audio at the requested position while video seeks
- **AND** resumes the audio against the video's playback clock

### Requirement: Watch controls

The Watch player SHALL expose seeking, ten-second jumps, speed, volume, audio track selection when available, and fullscreen.

#### Scenario: The player opens on a phone

- **WHEN** the viewport is narrow
- **THEN** the main controls remain reachable and secondary controls open in a disclosure
