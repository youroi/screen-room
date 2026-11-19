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

The `Publish catalogue` GitHub Actions workflow refreshes the hero and six Home rows at 10:23 UTC daily. Set the API Read Access Token as the `TMDB_READ_TOKEN` Actions secret. Run the workflow with its refresh option enabled for an immediate update. A failed refresh retains the last validated snapshot from `gh-pages`.

Popular uses global, Indian, Korean and Japanese feeds. Trending keeps the original weekly feed order after release checks. Latest Releases requires a digital debut and a streaming, rental or purchase listing in the same market. The market preference is Bangladesh, India, Korea, Japan, then the United States.

After checking real Circle playback in Via, record the title's IMDb ID in `scripts/featured-playback.json` with `date` (UTC, YYYY-MM-DD), `audio: true`, `seek: true` and the tested `season` for a series. Only checks within the past 14 days get priority. The refresh job and Home never connect to Circle.

Edit `public/hindi-dubs.js` to add verified dubs. Use an official movie source or a source for each confirmed season. A series gets a boost when its latest aired season is confirmed. These records rank titles independently of the audio tracks in a Circle file.

The seek regression also runs in Chromium. Generate a local test clip with
`ffmpeg -f lavfi -i testsrc2=size=640x360:rate=25 -t 18 -c:v libx264 -movflags +faststart /tmp/screen-room-clip.mp4`,
start `node qa/seek-fixture.mjs /tmp/screen-room-clip.mp4`, and run `playwright-cli run-code --filename=qa/seek.browser.js` in a Chromium session.

For the catalogue browser check, start `SCREENROOM_PORT=4190 npm start`, open a Chromium session with `playwright-cli open --mobile`, and run `playwright-cli run-code --filename=qa/quiet-cinema.browser.js`.

The [Circle provider](https://github.com/Riaz-404/nuvio-bdix-plugin/blob/main/src/providers/circleftp.js) documents the upstream playback shape.
