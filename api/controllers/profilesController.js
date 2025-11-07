const pool = require('../config/db');

const addUser = async (req, res) => {
  const { uid, email, displayName } = req.body;
  const username = displayName || email;
  try {
    const result = await pool.query(
        'INSERT INTO profiles (username, google_id) VALUES ($1, $2) ON CONFLICT (google_id) DO UPDATE SET username = $1, google_id = $2',
        [username, uid]);
    console.log('User added/updated:', uid);
    res.status(200).json({ message: 'User added/updated successfully' });
  } catch (error) {
    console.error('Error adding user', error);
    res.status(500).json({ error: 'Unable to add user' });
  }
};

const getUserByUid = async (req, res) => {
  const { uid } = req.params;
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