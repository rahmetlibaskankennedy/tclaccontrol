const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TCL_EMAIL = process.env.TCL_EMAIL;
const TCL_PASSWORD = process.env.TCL_PASSWORD;
const API_KEY = process.env.API_KEY || 'changeme';

const APP_LOGIN_URL = 'https://pa.account.tcl.com/account/login?clientId=54148614';
const CLOUD_URLS_URL = 'https://prod-center.aws.tcljd.com/v3/global/cloud_url_get';
const APP_ID = 'wx6e1af3fa84fbe523';

let authData = null;
let cloudUrlsData = null;
let refreshTokensData = null;
let tokenExpiry = 0;

// --- Auth ---

async function login() {
  const passwordHash = crypto.createHash('md5').update(TCL_PASSWORD).digest('hex');

  const payload = {
    equipment: 2,
    password: passwordHash,
    osType: 1,
    username: TCL_EMAIL,
    clientVersion: '4.8.1',
    osVersion: '6.0',
    deviceModel: 'AndroidAndroid SDK built for x86',
    captchaRule: 2,
    channel: 'app'
  };

  const headers = {
    'th_platform': 'android',
    'Content-Type': 'application/json',
    'th_appid': APP_ID,
  };

  const res = await axios.post(APP_LOGIN_URL, payload, { headers });
  if (!res.data || !res.data.data) throw new Error('Login başarısız: ' + JSON.stringify(res.data));
  authData = res.data.data;
  console.log('TCL login başarılı');
  return authData;
}

async function getCloudUrls() {
  if (cloudUrlsData) return cloudUrlsData;

  const payload = { appId: APP_ID };
  const headers = { 'Content-Type': 'application/json' };
  const res = await axios.post(CLOUD_URLS_URL, payload, { headers });
  if (!res.data || !res.data.data) throw new Error('Cloud URL alınamadı: ' + JSON.stringify(res.data));
  cloudUrlsData = res.data.data;
  console.log('Cloud URLs alındı:', cloudUrlsData.cloud_url);
  return cloudUrlsData;
}

async function refreshTokens() {
  if (refreshTokensData && Date.now() < tokenExpiry) return refreshTokensData;

  if (!authData) await login();
  const urls = await getCloudUrls();

  const url = `${urls.cloud_url}/v3/auth/refresh_tokens`;
  const payload = { refreshToken: authData.refreshToken, appId: APP_ID };
  const headers = {
    'Content-Type': 'application/json',
    'th_platform': 'android',
    'th_appid': APP_ID,
  };

  const res = await axios.post(url, payload, { headers });
  if (!res.data || !res.data.data) throw new Error('Token yenileme başarısız: ' + JSON.stringify(res.data));
  refreshTokensData = res.data.data;
  tokenExpiry = Date.now() + 3600 * 1000;
  console.log('Token yenilendi');
  return refreshTokensData;
}

async function getAuthHeaders() {
  const tokens = await refreshTokens();
  return {
    'Content-Type': 'application/json',
    'th_platform': 'android',
    'th_appid': APP_ID,
    'Authorization': `Bearer ${tokens.accessToken}`,
  };
}

// --- Devices ---

async function getDevices() {
  const urls = await getCloudUrls();
  const headers = await getAuthHeaders();
  const url = `${urls.device_url}/v3/user/get_things`;
  const res = await axios.post(url, {}, { headers });
  return res.data.data || [];
}

// --- AC Control (MQTT üzerinden değil, HTTP control endpoint) ---

async function sendCommand(deviceId, properties) {
  const urls = await getCloudUrls();
  const headers = await getAuthHeaders();
  const url = `${urls.device_url}/v3/device/control`;

  const payload = {
    deviceId,
    properties,
  };

  const res = await axios.post(url, payload, { headers });
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
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// Klimayı aç
app.get('/ac/on', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const temp = parseInt(req.query.temp || 24);
    const mode = parseInt(req.query.mode || 0); // 0=cool
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });

    const result = await sendCommand(deviceId, {
      powerSwitch: 1,
      workMode: mode,
      temperature: temp,
    });
    res.json({ ok: true, result });
  } catch (e) {
    console.error(e.message);
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
    console.error(e.message);
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
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// Mod değiştir
app.get('/ac/mode', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const modeMap = { cool: 0, dry: 1, fan: 2, heat: 3, auto: 4 };
    const mode = modeMap[req.query.value] ?? 0;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });

    const result = await sendCommand(deviceId, { workMode: mode });
    res.json({ ok: true, result });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`TCL AC Control sunucu port ${PORT} üzerinde çalışıyor`);
  if (!TCL_EMAIL || !TCL_PASSWORD) console.warn('UYARI: TCL_EMAIL veya TCL_PASSWORD tanımlı değil!');
});
