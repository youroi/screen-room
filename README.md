# still.

[Open still.](https://youroi.github.io/screen-room/) on a phone or desktop. Browse and search movies and series, then open the title page for artwork, details and episodes. [Cinemeta](https://github.com/Stremio/stremio-official-addons) supplies metadata.

Circle FTP is the only playback source. Home, catalogue rows, Search and title details run on the public site. **Play** opens the selected title or episode directly in the same tab. The browser looks up and streams the video through the viewer's BDIX connection. Browser Back and the player's Home and Search links return to the public site.

In Via, install the player script once from **Player setup** next to Play on a title page. Other browsers can use the bookmark described there. The browser prepares MKV audio on the Watch page and prefers Hindi, then the original or default track. Playback settings let you change the audio track, speed, and volume. The browser audio decoders cover AAC, AC-3, E-AC-3, DTS, and Dolby TrueHD when the file server supports byte ranges.

## Development

Node.js 24+ serves the app locally with the same browse and search flow. The local development server uses Circle for playback resolution and forwards byte-range requests.

```sh
npm start
npm test
```

## Catalogue refresh

The `Publish catalogue` GitHub Actions workflow refreshes the weekly TMDB feed and digital releases at 10:23 UTC daily. It reads the API Read Access Token from the `TMDB_READ_TOKEN` Actions secret. Run the workflow with its refresh option enabled for an immediate update. A failed refresh leaves the previous validated snapshot in place. A code-only deployment copies that snapshot from `gh-pages` into the Pages artifact.

Latest Releases uses the first confirmed digital release in Bangladesh, India, or the United States, in that market preference order. The Top Rated row uses the [IMDb chart snapshot from 15 November 2026](https://movies.rankhistory.fyi/250/history/2026/11/15) in chart order.

Edit `public/hindi-dubs.js` to add verified dubs. Use an official movie source or a source for each confirmed season. The record affects catalogue order and has no bearing on a file's audio tracks.

The seek regression also runs in Chromium. Generate a local test clip with
`ffmpeg -f lavfi -i testsrc2=size=640x360:rate=25 -t 18 -c:v libx264 -movflags +faststart /tmp/screen-room-clip.mp4`,
start `node qa/seek-fixture.mjs /tmp/screen-room-clip.mp4`, and run `playwright-cli run-code --filename=qa/seek.browser.js` in a Chromium session.

For the catalogue browser check, start `SCREENROOM_PORT=4190 npm start`, open a Chromium session with `playwright-cli open --mobile`, and run `playwright-cli run-code --filename=qa/quiet-cinema.browser.js`.

The [Circle provider](https://github.com/Riaz-404/nuvio-bdix-plugin/blob/main/src/providers/circleftp.js) documents the upstream playback shape.
