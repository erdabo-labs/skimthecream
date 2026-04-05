-- SkimTheCream initial schema
-- No RLS — single-user personal tool

create table stc_market_prices (
  id bigint generated always as identity primary key,
  category text not null,
  product_name text not null,
  condition text not null default 'good',
  avg_sold_price numeric(10,2),
  low_sold_price numeric(10,2),
  high_sold_price numeric(10,2),
  source text not null,
  sample_size int default 0,
  scraped_at timestamptz default now(),
  manual_override boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table stc_listings (
  id bigint generated always as identity primary key,
  source text not null,
  source_id text not null,
  title text not null,
  asking_price numeric(10,2),
  listing_url text,
  parsed_category text,
  parsed_product text,
  parsed_condition text,
  market_price_id bigint references stc_market_prices(id),
  estimated_profit numeric(10,2),
  score text check (score in ('pass', 'good', 'great')),
  status text not null default 'new' check (status in ('new', 'contacted', 'purchased', 'dismissed')),
  raw_email_snippet text,
  alert_sent boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(source, source_id)
);

create table stc_inventory (
  id bigint generated always as identity primary key,
  listing_id bigint references stc_listings(id),
  product_name text not null,
  purchase_price numeric(10,2),
  purchase_date date,
  purchase_source text,
  sold_price numeric(10,2),
  sold_date date,
  sold_platform text,
  fees numeric(10,2) default 0,
  profit numeric(10,2),
  status text not null default 'in_stock' check (status in ('in_stock', 'listed', 'sold')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table stc_negotiations (
  id bigint generated always as identity primary key,
  listing_id bigint references stc_listings(id),
  messages jsonb not null default '[]'::jsonb,
  target_price numeric(10,2),
  status text not null default 'active' check (status in ('active', 'closed', 'purchased')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Indexes
create index idx_listings_source on stc_listings(source, source_id);
create index idx_listings_status_score on stc_listings(status, score);
create index idx_market_prices_lookup on stc_market_prices(category, product_name);
create index idx_inventory_status on stc_inventory(status);
