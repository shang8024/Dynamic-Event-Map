const pool = require('../config/db');

const addUser = async (req, res) => {
  const { uid } = req.firebase;
  if (req.body?.uid && req.body.uid !== uid) {
    return res.status(403).json({ error: 'Cannot modify another profile' });
  }
  // Middleware already provisioned this UID safely. Legacy profile sync must
  // not replace its allocated unique username with a colliding display name.
  return res.status(200).json({ message: 'Profile synced successfully', user: req.user });
};

const getUserByUid = async (req, res) => {
  const { uid } = req.params;
  if (uid !== req.firebase.uid) {
    return res.status(403).json({ error: 'Cannot access another profile' });
  }
  try {
    const result = await pool.query(
        'SELECT id, username, google_id FROM profiles WHERE google_id = $1',
        [uid]);
    if (result.rows.length > 0) {
      return res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error fetching user', error);
    res.status(500).json({ error: 'Unable to fetch user' });
  }
};

module.exports = { addUser, getUserByUid };
