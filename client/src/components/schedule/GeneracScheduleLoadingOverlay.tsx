"use client";

import { useEffect, useState } from "react";
import { Zap, Clock, Calendar, ShieldCheck } from "lucide-react";
import type { WorkOrderListItem } from "@/lib/api";
import { COMPANY } from "@/lib/constants";

export interface GeneracGeneratorSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

/**
 * High-performance SVG Generac generator turbine & rotor spinner.
 * Features:
 * - Outer heavy stator housing with 12 ventilation/cooling notches (rotates smoothly clockwise)
 * - Middle alternator coil ring with copper electromagnetic windings (counter-rotates reverse)
 * - Inner high-velocity aerodynamic cooling fan / impeller blades (rapid spin)
 * - Center heavy generator hub with a pulsing Generac high-voltage power bolt core
 * - Ambient warm orange energy glow
 */
export function GeneracGeneratorSpinner({
  size = "lg",
  className = "",
}: GeneracGeneratorSpinnerProps) {
  const sizeMap = {
    sm: "h-10 w-10",
    md: "h-16 w-16",
    lg: "h-24 w-24",
    xl: "h-32 w-32",
  };

  const dimensionClass = sizeMap[size] || sizeMap.lg;

  return (
    <div
      className={`relative inline-flex items-center justify-center select-none ${dimensionClass} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 160 160"
        className="h-full w-full drop-shadow-[0_0_16px_rgba(243,108,33,0.45)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Radial ambient glow around the generator core */}
          <radialGradient id="gen-ambient-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f36c21" stopOpacity="0.7" />
            <stop offset="55%" stopColor="#f36c21" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#f36c21" stopOpacity="0" />
          </radialGradient>

          {/* Copper winding coil gradient */}
          <linearGradient id="gen-copper-coil" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f36c21" />
            <stop offset="50%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>

          {/* Turbine impeller blade metallic gradient */}
          <linearGradient id="gen-blade-metal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#78716c" />
            <stop offset="50%" stopColor="#44403c" />
            <stop offset="100%" stopColor="#1c1917" />
          </linearGradient>

          {/* Core glow filter */}
          <filter id="gen-bolt-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Ambient Radial Energy Field */}
        <circle
          cx="80"
          cy="80"
          r="72"
          fill="url(#gen-ambient-glow)"
          className="animate-pulse"
          style={{ animationDuration: "2.4s" }}
        />

        {/* Outer Heavy Steel Protective Enclosure / Ring */}
        <circle
          cx="80"
          cy="80"
          r="76"
          stroke="#44403c"
          strokeWidth="2"
          strokeDasharray="4 2"
          opacity="0.5"
        />
        <circle
          cx="80"
          cy="80"
          r="71"
          stroke="#78716c"
          strokeWidth="1.2"
          opacity="0.4"
        />

        {/* Outer Stator Ring with 12 Cooling Louvers / Ventilation Slots (Rotates clockwise) */}
        <g
          className="animate-spin"
          style={{
            animationDuration: "9s",
            transformOrigin: "80px 80px",
          }}
        >
          <circle
            cx="80"
            cy="80"
            r="63"
            stroke="#f36c21"
            strokeWidth="2.5"
            strokeDasharray="14 6 6 6"
            opacity="0.9"
          />
          {Array.from({ length: 12 }).map((_, i) => (
            <rect
              key={i}
              x="77.5"
              y="11"
              width="5"
              height="8"
              rx="1.5"
              fill="#f36c21"
              transform={`rotate(${i * 30} 80 80)`}
            />
          ))}
        </g>

        {/* Middle Alternator Stator Coils (Counter-rotates reverse with glowing copper winding nodes) */}
        <g
          className="animate-spin-reverse"
          style={{
            transformOrigin: "80px 80px",
          }}
        >
          <circle
            cx="80"
            cy="80"
            r="47"
            stroke="url(#gen-copper-coil)"
            strokeWidth="3"
            strokeDasharray="8 4"
          />
          {Array.from({ length: 8 }).map((_, i) => (
            <g key={i} transform={`rotate(${i * 45} 80 80)`}>
              <circle
                cx="80"
                cy="33"
                r="3.5"
                fill="#fbbf24"
                stroke="#d97706"
                strokeWidth="1"
              />
              <circle
                cx="80"
                cy="33"
                r="1.5"
                fill="#ffffff"
              />
            </g>
          ))}
        </g>

        {/* Inner High-Speed Turbine Impeller Blades (Fast smooth spin) */}
        <g
          className="animate-spin"
          style={{
            animationDuration: "2s",
            transformOrigin: "80px 80px",
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <path
              key={i}
              d="M80 80 L76 56 C76 49 84 49 84 56 Z"
              fill="url(#gen-blade-metal)"
              stroke="#f36c21"
              strokeWidth="0.8"
              transform={`rotate(${i * 60} 80 80)`}
            />
          ))}
        </g>

        {/* Generator Center Hub Enclosure */}
        <circle
          cx="80"
          cy="80"
          r="23"
          fill="#1c1917"
          stroke="#f36c21"
          strokeWidth="2.5"
        />
        <circle
          cx="80"
          cy="80"
          r="19"
          fill="#0c0a09"
          stroke="#fbbf24"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.85"
        />

        {/* Generac High-Voltage Lightning Bolt Core */}
        <g
          className="animate-pulse"
          style={{
            animationDuration: "1.2s",
            transformOrigin: "80px 80px",
          }}
        >
          <path
            d="M83 66 L72 80 L79 80 L76 94 L88 78 L81 78 Z"
            fill="#f36c21"
            stroke="#ffffff"
            strokeWidth="1"
            filter="url(#gen-bolt-glow)"
          />
        </g>
      </svg>
    </div>
  );
}

export interface GeneracScheduleLoadingOverlayProps {
  workOrder?: WorkOrderListItem | null;
  technicianName?: string | null;
  technicianInitials?: string | null;
  targetTime?: string | null;
  targetDate?: string | null;
  message?: string;
}

const STATUS_MESSAGES = [
  "Assigning appointment to technician schedule…",
  "Synchronizing dispatch board & route availability…",
  "Calibrating appointment window & service buffers…",
  "Locking work order into technician calendar…",
];

export default function GeneracScheduleLoadingOverlay({
  workOrder,
  technicianName,
  technicianInitials,
  targetTime,
  targetDate,
  message,
}: GeneracScheduleLoadingOverlayProps) {
  const [statusIndex, setStatusIndex] = useState(0);

  // Cycle through subtle technical status updates if the request takes a moment
  useEffect(() => {
    const timer = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 1800);
    return () => clearInterval(timer);
  }, []);

  const customerName = workOrder?.customerName?.trim() || "";
  const orderNumber = workOrder?.number ? `#${workOrder.number}` : "";
  const typeLabel = workOrder?.workOrderType?.label?.trim() || "Service Appointment";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Assigning appointment into technician schedule"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md transition-all duration-300 select-none animate-in fade-in"
    >
      <div className="relative mx-auto flex w-full max-w-md flex-col items-center overflow-hidden rounded-2xl border border-brand-orange/40 bg-[#141211]/95 px-6 py-7 text-center text-white shadow-[0_0_60px_-10px_rgba(243,108,33,0.38)] ring-1 ring-white/10 backdrop-blur-xl">
        {/* Top Industrial Orange Accent Bar */}
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-brand-orange to-transparent" />

        {/* Ambient Corner Orange Halos */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 h-36 w-36 rounded-full bg-brand-orange/15 blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 -left-16 h-36 w-36 rounded-full bg-brand-orange/10 blur-2xl"
        />

        {/* Generac / GMOF Branding Header */}
        <div className="flex flex-col items-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-brand-orange/40 bg-brand-orange/10 px-3 py-0.5 text-[10px] font-bold tracking-widest text-brand-orange uppercase">
            <Zap className="h-3 w-3 fill-brand-orange text-brand-orange" />
            <span>Generac Authorized Dealer</span>
          </div>

          <h2 className="mt-2.5 text-2xl font-black tracking-[0.16em] text-white sm:text-3xl">
            GENERAC
          </h2>

          <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-neutral-300">
            {COMPANY.name.replace(/ of Florida/i, "")}{" "}
            <span className="text-brand-orange font-extrabold">of Florida</span>
          </p>
        </div>

        {/* Central Bespoke Generator Rotor / Alternator Spinner */}
        <div className="my-5 flex items-center justify-center">
          <GeneracGeneratorSpinner size="xl" />
        </div>

        {/* Drop Destination & Work Order Details Card */}
        <div className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-3.5 text-left backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
            <span>Schedule Placement</span>
            <span className="inline-flex items-center gap-1 text-brand-orange">
              <ShieldCheck className="h-3 w-3" />
              Live Dispatch
            </span>
          </div>

          {/* Technician target info */}
          <div className="mt-2.5 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-orange/20 text-xs font-bold text-brand-orange ring-1 ring-brand-orange/40"
            >
              {technicianInitials || "T"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] text-neutral-400">Technician</p>
              <p className="truncate text-sm font-bold text-white">
                {technicianName || "Assigned Technician"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {targetDate && (
                <div className="flex items-center gap-1 rounded-md bg-neutral-800/80 px-2 py-1 text-xs font-medium text-neutral-300 ring-1 ring-white/10">
                  <Calendar className="h-3 w-3 text-neutral-400" />
                  <span>{targetDate}</span>
                </div>
              )}
              {targetTime && (
                <div className="flex items-center gap-1 rounded-md bg-neutral-800/80 px-2 py-1 text-xs font-semibold text-brand-orange ring-1 ring-white/10">
                  <Clock className="h-3 w-3" />
                  <span>{targetTime}</span>
                </div>
              )}
            </div>
          </div>

          {/* Work order info if available */}
          {(customerName || orderNumber) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2 text-xs">
              {orderNumber && (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-neutral-300">
                  {orderNumber}
                </span>
              )}
              {customerName && (
                <span className="font-medium text-white truncate max-w-[200px]">
                  {customerName}
                </span>
              )}
              <span className="text-[11px] text-neutral-400">· {typeLabel}</span>
            </div>
          )}
        </div>

        {/* Dynamic Progress Indicator */}
        <div className="mt-5 w-full">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className="animate-generac-progress absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 via-brand-orange to-amber-300 shadow-[0_0_12px_#f36c21]"
            />
          </div>

          <p className="mt-2.5 text-xs font-medium text-neutral-300 animate-pulse transition-opacity duration-300">
            {message || STATUS_MESSAGES[statusIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}
