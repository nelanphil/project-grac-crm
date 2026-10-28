"use client";

import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

const THUMB = 44;

export default function SwipeToConfirm({
  label,
  busyLabel = "Saving…",
  disabled = false,
  busy = false,
  onConfirm,
}: {
  label: string;
  busyLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const maxRef = useRef(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const locked = disabled || busy;
  const shown = dragging || busy ? offset : 0;

  function trackMax(): number {
    const track = trackRef.current;
    if (!track) return 0;
    return Math.max(track.clientWidth - THUMB - 8, 0);
  }

  function moveTo(clientX: number) {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.min(
      Math.max(clientX - track.getBoundingClientRect().left - THUMB / 2, 0),
      maxRef.current,
    );
    offsetRef.current = next;
    setOffset(next);
  }

  function finish(confirm: boolean) {
    setDragging(false);
    if (confirm && maxRef.current > 0) {
      offsetRef.current = maxRef.current;
      setOffset(maxRef.current);
      onConfirm();
      return;
    }
    offsetRef.current = 0;
    setOffset(0);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (locked) return;
    offsetRef.current = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    maxRef.current = trackMax();
    setDragging(true);
    moveTo(event.clientX);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging || locked) return;
    moveTo(event.clientX);
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const reached = maxRef.current > 0 && offsetRef.current >= maxRef.current * 0.85;
    finish(reached);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (locked) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onConfirm();
    }
  }

  return (
    <div
      ref={trackRef}
      className="complete-notice-secondary relative h-11 min-w-48 flex-1 touch-none overflow-hidden rounded-full select-none"
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-14 text-xs font-semibold">
        {busy ? busyLabel : label}
      </span>
      <button
        type="button"
        role="button"
        aria-label={label}
        disabled={locked}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finish(false)}
        onKeyDown={onKeyDown}
        className={`complete-notice-primary absolute top-1 left-1 flex h-9 w-11 items-center justify-center rounded-full disabled:opacity-60 ${
          dragging ? "" : "transition-transform duration-200"
        }`}
        style={{ transform: `translateX(${shown}px)` }}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
