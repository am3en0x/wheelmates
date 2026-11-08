// The API origin: the local server while developing, the production API everywhere else (the IMD mirror included).
window.WM = {
  api: /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8790' : 'https://api.wheelmates.app',
}
