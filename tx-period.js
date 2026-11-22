/* tx-period.js — one table layout across the desk (owner, Nov 18–19 2026): periods run ACROSS as columns, the fields run
   DOWN as rows. Any table whose first header is a period (Year, FY, Quarter, Month, Period) and that lists periods down
   the side is turned on its side after it renders. Cells keep their own markup and colour classes. Tables built with
   merged cells, more than 24 periods, or marked class="no-tx" are left alone. */
(function (root) {
  var doc = root.document, RX = /^(year|fy|fiscal year|quarter|qtr|month|period)$/i;
  function flip(t) {
    if (t.getAttribute("data-tx") || t.classList.contains("no-tx") || t.querySelector("[colspan],[rowspan]")) return;
    var hr = t.tHead && t.tHead.rows[0], body = t.tBodies[0]; if (!hr || !body) return;
    var H = [].slice.call(hr.cells); if (H.length < 3 || !RX.test(H[0].textContent.trim())) return;
    var R = [].slice.call(body.rows).concat(t.tFoot ? [].slice.call(t.tFoot.rows) : []);
    if (R.length < 2 || R.length > 24 || R.some(function (r) { return r.cells.length !== H.length || [].some.call(r.attributes, function (a) { return /^data-|^onclick$/.test(a.name); }); })) return;   /* interactive rows keep their layout */
    var th = '<tr><th class="tx-c0">' + H[0].innerHTML + "</th>" + R.map(function (r) { return '<th class="tx-p">' + r.cells[0].innerHTML + "</th>"; }).join("") + "</tr>";
    var rows = H.slice(1).map(function (h, j) {
      return '<tr><th scope="row" class="tx-l">' + h.innerHTML + "</th>" + R.map(function (r) { var c = r.cells[j + 1]; return "<td" + (c.className ? ' class="' + c.className + '"' : "") + (c.title ? ' title="' + c.title.replace(/"/g, "&quot;") + '"' : "") + (c.getAttribute("style") ? ' style="' + c.getAttribute("style").replace(/"/g, "&quot;") + '"' : "") + ">" + c.innerHTML + "</td>"; }).join("") + "</tr>";
    }).join("");
    t.innerHTML = "<thead>" + th + "</thead><tbody>" + rows + "</tbody>"; t.setAttribute("data-tx", "1"); t.classList.add("tx-flip");
  }
  function scan(el) { [].forEach.call((el || doc).querySelectorAll(".tab-panel table:not([data-tx])"), flip); }
  var due = 0;
  new MutationObserver(function () { if (!due) { due = 1; setTimeout(function () { due = 0; scan(); }, 120); } }).observe(doc.documentElement, { childList: true, subtree: true });
  var st = doc.createElement("style");
  st.textContent = "table.tx-flip thead{display:table-header-group!important}table.tx-flip tbody{display:table-row-group!important}table.tx-flip tr{display:table-row!important}" +
    "table.tx-flip td,table.tx-flip th{display:table-cell!important;white-space:nowrap}table.tx-flip td:before{content:none!important}" +
    "table.tx-flip th.tx-l{text-align:left;font-weight:600;color:var(--muted,#9aa7b8);position:sticky;left:0;background:var(--panel,#0b1016);z-index:1}" +
    "table.tx-flip th.tx-c0{text-align:left;position:sticky;left:0;background:var(--panel,#0b1016);z-index:2}table.tx-flip th.tx-p,table.tx-flip td{text-align:right!important}";
  doc.head.appendChild(st);
  root.TXPERIOD = { scan: scan };
})(window);
