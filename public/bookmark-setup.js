const home = new URL('./circle-web.js', import.meta.url).href
const code = document.querySelector('#bookmark-code')
const copy = document.querySelector('#copy-bookmark')
const status = document.querySelector('#copy-status')
if (/^#\/watch\/(?:movie|series)\/tt\d{5,12}(?:\?episode=\d+-\d+)?$/.test(location.hash)) {
  document.querySelector('#circle-tab').hash = location.hash
}

code.value = 'javascript:(()=>{if(!["http://new.circleftp.net:5000","http://15.1.1.50:5000"].includes(location.origin)){alert("Open the Circle playback tab first.");return}if(document.querySelector("script[data-screen-room]"))return;const s=document.createElement("script");s.type="module";s.dataset.screenRoom="1";s.src=' +
  JSON.stringify(home) + ';s.onerror=()=>{s.remove();alert("Screen Room could not load in this tab.")};document.head.append(s)})()'

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(code.value)
    status.textContent = 'Bookmark URL copied.'
  } catch {
    code.focus()
    code.select()
    status.textContent = 'Copy the selected URL.'
  }
})
