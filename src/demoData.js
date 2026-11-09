// Demo data used when PayPal sandbox keys are not set.
// Disputes are stored in the same normalized shape the app builds from
// real PayPal Disputes API responses (see paypal.js -> normalizeDispute).

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString();

// The headphones case uses fixed dates because its carrier photo (public/samples/porch-delivery.png)
// has "USPS PROOF OF DELIVERY · 10/17/2026 14:12" printed on it. 14:12 in Portland is 21:12 UTC.
const HEADPHONES = {
  placed: "2026-10-13T18:05:00.000Z",
  shipped: "2026-10-14T16:30:00.000Z",
  arrived: "2026-10-16T13:40:00.000Z",
  delivered: "2026-10-17T21:12:00.000Z",
};

export const demoDisputes = [
  {
    id: "PP-D-DEMO-1001",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    amount: { value: "129.00", currency: "USD" },
    created: daysAgo(3),
    sellerResponseDue: daysFromNow(7),
    buyerName: "Jordan Miles",
    transactionId: "7XK45123AB9876543",
    items: [{ name: "Aurora ANC Wireless Headphones", quantity: 1 }],
    messages: [
      {
        by: "BUYER",
        time: daysAgo(3),
        content:
          "I ordered these headphones weeks ago and never got them. Tracking is useless. I want my money back.",
      },
    ],
  },
  {
    id: "PP-D-DEMO-1002",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    amount: { value: "64.00", currency: "USD" },
    created: daysAgo(1),
    sellerResponseDue: daysFromNow(9),
    buyerName: "Priya Raman",
    transactionId: "3MN88210CD4455667",
    items: [{ name: "Handmade Ceramic Mug Set (4 mugs)", quantity: 1 }],
    messages: [
      {
        by: "BUYER",
        time: daysAgo(1),
        content:
          "One of the four mugs arrived with a big chip on the rim. The other three are lovely. Photo attached. Not happy paying full price for a broken set.",
      },
    ],
  },
  {
    id: "PP-D-DEMO-1003",
    reason: "UNAUTHORISED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    amount: { value: "289.99", currency: "USD" },
    created: daysAgo(2),
    sellerResponseDue: daysFromNow(5),
    buyerName: "Daniel Okafor",
    transactionId: "9QZ10432EF7788990",
    items: [{ name: "Pulse X2 Smartwatch", quantity: 1 }],
    messages: [
      {
        by: "BUYER",
        time: daysAgo(2),
        content:
          "I did not make this purchase. Someone used my PayPal account without permission.",
      },
    ],
  },
  {
    id: "PP-D-DEMO-1004",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    amount: { value: "42.50", currency: "USD" },
    created: daysAgo(0),
    sellerResponseDue: daysFromNow(10),
    buyerName: "Emma Schultz",
    transactionId: "5HT77001GH1122334",
    items: [{ name: "Organic Cotton Tote Bag (2-pack)", quantity: 1 }],
    messages: [
      {
        by: "BUYER",
        time: daysAgo(0),
        content: "Hi, it's been 8 days and my order still hasn't shown up. Where is it?",
      },
    ],
  },
  {
    // "Refund not received", but the store's records show the refund went out a week ago.
    id: "PP-D-DEMO-1005",
    reason: "CREDIT_NOT_PROCESSED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    amount: { value: "98.00", currency: "USD" },
    created: daysAgo(2),
    sellerResponseDue: daysFromNow(8),
    buyerName: "Olivia Chen",
    transactionId: "6PL20977RS3344120",
    items: [{ name: "Merino Wool Throw Blanket", quantity: 1 }],
    messages: [
      { by: "BUYER", time: daysAgo(2), content: "I sent the blanket back two weeks ago and still haven't been refunded. Filing with my bank." },
    ],
  },
  {
    // A real double charge: the honest move is to refund it, not fight.
    id: "PP-D-DEMO-1006",
    reason: "DUPLICATE_TRANSACTION",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "INQUIRY",
    amount: { value: "39.99", currency: "USD" },
    created: daysAgo(1),
    sellerResponseDue: daysFromNow(12),
    buyerName: "Marco Rossi",
    transactionId: "1RT55021ZX6677881",
    items: [{ name: "Cold Brew Coffee Maker", quantity: 1 }],
    messages: [
      { by: "BUYER", time: daysAgo(1), content: "I was charged twice for the same coffee maker. I only ordered one. Please refund the extra charge." },
    ],
  },
  {
    // "Unauthorized", but every fact points to the account holder: friendly fraud.
    id: "PP-D-DEMO-1007",
    reason: "UNAUTHORISED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    stage: "CHARGEBACK",
    amount: { value: "149.00", currency: "USD" },
    created: daysAgo(1),
    sellerResponseDue: daysFromNow(9),
    buyerName: "Rachel Kim",
    transactionId: "8WV31088TU5566342",
    items: [{ name: "Trailblazer Hiking Backpack 40L", quantity: 1 }],
    messages: [{ by: "BUYER", time: daysAgo(1), content: "I don't recognize this charge on my account." }],
  },
];

