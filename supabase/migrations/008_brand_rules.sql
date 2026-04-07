-- 008: Brand rules for per-brand configuration (age limits, auto-approve, etc.)

create table stc_brand_rules (
  id bigint generated always as identity primary key,
  brand text not null unique,
  max_age_years int,
  auto_approve boolean default false,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed with sensible defaults
insert into stc_brand_rules (brand, max_age_years, notes) values
  ('Apple', 5, 'Tech depreciates fast — 5+ year old Apple gear is hard to flip'),
  ('Samsung', 5, null),
  ('Google', 4, 'Pixel phones lose support quickly'),
  ('Microsoft', 5, 'Surface devices');
