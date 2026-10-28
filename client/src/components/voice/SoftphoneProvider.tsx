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
import {
  ApiError,
  clearVoicePresence,
  getVoiceToken,
  getVoiceTokens,
  sendVoicePresence,
  startVoiceCall,
  type VoiceAccessToken,
} from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import ActiveCallBar from "./ActiveCallBar";
import IncomingCallModal from "./IncomingCallModal";

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

type IncomingInfo = {
  callerName: string;
  callerNumber: string;
  lineLabel: string;
  conversationId: string;
};

type SoftphoneContextValue = {
  phase: SoftphonePhase;
  muted: boolean;
  error: string | null;
  displayName: string;
  startedAt: number | null;
  conversationId: string | null;
  startCall: (input: StartSoftphoneCall) => Promise<{ conversationId: string }>;
  hangup: () => void;
  mute: (next?: boolean) => void;
  sendDigits: (digits: string) => void;
};

type LiveDevice = {
  accountId: string;
  accountSid: string;
  friendlyName: string;
  device: Device;
};

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

const unavailableSoftphone: SoftphoneContextValue = {
  phase: "idle",
  muted: false,
  error: null,
  displayName: "",
  startedAt: null,
  conversationId: null,
  async startCall() {
    throw new Error("Softphone is not available on this page.");
  },
  hangup() {},
  mute() {},
  sendDigits() {},
};

export function useSoftphone(): SoftphoneContextValue {
  return useContext(SoftphoneContext) ?? unavailableSoftphone;
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const MIC_BLOCKED =
  "Microphone is blocked. On iPhone: tap aA in the address bar > Website Settings > Microphone > Allow, then try again.";

const CALLS_UNSUPPORTED =
  "This browser can't make calls. Open the site in Safari or Chrome.";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

type AudioContextCtor = typeof AudioContext;

let sharedAudio: AudioContext | null = null;

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scoped = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? scoped.webkitAudioContext ?? null;
}

function voiceErrorCode(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string" && /^\d+$/.test(code)) return Number(code);
  return null;
}

function callFailureMessage(err: unknown): string {
  console.error("Voice call failed:", err);
  const name = err instanceof Error ? err.name : "";
  const code = voiceErrorCode(err);
  if (name === "NotAllowedError" || code === 31401 || code === 31402) return MIC_BLOCKED;
  const message = errorText(err, "The call failed.");
  return code == null ? message : `Call failed (${code}): ${message}`;
}

