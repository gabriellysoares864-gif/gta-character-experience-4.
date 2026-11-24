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

// Inspeciona somente os nomes dos campos e seus tipos.
// Não registra valores pessoais, e-mails, telefones ou dados de pagamento.
function inspectStructure(obj, prefix = '', result = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return result;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    result.push({
      path,
      type: Array.isArray(value)
        ? 'array'
        : value === null
        ? 'null'
        : typeof value
    });

    if (value && typeof value === 'object') {
      inspectStructure(value, path, result, depth + 1);
    }
  }

  return result;
}

function findSckPaths(obj, prefix = '', result = []) {
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (key.toLowerCase() === 'sck') {
      result.push({
        path,
        present: value !== null && value !== undefined && value !== ''
      });
    }

    if (value && typeof value === 'object') {
      findSckPaths(value, path, result);
    }
  }

  return result;
}

export default async (req) => {
  const requestId = crypto.randomUUID();

  log('Request received', {
    requestId,
    method: req.method
  });

  if (req.method !== 'POST') {
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
      signaturePresent: true
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

  // Diagnóstico seguro: somente estrutura e nomes dos campos.
  log('EVENT STRUCTURE', {
    requestId,
    fields: inspectStructure(event)
  });

  log('SCK FIELD DIAGNOSTIC', {
    requestId,
    sckFields: findSckPaths(event)
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
    log('DIAGNOSTIC: intent ID missing', {
      requestId,
      eventType,
      orderStatus,
      orderIdPresent: !!orderId,
      trackingParametersPresent: !!(
        event?.TrackingParameters ||
        event?.tracking_parameters ||
        event?.Parameters ||
        event?.parameters
      ),
      sckFields: findSckPaths(event)
    });

    return json({
      received: true,
      diagnostic: true,
      reason: 'Missing intent tracking ID'
    });
  }

  if (!orderId) {
    log('DIAGNOSTIC: order ID missing', {
      requestId,
      eventType,
      orderStatus
    });

    return json({
      received: true,
      diagnostic: true,
      reason: 'Missing order ID'
    });
  }

  const intent = String(intentId);

  if (!/^[a-zA-Z0-9_-]{20,80}$/.test(intent)) {
    log('DIAGNOSTIC: invalid intent ID format', {
      requestId,
      intentLength: intent.length
    });

    return json({
      received: true,
      diagnostic: true,
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
