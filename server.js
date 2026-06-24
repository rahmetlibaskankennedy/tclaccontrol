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
let saasToken = null;
let tokenExpiry = 0;

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

function buildSignedHeaders(saasToken, countryAbbr) {
  const timestamp = Date.now().toString();
  const nonce = Math.random().toString(36).substr(2, 16);
  const sign = md5(timestamp + nonce + saasToken);
  return {
    'platform': 'android',
    'appversion': '5.4.1',
    'thomeversion': '4.8.1',
    'accesstoken': saasToken,
    'countrycode': countryAbbr || 'TR',
    'accept-language': 'en',
    'timestamp': timestamp,
    'nonce': nonce,
    'sign': sign,
    'user-agent': 'Android',
    'content-type': 'application/json; charset=UTF-8',
    'accept-encoding': 'gzip, deflate, br'
  };
}

async function login() {
  const passwordHash = md5(TCL_PASSWORD);
  const payload = {
    equipment: 2, password: passwordHash, osType: 1,
    username: TCL_EMAIL, clientVersion: '4.8.1', osVersion: '6.0',
    deviceModel: 'AndroidAndroid SDK built for x86', captchaRule: 2, channel: 'app'
  };
  const headers = { 'th_platform': 'android', 'Content-Type': 'application/json', 'th_appid': APP_ID };
  const res = await axios.post(APP_LOGIN_URL, payload, { headers });
  if (!res.data || !res.data.token) throw new Error('Login başarısız: ' + JSON.stringify(res.data));
  authData = res.data;
  console.log('TCL login başarılı:', authData.user.username);
  return authData;
}

async function getCloudUrls() {
  if (cloudUrlsData) return cloudUrlsData;
  if (!authData) await login();
  const payload = { ssoId: authData.user.username, ssoToken: authData.token };
  const headers = { 'user-agent': 'Android', 'content-type': 'application/json; charset=UTF-8' };
  const res = await axios.post(CLOUD_URLS_URL, payload, { headers });
  if (!res.data || res.data.code !== 0) throw new Error('Cloud URL alınamadı: ' + JSON.stringify(res.data));
  cloudUrlsData = res.data.data;
  console.log('Cloud URL:', cloudUrlsData.cloud_url);
  return cloudUrlsData;
}

async function getSaasToken() {
  if (saasToken && Date.now() < tokenExpiry) return saasToken;
  if (!authData) await login();
  const urls = await getCloudUrls();
  const url = `${urls.cloud_url}/v3/auth/refresh_tokens`;
  const payload = { userId: authData.user.username, ssoToken: authData.token, appId: APP_ID };
  const headers = { 'user-agent': 'Android', 'content-type': 'application/json; charset=UTF-8', 'accept-encoding': 'gzip, deflate, br' };
  const res = await axios.post(url, payload, { headers });
  if (!res.data || res.data.code !== 0) throw new Error('Token alınamadı: ' + JSON.stringify(res.data));
  saasToken = res.data.data.saasToken;
  tokenExpiry = Date.now() + 3500 * 1000;
  console.log('SaasToken alındı');
  return saasToken;
}

async function getDevices() {
  const urls = await getCloudUrls();
  const token = await getSaasToken();
  const headers = buildSignedHeaders(token, authData.user.countryAbbr);
  const url = `${urls.device_url}/v3/user/get_things`;
  const res = await axios.post(url, {}, { headers });
  return res.data;
}

async function sendCommand(deviceId, properties) {
  const urls = await getCloudUrls();
  const token = await getSaasToken();
  const headers = buildSignedHeaders(token, authData.user.countryAbbr);
  const url = `${urls.device_url}/v3/device/control`;
  const res = await axios.post(url, { deviceId, properties }, { headers });
  return res.data;
}

function auth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Yetkisiz' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/devices', auth, async (req, res) => {
  try { res.json(await getDevices()); }
  catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/on', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    const result = await sendCommand(deviceId, {
      powerSwitch: 1,
      workMode: parseInt(req.query.mode || 0),
      temperature: parseInt(req.query.temp || 24),
    });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/off', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    const result = await sendCommand(deviceId, { powerSwitch: 0 });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/temp', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId || !req.query.value) return res.status(400).json({ error: 'device_id ve value gerekli' });
    const result = await sendCommand(deviceId, { temperature: parseInt(req.query.value) });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/mode', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    const modeMap = { cool: 0, dry: 1, fan: 2, heat: 3, auto: 4 };
    const result = await sendCommand(deviceId, { workMode: modeMap[req.query.value] ?? 0 });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`TCL AC Control port ${PORT} üzerinde çalışıyor`);
  if (!TCL_EMAIL || !TCL_PASSWORD) console.warn('UYARI: TCL_EMAIL veya TCL_PASSWORD tanımlı değil!');
});
