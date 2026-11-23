import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });

const log = (step, details = {}) => {
  console.log(`[KIWIFY WEBHOOK] ${step}`, JSON.stringify(details));
};

export default async (req) => {
  const requestId = crypto.randomUUID();

  log('Request received', {
    requestId,
    method: req.method
  });

  if (req.method !== 'POST') {
    log('Rejected: invalid method', { requestId });
    return json({ error: 'Method not allowed' }, 405);
  }

  const token = process.env.KIWIFY_WEBHOOK_TOKEN;

  if (!token) {
    log('ERROR: webhook token not configured', { requestId });
    return json({ error: 'Webhook token not configured' }, 500);
  }

  let raw;

  try {
    raw = await req.text();
  } catch (error) {
    log('ERROR: could not read request body', {
      requestId,
      message: error.message
    });

    return json({ error: 'Could not read request body' }, 400);
  }

  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';

  if (!signature) {
    log('Rejected: signature missing', { requestId });
    return json({ error: 'Missing signature' }, 401);
  }

  let expectedSignature;

  try {
    expectedSignature = crypto
      .createHmac('sha1', token)
      .update(raw)
      .digest('hex');
  } catch (error) {
    log('ERROR: signature calculation failed', {
      requestId,
      message: error.message
    });

    return json({ error: 'Signature calculation failed' }, 500);
  }

  const received = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  const signatureValid =
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected);

  if (!signatureValid) {
    log('Rejected: invalid signature', {
      requestId,
      signaturePresent: true,
      signatureLength: signature.length
    });

    return json({ error: 'Invalid webhook signature' }, 401);
  }

  log('Signature validated', { requestId });

  let event;

  try {
    event = JSON.parse(raw);
  } catch (error) {
    log('Rejected: invalid JSON', {
      requestId,
      message: error.message
    });

    return json({ error: 'Invalid JSON' }, 400);
  }

  const eventType =
    event?.webhook_event_type ||
    event?.event_type ||
    event?.type ||
    'unknown';

  const orderStatus = event?.order_status || 'unknown';

  log('Event parsed', {
    requestId,
    eventType,
    orderStatus
  });

  const isApproved =
    orderStatus === 'paid' ||
    eventType === 'order_approved';

  if (!isApproved) {
    log('Event ignored: not an approved purchase', {
      requestId,
      eventType,
      orderStatus
    });

    return json({
      received: true,
      ignored: true,
      reason: 'Not an approved purchase'
    });
  }

  const intentId =
    event?.TrackingParameters?.sck ||
    event?.tracking_parameters?.sck ||
    event?.Parameters?.sck ||
    event?.parameters?.sck ||
    event?.sck ||
    null;

  const orderId =
    event?.order_id ||
    event?.orderId ||
    event?.id ||
    null;

  if (!intentId) {
    log('Approved purchase ignored: intent ID missing', {
      requestId,
      orderId: orderId ? String(orderId) : null,
      trackingParametersPresent: !!(
        event?.TrackingParameters ||
        event?.tracking_parameters ||
        event?.Parameters ||
        event?.parameters
      )
    });

    return json({
      received: true,
      ignored: true,
      reason: 'Missing intent tracking ID'
    });
  }

  if (!orderId) {
    log('Approved purchase ignored: order ID missing', {
      requestId
    });

    return json({
      received: true,
      ignored: true,
      reason: 'Missing order ID'
    });
  }

  const intent = String(intentId);

  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(intent)) {
    log('Approved purchase ignored: invalid intent ID format', {
      requestId,
      intentLength: intent.length
    });

    return json({
      received: true,
      ignored: true,
      reason: 'Invalid intent ID format'
    });
  }

  try {
    const store = getStore('gta-payments');

    const existing = await store.get(intent, {
      type: 'json'
    });

    const paymentRecord = {
      ...(existing || {}),
      paid: true,
      orderId: String(orderId),
      orderRef:
        event?.order_ref ||
        existing?.orderRef ||
        null,
      approvedAt:
        event?.approved_date ||
        existing?.approvedAt ||
        new Date().toISOString(),
      productName:
        event?.Product?.product_name ||
        existing?.productName ||
        null,
      paymentStatus: 'paid'
    };

    await store.set(intent, JSON.stringify(paymentRecord));

    log('PAYMENT SAVED SUCCESSFULLY', {
      requestId,
      orderId: String(orderId),
      intentId: intent,
      previouslySaved: !!existing
    });

    return json({
      received: true,
      paid: true,
      saved: true
    });

  } catch (error) {
    log('ERROR: failed to save payment', {
      requestId,
      message: error.message,
      name: error.name
    });

    return json({
      error: 'Failed to save payment'
    }, 500);
  }
};
