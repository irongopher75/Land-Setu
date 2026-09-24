import { createContext, useContext } from 'react';

// isSuper is the account's real role. Other components receive an "effective" role in which a super
// administrator counts as a state administrator, and read isSuper only where extra reach applies.
export const AuthContext = createContext({ isSuper: false });
export const useAuthInfo = () => useContext(AuthContext);
