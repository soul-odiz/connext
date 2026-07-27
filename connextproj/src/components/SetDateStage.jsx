import React, { useState } from 'react';
import Calendar from 'react-calendar';

const SetDateStage = ({ onDateSet, onCancel }) => {
  const [date, setDate] = useState(new Date());
  const [time, setTime] = useState('20:00');
  const [location, setLocation] = useState('');

  const handleDateChange = (newDate) => {
    setDate(newDate);
  };

  const handleConfirmDate = () => {
    if (!location.trim()) {
      alert('Please enter a location for your date.');
      return;
    }
    
    const dateTime = new Date(date);
    const [hours, minutes] = time.split(':');
    dateTime.setHours(parseInt(hours), parseInt(minutes));
    
    onDateSet({
      date_time: dateTime.toISOString(),
      location: location.trim()
    });
  };

  return (
    <div className="set-date-stage" style={{ marginTop: '20px', marginBottom: '20px' }}>
      <h2>Set a Date</h2>
      <p style={{ color: 'rgba(255,255,255,0.6)', marginBottom: '20px' }}>
        Choose a time and place to meet your match!
      </p>
      <div className="user-box">
        <label>Pick a Date</label>
        <div className="calendar-wrapper" style={{ marginBottom: '15px' }}>
          <Calendar
            onChange={handleDateChange}
            value={date}
            minDate={new Date()}
            locale="en-US"
          />
        </div>
      </div>
      <div className="user-box">
        <label>Time</label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <div className="user-box">
        <label>Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Central Park, Coffee Shop..."
        />
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button onClick={handleConfirmDate} style={{ flex: 1 }}>
          Confirm Date 💕
        </button>
        {onCancel && (
          <button onClick={onCancel} style={{ flex: 1 }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default SetDateStage;