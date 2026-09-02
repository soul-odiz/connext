import React, { useState } from 'react';
import axios from 'axios';
import API_BASE_URL from '../config';

const REPORT_REASONS = [
  'Nudity or sexual content',
  'Abusive or offensive language',
  'Harassment or bullying',
  'Violence or threatening behavior',
  'Drugs or illegal substances',
  'Hate speech or discrimination',
  'Fake profile or impersonation',
  'Spam or solicitation',
  'Other',
];

const ReportModal = ({ partnerId, partnerUsername, token, onClose }) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please select a reason');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await axios.post(
        `${API_BASE_URL}/report_user`,
        { blocked_id: partnerId, reason },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="terms-overlay" style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
        <div className="terms-modal" style={{background:'rgba(10,10,35,0.98)',border:'1px solid rgba(0,212,255,0.25)',borderRadius:'16px',maxWidth:'420px',width:'100%',padding:'32px',textAlign:'center',color:'#fff'}}>
          <div style={{fontSize:'48px',marginBottom:'16px'}}>✅</div>
          <h3 style={{margin:'0 0 8px'}}>Report Submitted</h3>
          <p style={{color:'rgba(255,255,255,0.6)',fontSize:'14px',marginBottom:'20px'}}>
            You have reported <strong>{partnerUsername}</strong>. You will not be matched with this user again.
          </p>
          <button onClick={onClose} style={{padding:'10px 28px',borderRadius:'10px',border:'none',background:'linear-gradient(135deg, #00d4ff, #ff4d6d)',color:'#fff',fontWeight:700,cursor:'pointer'}}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="terms-overlay" style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div className="terms-modal" style={{background:'rgba(10,10,35,0.98)',border:'1px solid rgba(0,212,255,0.25)',borderRadius:'16px',maxWidth:'420px',width:'100%',padding:'24px',color:'#fff'}}>
        <div style={{textAlign:'center',marginBottom:'20px'}}>
          <div style={{fontSize:'36px',marginBottom:'8px'}}>🚩</div>
          <h3 style={{margin:'0 0 4px'}}>Report User</h3>
          <p style={{color:'rgba(255,255,255,0.5)',fontSize:'13px'}}>Reporting <strong>{partnerUsername}</strong></p>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'20px'}}>
          {REPORT_REASONS.map((r) => (
            <label key={r} style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',padding:'8px 12px',borderRadius:'8px',background:reason === r ? 'rgba(255,77,77,0.15)' : 'rgba(255,255,255,0.04)',border:reason === r ? '1px solid rgba(255,77,77,0.3)' : '1px solid transparent',fontSize:'14px',transition:'all 0.2s'}}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={(e) => setReason(e.target.value)} style={{accentColor:'#ff4d6d'}} />
              {r}
            </label>
          ))}
        </div>

        {error && <div style={{color:'#ff6b6b',fontSize:'13px',marginBottom:'12px',textAlign:'center'}}>{error}</div>}

        <div style={{display:'flex',gap:'12px'}}>
          <button onClick={onClose} style={{flex:1,padding:'10px',borderRadius:'10px',border:'1px solid rgba(255,255,255,0.15)',background:'transparent',color:'rgba(255,255,255,0.6)',cursor:'pointer',fontSize:'14px'}}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{flex:1,padding:'10px',borderRadius:'10px',border:'none',background:submitting ? 'rgba(255,77,77,0.3)' : '#ff4d6d',color:'#fff',fontWeight:700,cursor:submitting ? 'not-allowed' : 'pointer',fontSize:'14px'}}>
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;