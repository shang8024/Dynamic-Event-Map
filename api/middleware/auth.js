const admin = require('../config/firebaseAdmin');
const User = require('../models/user');

const firebaseAuth = async (req, res, next) => {
  // Create local mock user in development without a token
  if (process.env.NODE_ENV !== 'production' && !process.env.FIREBASE_SERVICE_ACCOUNT) {
    req.firebase = { uid: 'MOCK_DEV_UID', email: 'dev@example.com' };
    req.user = { id: 'mock-user', google_id: 'MOCK_DEV_UID', username: 'Developer' };
    return next();
  }

  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer (.+)$/);
    if (!match) return res.status(401).json({ message: 'No token provided' });

    const idToken = match[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Upsert user by firebase uid (store in google_id for compatibility)
    let user = await User.findOne({ where: { google_id: decoded.uid } });
    if (!user) {
      user = await User.findOne({ where: { email: decoded.email } });
    }
    if (!user) {
      user = await User.create({
        google_id: decoded.uid,
        email: decoded.email,
        username: decoded.name || decoded.email.split('@')[0],
        picture: decoded.picture || null
      });
    } else {
      if (!user.google_id) user.google_id = decoded.uid;
      user.lastLogin = new Date();
      await user.save();
    }

    req.user = user;
    req.firebase = decoded;
    next();
  } catch (err) {
    console.error('firebaseAuth error', err && err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = firebaseAuth;