// Apply the stored theme before first paint to avoid a light/dark flash. Loaded as a classic
// (blocking) script from index.html; kept out of the bundle and not inline so the
// Content-Security-Policy can stay at script-src 'self'.
;(function () {
  try {
    var t = localStorage.getItem('gb-theme')
    var dark = t === 'dark' || ((!t || t === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)
    var root = document.documentElement
    if (dark) root.classList.add('dark')
    root.style.colorScheme = dark ? 'dark' : 'light'
  } catch {
    // Storage or matchMedia unavailable: keep the light default.
  }
})()
