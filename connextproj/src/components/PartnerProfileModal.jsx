import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { UserContext } from './UserContext';
import API_BASE_URL from '../config';

const PartnerProfileModal = ({ partnerId, partnerUsername, onClose }) => {
  const { token: ctxToken } = useContext(UserContext);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const authToken = ctxToken || localStorage.getItem('token');
    if (!authToken || !partnerId) return;

    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API_BASE_URL}/api/user_profile/${partnerId}`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        setProfile(res.data);
      } catch (err) {
        setError('Could not load profile.');
        console.error('PartnerProfileModal fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [partnerId, ctxToken]);

  return (
    <div className="partner-profile-overlay" onClick={onClose}>
      <div className="partner-profile-modal" onClick={(e) => e.stopPropagation()}>

        {/* Close button */}
        <button className="partner-profile-close" onClick={onClose} title="Close">✕</button>

        {loading && (
          <div className="partner-profile-loading">
            <div className="matches-spinner"></div>
            <p>Loading profile…</p>
          </div>
        )}

        {error && <p className="matches-error">{error}</p>}

        {!loading && !error && profile && (
          <>
            {/* Avatar / photo */}
            <div className="partner-profile-hero">
              {profile.profile_image ? (
                <img
                  className="partner-profile-photo"
                  src={
                    profile.profile_image.startsWith('http')
                      ? profile.profile_image
                      : `${API_BASE_URL}${profile.profile_image}`
                  }
                  alt={profile.username}
                />
              ) : (
                <div className="partner-profile-avatar-placeholder">
                  {profile.username?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div className="partner-profile-hero-overlay">
                <h2 className="partner-profile-name">{profile.username}</h2>
                <p className="partner-profile-meta">
                  {profile.age && `${profile.age} yrs`}
                  {profile.gender && ` · ${profile.gender}`}
                  {profile.city && ` · 📍 ${profile.city}`}
                </p>
              </div>
            </div>

            {/* Bio */}
            {profile.bio && (
              <div className="partner-profile-section">
                <h3 className="partner-profile-section-title">About</h3>
                <p className="partner-profile-bio">{profile.bio}</p>
              </div>
            )}

            {/* Interests */}
            {profile.interests && profile.interests.length > 0 && (
              <div className="partner-profile-section">
                <h3 className="partner-profile-section-title">Interests</h3>
                <div className="partner-profile-interests">
                  {profile.interests.map((interest, i) => (
                    <span key={i} className="partner-profile-chip">{interest}</span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerProfileModal;
