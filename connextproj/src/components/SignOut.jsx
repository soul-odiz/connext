import React, { useContext } from 'react';
import { UserContext } from './UserContext';

function SignOut() {
    const { setCurrentUser, setToken } = useContext(UserContext);

    const handleSignOut = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('profileImageUrl');

        setToken(null);
        setCurrentUser(null);
    };

    return (
        <div className="signout-container">
            <button onClick={handleSignOut}>התנתק</button>
        </div>
    );
}

export default SignOut;
