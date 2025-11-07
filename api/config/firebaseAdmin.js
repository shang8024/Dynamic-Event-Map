const admin = require('firebase-admin');
const fs = require('fs');

/**
 * Initialize firebase-admin.
 * Priority:
 * 1) GOOGLE_APPLICATION_CREDENTIALS path to a JSON file inside the container
 * 2) FIREBASE_SERVICE_ACCOUNT env var containing the JSON string
 * If neither is provided, firebase-admin is not initialized and verification will fail at runtime.
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
  } else {
    console.warn('No Firebase credentials provided (GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT).');
  }
} catch (err) {
  console.error('Unexpected error initializing firebase-admin', err);
}

module.exports = admin;
