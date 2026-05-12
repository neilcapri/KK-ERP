-- ============================================================
-- KONSCIOUS KITCHEN ERP — Database Schema
-- Run this in Supabase SQL Editor (kk-erp project)
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
create table if not exists users (
  id uuid references auth.users primary key,
  name text not null,
  role text not null check (role in ('admin','kitchen','dispatch')),
  created_at timestamptz default now()
);

-- ── PRODUCTS (FG) ────────────────────────────────────────────
create table if not exists products (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  name text not null,
  category text not null,
  pack_size integer default 1,
  tray_yield integer,
  units integer default 0,
  min_stock integer default 20,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── RAW MATERIALS ─────────────────────────────────────────────
create table if not exists raw_materials (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  category text,
  unit text default 'kg',
  price_per_unit numeric default 0,
  supplier text,
  stock numeric default 0,
  min_stock numeric default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── BOM ───────────────────────────────────────────────────────
create table if not exists bom (
  id uuid default gen_random_uuid() primary key,
  product_code text references products(code) on delete cascade,
  rm_name text references raw_materials(name) on delete cascade,
  qty_per_unit numeric not null,
  unit text default 'g',
  created_at timestamptz default now()
);

-- ── CUSTOMERS ────────────────────────────────────────────────
create table if not exists customers (
  id uuid default gen_random_uuid() primary key,
  name text unique not null,
  type text default 'retail',
  city text,
  province text,
  email text,
  phone text,
  notes text,
  created_at timestamptz default now()
);

-- ── CUSTOMER PRICES ──────────────────────────────────────────
create table if not exists customer_prices (
  id uuid default gen_random_uuid() primary key,
  customer_id uuid references customers(id) on delete cascade,
  product_code text references products(code) on delete cascade,
  price_per_pack numeric not null,
  created_at timestamptz default now(),
  unique(customer_id, product_code)
);

-- ── DISPATCHES ───────────────────────────────────────────────
create table if not exists dispatches (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  customer_id uuid references customers(id),
  customer_name text,
  invoice_number text,
  status text default 'completed',
  notes text,
  created_by uuid references users(id),
  created_by_name text,
  created_at timestamptz default now()
);

-- ── DISPATCH ITEMS ───────────────────────────────────────────
create table if not exists dispatch_items (
  id uuid default gen_random_uuid() primary key,
  dispatch_id uuid references dispatches(id) on delete cascade,
  product_code text references products(code),
  product_name text,
  qty integer not null,
  dispatch_type text default 'pack',
  units_dispatched integer not null,
  price_per_pack numeric default 0,
  created_at timestamptz default now()
);

-- ── PRODUCTIONS ──────────────────────────────────────────────
create table if not exists productions (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  product_code text references products(code),
  product_name text,
  input_qty numeric not null,
  input_type text default 'units',
  output_units integer not null,
  notes text,
  cogs_estimate numeric default 0,
  created_by uuid references users(id),
  created_by_name text,
  created_at timestamptz default now()
);

-- ── PRODUCTION SCHEDULE ──────────────────────────────────────
create table if not exists production_schedule (
  id uuid default gen_random_uuid() primary key,
  scheduled_date date not null,
  product_code text references products(code),
  product_name text,
  planned_input numeric,
  input_type text default 'trays',
  planned_output integer,
  status text default 'planned' check (status in ('planned','in_progress','completed','cancelled')),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz default now()
);

-- ── SOURCING ─────────────────────────────────────────────────
create table if not exists sourcing (
  id uuid default gen_random_uuid() primary key,
  date date not null,
  rm_name text references raw_materials(name),
  supplier text,
  qty_received numeric not null,
  unit text default 'kg',
  batch_number text,
  cost numeric default 0,
  image_urls text[],
  created_by uuid references users(id),
  created_by_name text,
  created_at timestamptz default now()
);

-- ── STOCK ADJUSTMENTS ────────────────────────────────────────
create table if not exists stock_adjustments (
  id uuid default gen_random_uuid() primary key,
  type text check (type in ('fg','rm')),
  item_code text,
  item_name text,
  old_value numeric,
  new_value numeric,
  reason text,
  created_by uuid references users(id),
  created_by_name text,
  created_at timestamptz default now()
);

-- ── ACTIVITY FEED ────────────────────────────────────────────
create table if not exists activity (
  id uuid default gen_random_uuid() primary key,
  type text not null,
  title text not null,
  description text,
  meta jsonb,
  created_by uuid references users(id),
  created_by_name text,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table users enable row level security;
alter table products enable row level security;
alter table raw_materials enable row level security;
alter table bom enable row level security;
alter table customers enable row level security;
alter table customer_prices enable row level security;
alter table dispatches enable row level security;
alter table dispatch_items enable row level security;
alter table productions enable row level security;
alter table production_schedule enable row level security;
alter table sourcing enable row level security;
alter table stock_adjustments enable row level security;
alter table activity enable row level security;

-- Allow authenticated users to read/write all tables
create policy "Auth users full access" on users for all to authenticated using (true) with check (true);
create policy "Auth users full access" on products for all to authenticated using (true) with check (true);
create policy "Auth users full access" on raw_materials for all to authenticated using (true) with check (true);
create policy "Auth users full access" on bom for all to authenticated using (true) with check (true);
create policy "Auth users full access" on customers for all to authenticated using (true) with check (true);
create policy "Auth users full access" on customer_prices for all to authenticated using (true) with check (true);
create policy "Auth users full access" on dispatches for all to authenticated using (true) with check (true);
create policy "Auth users full access" on dispatch_items for all to authenticated using (true) with check (true);
create policy "Auth users full access" on productions for all to authenticated using (true) with check (true);
create policy "Auth users full access" on production_schedule for all to authenticated using (true) with check (true);
create policy "Auth users full access" on sourcing for all to authenticated using (true) with check (true);
create policy "Auth users full access" on stock_adjustments for all to authenticated using (true) with check (true);
create policy "Auth users full access" on activity for all to authenticated using (true) with check (true);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger products_updated_at before update on products
  for each row execute function update_updated_at();

create trigger raw_materials_updated_at before update on raw_materials
  for each row execute function update_updated_at();

-- ============================================================
-- SEED DATA — PRODUCTS
-- ============================================================
insert into products (code, name, category, pack_size, tray_yield, units, min_stock) values
  ('VPB','Vegan Pistachio Bars','BARS',3,64,1565,60),
  ('VPCAN','Vegan Pecan Bars','BARS',3,36,204,30),
  ('PNF','Paleo No''tella Fudge','BARS',3,40,313,60),
  ('PVBRG','Vegan Brownie Ganache','BARS',1,36,240,20),
  ('PVBR','Paleo Vegan Brownie','BARS',4,36,352,20),
  ('PBB','Protein Blueberry Muffins','MUFFINS',2,null,821,60),
  ('PCC','Protein Choco Muffins','MUFFINS',2,null,576,60),
  ('KLR','Keto Lemon Raspberry Muffins','MUFFINS',2,null,326,30),
  ('KSCD','Keto Cinnamon Donuts','DONUTS',4,null,90,20),
  ('VPBD','Vegan PB Donuts','DONUTS',2,null,172,20),
  ('KHD','Keto Hazelnut Donuts','DONUTS',2,null,420,40),
  ('HPC','Hazelnut Protein Cookies','COOKIES',5,null,475,50),
  ('KABIS','Keto Almond Biscotti','COOKIES',5,null,1025,50),
  ('KAB','Keto Almond Butter Cookies','COOKIES',5,null,713,50),
  ('KWAL','Keto Walnut Cookies','COOKIES',5,null,246,30),
  ('PVHC','Paleo Vegan Hemp Cookies','COOKIES',5,null,354,30),
  ('POS','PO Shortbread','COOKIES',5,null,439,30),
  ('PGCo','Ginger Cookies','COOKIES',5,null,235,20),
  ('KCOC','Keto Collagen Cookies','COOKIES',1,null,308,20),
  ('KSCO','Keto Snickerdoodle Cookies','COOKIES',5,null,285,20),
  ('PVBB','Protein Vegan Banana Bread','LOAVES',1,null,271,20),
  ('GBL','Paleo Ginger Bread Loaf','LOAVES',1,null,72,12),
  ('KPL','Keto Pumpkin Loaf','LOAVES',1,null,50,12),
  ('CCL','Carrot Cake Loaf','LOAVES',1,null,32,8),
  ('BAGL','Signature Bagels','LOAVES',2,null,32,12),
  ('Focaccia','Paleo Vegan Focaccia','LOAVES',1,null,16,6),
  ('TRFCS','Truffle Cake Slices','SLICES',1,null,0,6),
  ('HRCS','Hazelnut Royale Cake Slices','SLICES',1,null,36,12),
  ('VSCS','Vegan Strawberry Cake Slices','SLICES',1,null,25,6),
  ('NALCOB','Nature''s Almond Coconut Bites','NATURES',1,null,0,20),
  ('NBFB','Nature''s Breakfast Bites','NATURES',1,null,80,20)
on conflict (code) do update set
  units = excluded.units,
  updated_at = now();

-- ============================================================
-- SEED DATA — RAW MATERIALS (82 items)
-- ============================================================
insert into raw_materials (name, category, unit, price_per_unit, supplier, stock, min_stock) values
  ('Almond Butter Jar','Nut Butter','kg',15.20,'Costco',6.618,2),
  ('Almond Butter Tub','Nut Butter','kg',15.20,'Prosperity Foods',20.462,5),
  ('Almond Extract','Extract','L',42.63,'Organic Matters',2.3,0.5),
  ('Almond Flour','Flour','kg',12.70,'Prosperity Foods',58.11,10),
  ('Almonds','Nuts','kg',11.33,'Costco',3.0,2),
  ('Apple Cider Vinegar','Condiment','L',9.49,'Costco',1.462,1),
  ('Apple Sauce','Fruit','kg',0,'TBD',0,2),
  ('Apples','Fruit','kg',0,'TBD',0,2),
  ('Arrowroot Powder','Starch','kg',0,'TBD',0,1),
  ('Active Dry Yeast','Leavening','kg',13.20,'Costco',0.732,0.5),
  ('Avocado Oil','Oil','L',14.33,'Costco',11.325,2),
  ('Agave','Sweetener','kg',0,'TBD',0,1),
  ('Baking Soda','Leavening','kg',4.00,'Costco',5.409,1),
  ('Bananas','Fruit','kg',0,'Costco',8.0,2),
  ('Blueberries','Fruit','kg',0,'Costco',0,2),
  ('Blueberries (Frozen)','Fruit','kg',0,'Costco',0,2),
  ('Brown Rice Syrup','Sweetener','kg',0,'TBD',0,1),
  ('Cardamom','Spice','kg',0,'TBD',0,0.2),
  ('Carrots','Vegetable','kg',2.75,'Costco',0,2),
  ('Cashews','Nuts','kg',0,'TBD',0,1),
  ('Cassava Flour','Flour','kg',7.28,'Tootsi Impex',7.0,2),
  ('Chia Seeds','Seed','kg',0,'TBD',0,1),
  ('Chocolate Chips','Chocolate','kg',32.00,'Purity Life',17.953,2),
  ('Cinnamon','Spice','kg',8.50,'Costco',2.083,1),
  ('Cocoa Powder','Chocolate','kg',15.99,'Costco',6.605,2),
  ('Coconut Flour','Flour','kg',4.15,'Lennie Ciglen',16.887,5),
  ('Coconut Milk','Dairy Alt','kg',4.99,'Costco',21.304,5),
  ('Coconut Nectar','Sweetener','kg',0,'TBD',3.0,1),
  ('Coconut Oil','Oil','kg',10.33,'Lennie Ciglen',59.244,5),
  ('Coconut Sugar','Sweetener','kg',9.37,'Sweets from the Earth',40.0,5),
  ('Coffee Grinds','Spice','kg',0,'TBD',0,0.2),
  ('Collagen Powder','Supplement','kg',50.00,'Costco',2.0,1),
  ('Cream of Tartar','Leavening','kg',22.75,'OM Foods',12.694,1),
  ('Dark Chocolate Chips','Chocolate','kg',46.88,'Mode Chocolate',0.3,1),
  ('Dates','Dried Fruit','kg',0,'TBD',20.0,2),
  ('Dry Rosemary','Herb','kg',30.32,'A1 Cash & Carry',0.3,0.2),
  ('Eggs','Dairy','ea',0.57,'Murray''s Farm',1253.071,50),
  ('Erythritol','Sweetener','kg',7.24,'Sweet & Friendly',35.0,5),
  ('Figs','Dried Fruit','kg',0,'TBD',0.9,1),
  ('Flaxseed Meal','Seed','kg',11.10,'Costco',7.2,2),
  ('GH Vegan Protein','Supplement','kg',0,'TBD',0,2),
  ('Garlic Powder','Spice','kg',8.50,'Costco',0,0.5),
  ('Ghee','Dairy','kg',13.33,'Costco',12.673,2),
  ('Ginger Powder','Spice','kg',12.48,'A1 Cash & Carry',7.5,1),
  ('Hazelnut Butter','Nut Butter','kg',29.25,'Lennie Ciglen',10.5,2),
  ('Hazelnut Flour','Flour','kg',0,'In-House',0,1),
  ('Hazelnuts','Nuts','kg',19.83,'Costco',9.0,2),
  ('Hemp Seeds','Seed','kg',17.63,'Costco',1.0,1),
  ('Honey','Sweetener','kg',10.99,'Costco',9.0,2),
  ('Italian Seasoning','Herb','kg',42.44,'A1 Cash & Carry',0.168,0.2),
  ('Lemon Extract','Extract','L',40.07,'Organic Matters',1.658,0.5),
  ('Maple Sugar','Sweetener','kg',21.36,'Tootsi Impex',10.0,2),
  ('Maple Syrup','Sweetener','L',14.55,'Robinson''s Maple',24.114,5),
  ('Molasses','Sweetener','kg',10.05,'OM Foods',9.5,2),
  ('Natural Almond Flour','Supplement','kg',0,'TBD',0,2),
  ('Nutmeg','Spice','kg',47.98,'A1 Cash & Carry',1.5,0.5),
  ('Oat Flour','Flour','kg',0,'TBD',0,2),
  ('Olive Oil','Oil','L',13.00,'Costco',4.0,2),
  ('Onion Powder','Spice','kg',8.57,'Costco',0,0.5),
  ('Orange Extract','Extract','L',59.07,'Organic Matters',2.0,0.5),
  ('Peanut Butter','Nut Butter','kg',6.50,'Costco',2.0,1),
  ('Peanuts','Nuts','kg',13.27,'Costco',0,1),
  ('Pecans','Nuts','kg',17.64,'Costco',14.0,2),
  ('Peppermint Extract','Extract','L',0,'TBD',0.2,0.2),
  ('Pistachios','Nuts','kg',34.17,'Prosperity Foods',1.232,2),
  ('Poppy Seeds','Seed','kg',0,'TBD',0,0.5),
  ('Psyllium Husk','Fibre','kg',27.39,'Lennie Ciglen',13.263,1),
  ('Pumpkin Puree','Vegetable','kg',0,'TBD',0,2),
  ('Pumpkin Seeds','Seed','kg',0,'TBD',2.0,1),
  ('Pumpkin Spice','Spice','kg',0,'TBD',0,0.2),
  ('Raspberries','Fruit','kg',0,'Costco',0,2),
  ('Raspberries (Frozen)','Fruit','kg',0,'Costco',9.0,2),
  ('Rolled Oats','Grain','kg',5.28,'Costco',2.5,2),
  ('Salt','Seasoning','kg',3.25,'Lennie Ciglen',10.745,1),
  ('Shortening','Fat','kg',6.10,'Sweets from the Earth',50.0,5),
  ('Shredded Coconut','Coconut','kg',10.67,'Lennie Ciglen',14.0,2),
  ('Strawberries','Fruit','kg',11.99,'Costco',5.0,2),
  ('Sultana Raisins','Dried Fruit','kg',0,'TBD',0.9,1),
  ('Sunflower Seed Butter','Nut Butter','kg',6.40,'Lennie Ciglen',7.0,2),
  ('Tapioca Starch','Starch','kg',7.01,'Lennie Ciglen',28.597,2),
  ('Vanilla Extract','Extract','L',29.58,'Costco',1.522,0.5),
  ('Vegan Protein Powder','Supplement','kg',0,'TBD',0,2),
  ('Walnuts','Nuts','kg',19.49,'Costco',8.0,2)
on conflict (name) do update set
  stock = excluded.stock,
  updated_at = now();
