// iCalendar (RFC 5545) feed of dispute response deadlines, with a reminder a day before.
// Subscribe to /api/calendar.ics from Google Calendar, Outlook or Apple Calendar.

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const escape = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines longer than 75 bytes must be folded: CRLF plus one space.
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join("\r\n");
}

const DONE = ["RESOLVED", "UNDER_REVIEW", "WAITING_FOR_BUYER_RESPONSE"];

export function buildCalendar(disputes, baseUrl) {
  const now = stamp(Date.now());
  const events = disputes
    .filter((d) => d.sellerResponseDue && !DONE.includes(d.status))
    .flatMap((d) => {
      const due = new Date(d.sellerResponseDue);
      const amount = `$${Number(d.amount?.value ?? 0).toFixed(2)}`;
      return [
        "BEGIN:VEVENT",
        `UID:${d.id}@dispute-defender`,
        `DTSTAMP:${now}`,
        `DTSTART:${stamp(due - 30 * 60000)}`,
        `DTEND:${stamp(due)}`,
        `SUMMARY:${escape(`⚔️ PayPal dispute due: ${d.item ?? d.id} (${amount})`)}`,
        `DESCRIPTION:${escape(`${d.buyerName ?? "Buyer"} · ${d.reason} · ${d.stage} stage.\nRespond before this time or PayPal may rule for the buyer.\nOpen the case: ${baseUrl}/#${d.id}`)}`,
        `URL:${baseUrl}/#${d.id}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-P1D",
        `DESCRIPTION:${escape(`Dispute ${d.id} is due tomorrow`)}`,
        "END:VALARM",
        "END:VEVENT",
      ];
    });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dispute Defender//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:PayPal dispute deadlines", ...events, "END:VCALENDAR"]
    .map(fold)
    .join("\r\n") + "\r\n";
}
