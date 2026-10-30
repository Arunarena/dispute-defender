// Demo data used when PayPal sandbox keys are not set.
// Disputes are stored in the same normalized shape the app builds from
// real PayPal Disputes API responses (see paypal.js -> normalizeDispute).

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString();

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
          "I ordered these headphones two weeks ago and never got them. Tracking is useless. I want my money back.",
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
];

// The merchant's own order system, keyed by PayPal transaction (capture) ID.
// Live sandbox orders made through the demo shop are added at runtime.
export const demoOrders = {
  "7XK45123AB9876543": {
    orderId: "SHOP-20481",
    placed: daysAgo(16),
    customerEmail: "jordan.miles@example.com",
    shippingAddress: "418 Birch Lane, Portland, OR 97205, US",
    billingAddress: "418 Birch Lane, Portland, OR 97205, US",
    items: [{ name: "Aurora ANC Wireless Headphones", sku: "AUR-ANC-01", price: "129.00" }],
    shipping: { carrier: "USPS", trackingNumber: "9400111202555842761003", shipped: daysAgo(15) },
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
      { time: daysAgo(15), location: "Seattle, WA", detail: "Accepted at USPS origin facility" },
      { time: daysAgo(13), location: "Portland, OR", detail: "Arrived at post office" },
      {
        time: daysAgo(12),
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
});

export const storePolicies = `STORE POLICIES (Juniper & Co.)
- Shipping: all orders ship with tracking within 2 business days. Standard delivery 3-7 business days.
- Damaged items: report within 14 days with a photo. We offer a replacement OR a refund of the damaged item's share of the price. No need to return broken items under $25.
- Returns: unused items within 30 days, buyer pays return shipping.
- Lost packages: if tracking does not show delivery within 14 days of shipping, we reship or refund in full.
- Fraud: orders shipped to freight forwarders are high risk; we do not have signature confirmation for orders under $300.
- Margin note: average product margin is ~45%; replacement mug cost to us is $6.`;
