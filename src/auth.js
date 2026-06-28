// OAuth login (Google + Facebook) and signed-cookie sessions — no dependencies.
//
// Sessions: a cookie `rid` holding base64url(JSON{uid,iat}).<HMAC-SHA256> signed
// with APPLICATION_SECRET. OAuth CSRF state rides in a separate short-lived
// signed cookie `oauth`. We mirror the movies app's convention of one callback
// path per provider: /auth/<provider>/callback.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './env.js';
import { upsertUserFromLogin, getUserById, setUserAdmin, setUserSetting } from './db.js';
import { fetchWithTimeout } from './fetch.js';

const SESSION_COOKIE = 'rid';
const STATE_COOKIE = 'oauth';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days (seconds)
const STATE_MAX_AGE = 10 * 60 * 1000;      // 10 minutes (ms)

// ---- signing helpers ------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => createHmac('sha256', config.appSecret).update(data).digest('base64url');

function pack(obj) {
  const body = b64url(JSON.stringify(obj));
  return `${body}.${sign(body)}`;
}
function unpack(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body);
  // constant-time compare; lengths must match for timingSafeEqual
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

// ---- cookies --------------------------------------------------------------
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function cookie(name, value, { maxAge, secure } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  if (secure) c += '; Secure';
  return c;
}

// ---- request origin -------------------------------------------------------
// Prefer an explicit BASE_URL; otherwise derive from forwarded headers so OAuth
// callback URLs match whatever host the user actually reached us on.
export function requestOrigin(req) {
  if (config.baseUrl) return config.baseUrl;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (req.socket.encrypted ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`).split(',')[0].trim();
  return `${proto}://${host}`;
}
const isSecure = (req) => requestOrigin(req).startsWith('https');
const redirectUri = (req, provider) => `${requestOrigin(req)}/auth/${provider}/callback`;

// ---- session API ----------------------------------------------------------
export function currentUser(req) {
  const sess = unpack(parseCookies(req)[SESSION_COOKIE]);
  if (!sess?.uid) return null;
  return getUserById(sess.uid) || null;
}
function setSession(res, req, userId, extraCookies = []) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, pack({ uid: userId, iat: Date.now() }), { maxAge: SESSION_MAX_AGE, secure: isSecure(req) }),
    ...extraCookies,
  ]);
}
function redirect(res, location, cookies = []) {
  res.writeHead(302, { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
  res.end();
}

// ---- providers ------------------------------------------------------------
const PROVIDERS = {
  google: {
    enabled: () => !!(config.google.id && config.google.secret),
    authUrl(req, state) {
      const p = new URLSearchParams({
        client_id: config.google.id,
        redirect_uri: redirectUri(req, 'google'),
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    },
    async profile(req, code) {
      const tok = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.google.id,
          client_secret: config.google.secret,
          redirect_uri: redirectUri(req, 'google'),
          grant_type: 'authorization_code',
        }),
      }).then((r) => r.json());
      if (!tok.access_token) throw new Error('Google token exchange failed');
      const u = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      }).then((r) => r.json());
      if (!u.email) throw new Error('Google did not return an email');
      return { email: u.email, name: u.name, picture: u.picture, provider: 'google', provider_sub: u.sub };
    },
  },
  facebook: {
    enabled: () => !!(config.facebook.id && config.facebook.secret),
    authUrl(req, state) {
      const p = new URLSearchParams({
        client_id: config.facebook.id,
        redirect_uri: redirectUri(req, 'facebook'),
        state,
        scope: 'email,public_profile',
        response_type: 'code',
      });
      return `https://www.facebook.com/v19.0/dialog/oauth?${p}`;
    },
    async profile(req, code) {
      const tok = await fetchWithTimeout('https://graph.facebook.com/v19.0/oauth/access_token?' + new URLSearchParams({
        client_id: config.facebook.id,
        client_secret: config.facebook.secret,
        redirect_uri: redirectUri(req, 'facebook'),
        code,
      })).then((r) => r.json());
      if (!tok.access_token) throw new Error('Facebook token exchange failed');
      const u = await fetchWithTimeout('https://graph.facebook.com/me?' + new URLSearchParams({
        fields: 'id,name,email,picture.width(200)',
        access_token: tok.access_token,
      })).then((r) => r.json());
      if (!u.email) throw new Error('Facebook did not return an email (is it granted?)');
      return { email: u.email, name: u.name, picture: u.picture?.data?.url, provider: 'facebook', provider_sub: u.id };
    },
  },
};

