-- Track listing lifecycle: when listings go down (sold/removed) and time-to-sell
alter table stc_listings add column if not exists first_seen_at timestamptz;
alter table stc_listings add column if not exists last_seen_at timestamptz;
alter table stc_listings add column if not exists gone_at timestamptz;
alter table stc_listings add column if not exists days_active integer;

-- Backfill first_seen_at from created_at for existing rows
update stc_listings set first_seen_at = created_at where first_seen_at is null;
