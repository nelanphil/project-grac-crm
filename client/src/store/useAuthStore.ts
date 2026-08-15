import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CookieConsentStatus } from "@/store/useConsentStore";

export type UserRole = string;

export interface NavOrder {
  /** Flat order of top-level item hrefs across every section. */
  order: string[];
  /** parentHref -> ordered child item hrefs within that parent. */
  children: Record<string, string[]>;
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  permissions: string[];
  first_name: string;
  last_name: string;
  username: string | null;
  /** Numeric suffix from backend key (doc1 → 1). Shown subtly in UI. */
  usernameNumber: number | null;
  /** Client-only cookie preference mirrored from consent store. */
  cookieConsentStatus?: CookieConsentStatus | null;
  /** ISO timestamp when Terms of Service were accepted. */
  termsAcceptedAt?: string | null;
  /** ISO timestamp when Privacy Policy was accepted. */
  privacyAcceptedAt?: string | null;
  /** Whether the user opted in to SMS alerts. */
  smsOptIn?: boolean;
  /** ISO timestamp when SMS opt-in was recorded. */
  smsOptInAt?: string | null;
  /** Version of legal docs accepted. */
  legalDocsVersion?: string | null;
  /** True when a customer must accept legal terms before using the app. */
  needsLegalConsent?: boolean;
  /** Per-user dashboard nav customization. */
  uiPreferences?: { navOrder: NavOrder };
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  redirectAfterAuth: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  setRedirectAfterAuth: (path: string | null) => void;
  setCookieConsentStatus: (status: CookieConsentStatus) => void;
  setNavOrder: (navOrder: NavOrder) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (...roles: UserRole[]) => boolean;
}

/** Customers without terms acceptance must complete the legal consent gate. */
export function userNeedsLegalConsent(
  user: AuthUser | null | undefined,
): boolean {
  if (!user) return false;
  if (typeof user.needsLegalConsent === "boolean")
    return user.needsLegalConsent;
  return user.role === "customer" && !user.termsAcceptedAt;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      redirectAfterAuth: null,

      login: (token, user) => {
        const previous = get().user;
        set({
          token,
          user: {
            ...user,
            needsLegalConsent: userNeedsLegalConsent(user),
            cookieConsentStatus:
              user.cookieConsentStatus ?? previous?.cookieConsentStatus ?? null,
          },
          isAuthenticated: true,
        });
      },

      logout: () => set({ token: null, user: null, isAuthenticated: false }),

      setRedirectAfterAuth: (path) => set({ redirectAfterAuth: path }),

      setCookieConsentStatus: (status) => {
        const { user } = get();
        if (!user) return;
        set({ user: { ...user, cookieConsentStatus: status } });
      },

      setNavOrder: (navOrder) => {
        const { user } = get();
        if (!user) return;
        set({ user: { ...user, uiPreferences: { navOrder } } });
      },

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
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