function releaseMic(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function primeAudioOutput(): void {
  const Ctor = audioContextCtor();
  if (Ctor) {
    if (!sharedAudio || sharedAudio.state === "closed") sharedAudio = new Ctor();
    const source = sharedAudio.createBufferSource();
    source.buffer = sharedAudio.createBuffer(1, 1, 22050);
    source.connect(sharedAudio.destination);
    try {
      source.start(0);
    } catch {
      // The context can close between the check above and playback.
    }
    void sharedAudio.resume().catch(() => undefined);
  }
  const audio = new Audio(SILENT_WAV);
  audio.setAttribute("playsinline", "");
  const played = audio.play();
  if (played) void played.catch(() => undefined);
}

function beginMicCapture(): Promise<MediaStream> {
  if (
    typeof window === "undefined" ||
    !window.isSecureContext ||
    typeof navigator.mediaDevices?.getUserMedia !== "function"
  ) {
    throw new Error(CALLS_UNSUPPORTED);
  }
  primeAudioOutput();
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

function customParam(call: Call, name: string): string {
  const value = call.customParameters?.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function ignoreCall(call: Call): void {
  const withIgnore = call as Call & { ignore?: () => void };
  if (typeof withIgnore.ignore === "function") withIgnore.ignore();
}

export default function SoftphoneProvider({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((state) => state.token);
  const canCall = useAuthStore(
    (state) => state.user?.permissions?.includes("messages:write") ?? false,
  );
  const [phase, setPhase] = useState<SoftphonePhase>("idle");
  const phaseRef = useRef(phase);
  const devicesRef = useRef<Map<string, LiveDevice>>(new Map());
  const lastSeenRef = useRef<string | null>(null);
  const deviceLocks = useRef<Map<string, Promise<Device>>>(new Map());
  const callRef = useRef<Call | null>(null);
  const incomingCallRef = useRef<Call | null>(null);
  const incomingInfoRef = useRef<IncomingInfo | null>(null);
  const [incoming, setIncoming] = useState<IncomingInfo | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const available = Boolean(token) && canCall;
  const [trackedAvailable, setTrackedAvailable] = useState(available);
  if (available !== trackedAvailable) {
    setTrackedAvailable(available);
    if (!available) {
      setPhase("idle");
      setIncoming(null);
      setConversationId(null);
    }
  }

  const clearDevices = useCallback(() => {
    for (const entry of devicesRef.current.values()) entry.device.destroy();
    devicesRef.current.clear();
    deviceLocks.current.clear();
  }, []);

  const finish = useCallback((next: SoftphonePhase, message?: string, source?: Call) => {
    if (source && callRef.current && callRef.current !== source) return;
    callRef.current = null;
    setMuted(false);
    setPhase(next);
    if (message) setError(message);
    if (next === "ended") {
      window.setTimeout(() => {
        if (phaseRef.current !== "ended") return;
        setPhase("idle");
        setConversationId(null);
      }, 2500);
    }
  }, []);

  const watchCall = useCallback(
    (call: Call) => {
      call.on("ringing", () => setPhase("ringing"));
      call.on("accept", () => {
        setPhase("in-progress");
        setStartedAt(Date.now());
      });
      call.on("disconnect", () => finish("ended", undefined, call));
      call.on("cancel", () => finish("ended", undefined, call));
      call.on("reject", () => finish("error", "The call was rejected.", call));
      call.on("error", (callError) => finish("error", callFailureMessage(callError), call));
    },
    [finish],
  );

  const showIncoming = useCallback((call: Call, lineFallback: string) => {
    if (incomingCallRef.current) {
      ignoreCall(call);
      return;
    }
    const info: IncomingInfo = {
      callerName: customParam(call, "callerName") || "Unknown",
      callerNumber: customParam(call, "callerNumber") || call.parameters.From || "",
      lineLabel: customParam(call, "lineLabel") || lineFallback || "Line",
      conversationId: customParam(call, "conversationId"),
    };
    incomingCallRef.current = call;
    incomingInfoRef.current = info;
    setIncoming(info);
    const clearIfCurrent = () => {
      if (incomingCallRef.current !== call) return;
      incomingCallRef.current = null;
      incomingInfoRef.current = null;
      setIncoming(null);
    };
    call.on("cancel", clearIfCurrent);
    call.on("disconnect", clearIfCurrent);
    call.on("reject", clearIfCurrent);
  }, []);

  const attachDevice = useCallback(async (issued: VoiceAccessToken) => {
    const existing = devicesRef.current.get(issued.twilioAccountId);
    if (existing) {
      existing.device.updateToken(issued.token);
      existing.accountSid = issued.accountSid;
      existing.friendlyName = issued.friendlyName;
      return existing.device;
    }
    const pending = deviceLocks.current.get(issued.twilioAccountId);
    if (pending) return pending;

    const creating = (async () => {
      const { Device: TwilioDevice } = await import("@twilio/voice-sdk");
      const device = new TwilioDevice(issued.token, {
        logLevel: "error",
        closeProtection: true,
        ...(isIos() ? { disableAudioContextSounds: true } : {}),
      });
      device.on("tokenWillExpire", () => {
        const latest = useAuthStore.getState().token;
        if (!latest) return;
        getVoiceToken(latest, issued.twilioAccountId)
          .then((next) => device.updateToken(next.token))
          .catch(() => undefined);
      });
      device.on("error", (deviceError) => {
        if (!callRef.current) return;
        setError(callFailureMessage(deviceError));
        setPhase("error");
      });
      device.on("incoming", (call) => {
        showIncoming(call, issued.friendlyName);
      });
      try {
        await device.register();
      } catch (err) {
        device.destroy();
        throw err;
      }
      devicesRef.current.set(issued.twilioAccountId, {
        accountId: issued.twilioAccountId,
        accountSid: issued.accountSid,
        friendlyName: issued.friendlyName,
        device,
      });
      return device;
    })();

    deviceLocks.current.set(issued.twilioAccountId, creating);
    try {
      return await creating;
    } finally {
      deviceLocks.current.delete(issued.twilioAccountId);
    }
  }, [showIncoming]);

  useEffect(() => {
    if (!token || !canCall) {
      callRef.current?.disconnect();
      callRef.current = null;
      incomingCallRef.current = null;
      incomingInfoRef.current = null;
      clearDevices();
      return;
    }

    const authToken = token;
    let cancelled = false;

    const sync = async () => {
      try {
        const issued = await getVoiceTokens(authToken);
        if (cancelled) return;
        const ids = new Set(issued.tokens.map((item) => item.twilioAccountId));
        if (!callRef.current) {
          for (const [id, entry] of devicesRef.current) {
            if (ids.has(id)) continue;
            entry.device.destroy();
            devicesRef.current.delete(id);
          }
        }
        for (const item of issued.tokens) {
          if (cancelled) return;
          await attachDevice(item);
        }
        if (cancelled) return;
        const accountSids = issued.tokens
          .map((item) => item.accountSid)
          .filter(Boolean);
        if (accountSids.length > 0) {
          const presence = await sendVoicePresence(authToken, accountSids);
          if (!cancelled) lastSeenRef.current = presence.lastSeenAt;
        }
      } catch {
        // Incoming registration is best-effort. Outbound calls fetch a token on demand.
      }
    };

    void sync();
    const timer = window.setInterval(() => void sync(), 60_000);
    const onHide = () => {
      if (!lastSeenRef.current) return;
      void clearVoicePresence(authToken, true, lastSeenRef.current);
    };
    const onShow = () => {
      void sync();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
      const signedOut = useAuthStore.getState().token !== authToken;
      if (signedOut) void clearVoicePresence(authToken, true);
      else if (lastSeenRef.current) {
        void clearVoicePresence(authToken, true, lastSeenRef.current);
      }
      callRef.current?.disconnect();
      callRef.current = null;
      incomingCallRef.current = null;
      clearDevices();
    };
  }, [token, canCall, attachDevice, clearDevices]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const deviceFor = useCallback(
    async (accountId: string) => {
      if (!token) throw new Error("Sign in to place a call.");
      const current = devicesRef.current.get(accountId);
      if (current) return current.device;
      const issued = await getVoiceToken(token, accountId);
      return attachDevice(issued);
    },
    [token, attachDevice],
  );

  const startCall = useCallback(
    async (input: StartSoftphoneCall) => {
      if (!token) throw new Error("Sign in to place a call.");
      if (callRef.current) throw new Error("Finish the current call first.");
      let mic: Promise<MediaStream>;
      try {
        mic = beginMicCapture();
      } catch (err) {
        setDisplayName(input.displayName || input.phone || "Call");
        setPhase("error");
        setError(callFailureMessage(err));
        throw err;
      }
      let probe: MediaStream | null = null;
      const captured = mic.then((stream) => {
        probe = stream;
        return stream;
      });
      setPhase("connecting");
      setError(null);
      setMuted(false);
      setStartedAt(null);
      setDisplayName(input.displayName || input.phone || "Call");
      try {
        const [started] = await Promise.all([startVoiceCall(token, input), captured]);
        releaseMic(probe);
        probe = null;
        setConversationId(started.conversationId || null);
        setDisplayName(input.displayName || started.toNumber);
        const device = await deviceFor(started.twilioAccountId);
        const call = await device.connect({ params: { intentId: started.intentId } });
        callRef.current = call;
        watchCall(call);
        return { conversationId: started.conversationId };
      } catch (err) {
        releaseMic(probe);
        void captured.then((stream) => releaseMic(stream)).catch(() => undefined);
        setPhase("error");
        setError(callFailureMessage(err));
        throw err;
      }
    },
    [token, deviceFor, watchCall],
  );

  const acceptIncoming = useCallback(() => {
    const call = incomingCallRef.current;
    const info = incomingInfoRef.current;
    if (!call || !info) return;
    let mic: Promise<MediaStream>;
    try {
      mic = beginMicCapture();
    } catch (err) {
      incomingCallRef.current = null;
      incomingInfoRef.current = null;
      setIncoming(null);
      try {
        call.reject();
      } catch {
        // The caller may already have hung up.
      }
      setDisplayName(info.callerName || info.callerNumber || "Call");
      setPhase("error");
      setError(callFailureMessage(err));
      return;
    }
    incomingCallRef.current = null;
    incomingInfoRef.current = null;
    setIncoming(null);
    const previous = callRef.current;
    callRef.current = call;
    if (previous && previous !== call) previous.disconnect();
    setDisplayName(info.callerName || info.callerNumber || "Call");
    setConversationId(info.conversationId || null);
    setError(null);
    setMuted(false);
    setStartedAt(null);
    setPhase("connecting");
    watchCall(call);
    void mic
      .then((stream) => {
        releaseMic(stream);
        if (callRef.current !== call) return;
        call.accept();
      })
      .catch((err: unknown) => {
        call.removeAllListeners("reject");
        try {
          call.reject();
        } catch {
          // The caller may already have hung up.
        }
        finish("error", callFailureMessage(err), call);
      });
  }, [watchCall, finish]);

  const declineIncoming = useCallback(() => {
    const call = incomingCallRef.current;
    incomingCallRef.current = null;
    incomingInfoRef.current = null;
    setIncoming(null);
    call?.reject();
  }, []);

  const dismissIncoming = useCallback(() => {
    const call = incomingCallRef.current;
    incomingCallRef.current = null;
    incomingInfoRef.current = null;
    setIncoming(null);
    if (call) ignoreCall(call);
  }, []);

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
      conversationId,
      startCall,
      hangup,
      mute,
      sendDigits,
    }),
    [
      phase,
      muted,
      error,
      displayName,
      startedAt,
      conversationId,
      startCall,
      hangup,
      mute,
      sendDigits,
    ],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      <ActiveCallBar />
      {incoming ? (
        <IncomingCallModal
          callerName={incoming.callerName}
          callerNumber={incoming.callerNumber}
          lineLabel={incoming.lineLabel}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
          onDismiss={dismissIncoming}
        />
      ) : null}
    </SoftphoneContext.Provider>
  );
}
