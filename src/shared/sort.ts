// Direction of a sortable list request, resolved at the DTO boundary to the
// documented default: `desc` for the date/id sort, `asc` for the alphabetical
// sorts (title/artist/playlist/section). The service never sees an unresolved
// direction.
export type SortOrder = 'asc' | 'desc';
