import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UserRole = string;

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  permissions: string[];
  first_name: string;
  last_name: string;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  redirectAfterAuth: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  setRedirectAfterAuth: (path: string | null) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      redirectAfterAuth: null,

      login: (token, user) =>
        set({ token, user, isAuthenticated: true }),

      logout: () =>
        set({ token: null, user: null, isAuthenticated: false }),

      setRedirectAfterAuth: (path) => set({ redirectAfterAuth: path }),

      hasPermission: (permission) => {
        const { user } = get();
        return user?.permissions.includes(permission) ?? false;
      },

      hasRole: (...roles) => {
        const { user } = get();
        return user ? roles.includes(user.role) : false;
      },
    }),
    {
      name: "grac-auth",
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
