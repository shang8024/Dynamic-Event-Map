// An Auth emulator deliberately skips real signature verification. Production
// must fail before initializing the SDK if that development setting leaks in.
if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Firebase Auth emulator must not be enabled in production');
}
const admin = require('firebase-admin');
const fs = require('fs');

/**
 * Initialize firebase-admin.
 * Priority:
 * 1) GOOGLE_APPLICATION_CREDENTIALS path to a JSON file inside the container
 * 2) FIREBASE_SERVICE_ACCOUNT env var containing the JSON string
 * 3) FIREBASE_PROJECT_ID for ID-token signature verification only
 * The third mode needs public signing certificates, but no private credentials.
 * Revocation checks and administrative operations still require credentials.
 */
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      console.log('firebase-admin initialized from GOOGLE_APPLICATION_CREDENTIALS');
    } catch (err) {
      console.error('Failed to read/parse GOOGLE_APPLICATION_CREDENTIALS file', err);
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      console.log('firebase-admin initialized from FIREBASE_SERVICE_ACCOUNT env var');
    } catch (err) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT JSON', err);
    }
  } else if (process.env.FIREBASE_PROJECT_ID?.trim()) {
    admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID.trim() });
    console.log('firebase-admin initialized for ID-token verification using FIREBASE_PROJECT_ID');
  } else {
    console.warn('No Firebase configuration provided (FIREBASE_PROJECT_ID or server credentials).');
  }
} catch (err) {
  console.error('Unexpected error initializing firebase-admin', err);
}

module.exports = admin;
