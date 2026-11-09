// Tap-to-Confirm helpers shared by the dispute screen and Risk Radar.
// Writing uses Web NFC, which works in Chrome on Android over HTTPS (e.g. the Render deploy).
// Elsewhere the seller can copy the link into any NFC writer app, or simulate a tap.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const supported = () => "NDEFReader" in window;
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const KIND = {
  OPEN: ["📲", "Phone tapped the package"],
  CONFIRM_OK: ["✅", "Buyer confirmed it arrived OK"],
  PROBLEM: ["⚠️", "Buyer reported a problem"],
};

function timeline(tag) {
  const items = [];
  if (tag.writtenAt ?? tag.writtenAtPacking) items.push(`<li class="nfc-ev w"><span>🏷️</span><div><b>Tag written & sealed in the box</b><small>${when(tag.writtenAt ?? tag.writtenAtPacking)}</small></div></li>`);
  for (const t of tag.taps ?? []) {
    const [icon, label] = KIND[t.kind] ?? ["•", t.kind];
    const bits = [
      t.device,
      t.place,
      t.location ? `GPS ±${t.location.accuracy} m` : null,
      t.hoursAfterDelivery != null ? (t.hoursAfterDelivery >= 0 ? `<b class="good">${t.hoursAfterDelivery} h after delivery scan</b>` : `${-t.hoursAfterDelivery} h before delivery scan`) : null,
    ].filter(Boolean);
    items.push(`<li class="nfc-ev ${t.kind}"><span>${icon}</span><div><b>${label}</b>${t.note ? `<q>${esc(t.note)}</q>` : ""}<small>${when(t.time)} · ${bits.map((b) => (b.startsWith("<b") ? b : esc(b))).join(" · ")}</small>${t.photoUrl ? `<a href="${esc(t.photoUrl)}" target="_blank"><img src="${esc(t.photoUrl)}" alt="Buyer photo" /></a>` : ""}</div></li>`);
  }
  if (!(tag.taps ?? []).length) items.push(`<li class="nfc-ev none"><span>⏳</span><div><b>Not tapped yet</b><small>The tag is waiting inside the box.</small></div></li>`);
  return `<ul class="nfc-tl">${items.join("")}</ul>`;
}

// Buttons for a tag: write to a sticker, copy the link, open it as the buyer would.
function actions(tag, url, { localOnly = false } = {}) {
  return `<div class="nfc-actions">
    <button class="mini-btn" data-nfc-write="${esc(tag.id)}" data-url="${esc(url)}" ${supported() ? "" : `disabled title="Web NFC needs Chrome on Android over HTTPS. Or copy the link into any NFC writer app."`}>✍️ WRITE NFC TAG</button>
    <button class="mini-btn" data-nfc-copy="${esc(url)}">🔗 COPY LINK</button>
    <a class="mini-btn" href="${esc(url)}" target="_blank" rel="noopener" title="Opens the page a buyer's phone opens when it touches the box">👆 SIMULATE BUYER TAP</a>
  </div>
  ${localOnly ? `<div class="nfc-note">Localhost link: phones can't open it.</div>` : ""}
`;
}

async function write(btn, toast) {
  const url = btn.dataset.url;
  btn.disabled = true;
  btn.textContent = "📡 HOLD A TAG TO THE PHONE…";
  try {
    const reader = new NDEFReader();
    await reader.write({ records: [{ recordType: "url", data: url }] });
    await fetch(`/api/nfc/tags/${encodeURIComponent(btn.dataset.nfcWrite)}/written`, { method: "POST" });
    navigator.vibrate?.(120);
    toast("🏷️ TAG WRITTEN", "Stick it inside the box. Any phone that taps it opens the confirm page.", "good");
    btn.textContent = "✓ WRITTEN";
  } catch (err) {
    toast("NFC WRITE FAILED", err.message, "warn");
    btn.textContent = "✍️ WRITE NFC TAG";
    btn.disabled = false;
  }
}

function bind(root, toast) {
  root.querySelectorAll("[data-nfc-write]").forEach((b) => (b.onclick = () => write(b, toast)));
  root.querySelectorAll("[data-nfc-copy]").forEach((b) => (b.onclick = async () => {
    await navigator.clipboard?.writeText(b.dataset.nfcCopy).catch(() => {});
    toast("🔗 LINK COPIED", b.dataset.nfcCopy, "");
  }));
}

window.NFC = { supported, timeline, actions, bind };