// The merchant's own order system, keyed by PayPal transaction (capture) ID.
// Live sandbox orders made through the demo shop are added at runtime.
export const demoOrders = {
  "7XK45123AB9876543": {
    orderId: "SHOP-20481",
    placed: HEADPHONES.placed,
    customerEmail: "jordan.miles@example.com",
    shippingAddress: "418 Birch Lane, Portland, OR 97205, US",
    billingAddress: "418 Birch Lane, Portland, OR 97205, US",
    items: [{ name: "Aurora ANC Wireless Headphones", sku: "AUR-ANC-01", price: "129.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842761003", shipped: HEADPHONES.shipped },
    ipCountry: "US",
  },
  "3MN88210CD4455667": {
    orderId: "SHOP-20512",
    placed: daysAgo(9),
    customerEmail: "priya.raman@example.com",
    shippingAddress: "77 Elm St, Apt 3B, Somerville, MA 02143, US",
    billingAddress: "77 Elm St, Apt 3B, Somerville, MA 02143, US",
    items: [{ name: "Handmade Ceramic Mug Set (4 mugs)", sku: "MUG-SET-4", price: "64.00" }],
    shipping: { carrier: "UPS", trackingNumber: "1Z999AA10123456784", shipped: daysAgo(8) },
    ipCountry: "US",
  },
  "9QZ10432EF7788990": {
    orderId: "SHOP-20530",
    placed: daysAgo(6),
    customerEmail: "d.okafor.shop2291@example.net",
    shippingAddress: "Unit 9, 1200 NW 82nd Ave (Freight Forwarder), Miami, FL 33126, US",
    billingAddress: "22 Harbor View Rd, Seattle, WA 98101, US",
    items: [{ name: "Pulse X2 Smartwatch", sku: "PLS-X2", price: "289.99" }],
    shipping: { carrier: "FEDEX", trackingNumber: "794644790132", shipped: daysAgo(5) },
    ipCountry: "RO",
  },
  "5HT77001GH1122334": {
    orderId: "SHOP-20544",
    placed: daysAgo(8),
    customerEmail: "emma.schultz@example.com",
    shippingAddress: "9 Linden Ct, Columbus, OH 43215, US",
    billingAddress: "9 Linden Ct, Columbus, OH 43215, US",
    items: [{ name: "Organic Cotton Tote Bag (2-pack)", sku: "TOTE-2", price: "42.50" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842799871", shipped: daysAgo(7) },
    ipCountry: "US",
  },
};

// Simulated carrier tracking feed.
export const demoTracking = {
  "9400111202555842761003": {
    status: "DELIVERED",
    events: [
      { time: HEADPHONES.shipped, location: "Seattle, WA", detail: "Accepted at USPS origin facility" },
      { time: HEADPHONES.arrived, location: "Portland, OR", detail: "Arrived at post office" },
      {
        time: HEADPHONES.delivered,
        location: "Portland, OR 97205",
        detail: "Delivered, front door/porch. Photo-on-delivery captured. GPS matches shipping address.",
      },
    ],
  },
  "1Z999AA10123456784": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(8), location: "Asheville, NC", detail: "Picked up by UPS" },
      { time: daysAgo(4), location: "Somerville, MA", detail: "Delivered, left at front desk" },
    ],
  },
  "794644790132": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(5), location: "Austin, TX", detail: "Picked up" },
      {
        time: daysAgo(3),
        location: "Miami, FL 33126",
        detail: "Delivered to freight forwarding warehouse. Signed by: WAREHOUSE DOCK 4",
      },
    ],
  },
  "9400111202555842799871": {
    status: "IN_TRANSIT",
    events: [
      { time: daysAgo(7), location: "Asheville, NC", detail: "Accepted at USPS origin facility" },
      { time: daysAgo(5), location: "Atlanta, GA", detail: "Arrived at regional distribution center" },
      { time: daysAgo(2), location: "Atlanta, GA", detail: "Delayed: weather disruption in network" },
      { time: daysAgo(1), location: "Columbus, OH", detail: "Arrived at post office. Out for delivery expected in 1-2 days" },
    ],
  },
};

