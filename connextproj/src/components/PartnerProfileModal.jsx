import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { UserContext } from './UserContext';
import API_BASE_URL from '../config';
import Avatar from './Avatar';

const PartnerProfileModal = ({ partnerId, partnerUsername, onClose, onUnmatch }) => {
  const { token: ctxToken } = useContext(UserContext);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unmatching, setUnmatching] = useState(false);

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
              <Avatar
                src={profile.profile_image ? (profile.profile_image.startsWith('http') ? profile.profile_image : `${API_BASE_URL}${profile.profile_image}`) : null}
                alt={profile.username}
                placeholder={profile.username?.[0]?.toUpperCase() || '?'}
                imgClass="partner-profile-photo"
                fallbackClass="partner-profile-avatar-placeholder"
              />
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

            {/* Unmatch button */}
            {onUnmatch && (
              <div className="partner-profile-section" style={{ textAlign: 'center', marginTop: '16px' }}>
                <button
                  className="unmatch-btn"
                  onClick={() => {
                    setUnmatching(true);
                    onUnmatch();
                  }}
                  disabled={unmatching}
                  style={{
                    background: 'rgba(255,60,60,0.15)',
                    color: '#ff6b6b',
                    border: '1px solid rgba(255,60,60,0.3)',
                    borderRadius: '8px',
                    padding: '8px 20px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                  onMouseEnter={(e) => e.target.style.background = 'rgba(255,60,60,0.25)'}
                  onMouseLeave={(e) => e.target.style.background = 'rgba(255,60,60,0.15)'}
                >
                  {unmatching ? 'Unmatching...' : '💔 Unmatch'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PartnerProfileModal;