export const enabledProviders = () =>
  Object.entries(PROVIDERS).filter(([, p]) => p.enabled()).map(([name]) => name);

// A Set-Cookie value that clears the session cookie — used to log the user out
// after they delete their own account from the app.
export const sessionClearingCookie = (req) =>
  cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) });

// ---- route handler --------------------------------------------------------
// Handles /auth/*; returns true if it took the request, false otherwise.
export async function handleAuth(req, res, url) {
  const path = url.pathname;

  if (path === '/auth/logout') {
    redirect(res, '/', [cookie(SESSION_COOKIE, '', { maxAge: 0, secure: isSecure(req) })]);
    return true;
  }

  // Test-only login bypass. Skips the real OAuth round-trip so automated tests
  // (and local dev) can sign in as an arbitrary account. Strictly gated behind
  // ALLOW_DEV_LOGIN=1 — never set in production, so this is inert on Render.
  //   GET /auth/dev-login?email=&name=&admin=1&onboarded=0
  if (path === '/auth/dev-login' && req.method === 'GET') {
    if (process.env.ALLOW_DEV_LOGIN !== '1') { redirect(res, '/?error=dev_login_disabled'); return true; }
    const email = (url.searchParams.get('email') || 'tester@example.com').toLowerCase();
    const name = url.searchParams.get('name') || 'Test User';
    const user = upsertUserFromLogin({ email, name, provider: 'dev', provider_sub: `dev-${email}` });
    if (url.searchParams.get('admin') === '1') setUserAdmin(user.id, true);
    // Default brand-new dev users straight into the app; pass onboarded=0 to
    // exercise the first-run onboarding screen.
    if (url.searchParams.get('onboarded') !== '0') setUserSetting(user.id, 'onboarded', true);
    setSession(res, req, user.id);
    res.writeHead(302, { Location: '/' });
    res.end();
    return true;
  }

  // Start: /auth/<provider>
  const start = path.match(/^\/auth\/(google|facebook)$/);
  if (start && req.method === 'GET') {
    const provider = PROVIDERS[start[1]];
    if (!provider.enabled()) { redirect(res, '/?error=provider_disabled'); return true; }
    const state = b64url(randomBytes(16));
    const stateCookie = cookie(STATE_COOKIE, pack({ state, provider: start[1], iat: Date.now() }),
      { maxAge: 600, secure: isSecure(req) });
    redirect(res, provider.authUrl(req, state), [stateCookie]);
    return true;
  }

  // Callback: /auth/<provider>/callback
  const cb = path.match(/^\/auth\/(google|facebook)\/callback$/);
  if (cb && req.method === 'GET') {
    const name = cb[1];
    try {
      const saved = unpack(parseCookies(req)[STATE_COOKIE]);
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Missing authorization code');
      if (!saved || saved.provider !== name || saved.state !== returnedState) throw new Error('Invalid OAuth state');
      if (Date.now() - saved.iat > STATE_MAX_AGE) throw new Error('OAuth state expired');
      const prof = await PROVIDERS[name].profile(req, code);
      const user = upsertUserFromLogin(prof);
      setSession(res, req, user.id, [cookie(STATE_COOKIE, '', { maxAge: 0, secure: isSecure(req) })]);
      res.writeHead(302, { Location: '/' });
      res.end();
    } catch (e) {
      redirect(res, '/?error=' + encodeURIComponent(e.message));
    }
    return true;
  }

  return false;
}
