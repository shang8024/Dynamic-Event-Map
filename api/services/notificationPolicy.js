const { createHmac, timingSafeEqual, createHash } = require('node:crypto');
const fs = require('node:fs');

const DEFAULT_PREFERENCES = Object.freeze({ reminders_enabled: false, marketing_enabled: false,
  personalization_enabled: false, reminder_lead_hours: 24, timezone: 'America/Toronto' });
const CONSENT_VERSION = '2026-10-21';

function validatePreferences(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected preference settings');
  const keys = ['reminders_enabled','marketing_enabled','personalization_enabled','reminder_lead_hours'];
  if (Object.keys(body).some(key => !keys.includes(key))) throw new Error('Unknown preference setting');
  for (const [key,value] of Object.entries(body)) {
    if (key === 'reminder_lead_hours' ? ![1,24].includes(value) : typeof value !== 'boolean') throw new Error(`Invalid ${key}`);
  }
  return body;
}
function publicPreferences(row) {
  return Object.fromEntries(Object.entries(DEFAULT_PREFERENCES).map(([key,value]) => [key,row?.[key] ?? value]));
}
function secret(env = process.env) {
  const value = env.UNSUBSCRIBE_SIGNING_SECRET_FILE
    ? fs.readFileSync(env.UNSUBSCRIBE_SIGNING_SECRET_FILE,'utf8').trim() : env.UNSUBSCRIBE_SIGNING_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error('Unsubscribe signing secret is not configured');
  return value;
}
function signUnsubscribe(userId, scope, key, now = Date.now()) {
  if (!Number.isSafeInteger(userId) || userId < 1 || !['reminders','marketing','all'].includes(scope)) throw new Error('Invalid unsubscribe scope');
  const payload = Buffer.from(JSON.stringify({ v:1, u:userId, s:scope, exp:Math.floor(now/1000)+365*86400 })).toString('base64url');
  return `${payload}.${createHmac('sha256',key).update(payload).digest('base64url')}`;
}
function verifyUnsubscribe(token, key, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid or expired unsubscribe link');
  const [payload,signature] = token.split('.');
  const expected = createHmac('sha256',key).update(payload).digest();
  const actual = Buffer.from(signature,'base64url');
  if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) throw new Error('Invalid or expired unsubscribe link');
  let value; try { value=JSON.parse(Buffer.from(payload,'base64url')); } catch { throw new Error('Invalid or expired unsubscribe link'); }
  if (value.v!==1 || !Number.isSafeInteger(value.u) || value.u<1 || !['reminders','marketing','all'].includes(value.s) ||
    !Number.isSafeInteger(value.exp) || value.exp<Math.floor(now/1000)) throw new Error('Invalid or expired unsubscribe link');
  return { userId:value.u, scope:value.s };
}
function emailHash(email) { return createHash('sha256').update(email.trim().toLowerCase()).digest('hex'); }
function deliveryState(env = process.env) {
  // Operators must complete verification/feedback checks before opting in.
  const enabled = env.EMAIL_DELIVERY_ENABLED === 'true' && env.EMAIL_PROVIDER === 'ses' && env.EMAIL_FEEDBACK_READY === 'true';
  return { enabled, mode:enabled ? 'ses' : 'dry_run' };
}
module.exports={ DEFAULT_PREFERENCES, CONSENT_VERSION, validatePreferences, publicPreferences, secret,
  signUnsubscribe, verifyUnsubscribe, emailHash, deliveryState };
