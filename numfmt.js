/* numfmt.js — app-wide number clarity (owner, Nov 17 2026).
   Wraps every % / pp / bp figure in a coloured span: + green, − red, plain ratios blue.
   Leaves figures alone where a page already colours them on purpose (up/dn/good/bad classes, inline colours). */
(function () {
  var RX = /(^|[^\w.])([+\-−–]?\s?\d[\d,]*(?:\.\d+)?)\s?(%|pp\b|bp\b)/g;
  var SKIP_TAG = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|TITLE|NOSCRIPT|CODE|PRE)$/;
  var SEM = /(^|[\s_-])(up|dn|down|pos|neg|good|bad|green|red|bull|bear|gain|loss|nf)([\s_-]|$)/i;
  function skip(el) {
    for (var i = 0; el && el !== document.body && i < 4; i++, el = el.parentElement) {
      if (SKIP_TAG.test(el.tagName) || el.isContentEditable || el.closest && el.closest("svg,.no-nf")) return 2;
      var c = typeof el.className === "string" ? el.className : "";
      if (SEM.test(c) || (el.style && el.style.color)) return 1;
    }
    return 0;
  }
  function wrap(tn) {
    var t = tn.nodeValue; if (!t || t.length > 2000 || !/\d\s?(%|pp|bp)/.test(t)) return;
    var p = tn.parentElement; if (!p) return; var s = skip(p); if (s === 2) return;
    RX.lastIndex = 0; var out = document.createDocumentFragment(), last = 0, m, hit = 0;
    while ((m = RX.exec(t))) {
      var num = m[2].replace(/\s/g, ""), sg = /^[+]/.test(num) ? "up" : /^[\-−–]/.test(num) ? "dn" : "pc";
      if (s === 1 && sg !== "pc") sg = "kp";   /* page colours it already: keep colour, just make it bold */
      if (s === 1 && sg === "pc") sg = "kp";
      var a = m.index + m[1].length;
      out.appendChild(document.createTextNode(t.slice(last, a)));
      var sp = document.createElement("span"); sp.className = "nf nf-" + sg; sp.textContent = t.slice(a, RX.lastIndex);
      out.appendChild(sp); last = RX.lastIndex; hit = 1;
    }
    if (!hit) return;
    out.appendChild(document.createTextNode(t.slice(last)));
    p.replaceChild(out, tn);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!(root.parentElement && root.parentElement.closest(".nf"))) wrap(root); return; }
    if (root.nodeType !== 1 || SKIP_TAG.test(root.tagName) || root.closest(".nf,svg")) return;
    var w = document.createTreeWalker(root, 4, null), a = [], n;
    while ((n = w.nextNode())) a.push(n);
    for (var i = 0; i < a.length; i++) if (!(a[i].parentElement && a[i].parentElement.closest(".nf"))) wrap(a[i]);
  }
  var Q = [], due = 0;
  function flush() { due = 0; var q = Q; Q = []; for (var i = 0; i < q.length; i++) if (q[i].isConnected) scan(q[i]); }
  new MutationObserver(function (ms) {
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.type === "characterData") { Q.push(m.target); continue; }
      for (var j = 0; j < m.addedNodes.length; j++) { var x = m.addedNodes[j]; if (!(x.nodeType === 1 && x.classList.contains("nf"))) Q.push(x); }
    }
    if (Q.length && !due) { due = 1; requestAnimationFrame(flush); }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  var st = document.createElement("style");
  st.textContent =
    "body{font-variant-numeric:tabular-nums lining-nums}" +
    ".nf{font-weight:700;white-space:nowrap;font-style:normal}" +
    ".nf-up{color:#34d67f}.nf-dn{color:#ff6262}.nf-pc{color:#ffb84d}" +
    "html[data-theme=light] .nf-up{color:#0d8a4a}html[data-theme=light] .nf-dn{color:#c62828}html[data-theme=light] .nf-pc{color:#a85d00}" +
    "td,th{font-style:normal}" +
    ".cx-t td{font-size:13.5px;font-weight:500;color:var(--ink)}" +
    ".cx-t td[data-calc],.cx-t td.calc{text-decoration:underline dotted rgba(140,160,190,.55);text-underline-offset:3px}";
  document.head.appendChild(st);
  scan(document.body);
})();
