"use client";

import { useEffect, useState } from "react";

export interface MobileSectionLink {
  id: string;
  label: string;
}

/**
 * Sticky horizontal jump links for long detail pages on small screens.
 */
export default function MobileSectionNav({
  sections,
}: {
  sections: MobileSectionLink[];
}) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    if (sections.length === 0) return;

    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => Boolean(el));

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-20% 0px -65% 0px",
        threshold: [0, 0.25, 0.5, 1],
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Page sections"
      className="sticky top-[3.25rem] z-20 -mx-4 border-b border-neutral-200 bg-[var(--staff-canvas,#f7f5f1)]/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden"
    >
      <ul className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((section) => {
          const active = activeId === section.id;
          return (
            <li key={section.id} className="shrink-0">
              <a
                href={`#${section.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(section.id);
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  setActiveId(section.id);
                }}
                className={`inline-flex rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-brand-dark text-white"
                    : "bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:text-brand-dark"
                }`}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
