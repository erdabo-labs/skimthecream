-- Support manual inventory entries with notes and target pricing
alter table stc_inventory add column if not exists notes text;
alter table stc_inventory add column if not exists target_sell_price numeric(10,2);
alter table stc_inventory add column if not exists ai_estimated_value numeric(10,2);
