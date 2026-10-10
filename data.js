// Vercel serverless function: logs in to Angel One SmartAPI (TOTP) and returns positions + orders.
// READ-ONLY: this code never places, modifies or cancels orders.
const crypto = require('crypto');

const BASE = 'https://apiconnect.angelone.in';
const PATHS = {
  login: '/rest/auth/angelbroking/user/v1/loginByPassword',
  positions: '/rest/secure/angelbroking/order/v1/getPosition',
  orders: '/rest/secure/angelbroking/order/v1/getOrderBook',
};

// ---- TOTP (RFC 6238) with no dependencies ----
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = input.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code =
    (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

// ---- SmartAPI helpers ----
function headers(jwt) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': process.env.ANGEL_LOCAL_IP || '192.168.1.10',
    'X-ClientPublicIP': process.env.ANGEL_PUBLIC_IP || '106.193.147.98',
    'X-MACAddress': process.env.ANGEL_MAC || 'fe80::216e:6507:4b90:3719',
    'X-PrivateKey': process.env.ANGEL_API_KEY,
    ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}),
  };
}

let session = null; // { jwt, at } cached while the serverless instance stays warm
let cache = null;   // { data, at } tiny cache to respect SmartAPI rate limits

async function login() {
  const res = await fetch(BASE + PATHS.login, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      clientcode: process.env.ANGEL_CLIENT_CODE,
      password: process.env.ANGEL_PIN,
      totp: totp(process.env.ANGEL_TOTP_SECRET),
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.status || !json.data || !json.data.jwtToken) {
    throw new Error('Angel One login failed: ' + (json.message || res.status));
  }
  session = { jwt: json.data.jwtToken, at: Date.now() };
  return session.jwt;
}

async function authedGet(path, retry = true) {
  const jwt = session ? session.jwt : await login();
  const res = await fetch(BASE + path, { method: 'GET', headers: headers(jwt) });
  const json = await res.json().catch(() => ({}));
  const tokenBad =
    res.status === 401 || json.errorcode === 'AG8001' || json.errorcode === 'AG8002' || json.errorcode === 'AG8003';
  if (tokenBad && retry) {
    session = null;
    return authedGet(path, false);
  }
  if (!json.status) throw new Error(json.message || 'Angel One request failed');
  return json.data || [];
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

function normPosition(p) {
  const qty = num(p.netqty);
  return {
    symbol: p.tradingsymbol,
    exch: p.exchange,
    product: p.producttype,
    qty,
    avg: num(p.avgnetprice) || num(qty >= 0 ? p.buyavgprice : p.sellavgprice),
    ltp: num(p.ltp),
    pnl: num(p.pnl),
    open: qty !== 0,
  };
}

function normOrder(o) {
  return {
    id: o.orderid,
    symbol: o.tradingsymbol,
    side: o.transactiontype,
    qty: num(o.quantity),
    filled: num(o.filledshares),
    price: num(o.price),
    avg: num(o.averageprice),
    status: String(o.orderstatus || o.status || '').toLowerCase(),
    type: o.ordertype,
    product: o.producttype,
    time: o.updatetime || o.exchtime || '',
    reason: o.text || '',
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const appKey = process.env.APP_KEY;
  if (!appKey || !safeEqual(req.headers['x-app-key'] || '', appKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (cache && Date.now() - cache.at < 5000) return res.status(200).json(cache.data);

    const [rawPos, rawOrd] = await Promise.all([
      authedGet(PATHS.positions),
      authedGet(PATHS.orders),
    ]);

    const positions = (Array.isArray(rawPos) ? rawPos : []).map(normPosition);
    const orders = (Array.isArray(rawOrd) ? rawOrd : []).map(normOrder).reverse(); // newest first
    const data = {
      updated: new Date().toISOString(),
      totalPnl: positions.reduce((s, p) => s + p.pnl, 0),
      positions: positions.sort((a, b) => Number(b.open) - Number(a.open)),
      orders,
    };
    cache = { data, at: Date.now() };
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
};
