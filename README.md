# Screen Room

[Open Screen Room](https://youroi.github.io/screen-room/) on a phone or desktop. Browse and search movies and series, then open the title page for artwork, details and episodes. [Cinemeta](https://github.com/Stremio/stremio-official-addons) supplies metadata.

Circle FTP is the only playback source. Screen Room looks for a matching stream when Watch opens. GitHub Pages uses HTTPS, so hosted playback needs a browser-readable HTTPS Circle endpoint and video URL. The published Circle API uses HTTP. If the source cannot be opened, Watch shows the playback error and Browse remains available.

## Development

Node.js 24+ serves the app locally with the same browse and search flow. The local development server uses Circle for playback resolution and forwards byte-range requests.

```sh
npm start
npm test
```

The [Circle provider](https://github.com/Riaz-404/nuvio-bdix-plugin/blob/main/src/providers/circleftp.js) documents the upstream playback shape.
