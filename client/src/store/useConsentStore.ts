import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CookieConsentStatus = "accepted" | "declined";

interface ConsentStore {
  cookieConsentStatus: CookieConsentStatus | null;
  cookieConsentDecidedAt: string | null;
  setCookieConsent: (status: CookieConsentStatus) => void;
}

export const useConsentStore = create<ConsentStore>()(
  persist(
    (set) => ({
      cookieConsentStatus: null,
      cookieConsentDecidedAt: null,

      setCookieConsent: (status) =>
        set({
          cookieConsentStatus: status,
          cookieConsentDecidedAt: new Date().toISOString(),
        }),
    }),
    {
      name: "grac-consent",
      partialize: (state) => ({
        cookieConsentStatus: state.cookieConsentStatus,
        cookieConsentDecidedAt: state.cookieConsentDecidedAt,
      }),
    },
  ),
);
