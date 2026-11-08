# Publishing Wheelmates through IMD

The site in `public/` is static and talks to our own API (`public/config.js`). IMD picks `public/` up as the folder to serve. IMD hosts the static site; the server runs on
the owner's host.

On explorer.imd.fun/launch: **Website**, then start from GitHub with `https://github.com/am3en0x/wheelmates`.
`public/config.js` already points at the production API (`https://api.wheelmates.app`) everywhere except localhost,
so the IMD copy talks to the same server as wheelmates.app. 0.5 IMD from the Genesis-verified wallet.

Text for the page:

