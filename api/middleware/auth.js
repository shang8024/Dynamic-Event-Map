const admin = require('../config/firebaseAdmin');
const User = require('../models/user');
const { createHash } = require('node:crypto');
const requestLimits = require('./rateLimit');

function usernameFor(decoded, attempt) {
  const name = typeof decoded.name === 'string' && decoded.name.trim();
  const base = name || decoded.email.split('@')[0] || 'user';
  if (attempt === 0) return Array.from(base).slice(0, 50).join('');
  // Keep a readable name and derive the fallback from the verified UID. Count
  // Unicode code points to respect PostgreSQL's VARCHAR(50) limit.
  const suffix = createHash('sha256').update(`${decoded.uid}:${attempt}`).digest('hex').slice(0, 16);
  return `${Array.from(base).slice(0, 33).join('')}-${suffix}`;
}

function linkingRequired() {
  const error = new Error('Account linking is required');
  error.status = 409;
  return error;
}

async function provisionProfile(decoded) {
  let user = await User.findOne({ where: { google_id: decoded.uid } });
  if (user) return user;

  const emailOwner = await User.findOne({ where: { email: decoded.email } });
  if (emailOwner) {
    // Another request for this exact UID may have committed since the first
    // lookup. Email equality alone never establishes ownership.
    if (emailOwner.google_id === decoded.uid) return emailOwner;
    throw linkingRequired();
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await User.create({
        google_id: decoded.uid,
        email: decoded.email,
        username: usernameFor(decoded, attempt),
        picture: decoded.picture || null,
      });
    } catch (error) {
      if (error.name !== 'SequelizeUniqueConstraintError') throw error;

      // PostgreSQL's unique constraints arbitrate concurrent first requests.
      // After a conflict, use only the verified UID to recover the winner.
      user = await User.findOne({ where: { google_id: decoded.uid } });
      if (user) return user;
      const owner = await User.findOne({ where: { email: decoded.email } });
      if (owner) {
        if (owner.google_id === decoded.uid) return owner;
        throw linkingRequired();
      }
      const usernameConflict = Object.hasOwn(error.fields || {}, 'username') ||
        error.errors?.some((item) => item.path === 'username');
      if (!usernameConflict) throw error;
    }
  }
  throw new Error('Unable to allocate a unique profile username');
}

const firebaseAuth = async (req, res, next) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ message: 'No token provided' });

    const idToken = match[1];
    decoded = await admin.auth().verifyIdToken(idToken);

    // A signed token alone does not prove that its email address is owned.
    // This also makes future email/password signups verify before using the API.
    if (typeof decoded.uid !== 'string' || !decoded.uid ||
        typeof decoded.email !== 'string' || !decoded.email || decoded.email_verified !== true) {
      return res.status(403).json({ message: 'A verified email address is required' });
    }
  } catch (err) {
    console.error('firebaseAuth error', err && err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }

  if (!await requestLimits.authenticated(req, res, decoded.uid)) return;

  try {
    // Preserve existing profile names and ownership on every subsequent login.
    req.user = await provisionProfile(decoded);
    req.firebase = decoded;
    return next();
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ message: error.message });
    // A database error is not an invalid Firebase token. Do not log SQL errors
    // containing profile/email values; the request can be retried safely.
    console.error('Profile provisioning failed', error.name);
    return res.status(503).json({ message: 'Unable to load your profile. Please try again.' });
  }
};

module.exports = firebaseAuth;
module.exports.provisionProfile = provisionProfile;
