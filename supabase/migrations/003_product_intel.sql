-- Product intelligence: user-provided context per product
create table stc_product_intel (
  id bigint generated always as identity primary key,
  product_name text not null unique,  -- base model e.g. "iPhone 13 Pro"
  category text,
  notes text,                          -- free-form user context
  difficulty text check (difficulty in ('easy', 'moderate', 'hard')),
  storage_matters boolean default false,  -- does storage significantly affect value?
  battery_matters boolean default false,  -- does battery health affect value?
  price_floor numeric(10,2),           -- user's "don't buy above this" price
  price_ceiling numeric(10,2),         -- user's "this is what it's worth" ceiling
  tags text[] default '{}',            -- quick tags: "seasonal", "trending down", etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_product_intel_name on stc_product_intel(product_name);

-- Add storage field to listings
alter table stc_listings add column if not exists parsed_storage text;
