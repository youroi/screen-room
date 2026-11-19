# Screen Room

[Open Screen Room](https://youroi.github.io/screen-room/) on a phone or desktop. Browse and search movies and series, then open the title page for artwork, details and episodes. [Cinemeta](https://github.com/Stremio/stremio-official-addons) supplies metadata.

Circle FTP is the only playback source. Browse, Search and title details run on the public site. **Play** opens the selected title or episode directly in the same tab. The browser looks up and streams the video through the viewer's BDIX connection. Browser Back and the player's Browse and Search links return to the public site.

In Via, install the Screen Room script from [Player setup](https://youroi.github.io/screen-room/web-play.html) once. Other browsers can use the bookmark described there. Screen Room prepares MKV audio on the Watch page and prefers Hindi, then the original or default track. Playback settings let you change the audio track, speed, and volume. The browser audio decoders cover AAC, AC-3, E-AC-3, DTS, and Dolby TrueHD when the file server supports byte ranges.

## Development

Node.js 24+ serves the app locally with the same browse and search flow. The local development server uses Circle for playback resolution and forwards byte-range requests.

```sh
npm start
npm test
```

The seek regression also runs in Chromium. Generate a local test clip with
`ffmpeg -f lavfi -i testsrc2=size=640x360:rate=25 -t 18 -c:v libx264 -movflags +faststart /tmp/screen-room-clip.mp4`,
start `node qa/seek-fixture.mjs /tmp/screen-room-clip.mp4`, and run `playwright-cli run-code --filename=qa/seek.browser.js` in a Chromium session.

The [Circle provider](https://github.com/Riaz-404/nuvio-bdix-plugin/blob/main/src/providers/circleftp.js) documents the upstream playback shape.
