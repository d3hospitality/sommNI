-- Personal Winebrary removal must never erase the collective master catalog.
-- Public SELECT and the existing server contribution pipeline are unchanged.
-- The project owner and trusted service role retain administrative access.
revoke delete, truncate on public.wines from public, anon, authenticated;
revoke delete, truncate on public.wl_community_wines from public, anon, authenticated;
