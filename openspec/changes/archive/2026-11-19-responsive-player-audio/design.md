## Approach

Read MKV metadata and load the preferred decoder while Play is available. Reuse the Via range bridge and keep video on the existing HTML media element. Use Web Audio for the selected track and schedule it against the video clock. Prime audio at the seek target while the video loads that range.

Keep the current typography and palette. Place playback controls in a separate tray under the picture, with an inline settings disclosure and a responsive timeline.
