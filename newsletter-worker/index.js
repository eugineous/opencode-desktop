// OpenCode Desktop Newsletter Worker
// Routes: POST /subscribe, GET /subscribers (admin), POST /announce (admin)
// Cloudflare bindings: KV OCD_SUBSCRIBERS, Secret ADMIN_KEY, Secret RESEND_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function handleSubscribe(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const email = (body.email || '').trim().toLowerCase();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return json({ error: 'Invalid email' }, 400);

  const appVersion = body.appVersion || 'unknown';
  const platform   = body.platform   || 'unknown';

  // Idempotent — overwrite existing subscriber record
  const record = JSON.stringify({
    email,
    appVersion,
    platform,
    subscribedAt: new Date().toISOString(),
    active: true,
  });
  await env.OCD_SUBSCRIBERS.put('sub:' + email, record);

  // Send welcome email via Resend (if key present)
  if (env.RESEND_KEY) {
    await sendWelcomeEmail(email, env.RESEND_KEY).catch(() => {});
  }

  return json({ ok: true, message: 'Subscribed' });
}

async function sendWelcomeEmail(email, resendKey) {
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <div style="background:#0a0a0a;padding:20px 24px;border-radius:8px 8px 0 0">
        <span style="font-family:monospace;font-size:18px;font-weight:800;color:#d97706">&gt;_ OpenCode Desktop</span>
      </div>
      <div style="background:#f9f9f9;padding:28px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px">
        <p style="margin:0 0 16px">Hey — welcome to the list.</p>
        <p style="margin:0 0 16px">I'm Eugine Micah, the developer behind OpenCode Desktop. I built this because I wanted AI coding to feel <em>fast and natural</em>, not like fighting a terminal.</p>
        <p style="margin:0 0 16px">You'll hear from me when there's a new release, a useful tip, or something important to know about the app. No spam — I'd unsubscribe too.</p>
        <p style="margin:0 0 4px">If you run into anything, just reply to this email. I read every message.</p>
        <p style="margin:24px 0 0;color:#666;font-size:13px">— Eugine<br>
        <a href="https://euginemicah.tech" style="color:#d97706">euginemicah.tech</a></p>
      </div>
    </div>
  `;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Eugine Micah <hello@euginemicah.tech>',
      to: [email],
      subject: 'You\'re in — welcome to OpenCode Desktop',
      html,
    }),
  });
}

async function handleSubscribers(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (key !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401);

  const list = await env.OCD_SUBSCRIBERS.list({ prefix: 'sub:' });
  const subs = await Promise.all(
    list.keys.map(async k => {
      const val = await env.OCD_SUBSCRIBERS.get(k.name);
      try { return JSON.parse(val); } catch { return null; }
    })
  );
  return json({ count: subs.length, subscribers: subs.filter(Boolean) });
}

async function handleAnnounce(request, env) {
  const key = request.headers.get('X-Admin-Key');
  if (key !== env.ADMIN_KEY) return json({ error: 'Unauthorized' }, 401);
  if (!env.RESEND_KEY) return json({ error: 'RESEND_KEY not configured' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { subject, html, text } = body;
  if (!subject || (!html && !text)) return json({ error: 'subject + html/text required' }, 400);

  // Get all active subscribers
  const list = await env.OCD_SUBSCRIBERS.list({ prefix: 'sub:' });
  const emails = [];
  for (const k of list.keys) {
    const val = await env.OCD_SUBSCRIBERS.get(k.name);
    try {
      const rec = JSON.parse(val);
      if (rec.active && rec.email) emails.push(rec.email);
    } catch {}
  }

  if (!emails.length) return json({ ok: true, sent: 0 });

  // Resend supports up to 50 recipients per call — batch
  let sent = 0;
  for (let i = 0; i < emails.length; i += 50) {
    const batch = emails.slice(i, i + 50);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Eugine Micah <hello@euginemicah.tech>',
        to: batch,
        subject,
        html: html || `<p>${text}</p>`,
        text: text || '',
      }),
    });
    if (res.ok) sent += batch.length;
  }
  return json({ ok: true, sent, total: emails.length });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    if (path === '/subscribe'    && request.method === 'POST') return handleSubscribe(request, env);
    if (path === '/subscribers'  && request.method === 'GET')  return handleSubscribers(request, env);
    if (path === '/announce'     && request.method === 'POST') return handleAnnounce(request, env);

    return json({ service: 'OpenCode Desktop Newsletter', version: '1.0.0' });
  },
};
