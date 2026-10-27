"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import { ApiError, getVoiceToken, startVoiceCall } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import ActiveCallBar from "./ActiveCallBar";

export type SoftphonePhase =
  | "idle"
  | "connecting"
  | "ringing"
  | "in-progress"
  | "ended"
  | "error";

export type StartSoftphoneCall = {
  contactId?: string;
  phone?: string;
  conversationId?: string;
  twilioAccountId?: string;
  fromNumber?: string;
  displayName?: string;
};

type SoftphoneContextValue = {
  phase: SoftphonePhase;
  muted: boolean;
  error: string | null;
  displayName: string;
  startedAt: number | null;
  startCall: (input: StartSoftphoneCall) => Promise<{ conversationId: string }>;
  hangup: () => void;
  mute: (next?: boolean) => void;
  sendDigits: (digits: string) => void;
};

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

export function useSoftphone(): SoftphoneContextValue {
  const value = useContext(SoftphoneContext);
  if (!value) {
    throw new Error("Softphone is not available on this page.");
  }
  return value;
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

function microphoneMessage(err: unknown): string {
  const message = errorText(err, "The call failed.");
  if (/31401|permission|notallowed|microphone/i.test(message)) {
    return "Allow microphone access in the browser to place a call.";
  }
  return message;
}

export default function SoftphoneProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const [phase, setPhase] = useState<SoftphonePhase>("idle");
  const [trackedToken, setTrackedToken] = useState(token);
  if (token !== trackedToken) {
    setTrackedToken(token);
    if (!token) setPhase("idle");
  }
  const deviceRef = useRef<{ accountId: string; device: Device } | null>(null);
  const callRef = useRef<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const clearDevice = useCallback(() => {
    deviceRef.current?.device.destroy();
    deviceRef.current = null;
  }, []);

  useEffect(() => {
    if (token) return;
    callRef.current?.disconnect();
    callRef.current = null;
    clearDevice();
  }, [token, clearDevice]);

  useEffect(() => () => clearDevice(), [clearDevice]);

  const finish = useCallback((next: SoftphonePhase, message?: string) => {
    callRef.current = null;
    setMuted(false);
    setPhase(next);
    if (message) setError(message);
    if (next === "ended") {
      window.setTimeout(() => {
        setPhase((current) => (current === "ended" ? "idle" : current));
      }, 2500);
    }
  }, []);

  const deviceFor = useCallback(
    async (accountId: string) => {
      if (!token) throw new Error("Sign in to place a call.");
      const current = deviceRef.current;
      if (current?.accountId === accountId) return current.device;
      clearDevice();
      const issued = await getVoiceToken(token, accountId);
      const { Device: TwilioDevice } = await import("@twilio/voice-sdk");
      const device = new TwilioDevice(issued.token, {
        logLevel: "error",
        closeProtection: true,
      });
      device.on("tokenWillExpire", () => {
        const latest = useAuthStore.getState().token;
        if (!latest) return;
        getVoiceToken(latest, accountId)
          .then((next) => device.updateToken(next.token))
          .catch(() => undefined);
      });
      device.on("error", (deviceError) => {
        setError(microphoneMessage(deviceError));
        setPhase("error");
      });
      deviceRef.current = { accountId, device };
      return device;
    },
    [token, clearDevice],
  );

  const startCall = useCallback(
    async (input: StartSoftphoneCall) => {
      if (!token) throw new Error("Sign in to place a call.");
      if (callRef.current) throw new Error("Finish the current call first.");
      setPhase("connecting");
      setError(null);
      setMuted(false);
      setStartedAt(null);
      setDisplayName(input.displayName || input.phone || "Call");
      try {
        const started = await startVoiceCall(token, input);
        setDisplayName(input.displayName || started.toNumber);
        const device = await deviceFor(started.twilioAccountId);
        const call = await device.connect({ params: { intentId: started.intentId } });
        callRef.current = call;
        call.on("ringing", () => setPhase("ringing"));
        call.on("accept", () => {
          setPhase("in-progress");
          setStartedAt(Date.now());
        });
        call.on("disconnect", () => finish("ended"));
        call.on("cancel", () => finish("ended"));
        call.on("reject", () => finish("error", "The call was rejected."));
        call.on("error", (callError) => finish("error", microphoneMessage(callError)));
        return { conversationId: started.conversationId };
      } catch (err) {
        setPhase("error");
        setError(microphoneMessage(err));
        throw err;
      }
    },
    [token, deviceFor, finish],
  );

  const hangup = useCallback(() => {
    const call = callRef.current;
    if (call) call.disconnect();
    else finish("ended");
  }, [finish]);

  const mute = useCallback((next?: boolean) => {
    const call = callRef.current;
    if (!call) return;
    const value = next ?? !call.isMuted();
    call.mute(value);
    setMuted(value);
  }, []);

  const sendDigits = useCallback((digits: string) => {
    callRef.current?.sendDigits(digits);
  }, []);

  const value = useMemo(
    () => ({
      phase,
      muted,
      error,
      displayName,
      startedAt,
      startCall,
      hangup,
      mute,
      sendDigits,
    }),
    [phase, muted, error, displayName, startedAt, startCall, hangup, mute, sendDigits],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <ActiveCallBar />
    </SoftphoneContext.Provider>
  );
}
