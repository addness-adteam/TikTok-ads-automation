'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  advertiserId: string | null;
  advertiserIds: string[];
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (accessToken: string, advertiserIds: string[], advertiserId?: string) => void;
  logout: () => void;
  setSelectedAdvertiser: (advertiserId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_STORAGE_KEY = 'tiktok_auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    accessToken: null,
    advertiserId: null,
    advertiserIds: [],
    isLoading: true,
  });

  // ページ読み込み時にLocalStorageから認証情報を復元
  useEffect(() => {
    const storedAuth = localStorage.getItem(AUTH_STORAGE_KEY);
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        setAuthState({
          isAuthenticated: true,
          accessToken: parsed.accessToken,
          advertiserId: parsed.advertiserId,
          advertiserIds: parsed.advertiserIds || [],
          isLoading: false,
        });
      } catch (error) {
        console.error('Failed to parse stored auth:', error);
        localStorage.removeItem(AUTH_STORAGE_KEY);
        setAuthState((prev) => ({ ...prev, isLoading: false }));
      }
    } else {
      setAuthState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  const login = (accessToken: string, advertiserIds: string[], advertiserId?: string) => {
    const selectedAdvertiserId = advertiserId || advertiserIds[0];
    const authData = {
      accessToken,
      advertiserIds,
      advertiserId: selectedAdvertiserId,
    };

    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));

    setAuthState({
      isAuthenticated: true,
      accessToken,
      advertiserId: selectedAdvertiserId,
      advertiserIds,
      isLoading: false,
    });
  };

  const logout = () => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuthState({
      isAuthenticated: false,
      accessToken: null,
      advertiserId: null,
      advertiserIds: [],
      isLoading: false,
    });
  };

  const setSelectedAdvertiser = (advertiserId: string) => {
    if (authState.advertiserIds.includes(advertiserId)) {
      const authData = {
        accessToken: authState.accessToken,
        advertiserIds: authState.advertiserIds,
        advertiserId,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
      setAuthState((prev) => ({ ...prev, advertiserId }));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        ...authState,
        login,
        logout,
        setSelectedAdvertiser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
