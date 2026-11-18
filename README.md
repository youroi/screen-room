# Screen Room

Screen Room is a custom Circle FTP catalogue and player with separate browse, search, title and watch views.

## Connect the hosted app

1. Download [Screen Room](https://github.com/youroi/screen-room/archive/refs/heads/main.zip) and extract it on a computer connected to the BDIX network that reaches Circle. Use Node.js 24 or later.
2. In the extracted folder, run `npm start`. The helper starts at `http://127.0.0.1:4174`.
3. Open [Screen Room on GitHub Pages](https://youroi.github.io/screen-room/) in Chrome on that computer. Select **Connect** and allow local network access when prompted.

To watch from a second device on the same trusted Wi-Fi, start the helper on the computer with `SCREENROOM_HOST=0.0.0.0 npm start`. On Windows PowerShell, use `$env:SCREENROOM_HOST = '0.0.0.0'` before `npm start`. Put its local IP address and port 4174 in the hosted app's **Helper address** field.

GitHub Pages serves the HTML, CSS, JavaScript and font. The helper fetches the Circle catalogue and video bytes through its own BDIX connection. Circle's API uses HTTP and resolves to an address Chrome classifies as public, so the helper provides a local origin for the HTTPS page to connect to.

## Run locally

The same process also serves the app at [http://127.0.0.1:4174](http://127.0.0.1:4174). Play opens the player directly, preloads the stream, and passes byte ranges to Circle. Startup and seek times depend on Circle, the ISP connection, and the browser's codec support.

Run `npm test` for catalogue, fallback, episode, route, range and hosted-origin checks. The test upstream is local.

The [Circle provider](https://github.com/Riaz-404/nuvio-bdix-plugin/blob/main/src/providers/circleftp.js) and [CloudStream provider](https://github.com/redowan99/Redowan-CloudStream/blob/master/BdixCircleftp/src/main/kotlin/com/redowan/CircleFtpProvider.kt) document the upstream response shape.
