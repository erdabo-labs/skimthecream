-- Dynamic categories table
create table stc_categories (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null,
  keywords text[] not null default '{}',
  avg_days_to_sell int default 14,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Seed with existing hardcoded categories
insert into stc_categories (slug, name, keywords, avg_days_to_sell) values
  ('apple', 'Apple', '{"ipad pro","macbook","macbook pro","macbook air","ipad air","iphone"}', 7),
  ('telescopes', 'Telescopes', '{"celestron","telescope","nexstar"}', 21),
  ('3d_printers', '3D Printers', '{"bambu","bambu lab","bambu labs","p1s","x1c","a1 mini"}', 14);