export const demoCustomers = {
  "jordan.miles@example.com": {
    accountAgeDays: 1240,
    orders: 6,
    totalSpent: "512.40",
    priorDisputes: 2,
    notes: "Two previous 'item not received' claims (2024, 2025); both packages showed delivered.",
  },
  "priya.raman@example.com": {
    accountAgeDays: 610,
    orders: 4,
    totalSpent: "231.00",
    priorDisputes: 0,
    notes: "Left two 5-star reviews. No issues.",
  },
  "d.okafor.shop2291@example.net": {
    accountAgeDays: 1,
    orders: 1,
    totalSpent: "289.99",
    priorDisputes: 0,
    notes: "Guest checkout created minutes before purchase. Email does not match PayPal account name pattern.",
  },
  "emma.schultz@example.com": {
    accountAgeDays: 380,
    orders: 3,
    totalSpent: "118.50",
    priorDisputes: 0,
    notes: "Repeat customer, no issues.",
  },
};

// Photos attached to demo disputes (served from public/samples).
export const demoPhotos = {
  "PP-D-DEMO-1001": [{ url: "/samples/porch-delivery.png", source: "CARRIER", label: "USPS proof-of-delivery photo" }],
  "PP-D-DEMO-1002": [{ url: "/samples/mug-chip.png", source: "BUYER", label: "Buyer's photo of the damage" }],
};

// What the scripted demo "sees" in the sample photos (used only without an API key).
export const demoPhotoAnalyses = {
  "porch-delivery.png": {
    summary: "A shipping box sits on the welcome mat in front of a blue door. House number 418 is on the wall. The carrier overlay shows a USPS delivery stamp.",
    findings: [
      "House number reads 418, matching 418 Birch Lane on the order",
      "Overlay: USPS PROOF OF DELIVERY 10/17/2026 14:12",
      "Tracking 9400111202555842761003 matches the order's tracking number",
      "GPS 45.5231, -122.6765 is in Portland, OR 97205",
      "Package left at front door, label visible",
    ],
    favors: "SELLER",
    confidence: 94,
    caption: "Carrier photo: package at door of #418",
  },
  "mug-chip.png": {
    summary: "Four matching blue mugs on a table. The third mug has a visible chip on the rim with a hairline crack running down; small fragments lie beside it.",
    findings: [
      "4 mugs visible, matching the 4-mug set",
      "1 mug has a chipped rim (about 1 cm) and a hairline crack",
      "Small ceramic fragments on the table next to the damaged mug",
      "The other 3 mugs appear undamaged",
    ],
    favors: "BUYER",
    confidence: 91,
    caption: "Buyer photo: 1 of 4 mugs chipped and cracked",
  },
};

