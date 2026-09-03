import type { Customer, Order, OrderItem, OrderStatus, PaymentMethod } from '@echosphere/core';

/**
 * Order catalogue — requirement 5.
 *
 * 24 customers and 60 orders, built so that every branch of the policy engine
 * has at least one order that exercises it. The awkward cases are written out
 * explicitly rather than generated, because their value *is* their specificity:
 * `4852` and `4582` differ by one transposed digit and belong to two different
 * people, which is the whole reason the read-back in requirement 7 has to be
 * strict.
 *
 * `SCENARIOS` at the bottom pairs each case with what should happen. The caller
 * app's reference panel and the escalation tests both read from it, so the panel
 * cannot drift away from the data the way the old hardcoded cards did.
 */

/** Catalogue is authored relative to a fixed day so return windows stay stable. */
export const CATALOGUE_TODAY = '2026-09-03';

function daysAgo(n: number): string {
  const base = new Date(`${CATALOGUE_TODAY}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - n);
  return base.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  return daysAgo(-n);
}

// ── Customers ─────────────────────────────────────────────────────────────────

export const CUSTOMERS: readonly Customer[] = [
  c('cust_001', 'Rahul Sharma', '9876543210', 'Mumbai', 'hi'),
  c('cust_002', 'Priya Menon', '9812347788', 'Bengaluru', 'en'),
  c('cust_003', 'Imran Qureshi', '9899884521', 'Hyderabad', 'hi'),
  c('cust_004', 'Ananya Iyer', '9741125566', 'Chennai', 'en'),
  c('cust_005', 'Vikram Malhotra', '9910012345', 'New Delhi', 'hi'),
  c('cust_006', 'Sneha Reddy', '9848099887', 'Hyderabad', 'en'),
  c('cust_007', 'Arjun Nair', '9995566778', 'Kochi', 'en'),
  c('cust_008', 'Kavya Desai', '9822011223', 'Pune', 'hi'),
  c('cust_009', 'Rohit Verma', '9455033445', 'Lucknow', 'hi'),
  c('cust_010', 'Meera Krishnan', '9840155667', 'Chennai', 'en'),
  c('cust_011', 'Aditya Joshi', '9825077889', 'Ahmedabad', 'hi'),
  c('cust_012', 'Fatima Sheikh', '9425099001', 'Bhopal', 'hi'),
  c('cust_013', 'Karthik Rao', '9880122334', 'Bengaluru', 'en'),
  c('cust_014', 'Nisha Gupta', '9414055667', 'Jaipur', 'hi'),
  c('cust_015', 'Sanjay Patil', '9822144556', 'Nagpur', 'hi'),
  c('cust_016', 'Divya Pillai', '9847066778', 'Thiruvananthapuram', 'en'),
  c('cust_017', 'Harsh Agarwal', '9830188990', 'Kolkata', 'hi'),
  c('cust_018', 'Ritu Chawla', '9815022334', 'Chandigarh', 'hi'),
  c('cust_019', 'Manish Yadav', '9451044556', 'Kanpur', 'hi'),
  c('cust_020', 'Pooja Bhatt', '9825166778', 'Surat', 'hi'),
  c('cust_021', 'Deepak Singh', '9431088990', 'Patna', 'hi'),
  c('cust_022', 'Lakshmi Subramanian', '9842011223', 'Coimbatore', 'en'),
  c('cust_023', 'Zoya Khan', '9906033445', 'Srinagar', 'hi'),
  c('cust_024', 'Nikhil Bose', '9836055667', 'Kolkata', 'en'),
];

function c(
  id: string,
  name: string,
  phone: string,
  city: string,
  preferredLanguage: 'hi' | 'en',
): Customer {
  return {
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    phone: `+91${phone}`,
    phoneLast4: phone.slice(-4),
    city,
    preferredLanguage,
  };
}

// ── Products ──────────────────────────────────────────────────────────────────

type ProductKey = keyof typeof PRODUCTS;

const PRODUCTS = {
  headphones: p('SKU-AUD-001', 'Sony WH-1000XM5 Headphones', 'Audio', 29990, 'RETURNABLE'),
  earbuds: p('SKU-AUD-002', 'boAt Airdopes 141', 'Audio', 1299, 'RETURNABLE'),
  soundbar: p('SKU-AUD-003', 'JBL Cinema SB271 Soundbar', 'Audio', 17999, 'RETURNABLE'),
  macbook: p('SKU-LAP-001', 'Apple MacBook Air M3 512GB', 'Laptops', 134900, 'RETURNABLE'),
  thinkpad: p('SKU-LAP-002', 'Lenovo ThinkPad E14', 'Laptops', 62500, 'RETURNABLE'),
  mouse: p('SKU-ACC-001', 'Logitech MX Master 3S', 'Accessories', 8495, 'RETURNABLE'),
  keyboard: p('SKU-ACC-002', 'Keychron K2 Wireless', 'Accessories', 7999, 'RETURNABLE'),
  vacuum: p('SKU-APP-001', 'Dyson V12 Detect Slim', 'Large Appliances', 55900, 'REPLACEMENT_ONLY'),
  washer: p('SKU-APP-002', 'LG 7kg Front Load Washing Machine', 'Large Appliances', 34490, 'REPLACEMENT_ONLY'),
  fridge: p('SKU-APP-003', 'Samsung 253L Double Door Fridge', 'Large Appliances', 28990, 'REPLACEMENT_ONLY'),
  galaxyTab: p('SKU-MOB-001', 'Samsung Galaxy Tab S9', 'Mobiles', 72999, 'RETURNABLE'),
  pixel: p('SKU-MOB-002', 'Google Pixel 9a', 'Mobiles', 49999, 'RETURNABLE'),
  iphone: p('SKU-MOB-003', 'Apple iPhone 16', 'Mobiles', 79900, 'RETURNABLE'),
  kurta: p('SKU-FSH-001', 'Fabindia Cotton Kurta', 'Fashion', 2499, 'RETURNABLE'),
  sneakers: p('SKU-FSH-002', 'Nike Air Jordan 1 Retro High', 'Fashion', 16995, 'RETURNABLE'),
  coat: p('SKU-FSH-003', 'Zara Oversized Wool Coat', 'Fashion', 8990, 'RETURNABLE'),
  saree: p('SKU-FSH-004', 'Nalli Kanjivaram Silk Saree', 'Fashion', 18500, 'RETURNABLE'),
  vest: p('SKU-INR-001', 'Jockey Cotton Vest Pack of 3', 'Innerwear', 899, 'NON_RETURNABLE'),
  socks: p('SKU-INR-002', 'Puma Ankle Socks Pack of 5', 'Innerwear', 649, 'NON_RETURNABLE'),
  coffee: p('SKU-GRO-001', 'Blue Tokai Coffee Beans 500g', 'Grocery', 899, 'NON_RETURNABLE'),
  atta: p('SKU-GRO-002', 'Aashirvaad Atta 10kg', 'Grocery', 545, 'NON_RETURNABLE'),
  giftCard: p('SKU-GFT-001', 'Nerv Gift Card ₹2000', 'Gift Cards', 2000, 'NON_RETURNABLE'),
  novel: p('SKU-BOK-001', 'The White Tiger — Aravind Adiga', 'Books', 299, 'RETURNABLE'),
  cookbook: p('SKU-BOK-002', 'Made in India — Meera Sodha', 'Books', 649, 'RETURNABLE'),
  chair: p('SKU-FUR-001', 'Featherlite Ergonomic Chair', 'Furniture', 14999, 'REPLACEMENT_ONLY'),
  mattress: p('SKU-FUR-002', 'Wakefit Orthopaedic Mattress Queen', 'Furniture', 12999, 'REPLACEMENT_ONLY'),
  kettle: p('SKU-KIT-001', 'Prestige Electric Kettle 1.5L', 'Kitchen', 1299, 'RETURNABLE'),
  cooker: p('SKU-KIT-002', 'Hawkins Contura 3L Pressure Cooker', 'Kitchen', 1850, 'RETURNABLE'),
  monitor: p('SKU-DSP-001', 'LG 27UP550 4K UHD Monitor', 'Displays', 28500, 'RETURNABLE'),
  watch: p('SKU-WRB-001', 'Noise ColorFit Pro 5', 'Wearables', 3499, 'RETURNABLE'),
} as const;

function p(
  sku: string,
  name: string,
  category: string,
  unitPriceInr: number,
  returnPolicy: OrderItem['returnPolicy'],
): Omit<OrderItem, 'quantity'> {
  return { sku, name, category, unitPriceInr, returnPolicy };
}

function item(key: ProductKey, quantity = 1): OrderItem {
  return { ...PRODUCTS[key], quantity };
}

// ── Order builder ─────────────────────────────────────────────────────────────

interface OrderSpec {
  id: string;
  customerId: string;
  status: OrderStatus;
  products: Array<[ProductKey, number] | ProductKey>;
  payment: PaymentMethod;
  placedDaysAgo: number;
  /** Negative means the promised date is still in the future. */
  expectedInDays: number;
  deliveredDaysAgo?: number;
  cancelledDaysAgo?: number;
  refundedDaysAgo?: number;
  returnWindowDays?: number;
  failedDeliveryAttempts?: number;
  courier?: string;
}

const COURIERS = ['Delhivery', 'Blue Dart', 'Ekart', 'XpressBees', 'India Post'];

const ADDRESSES: Record<string, string> = {
  Mumbai: 'Flat 4B, Green View Apartments, Andheri West, Mumbai 400053',
  Bengaluru: '212, 4th Cross, HSR Layout Sector 3, Bengaluru 560102',
  Hyderabad: 'Plot 45, Road No 12, Banjara Hills, Hyderabad 500034',
  Chennai: 'No 34, 2nd Cross Street, Adyar, Chennai 600020',
  'New Delhi': 'House 12, Block C, Vasant Kunj, New Delhi 110070',
  Kochi: 'Villa 7, Panampilly Nagar, Kochi 682036',
  Pune: 'Flat 12, Rosewood Society, Koregaon Park, Pune 411001',
  Lucknow: 'B-88, Gomti Nagar, Lucknow 226010',
  Ahmedabad: 'B-204, Royal Palace, Vastrapur, Ahmedabad 380015',
  Bhopal: '31, Arera Colony, Bhopal 462016',
  Jaipur: 'C-56, Malviya Nagar, Jaipur 302017',
  Nagpur: '18, Dharampeth, Nagpur 440010',
  Thiruvananthapuram: 'TC 9/1234, Sasthamangalam, Thiruvananthapuram 695010',
  Kolkata: '7A, Ballygunge Place, Kolkata 700019',
  Chandigarh: 'House 221, Sector 35A, Chandigarh 160022',
  Kanpur: '55, Swaroop Nagar, Kanpur 208002',
  Surat: 'A-9, Citylight Road, Surat 395007',
  Patna: '14, Boring Road, Patna 800001',
  Coimbatore: '22, RS Puram, Coimbatore 641002',
  Srinagar: 'Lane 3, Rajbagh, Srinagar 190008',
};

/** Statuses a real order passes through on the way to the given one. */
function historyFor(status: OrderStatus, placedAt: string, expectedAt: string, deliveredAt: string | null): Order['history'] {
  const chain: OrderStatus[] = ['PLACED'];
  const add = (...s: OrderStatus[]) => chain.push(...s);

  switch (status) {
    case 'PLACED':
      break;
    case 'PACKED':
      add('PACKED');
      break;
    case 'SHIPPED':
      add('PACKED', 'SHIPPED');
      break;
    case 'IN_TRANSIT':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT');
      break;
    case 'OUT_FOR_DELIVERY':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY');
      break;
    case 'DELAYED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'DELAYED');
      break;
    case 'DELIVERY_FAILED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED');
      break;
    case 'DELIVERED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED');
      break;
    case 'CANCELLED':
      add('CANCELLED');
      break;
    case 'RTO':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RTO');
      break;
    case 'LOST_IN_TRANSIT':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'LOST_IN_TRANSIT');
      break;
    case 'RETURN_REQUESTED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED');
      break;
    case 'RETURN_PICKED_UP':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_PICKED_UP');
      break;
    case 'RETURNED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_PICKED_UP', 'RETURNED');
      break;
    case 'REFUND_PENDING':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED', 'REFUND_PENDING');
      break;
    case 'REFUNDED':
      add('PACKED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED', 'REFUNDED');
      break;
  }

  const start = new Date(`${placedAt}T09:00:00Z`).getTime();
  const end = new Date(`${deliveredAt ?? expectedAt}T18:00:00Z`).getTime();
  const step = chain.length > 1 ? (end - start) / (chain.length - 1) : 0;

  return chain.map((s, i) => ({
    status: s,
    at: new Date(start + step * i).toISOString().slice(0, 10),
    note: null,
  }));
}

function build(spec: OrderSpec): Order {
  const customer = CUSTOMERS.find((cu) => cu.id === spec.customerId)!;
  const items = spec.products.map((entry) =>
    Array.isArray(entry) ? item(entry[0], entry[1]) : item(entry),
  );
  const placedAt = daysAgo(spec.placedDaysAgo);
  const expectedDeliveryAt =
    spec.expectedInDays >= 0 ? daysAgo(spec.expectedInDays) : daysAhead(-spec.expectedInDays);
  const deliveredAt = spec.deliveredDaysAgo !== undefined ? daysAgo(spec.deliveredDaysAgo) : null;

  const needsCourier = !['PLACED', 'PACKED', 'CANCELLED'].includes(spec.status);

  return {
    id: spec.id,
    customerId: spec.customerId,
    status: spec.status,
    items,
    totalInr: items.reduce((sum, i) => sum + i.unitPriceInr * i.quantity, 0),
    paymentMethod: spec.payment,
    placedAt,
    expectedDeliveryAt,
    deliveredAt,
    cancelledAt: spec.cancelledDaysAgo !== undefined ? daysAgo(spec.cancelledDaysAgo) : null,
    refundedAt: spec.refundedDaysAgo !== undefined ? daysAgo(spec.refundedDaysAgo) : null,
    courier: needsCourier ? (spec.courier ?? COURIERS[hash(spec.id) % COURIERS.length]!) : null,
    trackingId: needsCourier ? `${spec.id}${String(hash(spec.id)).padStart(6, '0').slice(0, 6)}` : null,
    deliveryAddress: ADDRESSES[customer.city] ?? `${customer.city}, India`,
    city: customer.city,
    returnWindowDays: spec.returnWindowDays ?? 10,
    failedDeliveryAttempts: spec.failedDeliveryAttempts ?? 0,
    history: historyFor(spec.status, placedAt, expectedDeliveryAt, deliveredAt),
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1_000_003;
  return h;
}

// ── The catalogue ─────────────────────────────────────────────────────────────

const SPECS: OrderSpec[] = [
  // ── The transposed-digit pair. Different customers, on purpose. ───────────
  { id: '4852', customerId: 'cust_001', status: 'DELAYED', products: ['headphones'], payment: 'PREPAID_CARD', placedDaysAgo: 17, expectedInDays: 13 },
  { id: '4582', customerId: 'cust_002', status: 'DELIVERED', products: ['vacuum'], payment: 'EMI', placedDaysAgo: 22, expectedInDays: 18, deliveredDaysAgo: 18 },

  // ── Out for delivery → cancelling needs a human (req 6.3). ───────────────
  { id: '7193', customerId: 'cust_001', status: 'OUT_FOR_DELIVERY', products: ['mouse'], payment: 'UPI', placedDaysAgo: 6, expectedInDays: 0 },
  { id: '7194', customerId: 'cust_005', status: 'OUT_FOR_DELIVERY', products: ['sneakers'], payment: 'COD', placedDaysAgo: 4, expectedInDays: 0 },

  // ── Return windows: one open, one closed. ────────────────────────────────
  { id: '5501', customerId: 'cust_004', status: 'DELIVERED', products: ['kurta', 'cookbook'], payment: 'UPI', placedDaysAgo: 9, expectedInDays: 4, deliveredDaysAgo: 3 },
  { id: '5502', customerId: 'cust_005', status: 'DELIVERED', products: ['coat'], payment: 'PREPAID_CARD', placedDaysAgo: 52, expectedInDays: 46, deliveredDaysAgo: 45 },

  // ── Cancellable by the AI: low value and high value. ────────────────────
  { id: '6001', customerId: 'cust_006', status: 'PLACED', products: ['novel'], payment: 'UPI', placedDaysAgo: 1, expectedInDays: -4 },
  { id: '6002', customerId: 'cust_007', status: 'PACKED', products: ['macbook'], payment: 'EMI', placedDaysAgo: 2, expectedInDays: -3 },

  // ── Already-settled money states. ───────────────────────────────────────
  { id: '6100', customerId: 'cust_008', status: 'REFUNDED', products: ['saree'], payment: 'NET_BANKING', placedDaysAgo: 40, expectedInDays: 35, deliveredDaysAgo: 34, refundedDaysAgo: 20 },
  { id: '6101', customerId: 'cust_009', status: 'REFUND_PENDING', products: ['pixel'], payment: 'PREPAID_CARD', placedDaysAgo: 30, expectedInDays: 25, deliveredDaysAgo: 24 },

  // ── Category policy blocks. ─────────────────────────────────────────────
  { id: '6200', customerId: 'cust_010', status: 'DELIVERED', products: [['vest', 2]], payment: 'UPI', placedDaysAgo: 8, expectedInDays: 3, deliveredDaysAgo: 2 },
  { id: '6201', customerId: 'cust_011', status: 'DELIVERED', products: ['washer'], payment: 'EMI', placedDaysAgo: 14, expectedInDays: 8, deliveredDaysAgo: 6 },
  { id: '6202', customerId: 'cust_022', status: 'DELIVERED', products: ['giftCard'], payment: 'WALLET', placedDaysAgo: 5, expectedInDays: 4, deliveredDaysAgo: 4 },

  // ── Delivery trouble. ───────────────────────────────────────────────────
  { id: '6300', customerId: 'cust_012', status: 'DELIVERY_FAILED', products: ['monitor'], payment: 'COD', placedDaysAgo: 11, expectedInDays: 3, failedDeliveryAttempts: 2 },
  { id: '6301', customerId: 'cust_013', status: 'LOST_IN_TRANSIT', products: ['iphone'], payment: 'PREPAID_CARD', placedDaysAgo: 20, expectedInDays: 12 },
  { id: '6600', customerId: 'cust_019', status: 'RTO', products: ['chair'], payment: 'COD', placedDaysAgo: 26, expectedInDays: 18, failedDeliveryAttempts: 3 },

  // ── Mid-flight, cancellable without a human. ────────────────────────────
  { id: '6400', customerId: 'cust_014', status: 'IN_TRANSIT', products: ['cooker', 'kettle'], payment: 'COD', placedDaysAgo: 3, expectedInDays: -2 },
  { id: '6401', customerId: 'cust_015', status: 'SHIPPED', products: ['thinkpad'], payment: 'EMI', placedDaysAgo: 2, expectedInDays: -5 },

  // ── Mixed basket: one returnable item, one not. ─────────────────────────
  { id: '6500', customerId: 'cust_016', status: 'DELIVERED', products: ['keyboard', 'socks'], payment: 'UPI', placedDaysAgo: 7, expectedInDays: 2, deliveredDaysAgo: 1 },

  // ── Return already in flight. ───────────────────────────────────────────
  { id: '6501', customerId: 'cust_017', status: 'RETURN_REQUESTED', products: ['soundbar'], payment: 'PREPAID_CARD', placedDaysAgo: 18, expectedInDays: 12, deliveredDaysAgo: 11 },
  { id: '6502', customerId: 'cust_018', status: 'RETURN_PICKED_UP', products: ['watch'], payment: 'UPI', placedDaysAgo: 24, expectedInDays: 18, deliveredDaysAgo: 17 },
  { id: '6503', customerId: 'cust_024', status: 'RETURNED', products: ['earbuds'], payment: 'WALLET', placedDaysAgo: 33, expectedInDays: 28, deliveredDaysAgo: 27 },

  // ── Already cancelled. ──────────────────────────────────────────────────
  { id: '8321', customerId: 'cust_003', status: 'CANCELLED', products: ['galaxyTab'], payment: 'NET_BANKING', placedDaysAgo: 25, expectedInDays: 20, cancelledDaysAgo: 23 },

  // ── Perishables, delivered same week. ───────────────────────────────────
  { id: '6601', customerId: 'cust_020', status: 'DELAYED', products: ['coffee', 'atta'], payment: 'UPI', placedDaysAgo: 6, expectedInDays: 2 },

  // ── The order id that simulates an order-service outage. ────────────────
  { id: '9999', customerId: 'cust_021', status: 'PLACED', products: ['mattress'], payment: 'COD', placedDaysAgo: 1, expectedInDays: -6 },

  // ── Depth: more orders per customer, spread across every status. ─────────
  { id: '7001', customerId: 'cust_001', status: 'DELIVERED', products: ['earbuds'], payment: 'UPI', placedDaysAgo: 60, expectedInDays: 55, deliveredDaysAgo: 54 },
  { id: '7002', customerId: 'cust_002', status: 'IN_TRANSIT', products: ['monitor'], payment: 'PREPAID_CARD', placedDaysAgo: 4, expectedInDays: -1 },
  { id: '7003', customerId: 'cust_003', status: 'DELIVERED', products: ['kurta', ['socks', 2]], payment: 'COD', placedDaysAgo: 12, expectedInDays: 7, deliveredDaysAgo: 6 },
  { id: '7004', customerId: 'cust_004', status: 'PLACED', products: ['cookbook'], payment: 'WALLET', placedDaysAgo: 0, expectedInDays: -5 },
  { id: '7005', customerId: 'cust_005', status: 'DELAYED', products: ['fridge'], payment: 'EMI', placedDaysAgo: 15, expectedInDays: 8 },
  { id: '7006', customerId: 'cust_006', status: 'SHIPPED', products: ['saree'], payment: 'NET_BANKING', placedDaysAgo: 3, expectedInDays: -3 },
  { id: '7007', customerId: 'cust_007', status: 'DELIVERED', products: ['chair'], payment: 'PREPAID_CARD', placedDaysAgo: 21, expectedInDays: 15, deliveredDaysAgo: 14 },
  { id: '7008', customerId: 'cust_008', status: 'OUT_FOR_DELIVERY', products: ['cooker'], payment: 'COD', placedDaysAgo: 5, expectedInDays: 0 },
  { id: '7009', customerId: 'cust_009', status: 'PACKED', products: ['keyboard'], payment: 'UPI', placedDaysAgo: 1, expectedInDays: -4 },
  { id: '7010', customerId: 'cust_010', status: 'DELIVERED', products: ['mattress'], payment: 'EMI', placedDaysAgo: 35, expectedInDays: 28, deliveredDaysAgo: 26 },
  { id: '7011', customerId: 'cust_011', status: 'IN_TRANSIT', products: ['novel', 'cookbook'], payment: 'UPI', placedDaysAgo: 2, expectedInDays: -2 },
  { id: '7012', customerId: 'cust_012', status: 'DELIVERED', products: ['watch'], payment: 'WALLET', placedDaysAgo: 10, expectedInDays: 5, deliveredDaysAgo: 4 },
  { id: '7013', customerId: 'cust_013', status: 'DELAYED', products: ['soundbar'], payment: 'PREPAID_CARD', placedDaysAgo: 13, expectedInDays: 6 },
  { id: '7014', customerId: 'cust_014', status: 'DELIVERED', products: ['atta', 'coffee'], payment: 'COD', placedDaysAgo: 4, expectedInDays: 2, deliveredDaysAgo: 1 },
  { id: '7015', customerId: 'cust_015', status: 'PLACED', products: ['vest'], payment: 'UPI', placedDaysAgo: 0, expectedInDays: -3 },
  { id: '7016', customerId: 'cust_016', status: 'SHIPPED', products: ['iphone'], payment: 'EMI', placedDaysAgo: 2, expectedInDays: -4 },
  { id: '7017', customerId: 'cust_017', status: 'DELIVERED', products: ['thinkpad'], payment: 'NET_BANKING', placedDaysAgo: 28, expectedInDays: 22, deliveredDaysAgo: 21 },
  { id: '7018', customerId: 'cust_018', status: 'CANCELLED', products: ['sneakers'], payment: 'UPI', placedDaysAgo: 9, expectedInDays: 4, cancelledDaysAgo: 8 },
  { id: '7019', customerId: 'cust_019', status: 'IN_TRANSIT', products: ['kettle'], payment: 'COD', placedDaysAgo: 3, expectedInDays: -1 },
  { id: '7020', customerId: 'cust_020', status: 'DELIVERED', products: ['galaxyTab'], payment: 'EMI', placedDaysAgo: 16, expectedInDays: 11, deliveredDaysAgo: 9 },
  { id: '7021', customerId: 'cust_021', status: 'DELAYED', products: ['washer'], payment: 'EMI', placedDaysAgo: 19, expectedInDays: 9 },
  { id: '7022', customerId: 'cust_022', status: 'OUT_FOR_DELIVERY', products: ['coat'], payment: 'PREPAID_CARD', placedDaysAgo: 5, expectedInDays: 0 },
  { id: '7023', customerId: 'cust_023', status: 'DELIVERED', products: ['macbook'], payment: 'EMI', placedDaysAgo: 44, expectedInDays: 38, deliveredDaysAgo: 37 },
  { id: '7024', customerId: 'cust_024', status: 'PACKED', products: ['pixel'], payment: 'UPI', placedDaysAgo: 1, expectedInDays: -5 },
  { id: '7025', customerId: 'cust_001', status: 'DELIVERED', products: ['monitor'], payment: 'PREPAID_CARD', placedDaysAgo: 70, expectedInDays: 64, deliveredDaysAgo: 63 },
  { id: '7026', customerId: 'cust_002', status: 'DELIVERY_FAILED', products: ['fridge'], payment: 'COD', placedDaysAgo: 14, expectedInDays: 5, failedDeliveryAttempts: 1 },
  { id: '7027', customerId: 'cust_004', status: 'DELIVERED', products: ['sneakers'], payment: 'UPI', placedDaysAgo: 6, expectedInDays: 2, deliveredDaysAgo: 2 },
  { id: '7028', customerId: 'cust_006', status: 'REFUNDED', products: ['earbuds'], payment: 'UPI', placedDaysAgo: 50, expectedInDays: 45, deliveredDaysAgo: 44, refundedDaysAgo: 30 },
  { id: '7029', customerId: 'cust_010', status: 'PLACED', products: ['giftCard'], payment: 'WALLET', placedDaysAgo: 0, expectedInDays: -1 },
  { id: '7030', customerId: 'cust_013', status: 'DELIVERED', products: ['chair', 'keyboard'], payment: 'EMI', placedDaysAgo: 11, expectedInDays: 6, deliveredDaysAgo: 5 },
  { id: '7031', customerId: 'cust_016', status: 'DELAYED', products: ['mattress'], payment: 'COD', placedDaysAgo: 21, expectedInDays: 11 },
  { id: '7032', customerId: 'cust_020', status: 'IN_TRANSIT', products: ['vacuum'], payment: 'EMI', placedDaysAgo: 4, expectedInDays: -2 },
  { id: '7033', customerId: 'cust_023', status: 'OUT_FOR_DELIVERY', products: ['novel', 'cookbook'], payment: 'UPI', placedDaysAgo: 4, expectedInDays: 0 },
  { id: '7034', customerId: 'cust_003', status: 'SHIPPED', products: ['watch'], payment: 'WALLET', placedDaysAgo: 2, expectedInDays: -3 },
  { id: '7035', customerId: 'cust_007', status: 'RETURN_REQUESTED', products: ['kurta'], payment: 'UPI', placedDaysAgo: 15, expectedInDays: 10, deliveredDaysAgo: 9 },

  // ── High-value delicate electronics return within 10-day window (escalates - req 6.2) ──
  { id: '7036', customerId: 'cust_005', status: 'DELIVERED', products: ['iphone'], payment: 'PREPAID_CARD', placedDaysAgo: 7, expectedInDays: 3, deliveredDaysAgo: 2 },
  { id: '7037', customerId: 'cust_009', status: 'DELIVERED', products: ['soundbar'], payment: 'UPI', placedDaysAgo: 8, expectedInDays: 4, deliveredDaysAgo: 3 },

  // ── Out for delivery cancel requests (must escalate to human - req 6.3) ──
  { id: '7038', customerId: 'cust_004', status: 'OUT_FOR_DELIVERY', products: ['soundbar'], payment: 'UPI', placedDaysAgo: 4, expectedInDays: 0 },
  { id: '7039', customerId: 'cust_011', status: 'OUT_FOR_DELIVERY', products: ['galaxyTab'], payment: 'EMI', placedDaysAgo: 3, expectedInDays: 0 },
  { id: '7040', customerId: 'cust_015', status: 'OUT_FOR_DELIVERY', products: ['headphones'], payment: 'COD', placedDaysAgo: 4, expectedInDays: 0 },

  // ── Pre-dispatch cancellations (AI resolves directly without human - req 6) ──
  { id: '7041', customerId: 'cust_012', status: 'PLACED', products: ['keyboard'], payment: 'UPI', placedDaysAgo: 1, expectedInDays: -4 },
  { id: '7042', customerId: 'cust_018', status: 'PACKED', products: ['cooker'], payment: 'COD', placedDaysAgo: 1, expectedInDays: -3 },
  { id: '7043', customerId: 'cust_021', status: 'PLACED', products: ['kettle'], payment: 'WALLET', placedDaysAgo: 0, expectedInDays: -4 },

  // ── Direct refunds requested for delivered items (escalates with verification report - req 6.2) ──
  { id: '7044', customerId: 'cust_002', status: 'DELIVERED', products: ['monitor'], payment: 'NET_BANKING', placedDaysAgo: 5, expectedInDays: 2, deliveredDaysAgo: 1 },
  { id: '7045', customerId: 'cust_008', status: 'DELIVERED', products: ['watch'], payment: 'UPI', placedDaysAgo: 6, expectedInDays: 2, deliveredDaysAgo: 2 },

  // ── Delivery delayed & in transit inquiries (AI resolves directly with delivery ETA - req 6) ──
  { id: '7046', customerId: 'cust_014', status: 'DELAYED', products: ['saree'], payment: 'PREPAID_CARD', placedDaysAgo: 12, expectedInDays: 5 },
  { id: '7047', customerId: 'cust_017', status: 'IN_TRANSIT', products: ['sneakers'], payment: 'COD', placedDaysAgo: 3, expectedInDays: -1 },
  { id: '7048', customerId: 'cust_019', status: 'IN_TRANSIT', products: ['earbuds', 'mouse'], payment: 'UPI', placedDaysAgo: 4, expectedInDays: -1 },

  // ── Hindi native orders (req 4, req 8) ──
  { id: '7049', customerId: 'cust_005', status: 'DELAYED', products: ['macbook'], payment: 'EMI', placedDaysAgo: 10, expectedInDays: 4 },
  { id: '7050', customerId: 'cust_009', status: 'OUT_FOR_DELIVERY', products: ['vacuum'], payment: 'COD', placedDaysAgo: 5, expectedInDays: 0 },
  { id: '7051', customerId: 'cust_011', status: 'DELIVERED', products: ['kurta'], payment: 'UPI', placedDaysAgo: 6, expectedInDays: 2, deliveredDaysAgo: 2 },
  { id: '7052', customerId: 'cust_020', status: 'PLACED', products: ['cookbook'], payment: 'WALLET', placedDaysAgo: 0, expectedInDays: -3 },

  // ── Failed delivery attempt & address updates (AI resolves directly) ──
  { id: '7053', customerId: 'cust_007', status: 'DELIVERY_FAILED', products: ['headphones'], payment: 'COD', placedDaysAgo: 8, expectedInDays: 2, failedDeliveryAttempts: 2 },
  { id: '7054', customerId: 'cust_013', status: 'DELIVERY_FAILED', products: ['thinkpad'], payment: 'PREPAID_CARD', placedDaysAgo: 9, expectedInDays: 3, failedDeliveryAttempts: 1 },

  // ── Non-returnable grocery & hygiene items ──
  { id: '7055', customerId: 'cust_003', status: 'DELIVERED', products: ['coffee'], payment: 'UPI', placedDaysAgo: 4, expectedInDays: 2, deliveredDaysAgo: 2 },
  { id: '7056', customerId: 'cust_024', status: 'DELIVERED', products: ['socks'], payment: 'COD', placedDaysAgo: 5, expectedInDays: 2, deliveredDaysAgo: 1 },

  // ── Replacement only large furniture / appliance ──
  { id: '7057', customerId: 'cust_006', status: 'DELIVERED', products: ['washer'], payment: 'EMI', placedDaysAgo: 7, expectedInDays: 3, deliveredDaysAgo: 2 },
  { id: '7058', customerId: 'cust_016', status: 'DELIVERED', products: ['mattress'], payment: 'PREPAID_CARD', placedDaysAgo: 8, expectedInDays: 3, deliveredDaysAgo: 2 },

  // ── Already settled refunds / RTO ──
  { id: '7059', customerId: 'cust_010', status: 'REFUNDED', products: ['kurta'], payment: 'UPI', placedDaysAgo: 30, expectedInDays: 25, deliveredDaysAgo: 24, refundedDaysAgo: 15 },
  { id: '7060', customerId: 'cust_022', status: 'RTO', products: ['soundbar'], payment: 'COD', placedDaysAgo: 18, expectedInDays: 10, failedDeliveryAttempts: 3 },
];

export const ORDERS: readonly Order[] = SPECS.map(build);

/** Order ids that behave as though the order service is unavailable. */
export const OUTAGE_ORDER_IDS: ReadonlySet<string> = new Set(['9999']);

// ── Test scenarios ────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  title: string;
  orderId: string;
  customerName: string;
  /** What the caller should say to trigger it. */
  say: string;
  /** What the system is expected to do. */
  expect: string;
  escalates: boolean;
  language: 'hi' | 'en';
  tags: string[];
}

/**
 * The behaviours worth demonstrating, each pinned to a real order.
 *
 * Read by the caller app's reference panel and by the escalation tests, which is
 * the point: if a status changes in the catalogue, both move together.
 */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'status-delayed',
    title: 'Delayed order, AI resolves it',
    orderId: '4852',
    customerName: 'Rahul Sharma',
    say: 'My order 4852 has not arrived yet',
    expect: 'Reads the order back with the name, confirms, explains the delay. No human.',
    escalates: false,
    language: 'en',
    tags: ['req6', 'req7'],
  },
  {
    id: 'ambiguous-digits',
    title: 'Transposed digits belong to someone else',
    orderId: '4582',
    customerName: 'Priya Menon',
    say: 'It is 4582... no wait, 4852',
    expect: 'Refuses to guess, reads both numbers back, asks which. Never discloses either order.',
    escalates: false,
    language: 'en',
    tags: ['req7', 'privacy'],
  },
  {
    id: 'name-mismatch',
    title: 'Wrong name on the order',
    orderId: '4852',
    customerName: 'Rahul Sharma',
    say: 'Order 4852, my name is Amit Kumar',
    expect: 'Withholds all order details, asks for the name as entered. No disclosure.',
    escalates: false,
    language: 'en',
    tags: ['req7', 'privacy'],
  },
  {
    id: 'cancel-before-dispatch',
    title: 'Cancel a placed order — AI does it',
    orderId: '6001',
    customerName: 'Sneha Reddy',
    say: 'I want to cancel order 6001, I ordered it by mistake',
    expect: 'Verifies, asks the reason, cancels it directly. Explicitly no escalation.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'cancel-out-for-delivery',
    title: 'Cancel while out for delivery — escalates',
    orderId: '7193',
    customerName: 'Rahul Sharma',
    say: 'Cancel order 7193 please',
    expect: 'Verifies, then hands to a human because it is with the courier today.',
    escalates: true,
    language: 'en',
    tags: ['req6.3'],
  },
  {
    id: 'refund-verified',
    title: 'Refund — verified, then escalates',
    orderId: '5501',
    customerName: 'Ananya Iyer',
    say: 'I want a refund for order 5501, the kurta does not fit',
    expect: 'Verifies order + name + window, builds the report, then hands over.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'return-window-closed',
    title: 'Return after the window closed',
    orderId: '5502',
    customerName: 'Vikram Malhotra',
    say: 'I want to return order 5502',
    expect: 'Escalates with a finding that the 10-day window closed 35 days ago.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'non-returnable',
    title: 'Return a non-returnable item',
    orderId: '6200',
    customerName: 'Meera Krishnan',
    say: 'I need to return order 6200',
    expect: 'Escalates, flagging the innerwear category as non-returnable.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'duplicate-refund',
    title: 'Refund already paid out',
    orderId: '6100',
    customerName: 'Kavya Desai',
    say: 'Where is my refund for 6100',
    expect: 'Escalates with a possible-duplicate finding and the refund date.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'insists-on-human',
    title: 'Insisting on a human — three asks',
    orderId: '4852',
    customerName: 'Rahul Sharma',
    say: 'Give me a human (repeat three times)',
    expect: 'Two substantive retention attempts, then hands over on the third ask.',
    escalates: true,
    language: 'en',
    tags: ['req6.1'],
  },
  {
    id: 'hindi-delayed',
    title: 'Hindi call, delayed order',
    orderId: '6601',
    customerName: 'Pooja Bhatt',
    say: 'मेरा ऑर्डर 6601 अभी तक नहीं आया',
    expect: 'Replies in Devanagari, reads the order number digit by digit, ₹ in Hindi words.',
    escalates: false,
    language: 'hi',
    tags: ['req4', 'req8'],
  },
  {
    id: 'hindi-human-request',
    title: 'Hindi, asks for a person',
    orderId: '7005',
    customerName: 'Vikram Malhotra',
    say: 'मुझे किसी इंसान से बात करनी है',
    expect: 'Recognises the Devanagari request, tries to help twice before handing over.',
    escalates: false,
    language: 'hi',
    tags: ['req6.1'],
  },
  {
    id: 'failed-delivery',
    title: 'Two failed delivery attempts',
    orderId: '6300',
    customerName: 'Fatima Sheikh',
    say: 'Order 6300 was never delivered to me',
    expect: 'AI resolves it: explains both failed attempts, arranges redelivery.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'already-cancelled',
    title: 'Cancel something already cancelled',
    orderId: '8321',
    customerName: 'Imran Qureshi',
    say: 'Cancel order 8321',
    expect: 'Explains it is already cancelled. No escalation, no duplicate action.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'high-value-cancel',
    title: 'High-value order, still pre-dispatch',
    orderId: '6002',
    customerName: 'Arjun Nair',
    say: 'Cancel order 6002, I found it cheaper elsewhere',
    expect: 'AI cancels it — value alone is not a reason to escalate — but flags it.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'backend-outage',
    title: 'Order service unavailable',
    orderId: '9999',
    customerName: 'Deepak Singh',
    say: 'Check order 9999 for me',
    expect: 'Admits the lookup failed, invents nothing, hands over.',
    escalates: true,
    language: 'en',
    tags: ['floor'],
  },
  {
    id: 'no-order-id',
    title: 'No order number offered',
    orderId: '—',
    customerName: '—',
    say: 'My delivery is late, sort it out',
    expect: 'Asks for the order number and will not proceed without it.',
    escalates: false,
    language: 'en',
    tags: ['req7'],
  },
  {
    id: 'unknown-order',
    title: 'Order number that does not exist',
    orderId: '1111',
    customerName: '—',
    say: 'My order number is 1111',
    expect: 'Says it matches nothing, reads it back, asks them to check a digit.',
    escalates: false,
    language: 'en',
    tags: ['req7'],
  },
  {
    id: 'mixed-basket-return',
    title: 'Mixed basket, one item returnable',
    orderId: '6500',
    customerName: 'Divya Pillai',
    say: 'I want to return order 6500',
    expect: 'Escalates with per-item findings: keyboard returnable, socks are not.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'safety-medical',
    title: 'Medical emergency mentioned',
    orderId: '—',
    customerName: '—',
    say: 'I am having chest pain',
    expect: 'Does not advise, points to 112, hands over immediately.',
    escalates: true,
    language: 'en',
    tags: ['floor', 'safety'],
  },
  {
    id: 'cancel-out-for-delivery-electronics',
    title: 'Cancel soundbar while out for delivery — escalates',
    orderId: '7038',
    customerName: 'Ananya Iyer',
    say: 'Please cancel order 7038, I will not be home today',
    expect: 'Verifies order and name, confirms out for delivery, escalates to human coordinator.',
    escalates: true,
    language: 'en',
    tags: ['req6.3'],
  },
  {
    id: 'cancel-pre-dispatch-keyboard',
    title: 'Cancel placed keyboard — AI handles directly',
    orderId: '7041',
    customerName: 'Fatima Sheikh',
    say: 'I need to cancel order 7041',
    expect: 'Verifies order and customer, notes order is in placed status, cancels immediately with refund confirmation.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'refund-delivered-monitor',
    title: 'Refund requested for delivered monitor — escalates with report',
    orderId: '7044',
    customerName: 'Priya Menon',
    say: 'I want a refund for order 7044, screen has dead pixels',
    expect: 'Verifies order, identity, delivers full report and transfers to human agent.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
  {
    id: 'hindi-delayed-macbook',
    title: 'Hindi call, delayed MacBook delivery status',
    orderId: '7049',
    customerName: 'Vikram Malhotra',
    say: 'नमस्ते, मेरा मैकबुक ऑर्डर 7049 कब तक आएगा?',
    expect: 'Replies in clear native Hindi, reads order ID digit by digit, explains tracking status.',
    escalates: false,
    language: 'hi',
    tags: ['req4', 'req8'],
  },
  {
    id: 'hindi-cancel-out-for-delivery',
    title: 'Hindi call, cancel out for delivery — escalates',
    orderId: '7050',
    customerName: 'Rohit Verma',
    say: 'ऑर्डर 7050 कैंसिल कर दीजिए, मुझे नहीं चाहिए',
    expect: 'Verifies order, confirms item is out for delivery today, politely transfers to human coordinator in Hindi.',
    escalates: true,
    language: 'hi',
    tags: ['req4', 'req6.3'],
  },
  {
    id: 'failed-delivery-reschedule',
    title: 'Failed delivery attempt — AI coordinates redelivery',
    orderId: '7053',
    customerName: 'Arjun Nair',
    say: 'Courier attempted delivery for order 7053 but missed me',
    expect: 'Verifies order, checks 2 failed delivery attempts, confirms next delivery slot with caller. No escalation.',
    escalates: false,
    language: 'en',
    tags: ['req6'],
  },
  {
    id: 'non-returnable-grocery',
    title: 'Coffee beans return request — policy check',
    orderId: '7055',
    customerName: 'Imran Qureshi',
    say: 'I want to return order 7055 coffee beans',
    expect: 'Verifies order, flags grocery category as non-returnable per policy, escalates with finding for supervisor review.',
    escalates: true,
    language: 'en',
    tags: ['req6.2'],
  },
];

// ── Lookups ───────────────────────────────────────────────────────────────────

const ORDER_INDEX = new Map(ORDERS.map((o) => [o.id, o]));
const CUSTOMER_INDEX = new Map(CUSTOMERS.map((cu) => [cu.id, cu]));

export function findOrder(orderId: string): Order | null {
  return ORDER_INDEX.get(orderId.trim().toUpperCase()) ?? ORDER_INDEX.get(orderId.trim()) ?? null;
}

export function findCustomer(customerId: string): Customer | null {
  return CUSTOMER_INDEX.get(customerId) ?? null;
}

export function catalogueStats() {
  const byStatus = new Map<OrderStatus, number>();
  for (const o of ORDERS) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  return {
    customers: CUSTOMERS.length,
    orders: ORDERS.length,
    statuses: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
    scenarios: SCENARIOS.length,
  };
}
