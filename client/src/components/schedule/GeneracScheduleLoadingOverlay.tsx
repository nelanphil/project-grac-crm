"use client";

import { useEffect, useRef, useState } from "react";
import { Zap, Clock, Calendar, ShieldCheck, Flag } from "lucide-react";
import type { WorkOrderListItem } from "@/lib/api";
import { COMPANY } from "@/lib/constants";

export interface GeneracGeneratorSpinnerProps {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  /** Current 0..1 progress along the track; if omitted, managed internally. */
  progress?: number;
  /** True when the operation has finished and the car is crossing the finish line. */
  completing?: boolean;
}

/**
 * High-performance SVG Generac Race Car & Checkered Finish Line animation.
 * Replaces the circular rotor spinner with a sleek Generac-livery race car
 * accelerating down an illuminated dispatch speedway and crossing the finish
 * line in sync with the schedule placement completing.
 */
export function GeneracGeneratorSpinner({
  size = "xl",
  className = "",
  progress: controlledProgress,
  completing = false,
}: GeneracGeneratorSpinnerProps) {
  const [internalProgress, setInternalProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const completeStartRef = useRef<{ time: number; fromProgress: number } | null>(
    null,
  );

  useEffect(() => {
    if (typeof controlledProgress === "number") return;
    let rafId = 0;

    const tick = (now: number) => {
      if (startRef.current === null) {
        startRef.current = now;
      }

      if (completing) {
        if (!completeStartRef.current) {
          completeStartRef.current = {
            time: now,
            fromProgress: internalProgress,
          };
        }
        const completeElapsed = now - completeStartRef.current.time;
        const t = Math.min(1, completeElapsed / 220);
        const eased = 1 - Math.pow(1 - t, 3);
        const from = Math.max(0.72, completeStartRef.current.fromProgress);
        setInternalProgress(from + (1 - from) * eased);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        }
        return;
      }

      const elapsed = now - startRef.current;
      // Accelerate smoothly from 0 -> 0.72 over the first 520ms, then edge toward 0.78 while awaiting API
      let nextProgress: number;
      if (elapsed <= 520) {
        const t = elapsed / 520;
        const easeOut = 1 - Math.pow(1 - t, 2.4);
        nextProgress = easeOut * 0.72;
      } else {
        const extra = elapsed - 520;
        nextProgress = 0.72 + 0.06 * (1 - Math.exp(-extra / 1100));
      }
      setInternalProgress(nextProgress);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completing, controlledProgress]);

  const progress =
    typeof controlledProgress === "number"
      ? Math.max(0, Math.min(1, controlledProgress))
      : internalProgress;

  const crossedFinish = completing || progress >= 0.92;

  const heightMap = {
    sm: "h-16",
    md: "h-20",
    lg: "h-24",
    xl: "h-28",
  };
  const heightClass = heightMap[size] || heightMap.xl;

  // Track coordinates inside viewBox 0 0 380 112:
  // Car nose starts at x ≈ 96 (car group x = 14) and crosses finish line at x = 318 (car group x = 238..258)
  const carX = 14 + progress * 244;

  return (
    <div
      className={`relative flex w-full items-center justify-center select-none ${heightClass} ${className}`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 380 112"
        className="h-full w-full overflow-visible drop-shadow-[0_0_18px_rgba(243,108,33,0.38)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Ambient speedway glow */}
          <radialGradient id="race-ambient-glow" cx="55%" cy="62%" r="55%">
            <stop offset="0%" stopColor="#f36c21" stopOpacity="0.38" />
            <stop offset="65%" stopColor="#f36c21" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#f36c21" stopOpacity="0" />
          </radialGradient>

          {/* Asphalt track surface gradient */}
          <linearGradient id="race-track-surface" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1c1917" />
            <stop offset="50%" stopColor="#0f0d0c" />
            <stop offset="100%" stopColor="#1c1917" />
          </linearGradient>

          {/* Heated orange speed trail behind the car */}
          <linearGradient id="race-speed-trail" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#f36c21" stopOpacity="0" />
            <stop offset="55%" stopColor="#f36c21" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.85" />
          </linearGradient>

          {/* Generac race car body metallic orange gradient */}
          <linearGradient id="race-car-body" x1="0%" y1="0%" x2="100%" y2="35%">
            <stop offset="0%" stopColor="#c2410c" />
            <stop offset="42%" stopColor="#f36c21" />
            <stop offset="82%" stopColor="#fb923c" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>

          {/* Cockpit canopy glass gradient */}
          <linearGradient id="race-canopy-glass" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#44403c" />
            <stop offset="45%" stopColor="#1c1917" />
            <stop offset="100%" stopColor="#090807" />
          </linearGradient>

          {/* Exhaust flame gradient */}
          <linearGradient id="race-flame-grad" x1="100%" y1="50%" x2="0%" y2="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="35%" stopColor="#fbbf24" />
            <stop offset="75%" stopColor="#f36c21" />
            <stop offset="100%" stopColor="#f36c21" stopOpacity="0" />
          </linearGradient>

          {/* Finish line victory burst */}
          <radialGradient id="finish-line-burst" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#f36c21" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#f36c21" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient Speedway Energy Field */}
        <ellipse
          cx="195"
          cy="68"
          rx="178"
          ry="40"
          fill="url(#race-ambient-glow)"
        />

        {/* Speedway Track Base */}
        <rect
          x="10"
          y="54"
          width="360"
          height="42"
          rx="10"
          fill="url(#race-track-surface)"
          stroke="#44403c"
          strokeWidth="1.5"
        />

        {/* Top & Bottom Illuminated Track Curbs / Rumble Strips */}
        <line
          x1="18"
          y1="55.5"
          x2="362"
          y2="55.5"
          stroke="#f36c21"
          strokeWidth="2"
          strokeDasharray="10 6"
          opacity="0.75"
        />
        <line
          x1="18"
          y1="94.5"
          x2="362"
          y2="94.5"
          stroke="#f36c21"
          strokeWidth="2"
          strokeDasharray="10 6"
          opacity="0.75"
        />

        {/* Starting Grid Chevrons (Left) */}
        <g opacity="0.45">
          <path
            d="M24 61 L30 75 L24 89"
            stroke="#fbbf24"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M32 61 L38 75 L32 89"
            stroke="#f36c21"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* Scrolling Center Speedway Dashed Line */}
        <line
          x1="20"
          y1="75"
          x2="314"
          y2="75"
          stroke="#78716c"
          strokeWidth="2"
          strokeDasharray="18 18"
          className="animate-race-track-lines"
          opacity="0.65"
        />

        {/* Illuminated Orange Tire / Boost Trail Following Car */}
        <rect
          x="18"
          y="67"
          width={Math.max(8, carX + 18)}
          height="16"
          rx="8"
          fill="url(#race-speed-trail)"
          opacity="0.75"
        />
        <line
          x1="20"
          y1="75"
          x2={Math.max(24, carX + 26)}
          y2="75"
          stroke="#fbbf24"
          strokeWidth="2.2"
          opacity="0.9"
        />

        {/* Checkered Finish Line on Track (x = 318..332) */}
        <g>
          {crossedFinish && (
            <circle
              cx="325"
              cy="64"
              r="38"
              fill="url(#finish-line-burst)"
            />
          )}

          {/* Checkered Pattern (2 columns x 6 rows) */}
          {Array.from({ length: 6 }).map((_, row) => {
            const y = 57 + row * 6.2;
            const isEven = row % 2 === 0;
            return (
              <g key={row}>
                <rect
                  x="318"
                  y={y}
                  width="6.5"
                  height="6.2"
                  fill={isEven ? "#ffffff" : "#1c1917"}
                />
                <rect
                  x="324.5"
                  y={y}
                  width="6.5"
                  height="6.2"
                  fill={isEven ? "#f36c21" : "#ffffff"}
                />
              </g>
            );
          })}

          {/* Finish Gantry / Checkered Flag Pole Above Track */}
          <line
            x1="324.5"
            y1="14"
            x2="324.5"
            y2="56"
            stroke={crossedFinish ? "#fbbf24" : "#a8a29e"}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle
            cx="324.5"
            cy="13"
            r="3"
            fill={crossedFinish ? "#fbbf24" : "#f36c21"}
          />

          {/* Checkered Flag Banner */}
          <g
            transform={
              crossedFinish
                ? "translate(325, 14) rotate(-6)"
                : "translate(325, 15)"
            }
          >
            <path
              d="M0 0 C10 -3, 20 3, 30 0 L30 18 C20 21, 10 15, 0 18 Z"
              fill="#1c1917"
              stroke={crossedFinish ? "#fbbf24" : "#f36c21"}
              strokeWidth="1.5"
            />
            {/* Checkered cells on flag */}
            {Array.from({ length: 3 }).map((_, r) =>
              Array.from({ length: 5 }).map((__, c) => {
                const filled = (r + c) % 2 === 0;
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={1.5 + c * 5.5}
                    y={1.5 + r * 5.2}
                    width="5.5"
                    height="5.2"
                    fill={
                      filled
                        ? "#ffffff"
                        : crossedFinish
                          ? "#f36c21"
                          : "#292524"
                    }
                  />
                );
              }),
            )}
          </g>

          {/* Finish Line Label Badge */}
          <g transform="translate(298, 38)">
            <rect
              x="0"
              y="0"
              width="52"
              height="13"
              rx="4"
              fill={crossedFinish ? "#f36c21" : "#1c1917"}
              stroke={crossedFinish ? "#fbbf24" : "#f36c21"}
              strokeWidth="1"
            />
            <text
              x="26"
              y="9.5"
              textAnchor="middle"
              fill={crossedFinish ? "#ffffff" : "#fbbf24"}
              fontSize="7.5"
              fontWeight="800"
              letterSpacing="1.2"
            >
              {crossedFinish ? "FINISHED" : "FINISH"}
            </text>
          </g>
        </g>

        {/* Generac Race Car Group (moves horizontally with progress) */}
        <g transform={`translate(${carX}, 39)`}>
          <g className="animate-race-rumble">
            {/* High-Velocity Wind / Speed Streaks Behind Car */}
            <g opacity="0.85">
              <line
                x1="-28"
                y1="18"
                x2="-6"
                y2="18"
                stroke="#fbbf24"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="-38"
                y1="26"
                x2="-10"
                y2="26"
                stroke="#f36c21"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="-22"
                y1="34"
                x2="-4"
                y2="34"
                stroke="#fbbf24"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </g>

            {/* Twin Turbo Afterburner Exhaust Flames */}
            <g
              className="animate-race-exhaust"
              style={{ transformOrigin: "4px 31px" }}
            >
              <path
                d="M4 27 L-24 23 L-15 31 L-28 35 L4 35 Z"
                fill="url(#race-flame-grad)"
              />
              <path
                d="M4 29 L-14 27 L-9 31 L-16 33 L4 33 Z"
                fill="#ffffff"
                opacity="0.9"
              />
            </g>

            {/* Car Drop Shadow on Asphalt */}
            <ellipse
              cx="45"
              cy="41"
              rx="42"
              ry="5"
              fill="#000000"
              opacity="0.65"
            />

            {/* Rear Aerodynamic GT Wing / Spoiler */}
            <path
              d="M4 14 L14 14 L18 26 L10 26 Z"
              fill="#292524"
              stroke="#f36c21"
              strokeWidth="1.2"
            />
            <rect
              x="1"
              y="11"
              width="15"
              height="4"
              rx="1.5"
              fill="#f36c21"
              stroke="#fbbf24"
              strokeWidth="0.8"
            />

            {/* Lower Carbon Fiber Ground-Effect Skirt & Front Splitter */}
            <path
              d="M6 34 L88 34 L92 37 L4 37 Z"
              fill="#1c1917"
              stroke="#fbbf24"
              strokeWidth="0.9"
            />

            {/* Main Aerodynamic Race Car Chassis Body */}
            <path
              d="M6 26 L14 20 L28 19 L42 12 L62 13 L78 22 L90 27 L91 34 L6 34 Z"
              fill="url(#race-car-body)"
              stroke="#fed7aa"
              strokeWidth="1"
            />

            {/* Cockpits / Tinted Aerodynamic Canopy */}
            <path
              d="M31 19 L42 13.5 L60 14.5 L71 22 L31 22 Z"
              fill="url(#race-canopy-glass)"
              stroke="#fbbf24"
              strokeWidth="1"
            />
            {/* Windshield highlight */}
            <path
              d="M56 15.5 L67 21 L62 21 L52 15.5 Z"
              fill="#ffffff"
              opacity="0.28"
            />

            {/* Generac Racing Livery Stripe & High-Voltage Bolt Emblem */}
            <path
              d="M12 27 L84 27"
              stroke="#ffffff"
              strokeWidth="1.6"
              opacity="0.9"
            />
            <path
              d="M16 30 L78 30"
              stroke="#fbbf24"
              strokeWidth="1.2"
              opacity="0.85"
            />
            {/* Lightning Bolt Door Crest */}
            <path
              d="M47 21 L42 27 L46 27 L44 33 L51 26 L47 26 Z"
              fill="#ffffff"
              stroke="#f36c21"
              strokeWidth="0.6"
            />

            {/* Front LED Racing Headlight Beam */}
            <polygon
              points="90,28 118,22 118,35 90,32"
              fill="#fbbf24"
              opacity="0.32"
            />
            <rect
              x="86"
              y="27.5"
              width="4.5"
              height="3"
              rx="1"
              fill="#ffffff"
            />

            {/* Rear Racing Wheel & Spinning Spokes (cx=22, cy=35) */}
            <g>
              <circle
                cx="22"
                cy="35"
                r="9"
                fill="#0c0a09"
                stroke="#44403c"
                strokeWidth="2"
              />
              <circle
                cx="22"
                cy="35"
                r="6.2"
                fill="#1c1917"
                stroke="#f36c21"
                strokeWidth="1.4"
              />
              <g
                className="animate-spin"
                style={{
                  animationDuration: "0.32s",
                  transformOrigin: "22px 35px",
                }}
              >
                <line
                  x1="22"
                  y1="29"
                  x2="22"
                  y2="41"
                  stroke="#fbbf24"
                  strokeWidth="1.4"
                />
                <line
                  x1="16"
                  y1="35"
                  x2="28"
                  y2="35"
                  stroke="#fbbf24"
                  strokeWidth="1.4"
                />
                <line
                  x1="17.8"
                  y1="30.8"
                  x2="26.2"
                  y2="39.2"
                  stroke="#f36c21"
                  strokeWidth="1.1"
                />
              </g>
              <circle cx="22" cy="35" r="2" fill="#ffffff" />
            </g>

            {/* Front Racing Wheel & Spinning Spokes (cx=70, cy=35) */}
            <g>
              <circle
                cx="70"
                cy="35"
                r="9"
                fill="#0c0a09"
                stroke="#44403c"
                strokeWidth="2"
              />
              <circle
                cx="70"
                cy="35"
                r="6.2"
                fill="#1c1917"
                stroke="#f36c21"
                strokeWidth="1.4"
              />
              <g
                className="animate-spin"
                style={{
                  animationDuration: "0.32s",
                  transformOrigin: "70px 35px",
                }}
              >
                <line
                  x1="70"
                  y1="29"
                  x2="70"
                  y2="41"
                  stroke="#fbbf24"
                  strokeWidth="1.4"
                />
                <line
                  x1="64"
                  y1="35"
                  x2="76"
                  y2="35"
                  stroke="#fbbf24"
                  strokeWidth="1.4"
                />
                <line
                  x1="65.8"
                  y1="30.8"
                  x2="74.2"
                  y2="39.2"
                  stroke="#f36c21"
                  strokeWidth="1.1"
                />
              </g>
              <circle cx="70" cy="35" r="2" fill="#ffffff" />
            </g>
          </g>
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
  /** Set to true right as the schedule placement completes so the car crosses the finish line. */
  completing?: boolean;
}

const STATUS_MESSAGES = [
  "Racing appointment onto technician schedule…",
  "Synchronizing dispatch board & route availability…",
  "Calibrating appointment window & service buffers…",
  "Approaching finish line — locking technician calendar…",
];

export default function GeneracScheduleLoadingOverlay({
  workOrder,
  technicianName,
  technicianInitials,
  targetTime,
  targetDate,
  message,
  completing = false,
}: GeneracScheduleLoadingOverlayProps) {
  const [statusIndex, setStatusIndex] = useState(0);
  const [raceProgress, setRaceProgress] = useState(0);
  const startRef = useRef<number | null>(null);
  const completeStartRef = useRef<{ time: number; fromProgress: number } | null>(
    null,
  );

  // Cycle through technical status updates if the request takes a moment
  useEffect(() => {
    const timer = setInterval(() => {
      setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 1800);
    return () => clearInterval(timer);
  }, []);

  // Synchronize race car position & progress bar with the actual completion timing
  useEffect(() => {
    let rafId = 0;

    const tick = (now: number) => {
      if (startRef.current === null) {
        startRef.current = now;
      }

      if (completing) {
        if (!completeStartRef.current) {
          completeStartRef.current = {
            time: now,
            fromProgress: raceProgress,
          };
        }
        const completeElapsed = now - completeStartRef.current.time;
        const t = Math.min(1, completeElapsed / 230);
        const eased = 1 - Math.pow(1 - t, 3);
        const from = Math.max(0.75, completeStartRef.current.fromProgress);
        setRaceProgress(from + (1 - from) * eased);
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        }
        return;
      }

      const elapsed = now - startRef.current;
      let nextProgress: number;
      if (elapsed <= 520) {
        const t = elapsed / 520;
        const easeOut = 1 - Math.pow(1 - t, 2.4);
        nextProgress = easeOut * 0.72;
      } else {
        const extra = elapsed - 520;
        nextProgress = 0.72 + 0.06 * (1 - Math.exp(-extra / 1100));
      }
      setRaceProgress(nextProgress);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completing]);

  const customerName = workOrder?.customerName?.trim() || "";
  const orderNumber = workOrder?.number ? `#${workOrder.number}` : "";
  const typeLabel =
    workOrder?.workOrderType?.label?.trim() || "Service Appointment";

  const progressPercent = Math.round(
    Math.max(6, Math.min(100, raceProgress * 100)),
  );

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

        {/* Central Bespoke Race Car & Finish Line Animation */}
        <div className="my-4 flex w-full items-center justify-center">
          <GeneracGeneratorSpinner
            size="xl"
            progress={raceProgress}
            completing={completing}
          />
        </div>

        {/* Drop Destination & Work Order Details Card */}
        <div className="w-full rounded-xl border border-white/10 bg-white/[0.04] p-3.5 text-left backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
            <span>Schedule Placement</span>
            <span className="inline-flex items-center gap-1 text-brand-orange">
              {completing ? (
                <>
                  <Flag className="h-3 w-3" />
                  Finish Line Crossed
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3 w-3" />
                  Live Dispatch
                </>
              )}
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

        {/* Synchronized Finish-Line Progress Bar */}
        <div className="mt-5 w-full">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className=" inset-y-0 left-0 h-full rounded-full bg-gradient-to-r from-amber-500 via-brand-orange to-amber-300 shadow-[0_0_12px_#f36c21] transition-[width] duration-75 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="mt-2.5 text-xs font-medium text-neutral-300 animate-pulse transition-opacity duration-300">
            {completing
              ? "Checkered flag! Appointment locked into technician schedule."
              : message || STATUS_MESSAGES[statusIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}
