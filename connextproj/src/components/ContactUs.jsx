import React from 'react';

const ContactUs = ({ onClose }) => {
  return (
    <div className="terms-overlay" style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
      <div className="terms-modal" style={{background:'rgba(10,10,35,0.98)',border:'1px solid rgba(0,212,255,0.25)',borderRadius:'16px',maxWidth:'600px',width:'100%',maxHeight:'90vh',display:'flex',flexDirection:'column',color:'#fff',overflow:'hidden'}}>
        
        <div style={{padding:'24px 24px 0',textAlign:'center'}}>
          <h2 style={{margin:'0 0 4px',fontSize:'22px'}}>📧 Contact Us</h2>
          <p style={{margin:'0 0 16px',color:'rgba(255,255,255,0.5)',fontSize:'14px'}}>We would love to hear from you</p>
        </div>
        
        <div style={{padding:'0 24px',flex:1,overflowY:'auto'}}>
          <p style={{color:'rgba(255,255,255,0.7)',fontSize:'14px',lineHeight:'1.6',marginBottom:'24px'}}>
            If you have any questions, feedback, concerns, or need help with your account, you can reach us through the following channels:
          </p>
          
          <div style={{display:'flex',flexDirection:'column',gap:'16px',marginBottom:'24px'}}>
            
            <div style={{background:'rgba(255,255,255,0.04)',borderRadius:'12px',padding:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{fontSize:'24px',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,212,255,0.1)',borderRadius:'10px'}}>📧</div>
                <div>
                  <div style={{fontWeight:600,fontSize:'15px',color:'#00d4ff'}}>Email</div>
                  <div style={{color:'rgba(255,255,255,0.5)',fontSize:'13px',marginTop:'2px'}}>connext@example.com</div>
                </div>
              </div>
            </div>
            
            <div style={{background:'rgba(255,255,255,0.04)',borderRadius:'12px',padding:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{fontSize:'24px',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,212,255,0.1)',borderRadius:'10px'}}>🐦</div>
                <div>
                  <div style={{fontWeight:600,fontSize:'15px',color:'#00d4ff'}}>X (Twitter)</div>
                  <div style={{color:'rgba(255,255,255,0.5)',fontSize:'13px',marginTop:'2px'}}>@connext_app</div>
                </div>
              </div>
            </div>
            
            <div style={{background:'rgba(255,255,255,0.04)',borderRadius:'12px',padding:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{fontSize:'24px',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,212,255,0.1)',borderRadius:'10px'}}>📷</div>
                <div>
                  <div style={{fontWeight:600,fontSize:'15px',color:'#00d4ff'}}>Instagram</div>
                  <div style={{color:'rgba(255,255,255,0.5)',fontSize:'13px',marginTop:'2px'}}>@connext_app</div>
                </div>
              </div>
            </div>
            
            <div style={{background:'rgba(255,255,255,0.04)',borderRadius:'12px',padding:'16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
                <div style={{fontSize:'24px',width:'40px',height:'40px',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,212,255,0.1)',borderRadius:'10px'}}>🌐</div>
                <div>
                  <div style={{fontWeight:600,fontSize:'15px',color:'#00d4ff'}}>Website</div>
                  <div style={{color:'rgba(255,255,255,0.5)',fontSize:'13px',marginTop:'2px'}}>www.connext-app.com</div>
                </div>
              </div>
            </div>
            
          </div>
          
          <p style={{color:'rgba(255,255,255,0.7)',fontSize:'14px',lineHeight:'1.6',marginBottom:'24px'}}>
            For urgent safety concerns or abuse reports, please use the in-app reporting feature or contact us immediately at <strong style={{color:'#00d4ff'}}>connext@example.com</strong>.
          </p>
        </div>
        
        <div style={{padding:'16px 24px 24px',textAlign:'center'}}>
          <button onClick={() => onClose()} style={{padding:'12px 32px',borderRadius:'10px',border:'none',background:'linear-gradient(135deg, #00d4ff, #ff4d6d)',color:'#fff',fontWeight:700,fontSize:'15px',cursor:'pointer'}}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default ContactUs;