// Pulpit waitlist form handler (Cloudflare Worker)
// Deploy this as a separate Worker, bind a KV namespace for storage, and point
// the landing page form action at the Worker URL.
//
// Deployment:
//   1. Create a new Cloudflare Worker named `pulpit-waitlist`
//   2. Create a KV namespace named `WAITLIST` and bind it as `WAITLIST`
//   3. Set environment variable `NOTIFY_EMAIL` to arcadiastudio77@gmail.com (or wherever)
//   4. Paste this code in
//   5. Update `index.html` form action to the Worker URL

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // Parse form submission (supports both form-urlencoded and multipart/form-data)
    let email = null;
    const contentType = request.headers.get('content-type') || '';

    try {
      if (contentType.includes('application/json')) {
        const json = await request.json();
        email = json.email;
      } else {
        const formData = await request.formData();
        email = formData.get('email');
      }
    } catch (err) {
      return json({ ok: false, error: 'invalid_form' }, 400);
    }

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 200) {
      return json({ ok: false, error: 'invalid_email' }, 400);
    }

    email = email.trim().toLowerCase();

    // Simple rate limit by IP (max 5 submissions per hour per IP)
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateKey = `ratelimit:${ip}`;
    const existing = await env.WAITLIST.get(rateKey);
    const count = existing ? parseInt(existing, 10) : 0;
    if (count >= 5) {
      return json({ ok: false, error: 'rate_limited' }, 429);
    }
    await env.WAITLIST.put(rateKey, String(count + 1), { expirationTtl: 3600 });

    // Store the signup (keyed by email, so duplicates overwrite)
    const record = {
      email,
      ip,
      user_agent: request.headers.get('user-agent') || 'unknown',
      country: request.headers.get('cf-ipcountry') || 'unknown',
      created_at: new Date().toISOString(),
    };
    await env.WAITLIST.put(`signup:${email}`, JSON.stringify(record));

    // Increment count
    const totalRaw = await env.WAITLIST.get('meta:count');
    const total = (totalRaw ? parseInt(totalRaw, 10) : 0) + 1;
    await env.WAITLIST.put('meta:count', String(total));

    return json({ ok: true, count: total });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
