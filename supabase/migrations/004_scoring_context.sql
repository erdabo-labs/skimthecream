-- Add scoring context and feedback fields to listings
alter table stc_listings add column if not exists price_source text;
alter table stc_listings add column if not exists feedback text;
alter table stc_listings add column if not exists feedback_note text;
