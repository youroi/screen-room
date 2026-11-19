## Why

Circle MKVs can start silently while Screen Room waits for the native decoder. Viewers also need a predictable language preference and playback controls that fit a phone.

## What Changes

- Prepare browser audio as playback opens and warm the target audio during a seek.
- Prefer Hindi, fall back to the original or default track, and let the viewer switch tracks.
- Bring timeline, ten-second jumps, speed, audio and fullscreen into the Watch player.

## Capabilities

### Modified Capabilities

- `catalogue`: Circle playback and Watch controls.

## Impact

Watch UI and browser audio decoding. Circle media requests still originate from the browser.
