"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  nestDroppableId,
  ROOT_DROPPABLE_ID,
} from "@/lib/dashboard-nav";

export function NestPlaceholder({
  parentHref,
  editMode,
  className,
}: {
  parentHref: string;
  editMode: boolean;
  className: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: nestDroppableId(parentHref),
    disabled: !editMode,
  });
  if (!editMode) return null;

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${
        isOver ? "border-solid border-brand-orange text-brand-orange" : ""
      }`}
    >
      {isOver ? "Drop to nest here" : "Drop links here"}
    </div>
  );
}

export function RootDropZone({
  editMode,
  className,
}: {
  editMode: boolean;
  className: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: ROOT_DROPPABLE_ID,
    disabled: !editMode,
  });
  if (!editMode) return null;

  return (
    <div
      ref={setNodeRef}
      className={`${className} ${
        isOver ? "border-solid border-brand-orange text-brand-orange" : ""
      }`}
    >
      {isOver ? "Drop to make top-level" : "Drop here to make a top-level link"}
    </div>
  );
}
