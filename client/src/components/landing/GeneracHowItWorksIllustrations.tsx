import type { ReactNode } from "react";

const STROKE = "#231f20";
const MUTED = "#737373";
const ORANGE = "#f36c21";
const LIGHT = "#fafafa";
const WINDOW_OFF = "#d4d4d4";
const WINDOW_ON = "#fef3c7";
const GLOW = "#fbbf24";

function StepBadge({ cx, cy, label }: { cx: number; cy: number; label: string }) {
  return (
    <>
      <circle cx={cx} cy={cy} r={17} fill={ORANGE} />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fill="white"
        fontSize="12"
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
      >
        {label}
      </text>
    </>
  );
}

/** Generac-style isometric line-art house with garage, generator, and utility pole */
function GeneracLineArtScene({
  badgeLabel,
  badgeX,
  badgeY,
  windowsLit = false,
  generatorRunning = false,
  showGenToHouseLine = false,
}: {
  badgeLabel: string;
  badgeX: number;
  badgeY: number;
  windowsLit?: boolean;
  generatorRunning?: boolean;
  showGenToHouseLine?: boolean;
}) {
  const windowFill = windowsLit ? WINDOW_ON : "white";
  const windowStroke = STROKE;

  return (
    <g>
      {/* Ground */}
      <line x1={16} y1={172} x2={344} y2={172} stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" />

      {/* Standby generator — left of house */}
      <rect x={24} y={138} width={44} height={30} fill="white" stroke={STROKE} strokeWidth={1.5} />
      <rect x={30} y={144} width={32} height={10} fill="white" stroke={STROKE} strokeWidth={1} />
      <line x1={32} y1={148} x2={58} y2={148} stroke={MUTED} strokeWidth={0.75} />
      <line x1={32} y1={151} x2={50} y2={151} stroke={MUTED} strokeWidth={0.75} />
      {generatorRunning && (
        <path d="M 68 150 Q 74 142 80 150" fill="none" stroke={MUTED} strokeWidth={1} />
      )}

      {/* Utility pole — behind garage */}
      <line x1={108} y1={172} x2={108} y2={48} stroke={STROKE} strokeWidth={2} strokeLinecap="round" />
      <line x1={88} y1={62} x2={128} y2={62} stroke={STROKE} strokeWidth={2} strokeLinecap="round" />
      <line x1={92} y1={74} x2={124} y2={74} stroke={STROKE} strokeWidth={1.5} strokeLinecap="round" />

      {/* Power line: pole → house (with badge placement) */}
      <path
        d="M 128 62 L 168 62 L 168 88"
        fill="none"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <StepBadge cx={badgeX} cy={badgeY} label={badgeLabel} />

      {/* Garage wing (left, single story) */}
      <polygon
        points="72,172 72,128 132,128 132,172"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <polygon
        points="72,128 102,108 132,128"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Garage door */}
      <rect x={82} y={142} width={40} height={30} fill="white" stroke={STROKE} strokeWidth={1.5} />
      <line x1={86} y1={150} x2={118} y2={150} stroke={MUTED} strokeWidth={0.75} />
      <line x1={86} y1={158} x2={118} y2={158} stroke={MUTED} strokeWidth={0.75} />
      <line x1={86} y1={166} x2={118} y2={166} stroke={MUTED} strokeWidth={0.75} />

      {/* Main house body — isometric front + side */}
      <polygon
        points="132,172 132,92 248,92 248,172"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Side wall depth */}
      <polygon
        points="248,92 268,82 268,162 248,172"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Main roof */}
      <polygon
        points="124,92 190,52 254,92 248,92 132,92"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Side roof */}
      <polygon
        points="254,92 268,82 268,88 254,92"
        fill="white"
        stroke={STROKE}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <line x1={190} y1={52} x2={268} y2={82} stroke={STROKE} strokeWidth={1.5} />

      {/* Chimney */}
      <rect x={228} y={58} width={12} height={22} fill="white" stroke={STROKE} strokeWidth={1.5} />

      {/* Windows — upper floor */}
      <rect x={148} y={102} width={18} height={16} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />
      <line x1={157} y1={102} x2={157} y2={118} stroke={windowStroke} strokeWidth={0.75} />
      <rect x={178} y={102} width={18} height={16} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />
      <line x1={187} y1={102} x2={187} y2={118} stroke={windowStroke} strokeWidth={0.75} />
      <rect x={208} y={102} width={18} height={16} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />
      <line x1={217} y1={102} x2={217} y2={118} stroke={windowStroke} strokeWidth={0.75} />

      {/* Windows — lower floor + door */}
      <rect x={148} y={128} width={18} height={16} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />
      <rect x={178} y={128} width={22} height={34} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />
      <circle cx={196} cy={145} r={1.5} fill={STROKE} />
      <rect x={208} y={128} width={18} height={16} fill={windowFill} stroke={windowStroke} strokeWidth={1.25} />

      {windowsLit && (
        <ellipse cx={200} cy={130} rx={55} ry={28} fill={GLOW} opacity={0.12} />
      )}

      {/* Generator-to-house connection (steps 2 & 3) */}
      {showGenToHouseLine && (
        <path
          d="M 68 153 L 72 153"
          fill="none"
          stroke={ORANGE}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}
    </g>
  );
}

function IllustrationFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 360 200"
      className={className ?? "h-full w-full"}
      role="img"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Step 1 — matches Generac.com layout: line art, pole behind garage, 01 on power line */
export function StepOneIllustration() {
  return (
    <IllustrationFrame className="mx-auto h-auto w-full max-w-md">
      <GeneracLineArtScene badgeLabel="01." badgeX={148} badgeY={62} />
    </IllustrationFrame>
  );
}

export function StepTwoIllustration() {
  return (
    <IllustrationFrame className="mx-auto h-auto w-full max-w-md">
      <GeneracLineArtScene
        badgeLabel="02."
        badgeX={90}
        badgeY={153}
        generatorRunning
        showGenToHouseLine
      />
      {/* Transfer switch pulse on generator connection */}
      <circle cx={90} cy={153} r={6} fill="none" stroke={ORANGE} strokeWidth={1.5} opacity={0.5} />
      <circle cx={90} cy={153} r={11} fill="none" stroke={ORANGE} strokeWidth={1} opacity={0.3} />
    </IllustrationFrame>
  );
}

export function StepThreeIllustration() {
  return (
    <IllustrationFrame className="mx-auto h-auto w-full max-w-md">
      <GeneracLineArtScene
        badgeLabel="03."
        badgeX={115}
        badgeY={153}
        windowsLit
        generatorRunning
        showGenToHouseLine
      />
      {/* Active power path from generator to house */}
      <path
        d="M 68 153 L 132 153"
        fill="none"
        stroke={ORANGE}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="none"
      />
    </IllustrationFrame>
  );
}

export const HOW_IT_WORKS_ILLUSTRATIONS = [
  StepOneIllustration,
  StepTwoIllustration,
  StepThreeIllustration,
] as const;
