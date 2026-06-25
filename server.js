const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');

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
let awsCredentials = null;
let awsCredentialsExpiry = 0;
let iotData = null;
let tokenExpiry = 0;

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

function buildSignedHeaders(token, countryAbbr) {
  const timestamp = Date.now().toString();
  const nonce = Math.random().toString(36).substr(2, 16);
  const sign = md5(timestamp + nonce + token);
  return {
    'platform': 'android',
    'appversion': '5.4.1',
    'thomeversion': '4.8.1',
    'accesstoken': token,
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

async function getRefreshTokens() {
  if (refreshTokensData && Date.now() < tokenExpiry) return refreshTokensData;
  if (!authData) await login();
  const urls = await getCloudUrls();
  const url = `${urls.cloud_url}/v3/auth/refresh_tokens`;
  const payload = { userId: authData.user.username, ssoToken: authData.token, appId: APP_ID };
  const headers = { 'user-agent': 'Android', 'content-type': 'application/json; charset=UTF-8', 'accept-encoding': 'gzip, deflate, br' };
  const res = await axios.post(url, payload, { headers });
  if (!res.data || res.data.code !== 0) throw new Error('Token alınamadı: ' + JSON.stringify(res.data));
  refreshTokensData = res.data;
  tokenExpiry = Date.now() + 3500 * 1000;
  console.log('SaasToken alındı');
  return refreshTokensData;
}

async function getAwsCredentials() {
  if (awsCredentials && Date.now() < awsCredentialsExpiry) return awsCredentials;

  // Credentials expire olmuşsa iotData'yı da sıfırla
  awsCredentials = null;
  iotData = null;

  const tokens = await getRefreshTokens();
  const urls = await getCloudUrls();
  const region = urls.cloud_region;
  const url = `https://cognito-identity.${region}.amazonaws.com/`;
  const decoded = jwt.decode(tokens.data.cognitoToken, { complete: false });
  const identityId = decoded.sub;
  const payload = {
    IdentityId: identityId,
    Logins: { 'cognito-identity.amazonaws.com': tokens.data.cognitoToken }
  };
  const headers = {
    'User-agent': 'aws-sdk-android/2.22.6 Linux/6.1.23-android14-4-00257-g7e35917775b8-ab9964412 Dalvik/2.1.0/0 en_US',
    'X-Amz-Target': 'AWSCognitoIdentityService.GetCredentialsForIdentity',
    'content-type': 'application/x-amz-json-1.1'
  };
  const res = await axios.post(url, payload, { headers });
  awsCredentials = res.data;
  awsCredentialsExpiry = Date.now() + 50 * 60 * 1000; // 50 dakika
  console.log('AWS credentials alındı');
  return awsCredentials;
}

async function getIotData() {
  if (iotData) return iotData;
  const creds = await getAwsCredentials();
  const urls = await getCloudUrls();
  const region = urls.cloud_region;
  AWS.config.update({
    region,
    accessKeyId: creds.Credentials.AccessKeyId,
    secretAccessKey: creds.Credentials.SecretKey,
    sessionToken: creds.Credentials.SessionToken,
  });
  iotData = new AWS.IotData({ endpoint: `https://data-ats.iot.${region}.amazonaws.com` });
  console.log('AWS IoT Data hazır');
  return iotData;
}

async function sendCommand(deviceId, properties) {
  const iot = await getIotData();
  const topic = `$aws/things/${deviceId}/shadow/update`;
  const payload = JSON.stringify({ state: { desired: properties } });
  await iot.publish({ topic, payload, qos: 0 }).promise();
  console.log('Komut gönderildi:', properties);
  return { ok: true };
}

async function getShadow(deviceId) {
  const iot = await getIotData();
  const data = await iot.getThingShadow({ thingName: deviceId }).promise();
  return JSON.parse(data.payload);
}

async function getDevices() {
  const urls = await getCloudUrls();
  const tokens = await getRefreshTokens();
  const headers = buildSignedHeaders(tokens.data.saasToken, authData.user.countryAbbr);
  const url = `${urls.device_url}/v3/user/get_things`;
  const res = await axios.post(url, {}, { headers });
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
      workMode: parseInt(req.query.mode || 1),
      targetTemperature: parseInt(req.query.temp || 24),
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
    const temp = parseInt(req.query.value);
    if (isNaN(temp) || temp < 16 || temp > 32)
      return res.status(400).json({ error: 'Sıcaklık 16-32 arasında olmalı' });
    const result = await sendCommand(deviceId, { targetTemperature: temp });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/mode', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    const modeMap = { auto: 0, cool: 1, dry: 2, fan: 3, heat: 4 };
    const mode = req.query.value?.toLowerCase();
    if (!(mode in modeMap)) return res.status(400).json({ error: 'Geçersiz mod. Seçenekler: auto, cool, dry, fan, heat' });
    const result = await sendCommand(deviceId, { workMode: modeMap[mode] });
    res.json({ ok: true, result });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/status', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    const shadow = await getShadow(deviceId);
    const state = shadow.state.reported;
    const modeMap = ['auto', 'cool', 'dry', 'fan', 'heat'];
    res.json({
      ok: true,
      power: state.powerSwitch === 1 ? 'açık' : 'kapalı',
      temp: state.targetTemperature,
      mode: modeMap[state.workMode] || 'bilinmiyor',
      fanSpeed: state.fanSpeed ?? null,
      raw: state
    });
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.get('/ac/timer', auth, async (req, res) => {
  try {
    const deviceId = req.query.device_id || process.env.TCL_DEVICE_ID;
    const minutes = parseInt(req.query.minutes);
    const action = req.query.action || 'off';
    if (!deviceId) return res.status(400).json({ error: 'device_id gerekli' });
    if (!minutes || isNaN(minutes) || minutes < 1 || minutes > 1440)
      return res.status(400).json({ error: 'minutes 1-1440 arası olmalı' });
    if (!['on', 'off'].includes(action))
      return res.status(400).json({ error: 'action on veya off olmalı' });
    const command = action === 'on' ? { powerSwitch: 1 } : { powerSwitch: 0 };
    res.json({ ok: true, message: `${minutes} dakika sonra klima ${action === 'on' ? 'açılacak' : 'kapanacak'}` });
    setTimeout(async () => {
      try {
        await sendCommand(deviceId, command);
        console.log(`Timer tamamlandı: ${deviceId} → ${action}`);
      } catch (e) { console.error('Timer komutu başarısız:', e.message); }
    }, minutes * 60 * 1000);
  } catch (e) { console.error(e.message); res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`TCL AC Control port ${PORT} üzerinde çalışıyor`);
  if (!TCL_EMAIL || !TCL_PASSWORD) console.warn('UYARI: TCL_EMAIL veya TCL_PASSWORD tanımlı değil!');
});
