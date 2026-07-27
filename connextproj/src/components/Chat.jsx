import React, { useState, useEffect } from 'react';
import axios from 'axios';
import closeButtonImage from '../close.jpg';
import API_BASE_URL from '../config';

const Chat = ({ socket, currentUser, closeChat, partnerId }) => {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  useEffect(() => {
    if (!socket) return;
    
    socket.on('new_message', message => {
      setMessages(prevMessages => [...prevMessages, message]);
    });

    return () => socket.off('new_message');
  }, [socket]);

  // Load existing messages when chat opens
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadMessages = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token || !partnerId) return;
      
      const response = await axios.get(`${API_BASE_URL}/get_messages?partner_id=${partnerId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.data && response.data.messages) {
        setMessages(response.data.messages);
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  useEffect(() => {
    if (partnerId) {
      loadMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId]);

  const sendMessage = async () => {
    if (newMessage.trim() && partnerId) {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No token found');
        return;
      }

      try {
        await axios.post(`${API_BASE_URL}/send_message`, {
          text: newMessage,
          receiver_id: partnerId,
        }, {
          headers: { Authorization: `Bearer ${token}` }
        });

        // Add message locally for instant display
        setMessages(prev => [...prev, {
          sender_id: currentUser.id,
          text: newMessage,
          timestamp: new Date().toISOString()
        }]);
        
        setNewMessage('');
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  return (
    <div className='chat-container'>
      <div className="chat-header">
        <h3>Chat</h3>
        <button onClick={closeChat} className="close-chat-button">
          <img src={closeButtonImage} alt="Close" />
        </button>
      </div>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.sender_id === currentUser.id ? 'sent' : 'received'}`}>
            <div className="message-text">{msg.text}</div>
            <div className="message-time">
              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </div>
          </div>
        ))}
        {messages.length === 0 && <p className="no-messages">No messages yet. Say hello!</p>}
      </div>
      <div className="chat-input">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type a message..."
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  );
};

export default Chat;