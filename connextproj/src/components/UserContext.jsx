import React, { createContext, useState, useEffect } from 'react';


export const UserContext = createContext(null);

export const UserProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('currentUser');
    if (storedToken && storedUser) {
      setToken(storedToken);
      setCurrentUser(JSON.parse(storedUser)); // Parse the user object from string
    }
  }, []);
  

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, token, setToken }}>
      {children}
    </UserContext.Provider>
  );
};