// Disputes that "arrive" when you click Simulate (or via a real PayPal webhook in sandbox).
export const incomingTemplates = [
  {
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "CHARGEBACK",
    amount: { value: "89.00", currency: "USD" },
    buyerName: "Jay Patel",
    transactionId: "8BC55120JK3344556",
    items: [{ name: "Boombox Mini Bluetooth Speaker", quantity: 1 }],
    message: "Package never came. I want a refund.",
  },
  {
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    stage: "INQUIRY",
    amount: { value: "18.00", currency: "USD" },
    buyerName: "Lena Brooks",
    transactionId: "2DE66330LM5566778",
    items: [{ name: "Linen Napkins (6-pack)", quantity: 1 }],
    message: "One of the six napkins has a stain on it. The rest are fine.",
  },
  {
    reason: "UNAUTHORISED",
    stage: "CHARGEBACK",
    amount: { value: "219.00", currency: "USD" },
    buyerName: "Marcus Hale",
    transactionId: "6FG77440NP7788990",
    items: [{ name: "Nova Pro Gaming Headset", quantity: 1 }],
    message: "This charge is not mine.",
  },
  {
    // Delivered with no photo and no signature: the pattern the agent used to be overconfident on.
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "CHARGEBACK",
    amount: { value: "129.00", currency: "USD" },
    buyerName: "Sam Ortiz",
    transactionId: "4HJ88550QR9900112",
    items: [{ name: "Aurora ANC Wireless Headphones", quantity: 1 }],
    message: "Tracking says delivered but there was nothing in my mailbox.",
  },
];

Object.assign(demoOrders, {
  "8BC55120JK3344556": {
    orderId: "SHOP-20601",
    placed: daysAgo(12),
    customerEmail: "jay.patel@example.com",
    shippingAddress: "55 Cedar Ave, Austin, TX 78701, US",
    billingAddress: "55 Cedar Ave, Austin, TX 78701, US",
    items: [{ name: "Boombox Mini Bluetooth Speaker", sku: "BBX-MINI", price: "89.00" }],
    shipping: { carrier: "UPS", trackingNumber: "1Z999AA10198765432", shipped: daysAgo(11) },
    ipCountry: "US",
  },
  "2DE66330LM5566778": {
    orderId: "SHOP-20615",
    placed: daysAgo(7),
    customerEmail: "lena.brooks@example.com",
    shippingAddress: "12 Oak St, Denver, CO 80203, US",
    billingAddress: "12 Oak St, Denver, CO 80203, US",
    items: [{ name: "Linen Napkins (6-pack)", sku: "NAP-6", price: "18.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842711110", shipped: daysAgo(6) },
    ipCountry: "US",
  },
  "6FG77440NP7788990": {
    orderId: "SHOP-20622",
    placed: daysAgo(4),
    customerEmail: "m.hale.deals77@example.net",
    shippingAddress: "Suite 300, 8 Port Way (Freight Forwarder), Newark, NJ 07114, US",
    billingAddress: "901 Lakeview Dr, Chicago, IL 60614, US",
    items: [{ name: "Nova Pro Gaming Headset", sku: "NOVA-PRO", price: "219.00" }],
    shipping: { carrier: "FEDEX", trackingNumber: "794644790177", shipped: daysAgo(3) },
    ipCountry: "VN",
  },
  "4HJ88550QR9900112": {
    orderId: "SHOP-20630",
    placed: daysAgo(9),
    customerEmail: "sam.ortiz@example.com",
    shippingAddress: "77 Elm St, Apt 2, Columbus, OH 43215, US",
    billingAddress: "77 Elm St, Apt 2, Columbus, OH 43215, US",
    items: [{ name: "Aurora ANC Wireless Headphones", sku: "AUR-ANC-01", price: "129.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842799990", shipped: daysAgo(8) },
    ipCountry: "US",
  },
});

Object.assign(demoTracking, {
  "1Z999AA10198765432": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(11), location: "Asheville, NC", detail: "Picked up by UPS" },
      { time: daysAgo(9), location: "Dallas, TX", detail: "Departed facility" },
      { time: daysAgo(8), location: "Austin, TX 78701", detail: "Delivered, front porch. Signed by: J. PATEL" },
    ],
  },
  "9400111202555842711110": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(6), location: "Asheville, NC", detail: "Accepted at USPS origin facility" },
      { time: daysAgo(2), location: "Denver, CO 80203", detail: "Delivered, in mailbox" },
    ],
  },
  "794644790177": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(3), location: "Austin, TX", detail: "Picked up" },
      { time: daysAgo(1), location: "Newark, NJ 07114", detail: "Delivered to freight forwarding warehouse. Signed by: DOCK 2" },
    ],
  },
  "9400111202555842799990": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(8), location: "Asheville, NC", detail: "Accepted at USPS origin facility" },
      { time: daysAgo(5), location: "Columbus, OH", detail: "Arrived at post office" },
      { time: daysAgo(4), location: "Columbus, OH 43215", detail: "Delivered, in/at mailbox" },
    ],
  },
});

