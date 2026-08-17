// Default page size for offset pagination when only `page` is supplied. The
// generated schemas cap `limit` at 100, so the default equals the maximum —
// a bare `page` returns a full page.
export const DEFAULT_PAGE_LIMIT = 100;
