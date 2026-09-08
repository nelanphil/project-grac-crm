export const PAGE_SIZE_OPTIONS = [50, 150, 250, 500] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value);
}

export function paginationRange(
  page: number,
  pageSize: number,
  total: number,
): { safePage: number; totalPages: number; rangeStart: number; rangeEnd: number } {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);
  return { safePage, totalPages, rangeStart, rangeEnd };
}
