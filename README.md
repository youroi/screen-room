# Screen Room

[Open Screen Room](https://youroi.github.io/screen-room/) on a phone or desktop. Browse and search movies and series, then open the title page for artwork, details and episodes. [Cinemeta](https://github.com/Stremio/stremio-official-addons) supplies metadata.

Circle FTP is the only playback source. Screen Room looks for a matching stream when Watch opens. The published Circle API uses HTTP. The [Circle web player](https://youroi.github.io/screen-room/web-play.html) opens the hosted UI in the Circle API tab using a Chrome bookmark. The browser then makes the playback lookup from the Circle origin and streams over the phone's BDIX connection. Open that tab and run the bookmark again after closing or reloading it.

If an MKV is silent, use **Browser audio**, run the updated Screen Room bookmark in the file-server tab, then select **Play with browser audio**. This mode decodes AC-3 and E-AC-3 in the browser and requires byte-range responses from the file server.

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
