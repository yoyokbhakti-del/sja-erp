-- =====================================================================
-- 0002 MASTER DATA: satuan, grup item, item, gudang, supplier, customer
-- =====================================================================

create table public.uoms (
  code       text primary key,            -- 'Kg', 'L', 'Pcs', 'Botol', 'Sak'
  name       text not null,
  whole_number boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.item_groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  parent_id  uuid references public.item_groups(id),
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  item_group_id   uuid references public.item_groups(id),
  item_type       text not null default 'Produk Jadi'
                  check (item_type in ('Bahan Baku','Bahan Kemas','Produk Jadi','Barang Dagang','Jasa','Lainnya')),
  stock_uom       text not null references public.uoms(code),
  is_stock_item   boolean not null default true,
  has_batch       boolean not null default false,
  has_expiry      boolean not null default false,
  shelf_life_days integer,
  standard_buying_rate  numeric(18,2) not null default 0,
  standard_selling_rate numeric(18,2) not null default 0,
  min_qty         numeric(18,3) not null default 0,     -- titik reorder
  reg_number      text,                                 -- No. registrasi Kementan
  description     text,
  disabled        boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid,
  constraint expiry_needs_batch check (not has_expiry or has_batch)
);

create table public.warehouses (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  warehouse_type text not null default 'Umum'
                 check (warehouse_type in ('Umum','Karantina','Bahan Baku','Bahan Kemas','Produk Jadi','Reject','Transit')),
  company_id     uuid not null default public.default_company() references public.companies(id),
  is_group       boolean not null default false,
  disabled       boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  supplier_group   text default 'Lokal' check (supplier_group in ('Lokal','Impor','Jasa')),
  npwp             text,
  address          text,
  city             text,
  phone            text,
  email            text,
  contact_person   text,
  payment_terms_days integer not null default 30,
  is_approved      boolean not null default false,   -- Approved Vendor (CPOHB)
  disabled         boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  customer_group   text default 'Distributor'
                   check (customer_group in ('Distributor','Poultry Shop','Peternak','Tambak','Pemerintah','Lainnya')),
  npwp             text,
  address          text,
  city             text,
  phone            text,
  email            text,
  contact_person   text,
  payment_terms_days integer not null default 30,
  credit_limit     numeric(18,2) not null default 0,
  disabled         boolean not null default false,
  created_at timestamptz, created_by uuid, updated_at timestamptz, updated_by uuid
);

select public._setup_master('uoms');
select public._setup_master('item_groups');
select public._setup_master('items');
select public._setup_master('warehouses');
select public._setup_master('suppliers');
select public._setup_master('customers');
