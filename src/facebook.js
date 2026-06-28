// Facebook "Data Deletion Request" callback — the deletion mechanism Meta
// requires for any Login app that stores user data. When a user removes our app
// from their Facebook settings (or asks Facebook to delete their data), Facebook
// POSTs a signed_request here; we verify it, wipe that user's account, and return
// a confirmation code + a status URL Facebook shows back to the user.
//
// This mirrors the movies app's FacebookDataDeletionController. Configure the
// callback URL in the Meta App Dashboard → Settings → Advanced → "Data Deletion
// Request Callback URL" as  <origin>/facebook/data-deletion .
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './env.js';
import { getUserByProviderSub, deleteAccount } from './db.js';
import { requestOrigin } from './auth.js';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });

// Parse and verify Facebook's signed_request: "<base64url sig>.<base64url payload>".
// The signature is HMAC-SHA256 over the *raw payload segment* keyed by the app
// secret. We compare in constant time before parsing the JSON. Returns the
// decoded payload, or throws on any malformation / bad signature.
export function verifySignedRequest(signedRequest, appSecret) {
  if (!signedRequest || !signedRequest.includes('.')) throw new Error('malformed signed_request');
  const [encodedSig, payload] = signedRequest.split('.', 2);
  const expected = createHmac('sha256', appSecret).update(payload).digest();
  const actual = Buffer.from(encodedSig, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('bad signature');
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.algorithm && String(data.algorithm).toUpperCase() !== 'HMAC-SHA256') {
    throw new Error('unexpected algorithm');
  }
  return data;
}

// An opaque, deterministic confirmation code derived from the Facebook user id —
// stable enough to look the request up again, without exposing the raw id in the
// status URL. Facebook displays this code to the user.
function confirmationCode(userId) {
  return createHmac('sha256', config.appSecret).update('fb-del:' + userId).digest('hex').slice(0, 16);
}

// Handles the data-deletion routes. Returns true if it took the request.
export async function handleFacebook(req, res, url) {
  // POST /facebook/data-deletion — the signed callback from Facebook.
  if (url.pathname === '/facebook/data-deletion' && req.method === 'POST') {
    if (!config.facebook.secret) { json(res, 503, { error: 'facebook not configured' }); return true; }
    try {
      const raw = await readBody(req);
      // Facebook sends application/x-www-form-urlencoded with a single field.
      const signedRequest = new URLSearchParams(raw).get('signed_request');
      const data = verifySignedRequest(signedRequest, config.facebook.secret);
      const userId = data.user_id;
      if (!userId) throw new Error('no user_id in signed_request');

      // Wipe the account if we have one for this Facebook id. Idempotent: if we
      // never stored them (or already deleted), this is a harmless no-op — we
      // still return a valid confirmation so Facebook marks the request handled.
      const user = getUserByProviderSub('facebook', userId);
      if (user) deleteAccount(user.id);

      const code = confirmationCode(userId);
      json(res, 200, {
        url: `${requestOrigin(req)}/facebook/data-deletion/status?code=${code}`,
        confirmation_code: code,
      });
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return true;
  }

  // GET /facebook/data-deletion/status?code=… — human-readable status page that
  // Facebook links the user to. Deletion is synchronous, so by the time this is
  // reachable the data is already gone.
  if (url.pathname === '/facebook/data-deletion/status' && req.method === 'GET') {
    const code = (url.searchParams.get('code') || '').replace(/[^a-f0-9]/gi, '').slice(0, 32);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Data deletion — recommend</title>
<style>
  body { font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
         color: #1c2230; background: #f4f5f8; margin: 0; padding: 48px 20px; }
  main { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 14px;
         padding: 36px; box-shadow: 0 1px 3px rgba(11,15,58,.08); }
  h1 { font-size: 22px; margin: 0 0 14px; }
  code { background: #eef0f5; padding: 2px 6px; border-radius: 5px; }
  a { color: #c1121f; text-decoration: none; } a:hover { text-decoration: underline; }
  .muted { color: #6b7280; font-size: 14px; margin-top: 18px; }
</style></head>
<body><main>
  <h1>🎬 Your data has been deleted</h1>
  <p>Any account and data we held for your Facebook login on <strong>recommend</strong>
     has been permanently deleted from our database.</p>
  ${code ? `<p>Confirmation code: <code>${code}</code></p>` : ''}
  <p class="muted">Questions? Email
     <a href="mailto:pawel.krupinski@gmail.com">pawel.krupinski@gmail.com</a>.
     See our <a href="/privacy">privacy policy</a>.</p>
</main></body></html>`);
    return true;
  }

  return false;
}