Object.assign(demoCustomers, {
  "jay.patel@example.com": {
    accountAgeDays: 900, orders: 5, totalSpent: "402.00", priorDisputes: 1,
    notes: "One previous 'not received' claim in 2025; tracking showed delivered with signature.",
  },
  "lena.brooks@example.com": {
    accountAgeDays: 450, orders: 3, totalSpent: "96.00", priorDisputes: 0, notes: "Happy repeat customer.",
  },
  "m.hale.deals77@example.net": {
    accountAgeDays: 2, orders: 1, totalSpent: "219.00", priorDisputes: 0,
    notes: "Brand-new account; email doesn't match the cardholder's name.",
  },
  "sam.ortiz@example.com": {
    accountAgeDays: 610, orders: 2, totalSpent: "171.00", priorDisputes: 0, notes: "No issues on the previous order.",
  },
});

export const storePolicies = `STORE POLICIES (Juniper & Co.)
- Shipping: all orders ship with tracking within 2 business days. Standard delivery 3-7 business days.
- Damaged items: report within 14 days with a photo. We offer a replacement OR a refund of the damaged item's share of the price. No need to return broken items under $25.
- Returns: unused items within 30 days, buyer pays return shipping.
- Lost packages: if tracking does not show delivery within 14 days of shipping, we reship or refund in full.
- Fraud: orders shipped to freight forwarders are high risk; we do not have signature confirmation for orders under $300.
- Margin note: average product margin is ~45%; replacement mug cost to us is $6.`;

// NFC package tags (Tap-to-Confirm). The seller sticks a tag inside the box at packing time.
// When the buyer's phone touches the box, the tag opens a page that records the tap.
// Headphones: the tag was tapped in Portland 2.5 hours after USPS marked it delivered,
// yet the buyer says it never arrived. The tote is still in transit, so it hasn't been tapped.
export const demoNfcTags = [
  {
    id: "tg-hp20481",
    transactionId: "7XK45123AB9876543",
    label: { buyerName: "Jordan Miles", items: ["Aurora ANC Wireless Headphones"], total: "129.00" },
    createdAt: "2026-10-14T15:10:00.000Z",
    writtenAt: "2026-10-14T15:12:00.000Z",
    taps: [
      { time: "2026-10-17T23:44:00.000Z", kind: "OPEN", device: "iPhone · Safari", place: "Portland, OR (network location)" },
    ],
  },
  {
    id: "tg-tt20544",
    transactionId: "5HT77001GH1122334",
    label: { buyerName: "Emma Schultz", items: ["Organic Cotton Tote Bag (2-pack)"], total: "42.50" },
    createdAt: daysAgo(7),
    writtenAt: daysAgo(7),
    taps: [],
  },
];

