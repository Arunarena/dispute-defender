// Cases: every dispute in one AG Grid table, with the AI's plan, win odds and the money it expects to keep.
// Sort, filter, search, export to CSV, click a row to open the case. Updates live and follows the theme.
while (!window.DD || !window.agGrid) await new Promise((r) => setTimeout(r, 50));
const DD = window.DD;
const { createGrid, themeQuartz, ModuleRegistry, AllCommunityModule } = window.agGrid;
ModuleRegistry?.registerModules?.([AllCommunityModule]);
const esc = DD.esc;
const $ = (s) => document.querySelector(s);

const DONE = ["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"];
const REASON = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  CREDIT_NOT_PROCESSED: "Refund not received",
};
const PLAN = {
  FIGHT: ["Fight", "var(--green)"],
  OFFER_PARTIAL_REFUND: ["Partial refund", "var(--violet)"],
  ACCEPT_CLAIM: ["Accept", "var(--red)"],
  SEND_MESSAGE: ["Reply", "var(--cyan)"],
};
const usd = (n) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
const daysLeft = (iso) => (iso ? Math.ceil((new Date(iso) - Date.now()) / 86400000) : null);
// Expected keep: for a fight, the amount at stake times the win odds; otherwise what the plan keeps.
const expectedKeep = (ai) => (!ai ? null : (Number(ai.saved) || 0) * (ai.verdict === "FIGHT" ? (ai.win ?? 0) / 100 : 1));

function rows() {
  return DD.state.disputes.map((d) => ({
    id: d.id,
    item: d.item ?? d.id,
    buyer: d.buyerName ?? "",
    amount: Number(d.amount?.value ?? 0),
    reason: REASON[d.reason] ?? d.reason ?? "",
    stage: d.stage === "INQUIRY" ? "Inquiry" : d.stage === "CHARGEBACK" ? "Chargeback" : d.stage ?? "",
    due: DONE.includes(d.status) ? null : daysLeft(d.sellerResponseDue),
    plan: d.ai?.verdict ?? null,
    win: d.ai?.verdict === "FIGHT" ? d.ai.win ?? null : null,
    keep: expectedKeep(d.ai),
    status: DONE.includes(d.status) ? (d.status === "RESOLVED" ? "Resolved" : "Waiting") : "Open",
  }));
}

// ---- cell renderers ----
const caseCell = (p) => {
  if (p.node.rowPinned) return `<b class="cg-total">${esc(p.data.item)}</b>`;
  const el = document.createElement("div");
  el.className = "cg-case";
  el.innerHTML = `<img src="${DD.imgFor(p.data.item)}" alt="" /><span><b>${esc(p.data.item)}</b><small>${esc(p.data.buyer)} · ${esc(p.data.id)}</small></span>`;
  return el;
};
const planCell = (p) => {
  if (p.node.rowPinned) return "";
  if (!p.value) return `<span class="cg-none">Not checked</span>`;
  const [label, color] = PLAN[p.value] ?? [p.value, "var(--muted)"];
  return `<span class="cg-plan" style="--pc:${color}">${label}</span>`;
};
const winCell = (p) => (p.value == null ? "" : `<span class="cg-win"><span class="cg-bar"><i style="width:${p.value}%"></i></span><b>${p.value}%</b></span>`);
const dueCell = (p) => (p.node.rowPinned ? "" : p.value == null ? `<span class="cg-none">Closed</span>` : `<span class="${p.value <= 5 ? "cg-soon" : ""}">${p.value} day${p.value === 1 ? "" : "s"}</span>`);
const statusCell = (p) => p.node.rowPinned ? "" : `<span class="cg-status ${p.value.toLowerCase()}">${p.value}</span>`;

// The grid's colors come from the app's own theme variables, so every theme switch restyles it.
const theme = themeQuartz.withParams({
  backgroundColor: "var(--panel-solid)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--muted)",
  headerBackgroundColor: "rgba(var(--cyan-rgb), .07)",
  headerTextColor: "var(--ink2)",
  borderColor: "var(--line)",
  rowBorder: { color: "var(--line)" },
  accentColor: "var(--cyan)",
  rowHoverColor: "rgba(var(--cyan-rgb), .07)",
  selectedRowBackgroundColor: "rgba(var(--cyan-rgb), .12)",
  oddRowBackgroundColor: "rgba(var(--glass-rgb), .02)",
  inputBackgroundColor: "var(--panel-solid)",
  inputBorder: { color: "var(--line-strong)" },
  fontFamily: "var(--sans)",
  headerFontFamily: "var(--mono)",
  headerFontSize: 11,
  fontSize: 13,
  rowHeight: 54,
  headerHeight: 42,
  wrapperBorderRadius: 14,
  spacing: 7,
});

