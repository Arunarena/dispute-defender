// Scripted stand-in for Claude, used only when no ANTHROPIC_API_KEY is set,
// so the app can be clicked through without any keys. It calls the same
// back-office lookups as the real agent and applies simple rules.
import { findOrder, findTracking, findCustomer, getPolicies, findTagsFor } from "./store.js";
import { listPhotos, analyzePhoto } from "./photos.js";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(emit, name, label, input, fn) {
  emit({ type: "tool", name, label, input });
  await pause(180);
  const result = fn();
  emit({ type: "tool_result", name, result });
  await pause(60);
  return result;
}

export async function scriptedRecommendation(d, emit) {
  emit({ type: "status", message: "Demo mode · scripted agent" });
  const amount = Number(d.amount.value);
  const cur = d.amount.currency;

  const order = await step(emit, "lookup_order", "Looking up the order", { transaction_id: d.transactionId }, () =>
    findOrder(d.transactionId),
  );
  const tracking = order?.shipping
    ? await step(
        emit,
        "track_shipment",
        "Checking carrier tracking",
        { carrier: order.shipping.carrier, tracking_number: order.shipping.trackingNumber },
        () => findTracking(order.shipping.trackingNumber),
      )
    : null;
  const customer = order
    ? await step(emit, "get_customer_history", "Reviewing the buyer's history", { email: order.customerEmail }, () =>
        findCustomer(order.customerEmail),
      )
    : null;
  await step(emit, "get_store_policies", "Reading store policies", {}, () => ({ policies: getPolicies() }));

  // NFC Tap-to-Confirm tag sealed in the box, if the order had one.
  const tag = d.transactionId ? findTagsFor(d.transactionId)[0] ?? null : null;
  if (tag) await step(emit, "check_package_tag", "Checking the NFC package tag", { transaction_id: d.transactionId }, () => ({ tagId: tag.id, writtenAtPacking: tag.writtenAt, taps: tag.taps }));
  const deliveredAt = tracking?.status === "DELIVERED" ? tracking.events?.at(-1)?.time : null;
  const tapAfterDelivery = tag?.taps.find((x) => deliveredAt && new Date(x.time) >= new Date(deliveredAt));

  // Photo evidence (carrier proof-of-delivery, buyer damage photos, uploads).
  const photos = listPhotos(d.id);
  let photoEvidence = [];
  if (photos.length) {
    emit({ type: "tool", name: "inspect_photos", label: "Inspecting photo evidence", input: { count: photos.length } });
    for (const p of photos) if (!p.analysis) await analyzePhoto(d, p, order);
    photoEvidence = photos.map((p) => ({ url: p.url, source: p.source, ...p.analysis }));
    emit({ type: "tool_result", name: "inspect_photos", result: { photos: photoEvidence } });
  }
  const sellerPhotos = photoEvidence.filter((p) => p.favors === "SELLER");
  const buyerPhotos = photoEvidence.filter((p) => p.favors === "BUYER");
  const withPhotos = (rec) => {
    if (tapAfterDelivery && d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
      const hrs = Math.round(((new Date(tapAfterDelivery.time) - new Date(deliveredAt)) / 3600000) * 10) / 10;
      rec.reasoning.push(`The NFC tag sealed in the box was tapped by a phone (${tapAfterDelivery.device}${tapAfterDelivery.place ? `, ${tapAfterDelivery.place}` : ""}) ${hrs} hours after delivery. Someone had the package in hand.`);
      rec.evidence.push({ evidence_type: "PROOF_OF_FULFILLMENT", title: "NFC package tap after delivery", detail: `Tag ${tag.id}, written at packing ${new Date(tag.writtenAt).toDateString()}, tapped ${new Date(tapAfterDelivery.time).toUTCString()} by ${tapAfterDelivery.device}` });
      rec.win_likelihood = Math.min(97, rec.win_likelihood + 6);
      if (rec.response_text) rec.response_text += ` In addition, the NFC tag sealed inside the package was tapped by a phone on ${new Date(tapAfterDelivery.time).toDateString()}, ${hrs} hours after the carrier's delivery scan, which shows the package was physically received.`;
    }
    const confirmed = tag?.taps.find((x) => x.kind === "CONFIRM_OK");
    if (confirmed && d.reason !== "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && rec.verdict === "FIGHT") {
      rec.reasoning.push(`The buyer tapped the NFC tag in the box and pressed "Arrived OK" on ${new Date(confirmed.time).toDateString()} (${confirmed.device}${confirmed.location ? ", with GPS at the delivery address" : ""}).`);
      rec.evidence.push({ evidence_type: "PROOF_OF_FULFILLMENT", title: "Buyer confirmed delivery by NFC tap", detail: `Tag ${tag.id}: "Arrived OK" pressed ${new Date(confirmed.time).toUTCString()} on ${confirmed.device}` });
      rec.win_likelihood = Math.min(97, rec.win_likelihood + 6);
      if (rec.response_text) rec.response_text += ` The buyer also confirmed receipt themselves: they tapped the NFC tag inside the package and pressed "Arrived OK" on ${new Date(confirmed.time).toDateString()}.`;
    }
    const problem = tag?.taps.find((x) => x.kind === "PROBLEM");
    if (problem) rec.risk_flags.push(`Buyer reported a problem when tapping the package: "${problem.note ?? "no details"}"`);
    for (const p of sellerPhotos) {
      rec.reasoning.push(`Photo evidence: ${p.caption} (${p.confidence}% confidence).`);
      rec.evidence.push({ evidence_type: "PROOF_OF_FULFILLMENT", title: p.caption, detail: p.findings.slice(0, 3).join("; ") });
      rec.win_likelihood = Math.min(97, rec.win_likelihood + 6);
    }
    for (const p of buyerPhotos) rec.risk_flags.push(`Buyer photo: ${p.caption}`);
    return rec;
  };

  const lastEvent = tracking?.events?.at(-1);
  const trk = order?.shipping
    ? { carrier: order.shipping.carrier, tracking_number: order.shipping.trackingNumber }
    : null;
  const base = { engine: "scripted-demo", risk_flags: [], evidence: [], primary_evidence_type: null, tracking: trk, offer_amount: null };

  // Unauthorized purchase: count fraud signals.
  if (d.reason === "UNAUTHORISED") {
    const flags = [];
    if (order && order.billingAddress !== order.shippingAddress) flags.push("Billing and shipping addresses don't match");
    if (/forward/i.test(order?.shippingAddress ?? "")) flags.push("Shipped to a freight forwarder");
    if ((customer?.accountAgeDays ?? 999) < 7) flags.push(`Customer account is ${customer.accountAgeDays} day(s) old`);
    if (order?.ipCountry && order.ipCountry !== "US") flags.push(`Order placed from IP in ${order.ipCountry}, card holder is in the US`);
    if (!/signed by: [a-z]+ [a-z]+$/i.test(lastEvent?.detail ?? "")) flags.push("No signature from the cardholder on delivery");
    if (flags.length >= 2) {
      return withPhotos({
        ...base,
        verdict: "ACCEPT_CLAIM",
        win_likelihood: 12,
        headline: `This looks like real fraud. Accept the claim and block the address rather than spend time on a case you'll likely lose.`,
        reasoning: [
          `${flags.length} classic fraud signals are present on this order.`,
          `PayPal rarely sides with sellers on unauthorized claims without proof the account holder received the item.`,
          `Fighting and losing adds time and can hurt your dispute ratio.`,
          `Recommend blocking ${order?.shippingAddress?.split(",")[0] ?? "this address"} for future orders.`,
        ],
        risk_flags: flags,
        money_saved_estimate: "0.00",
        response_text: `We accept this claim. Our review of order ${order?.orderId ?? ""} found signs that the purchase was not made by the account holder, and we have blocked the shipping address used. We're sorry for the trouble this caused.`,
      });
    }
  }

  // Unauthorized, but the facts point to the account holder (friendly fraud).
  if (d.reason === "UNAUTHORISED" && order) {
    const signer = /signed by: ([a-z]+ [a-z]+)$/i.exec(lastEvent?.detail ?? "")?.[1];
    const signedByBuyer = Boolean(signer && signer.toLowerCase() === d.buyerName.toLowerCase());
    const history = (customer?.orders ?? 0) > 1 && (customer?.accountAgeDays ?? 0) > 180;
    if (signedByBuyer || history) {
      return withPhotos({
        ...base,
        verdict: "FIGHT",
        win_likelihood: signedByBuyer && history ? 82 : 68,
        headline: `Fight it. This looks like friendly fraud: the account holder's own details are all over this order.`,
        reasoning: [
          `Billing and shipping addresses match (${order.shippingAddress.split(",").slice(0, 2).join(",")}), and the order came from a US IP.`,
          ...(signedByBuyer ? [`${order.shipping.carrier} delivery was signed by "${signer}", the account holder's own name.`] : []),
          ...(history ? [`The buyer has ${customer.orders} orders over ${Math.max(1, Math.round(customer.accountAgeDays / 365))} years to this address.${customer.priorDisputes ? ` ${customer.priorDisputes} earlier claim(s) on record.` : ""}`] : []),
          ...(order.deviceMatch ? [order.deviceMatch + "."] : []),
        ],
        risk_flags: customer?.priorDisputes ? [`Buyer filed ${customer.priorDisputes} earlier claim(s)`] : [],
        evidence: [
          { evidence_type: "PROOF_OF_FULFILLMENT", title: "Signed delivery to the account holder's address", detail: `${order.shipping.carrier} ${order.shipping.trackingNumber}: ${lastEvent?.detail ?? "delivered"}` },
          { evidence_type: "OTHER", title: "Purchase history", detail: `${customer?.orders ?? 1} orders to ${order.shippingAddress}; billing address matches` },
        ],
        primary_evidence_type: "PROOF_OF_FULFILLMENT",
        money_saved_estimate: amount.toFixed(2),
        response_text: `This purchase was made by the account holder. Order ${order.orderId} shipped to ${order.shippingAddress}, the same as the billing address on file${history ? ` and the address used on ${customer.orders - 1} earlier orders from this buyer` : ""}. ${order.shipping.carrier} tracking ${order.shipping.trackingNumber} shows: "${lastEvent?.detail ?? "delivered"}". We ask that this claim be decided in the seller's favor.`,
      });
    }
  }

  // Refund not received: check the store's refund and return records.
  if (d.reason === "CREDIT_NOT_PROCESSED" && order) {
    const ret = order.returnShipment;
    if (order.refund?.issued) {
      return withPhotos({
        ...base,
        verdict: "FIGHT",
        win_likelihood: 93,
        headline: `Fight it. You already refunded ${order.refund.amount} ${cur} on ${new Date(order.refund.issued).toDateString()}. This claim would make you pay twice.`,
        reasoning: [
          ...(ret ? [`Return tracking ${ret.trackingNumber} shows it reached your warehouse on ${new Date(ret.received).toDateString()}.`] : []),
          `Refund ${order.refund.id} for the full ${order.refund.amount} ${cur} was issued on ${new Date(order.refund.issued).toDateString()}: ${order.refund.method}.`,
          `PayPal refunds can take a few business days to show at the buyer's bank, which explains the confusion.`,
        ],
        evidence: [
          { evidence_type: "PROOF_OF_REFUND", title: `Refund ${order.refund.id}`, detail: `${order.refund.amount} ${cur} issued ${new Date(order.refund.issued).toDateString()}, status ${order.refund.paypalStatus ?? "COMPLETED"}` },
          ...(ret ? [{ evidence_type: "OTHER", title: "Return received", detail: `${ret.carrier} ${ret.trackingNumber} delivered to the store ${new Date(ret.received).toDateString()}` }] : []),
        ],
        tracking: ret ? { carrier: ret.carrier, tracking_number: ret.trackingNumber } : trk,
        primary_evidence_type: "PROOF_OF_REFUND",
        money_saved_estimate: amount.toFixed(2),
        response_text: `${ret ? `We received the buyer's return on ${new Date(ret.received).toDateString()} and issued` : "We issued"} a full refund of ${order.refund.amount} ${cur} on ${new Date(order.refund.issued).toDateString()} (refund ID ${order.refund.id}, status ${order.refund.paypalStatus ?? "COMPLETED"}) to the original PayPal payment. The buyer has already been refunded, so a second refund is not due.`,
      });
    }
    if (ret?.received) {
      return withPhotos({
        ...base,
        verdict: "ACCEPT_CLAIM",
        win_likelihood: 4,
        headline: `Refund now. The return reached you on ${new Date(ret.received).toDateString()} and no refund was sent. The buyer is right.`,
        reasoning: [
          `Return tracking ${ret.trackingNumber} shows delivery to your warehouse.`,
          `There is no refund on record for order ${order.orderId}.`,
          `Your policy promises a refund for returned items. Fighting would lose and could add a chargeback fee.`,
        ],
        risk_flags: ["Refund overdue: check why this return wasn't processed"],
        money_saved_estimate: "0.00",
        response_text: `Hi ${d.buyerName.split(" ")[0]}, you're right, and we're sorry. Your return arrived on ${new Date(ret.received).toDateString()} and the refund was missed on our side. We've accepted your claim so the full amount goes back to you now.`,
      });
    }
  }

  // Duplicate charge: refund a real double payment.
  if (d.reason === "DUPLICATE_TRANSACTION" && order?.duplicateCapture && !order.duplicateCapture.shipped) {
    const dup = order.duplicateCapture;
    return withPhotos({
      ...base,
      verdict: "ACCEPT_CLAIM",
      win_likelihood: 3,
      headline: `Refund it. Two identical payments ${dup.capturedSecondsLater} seconds apart, and only one box shipped. It's a real double charge.`,
      reasoning: [
        `Payments ${d.transactionId} and ${dup.transactionId} are both ${dup.amount} ${cur}, ${dup.capturedSecondsLater} seconds apart.`,
        `Only one shipment exists (${order.shipping.carrier} ${order.shipping.trackingNumber}). ${dup.note}.`,
        `Fighting a true duplicate loses and hurts your dispute ratio. Refunding the extra charge keeps a good customer.`,
      ],
      risk_flags: ["Checkout allowed a double submit: disable the pay button after one click"],
      money_saved_estimate: "0.00",
      response_text: `Hi ${d.buyerName.split(" ")[0]}, you're right: checkout charged you twice, ${dup.capturedSecondsLater} seconds apart. Your ${d.items[0]?.name ?? "order"} is on its way (${order.shipping.carrier} ${order.shipping.trackingNumber}), and we're refunding the extra ${dup.amount} ${cur} now. Sorry for the hassle!`,
    });
  }

  // Item not received.
  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" && tracking) {
    if (tracking.status === "DELIVERED") {
      const repeat = (customer?.priorDisputes ?? 0) > 0;
      return withPhotos({
        ...base,
        verdict: "FIGHT",
        win_likelihood: repeat ? 86 : 78,
        headline: `Fight it. The carrier confirms delivery to the buyer's address on ${new Date(lastEvent.time).toDateString()}.`,
        reasoning: [
          `${order.shipping.carrier} tracking ${order.shipping.trackingNumber} shows "${lastEvent.detail}"`,
          `Delivery address matches the shipping address on the PayPal transaction.`,
          `Shipped within 1 day of purchase, per store policy.`,
          ...(repeat ? [`Buyer has ${customer.priorDisputes} prior "not received" claims where tracking showed delivered.`] : []),
        ],
        risk_flags: ["No signature confirmation (order under $300)"],
        evidence: [
          { evidence_type: "PROOF_OF_FULFILLMENT", title: "Carrier tracking: delivered", detail: `${order.shipping.carrier} ${order.shipping.trackingNumber}: ${lastEvent.detail}` },
          { evidence_type: "OTHER", title: "Order record", detail: `Order ${order.orderId}, shipped to ${order.shippingAddress}` },
        ],
        primary_evidence_type: "PROOF_OF_FULFILLMENT",
        money_saved_estimate: amount.toFixed(2),
        response_text: `The item was shipped on ${new Date(order.shipping.shipped).toDateString()} via ${order.shipping.carrier} (tracking ${order.shipping.trackingNumber}) to the address on this PayPal transaction: ${order.shippingAddress}. The carrier confirms delivery on ${new Date(lastEvent.time).toDateString()}: "${lastEvent.detail}". We believe the buyer received the item and ask that this claim be decided in the seller's favor.`,
      });
    }
    if (d.stage === "INQUIRY") {
      return withPhotos({
        ...base,
        verdict: "SEND_MESSAGE",
        win_likelihood: 90,
        headline: `Don't refund. The package is moving and should arrive in 1-2 days. Send the buyer the tracking.`,
        reasoning: [
          `Tracking status is ${tracking.status}: "${lastEvent.detail}"`,
          `The delay was caused by a carrier weather disruption, not the store.`,
          `Buyer is a repeat customer with no prior disputes, so a friendly update will likely close this.`,
        ],
        money_saved_estimate: amount.toFixed(2),
        response_text: `Hi ${d.buyerName.split(" ")[0]}, thanks for reaching out and sorry for the wait! Your order shipped on ${new Date(order.shipping.shipped).toDateString()} with ${order.shipping.carrier} (tracking ${order.shipping.trackingNumber}). Its latest scan is "${lastEvent.detail}" (${lastEvent.location}), so it should reach you in the next 1-2 days. If it hasn't arrived by then, reply here and we'll reship it or refund you right away.`,
      });
    }
  }

  // Not as described: offer the damaged share when we can.
  if (d.reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" && d.stage === "INQUIRY") {
    const setSize = Number(/\((\d+)/.exec(d.items[0]?.name ?? "")?.[1] ?? 4);
    const offer = (amount / setSize).toFixed(2);
    return withPhotos({
      ...base,
      verdict: "OFFER_PARTIAL_REFUND",
      win_likelihood: 35,
      headline: `Offer ${offer} ${cur} for the one damaged item. It follows your policy and keeps ${(amount - offer).toFixed(2)} ${cur}.`,
      reasoning: [
        `Buyer reports 1 of ${setSize} items damaged and is happy with the rest.`,
        `Store policy: refund the damaged item's share, no return needed under $25.`,
        `A partial refund costs far less than losing the full ${amount.toFixed(2)} ${cur}.`,
        ...(customer && !customer.priorDisputes ? [`Buyer has ${customer.orders} orders and no prior disputes. Worth keeping happy.`] : []),
      ],
      risk_flags: [],
      offer_amount: offer,
      money_saved_estimate: (amount - offer).toFixed(2),
      response_text: `Hi ${d.buyerName.split(" ")[0]}, we're so sorry one item in your ${d.items[0]?.name ?? "order"} arrived damaged. Everything is packed with care, so this is disappointing for us too. We'd like to refund ${offer} ${cur}, the full price of the damaged piece. There's no need to send it back. Thank you for letting us know!`,
    });
  }

  // Fallback.
  return withPhotos({
    ...base,
    verdict: d.stage === "INQUIRY" ? "SEND_MESSAGE" : "ACCEPT_CLAIM",
    win_likelihood: 30,
    headline: order ? "Not enough evidence to fight confidently." : "No matching order found in your store records.",
    reasoning: [
      order ? `Order ${order.orderId} found, but nothing clearly answers the buyer's claim.` : "We couldn't find this transaction in the store's order system.",
      "Without evidence, PayPal usually sides with the buyer.",
    ],
    risk_flags: ["Missing evidence"],
    money_saved_estimate: "0.00",
    response_text:
      d.stage === "INQUIRY"
        ? `Hi ${d.buyerName.split(" ")[0]}, thanks for reaching out. Could you share a bit more about the problem so we can make it right?`
        : `We accept this claim and apologize for the inconvenience.`,
  });
}
