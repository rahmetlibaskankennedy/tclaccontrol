const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TCL_EMAIL = process.env.TCL_EMAIL;
const TCL_PASSWORD = process.env.TCL_PASSWORD;
const API_KEY = process.env.API_KEY || 'changeme';

// TCL Home API endpoints
const APP_LOGIN_URL = 'https://global.tclaccount.ilink-dns.com/api/user/v2/login';
const CLOUD_URL = 'https://global.things.ilink-dns.com';
const APP_ID = 'TCLHome';
const APP_VERSION = '2.1.0';
const PLATFORM = 'Android';

let tokenCache = null;
let tokenExpiry = 0;

// --- Auth ---

function generateSign(params, timestamp) {
  // TCL checksum: sorted keys + values + timestamp + secret
  const secret = 'tclhome2022';
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const raw = `${sorted}&timestamp=${timestamp}&secret=${secret}`;
  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
}

async function login() {
  const timestamp = Date.now().toString();
  const params = {
    account: TCL_EMAIL,
    password: crypto.createHash('md5').update(TCL_PASSWORD).digest('hex'),
    appId: APP_ID,
    appVersion: APP_VERSION,
    platform: PLATFORM,
  };
  const sign = generateSign(params, timestamp);

  const res = await axios.post(APP_LOGIN_URL, {
    ...params,
    timestamp,
    sign,
  }, {
    headers: { 'Content-Type': 'application/json' }
  });

  if (res.data && res.data.data && res.data.data.token) {
    tokenCache = res.data.data.token;
    tokenExpiry = Date.now() + 3600 * 1000; // 1 saat
    console.log('TCL login başarılı');
    return tokenCache;
  }
  throw new Error('Login başarısız: ' + JSON.stringify(res.data));
}

async function getToken() {
  if (tokenCache && Date.now() < tokenExpiry) return tokenCache;
  return await login();
}

// --- Devices ---

async function getDevices() {
  const token = await getToken();
  const timestamp = Date.now().toString();
  const params = { appId: APP_ID, appVersion: APP_VERSION, platform: PLATFORM };
  const sign = generateSign(params, timestamp);

  const res = await axios.get(`${CLOUD_URL}/api/device/v1/list`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    params: { ...params, timestamp, sign }
  });
  return res.data.data || [];
}

// --- AC Control ---

async function sendCommand(deviceId, properties) {
  const token = await getToken();
  const timestamp = Date.now().toString();
  const params = {
    appId: APP_ID,
    appVersion: APP_VERSION,
    platform: PLATFORM,
    deviceId,
  };
  const sign = generateSign({ ...params, ...properties }, timestamp);

  const res = await axios.post(`${CLOUD_URL}/api/device/v1/control`, {
    ...params,
    properties,
    timestamp,
    sign,
  }, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });
  return res.data;
}

// --- Auth middleware ---

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Yetkisiz' });
  next();
}

// --- Routes ---

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/devices', auth, async (req, res) => {
  try {
    const devices = await getDevices();
    res.json(devices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Klimayı aç
app.get('/ac/on', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const temp = req.query.temp || 24;
    const mode = req.query.mode || 0; // 0=cool, 1=dry, 2=fan, 3=heat
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });

    const result = await sendCommand(deviceId, {
      powerSwitch: 1,
      workMode: parseInt(mode),
      temperature: parseInt(temp),
    });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Klimayı kapat
app.get('/ac/off', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });

    const result = await sendCommand(deviceId, { powerSwitch: 0 });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Sıcaklık ayarla
app.get('/ac/temp', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const temp = req.query.value;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    if (!temp) return res.status(400).json({ error: 'value gerekli (18-30)' });

    const result = await sendCommand(deviceId, { temperature: parseInt(temp) });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mod değiştir (cool/heat/fan/dry)
app.get('/ac/mode', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const modeMap = { cool: 0, dry: 1, fan: 2, heat: 3, auto: 4 };
    const mode = modeMap[req.query.value] ?? 0;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });

    const result = await sendCommand(deviceId, { workMode: mode });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`TCL AC Control sunucu port ${PORT} üzerinde çalışıyor`);
  if (!TCL_EMAIL || !TCL_PASSWORD) {
    console.warn('UYARI: TCL_EMAIL veya TCL_PASSWORD tanımlı değil!');
  }
});
