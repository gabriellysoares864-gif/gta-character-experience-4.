import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = process.env.KIWIFY_WEBHOOK_TOKEN;
  if (!token) return json({ error: 'Webhook token not configured' }, 500);

  // Validate Kiwify HMAC-SHA1 signature over the exact raw request body.
  const raw = await req.text();
  const signature = new URL(req.url).searchParams.get('signature') || '';
  const expected = crypto.createHmac('sha1', token).update(raw).digest('hex');
  const providedBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (!signature || providedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(providedBytes, expectedBytes)) {
    return json({ error: 'Invalid webhook signature' }, 401);
  }

  let event;
  try { event = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const isApproved = event?.order_status === 'paid' || event?.webhook_event_type === 'order_approved';
  if (!isApproved) return json({ received: true, ignored: true });

  const intentId = event?.TrackingParameters?.sck || event?.tracking_parameters?.sck || event?.sck;
  const orderId = event?.order_id;
  if (!intentId || !/^[a-zA-Z0-9_-]{20,80}$/.test(String(intentId)) || !orderId) {
    return json({ received: true, ignored: true, reason: 'Missing intent tracking or order id' });
  }

  const store = getStore('gta-payments');
  const existing = await store.get(String(intentId), { type: 'json' });
  // Idempotent: duplicate approved webhook must not reset generation progress.
  await store.set(String(intentId), JSON.stringify({
    ...(existing || {}),
    paid: true,
    orderId: String(orderId),
    orderRef: event.order_ref || existing?.orderRef || null,
    approvedAt: event.approved_date || existing?.approvedAt || new Date().toISOString(),
    productName: event.Product?.product_name || existing?.productName || null,
    paymentStatus: 'paid'
  }));
  return json({ received: true });
};
