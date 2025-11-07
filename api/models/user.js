const { DataTypes } = require('sequelize');
const sequelize = require('../config/sequelize');

const User = sequelize.define('User', {
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false
  },
  picture: {
    type: DataTypes.STRING,
    allowNull: true
  },
  // OAuth specific fields
  google_id: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: true
  },
  // Can add other OAuth providers here (e.g., githubId)
}, {
  timestamps: true, // Adds createdAt and updatedAt
  freezeTableName: true,
  tableName: 'profiles',
  underscored: true
});

module.exports = User;