// ---- more cases: refund already issued, a real double charge, friendly fraud ----
Object.assign(demoOrders, {
  "6PL20977RS3344120": {
    orderId: "SHOP-20488",
    placed: daysAgo(30),
    customerEmail: "olivia.chen@example.com",
    shippingAddress: "260 Maple Ave, Evanston, IL 60201, US",
    billingAddress: "260 Maple Ave, Evanston, IL 60201, US",
    items: [{ name: "Merino Wool Throw Blanket", sku: "MRN-THROW", price: "98.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842720018", shipped: daysAgo(29) },
    returnShipment: { carrier: "USPS", trackingNumber: "9400111202555842733334", received: daysAgo(10) },
    refund: { id: "REF-6K2208", amount: "98.00", issued: daysAgo(9), method: "Full refund to the original PayPal payment", paypalStatus: "COMPLETED" },
    ipCountry: "US",
  },
  "1RT55021ZX6677881": {
    orderId: "SHOP-20640",
    placed: daysAgo(3),
    customerEmail: "marco.rossi@example.com",
    shippingAddress: "14 Harbor St, Providence, RI 02903, US",
    billingAddress: "14 Harbor St, Providence, RI 02903, US",
    items: [{ name: "Cold Brew Coffee Maker", sku: "BREW-1L", price: "39.99" }],
    shipping: { carrier: "UPS", trackingNumber: "1Z999AA10155501234", shipped: daysAgo(2) },
    duplicateCapture: { transactionId: "1RT55021ZX6677882", amount: "39.99", capturedSecondsLater: 41, shipped: false, note: "Checkout button clicked twice; the second payment has no order or shipment" },
    ipCountry: "US",
  },
  "8WV31088TU5566342": {
    orderId: "SHOP-20618",
    placed: daysAgo(12),
    customerEmail: "rachel.kim@example.com",
    shippingAddress: "88 Summit Rd, Boulder, CO 80302, US",
    billingAddress: "88 Summit Rd, Boulder, CO 80302, US",
    items: [{ name: "Trailblazer Hiking Backpack 40L", sku: "TRL-40", price: "149.00" }],
    shipping: { carrier: "FEDEX", trackingNumber: "794644790255", shipped: daysAgo(11) },
    ipCountry: "US",
    deviceMatch: "Same device and IP as the buyer's 6 earlier orders",
  },
});

Object.assign(demoTracking, {
  "9400111202555842720018": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(29), location: "Asheville, NC", detail: "Accepted at USPS origin facility" },
      { time: daysAgo(26), location: "Evanston, IL 60201", detail: "Delivered, front door" },
    ],
  },
  "9400111202555842733334": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(14), location: "Evanston, IL", detail: "Return accepted at post office" },
      { time: daysAgo(10), location: "Asheville, NC 28801", detail: "Return delivered to the store's warehouse" },
    ],
  },
  "1Z999AA10155501234": {
    status: "IN_TRANSIT",
    events: [
      { time: daysAgo(2), location: "Asheville, NC", detail: "Picked up by UPS" },
      { time: daysAgo(1), location: "Hartford, CT", detail: "Arrived at facility" },
    ],
  },
  "794644790255": {
    status: "DELIVERED",
    events: [
      { time: daysAgo(11), location: "Asheville, NC", detail: "Picked up" },
      { time: daysAgo(8), location: "Boulder, CO 80302", detail: "Delivered, front door. Signed by: RACHEL KIM" },
    ],
  },
});

Object.assign(demoCustomers, {
  "olivia.chen@example.com": {
    accountAgeDays: 800, orders: 5, totalSpent: "344.00", priorDisputes: 0, notes: "Returned the blanket within 30 days; refund REF-6K2208 sent the day after it arrived.",
  },
  "marco.rossi@example.com": {
    accountAgeDays: 220, orders: 2, totalSpent: "79.98", priorDisputes: 0, notes: "Two identical payments 41 seconds apart on this order.",
  },
  "rachel.kim@example.com": {
    accountAgeDays: 1510, orders: 7, totalSpent: "868.00", priorDisputes: 0, notes: "Six earlier orders to the same address, all delivered without issue. Left a 5-star review on a past order.",
  },
});

