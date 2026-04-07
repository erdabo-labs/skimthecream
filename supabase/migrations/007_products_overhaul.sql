-- 007: Products Overhaul
-- Replace stc_categories + stc_market_prices + stc_product_intel with a single stc_products table.
-- Existing data is not preserved (user confirmed it's not useful).

-- 1. Create the new products table
create table stc_products (
  id bigint generated always as identity primary key,
  canonical_name text not null unique,
  brand text,
  model_line text,
  tier text,
  generation text,
  status text not null default 'pending' check (status in ('pending', 'active', 'inactive')),
  first_seen_at timestamptz default now(),
  listing_count int default 0,
  avg_asking_price numeric(10,2),
  median_asking_price numeric(10,2),
  low_price numeric(10,2),
  high_price numeric(10,2),
  target_buy_price numeric(10,2),
  ai_market_value numeric(10,2),
  avg_days_to_sell numeric(5,1),
  sell_velocity text check (sell_velocity in ('fast', 'moderate', 'slow')),
  avg_profit numeric(10,2),
  times_sold int default 0,
  ease_rating text check (ease_rating in ('easy', 'moderate', 'hard')),
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high', 'very_high')),
  notes text,
  last_refreshed timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_products_status on stc_products(status);

-- 2. Add product_id FK to listings and inventory
alter table stc_listings add column product_id bigint references stc_products(id);
create index idx_listings_product_id on stc_listings(product_id);

alter table stc_inventory add column product_id bigint references stc_products(id);
create index idx_inventory_product_id on stc_inventory(product_id);

-- 3. Drop the obsolete market_price_id FK from listings
alter table stc_listings drop column if exists market_price_id;

-- 4. Drop the old tables
drop table if exists stc_product_intel cascade;
drop table if exists stc_market_prices cascade;
drop table if exists stc_categories cascade;

-- 5. Reset existing listings so the new scorer can reprocess them
update stc_listings
set score = null, estimated_profit = null, product_id = null, price_source = null
where status = 'new';
