import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, UserProfile } from '../lib/supabase';
import { resolveAccessibleModules } from '../utils/permissions';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  accessibleModules: Set<string>;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessibleModules, setAccessibleModules] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfileAndPermissions(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfileAndPermissions(session.user.id);
      } else {
        setProfile(null);
        setAccessibleModules(new Set());
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadProfileAndPermissions = async (userId: string) => {
    try {
      const [profileResult, permissionsResult] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle(),
        supabase.from('user_permissions').select('module, can_access').eq('user_id', userId),
      ]);

      if (profileResult.error) throw profileResult.error;

      const profileData = profileResult.data as UserProfile | null;
      setProfile(profileData);

      if (profileData) {
        const modules = resolveAccessibleModules(
          profileData.role,
          permissionsResult.data ?? null
        );
        setAccessibleModules(modules);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshPermissions = async () => {
    if (!user) return;
    await loadProfileAndPermissions(user.id);
  };

  const signIn = async (usernameOrEmail: string, password: string) => {
    let email = usernameOrEmail;

    if (!usernameOrEmail.includes('@')) {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('email, username, is_active')
        .eq('username', usernameOrEmail.toLowerCase())
        .maybeSingle();

      if (error) throw new Error('Invalid username or password');
      if (!data) throw new Error('Invalid username or password');
      if (!data.is_active) throw new Error('Account is inactive. Please contact administrator.');

      email = data.email;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, fullName: string, role: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;

    if (data.user) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          id: data.user.id,
          email,
          full_name: fullName,
          role,
          language: 'en',
          is_active: true,
        });

      if (profileError) throw profileError;
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ user, profile, accessibleModules, loading, signIn, signUp, signOut, refreshPermissions }}>
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