let api = null;
function build() {
  const host = $("#view-cases");
  host.innerHTML = `<div class="view-pad cases">
    <div class="cases-head">
      <div><h2 class="cases-title">📋 Cases</h2><p class="muted">Every dispute and the agent's plan in one table. Click a row to open the case.</p></div>
      <div class="cases-tools">
        <input id="cg-search" type="search" placeholder="Search buyer, item, reason…" autocomplete="off" />
        <button class="mini-btn" id="cg-open">Open only</button>
        <button class="mini-btn" id="cg-csv">⬇ Export CSV</button>
        <button class="cta" id="cg-triage">⚡ Triage all</button>
      </div>
    </div>
    <div class="cases-sum" id="cg-sum"></div>
    <div id="cases-grid" class="cases-grid"></div>
  </div>`;
  api = createGrid($("#cases-grid"), {
    theme,
    rowData: rows(),
    getRowId: (p) => p.data.id,
    animateRows: true,
    defaultColDef: { sortable: true, filter: true, resizable: true, enableCellChangeFlash: true, minWidth: 90 },
    columnDefs: [
      { headerName: "Case", field: "item", cellRenderer: caseCell, flex: 2.4, minWidth: 250, getQuickFilterText: (p) => `${p.data.item} ${p.data.buyer} ${p.data.id}` },
      { headerName: "Amount", field: "amount", type: "numericColumn", valueFormatter: (p) => usd(p.value), filter: "agNumberColumnFilter", flex: 0.8 },
      { headerName: "Reason", field: "reason", flex: 1.1 },
      { headerName: "Stage", field: "stage", flex: 0.8 },
      { headerName: "Due in", field: "due", cellRenderer: dueCell, filter: "agNumberColumnFilter", flex: 0.8, minWidth: 110, sort: "asc" },
      { headerName: "AI plan", field: "plan", cellRenderer: planCell, flex: 1, valueFormatter: (p) => (p.value ? PLAN[p.value]?.[0] ?? p.value : "") },
      { headerName: "Win odds", field: "win", cellRenderer: winCell, filter: "agNumberColumnFilter", flex: 1 },
      { headerName: "Expected keep", field: "keep", type: "numericColumn", valueFormatter: (p) => usd(p.value), filter: "agNumberColumnFilter", flex: 1, cellClass: "cg-keep" },
      { headerName: "Status", field: "status", cellRenderer: statusCell, flex: 0.8 },
    ],
    onRowClicked: (e) => { if (!e.rowPinned) DD.open(e.data.id); },
    onModelUpdated: summarize,
    overlayNoRowsTemplate: `<span class="muted">No cases match.</span>`,
  });
  $("#cg-search").oninput = (e) => api.setGridOption("quickFilterText", e.target.value);
  let openOnly = false;
  $("#cg-open").onclick = async () => {
    openOnly = !openOnly;
    $("#cg-open").classList.toggle("on", openOnly);
    await api.setColumnFilterModel("status", openOnly ? { filterType: "text", type: "equals", filter: "Open" } : null);
    api.onFilterChanged();
  };
  $("#cg-csv").onclick = () => api.exportDataAsCsv({
    fileName: "dispute-defender-cases.csv",
    processCellCallback: (p) => (p.column.getColId() === "plan" ? (PLAN[p.value]?.[0] ?? "") : p.value),
  });
  $("#cg-triage").onclick = () => DD.triage();
}

// Totals for what's currently shown (after search and filters), plus a pinned total row.
function summarize() {
  if (!api) return;
  const shown = [];
  api.forEachNodeAfterFilter((n) => n.data && shown.push(n.data));
  const open = shown.filter((r) => r.status === "Open");
  const stake = open.reduce((s, r) => s + r.amount, 0);
  const keep = open.reduce((s, r) => s + (r.keep ?? 0), 0);
  const planned = open.filter((r) => r.plan).length;
  $("#cg-sum").innerHTML = [
    ["Showing", `${shown.length} case${shown.length === 1 ? "" : "s"}`],
    ["Open", open.length],
    ["At stake", usd(stake)],
    ["AI has a plan for", `${planned} of ${open.length}`],
    ["Expected to keep", usd(keep)],
  ].map(([k, v], i) => `<div class="${i === 4 ? "keep" : ""}"><small>${k}</small><b>${v}</b></div>`).join("");
  api.setGridOption("pinnedBottomRowData", [{ id: "total", item: "Total (open cases)", buyer: `${open.length} open`, amount: stake, keep, status: "", reason: "", stage: "" }]);
}

function refresh() {
  if (!api) return;
  api.setGridOption("rowData", rows()); // getRowId keeps rows in place and flashes changed cells
}

// Refresh whenever the tab opens, and shortly after anything changes.
let timer = null;
window.addEventListener("dd-event", () => { clearTimeout(timer); timer = setTimeout(refresh, 900); });
window.DDCases = { open() { if (!api) build(); else refresh(); }, refresh };
