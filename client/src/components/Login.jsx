import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import GuestAvatar from '../assets/guest.png';

const pfpStyle = {
  width: 40,
  height: 40,
  borderRadius: '50%',
  alignItems: 'center',
  justifyContent: 'center',
  objectFit: 'cover',
};

export default function Login() {
  const { user, loginWithGoogle, logout } = useAuth();

  if (user) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginRight: '8px' }}>
          {user.photoURL ? <img src={user.photoURL} style={pfpStyle} /> :
          <img src={GuestAvatar} style={pfpStyle} /> }
          <span style={{ marginLeft: 8 }}>{user.displayName || user.email}</span>
        </div>
        <button onClick={logout} style={{ marginLeft: 12 }}>Log Out</button>
      </div>
    );
  }

  return (
    <button onClick={loginWithGoogle}>Sign In</button>
  );
}
