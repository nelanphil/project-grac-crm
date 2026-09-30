/** Job-role slugs that replace the default staff home, highest priority first. */
export const STAFF_HOME_VIEWS = ["technician"] as const;

export type StaffHomeView = (typeof STAFF_HOME_VIEWS)[number] | "default";

export function staffHomeView(
  slugs: string[] | null | undefined,
): StaffHomeView {
  const assigned = new Set(slugs ?? []);
  for (const slug of STAFF_HOME_VIEWS) {
    if (assigned.has(slug)) return slug;
  }
  return "default";
}