// The backpack's tag: the buyer tapped it and pressed "Arrived OK" two days after delivery.
demoNfcTags.push({
  id: "tg-tr20618",
  transactionId: "8WV31088TU5566342",
  label: { buyerName: "Rachel Kim", items: ["Trailblazer Hiking Backpack 40L"], total: "149.00" },
  createdAt: daysAgo(11),
  writtenAt: daysAgo(11),
  taps: [
    { time: daysAgo(6), kind: "OPEN", device: "Android · Chrome", place: "Boulder, CO (network location)" },
    { time: daysAgo(6), kind: "CONFIRM_OK", device: "Android · Chrome", location: { lat: 40.01499, lon: -105.27055, accuracy: 18 } },
  ],
});

incomingTemplates.push(
  {
    // The return arrived but nobody sent the refund: the agent says pay it.
    reason: "CREDIT_NOT_PROCESSED",
    stage: "INQUIRY",
    amount: { value: "34.00", currency: "USD" },
    buyerName: "Nina Alvarez",
    transactionId: "3KM40122VW7788231",
    items: [{ name: "Bamboo Cutting Board Set", quantity: 1 }],
    message: "You received my return 10 days ago according to tracking. Where is my refund?",
  },
  {
    reason: "UNAUTHORISED",
    stage: "CHARGEBACK",
    amount: { value: "98.00", currency: "USD" },
    buyerName: "Chris Doyle",
    transactionId: "5NB60344XY9900453",
    items: [{ name: "Merino Wool Throw Blanket", quantity: 1 }],
    message: "Unauthorized transaction.",
  },
);

Object.assign(demoOrders, {
  "3KM40122VW7788231": {
    orderId: "SHOP-20655",
    placed: daysAgo(25),
    customerEmail: "nina.alvarez@example.com",
    shippingAddress: "5 Grove St, Savannah, GA 31401, US",
    billingAddress: "5 Grove St, Savannah, GA 31401, US",
    items: [{ name: "Bamboo Cutting Board Set", sku: "BMB-3", price: "34.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842744445", shipped: daysAgo(24) },
    returnShipment: { carrier: "USPS", trackingNumber: "9400111202555842755556", received: daysAgo(10) },
    refund: null,
    ipCountry: "US",
  },
  "5NB60344XY9900453": {
    orderId: "SHOP-20661",
    placed: daysAgo(15),
    customerEmail: "chris.doyle@example.com",
    shippingAddress: "31 Pearl St, Burlington, VT 05401, US",
    billingAddress: "31 Pearl St, Burlington, VT 05401, US",
    items: [{ name: "Merino Wool Throw Blanket", sku: "MRN-THROW", price: "98.00" }],
    shipping: { carrier: "UPS", trackingNumber: "1Z999AA10166602345", shipped: daysAgo(14) },
    ipCountry: "US",
  },
});

Object.assign(demoTracking, {
  "9400111202555842744445": { status: "DELIVERED", events: [{ time: daysAgo(24), location: "Asheville, NC", detail: "Accepted at USPS origin facility" }, { time: daysAgo(21), location: "Savannah, GA 31401", detail: "Delivered, in mailbox" }] },
  "9400111202555842755556": { status: "DELIVERED", events: [{ time: daysAgo(13), location: "Savannah, GA", detail: "Return accepted at post office" }, { time: daysAgo(10), location: "Asheville, NC 28801", detail: "Return delivered to the store's warehouse" }] },
  "1Z999AA10166602345": { status: "DELIVERED", events: [{ time: daysAgo(14), location: "Asheville, NC", detail: "Picked up by UPS" }, { time: daysAgo(11), location: "Burlington, VT 05401", detail: "Delivered, front porch. Signed by: CHRIS DOYLE" }] },
});

Object.assign(demoCustomers, {
  "nina.alvarez@example.com": { accountAgeDays: 400, orders: 2, totalSpent: "71.00", priorDisputes: 0, notes: "Return logged as received; no refund recorded yet." },
  "chris.doyle@example.com": { accountAgeDays: 1100, orders: 4, totalSpent: "312.00", priorDisputes: 1, notes: "Same address on all 4 orders. One earlier 'unauthorized' claim in 2025, later withdrawn." },
});
