-- ETF下落通知アプリ(Web版) Supabaseスキーマ
-- Supabaseの「SQL Editor」にこの内容を貼り付けて実行してください。

-- 1. ETFカタログ(日本国内ETF全銘柄)
create table if not exists etf_catalog (
  code text primary key,
  name text not null,
  nickname text,
  issuer text not null,
  index_name text not null,
  category text not null,
  themes text[] not null default '{}',
  is_leveraged boolean not null default false,
  is_inverse boolean not null default false,
  expense_ratio numeric not null default 0,
  aum bigint not null default 0
);

-- 2. ユーザー設定(このアプリは1人で使う前提。行は1件のみ)
create table if not exists app_settings (
  id int primary key default 1,
  default_alert_levels numeric[] not null default '{-3,-5,-7,-10}',
  daily_price_retention_days int not null default 365,
  export_history_days int not null default 30,
  constraint single_row check (id = 1)
);
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- 3. ETFごとのユーザー状態
create table if not exists etf_user_state (
  code text primary key references etf_catalog(code),
  is_favorite boolean not null default false,
  is_watched boolean not null default false,
  custom_alert_levels numeric[],
  memo_templates text[] not null default '{}',
  memo_text text not null default '',
  notified_level_today numeric,
  last_price numeric,
  last_change_pct numeric,
  last_volume bigint,
  last_turnover bigint,
  last_updated_at timestamptz,
  created_at timestamptz not null default now()
);

-- 3b. 既存環境向け: 出来高・売買代金カラムを追加(流動性フィルター用)
alter table etf_user_state add column if not exists last_volume bigint;
alter table etf_user_state add column if not exists last_turnover bigint;

-- 4. 買付計画
create table if not exists purchase_plan_item (
  id bigint generated always as identity primary key,
  code text not null references etf_user_state(code) on delete cascade,
  level numeric not null,
  amount int not null,
  note text
);

-- 5. 日次価格履歴(監視ETFのみ)
create table if not exists daily_price (
  id bigint generated always as identity primary key,
  code text not null references etf_user_state(code) on delete cascade,
  date date not null,
  close numeric not null,
  change_pct numeric not null,
  reached_level numeric,
  notified boolean not null default false,
  unique (code, date)
);

-- 6. 通知履歴
create table if not exists notification_record (
  id bigint generated always as identity primary key,
  code text not null references etf_user_state(code) on delete cascade,
  date date not null,
  fired_at timestamptz not null,
  level numeric not null,
  price numeric not null,
  change_pct numeric not null
);

-- 7. プッシュ通知の宛先(スマホをホーム画面に追加した際に登録される)
create table if not exists push_subscription (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Row Level Security: 個人利用なので全開放(anon keyでの読み書きを許可)
-- ※これは「自分専用」の前提です。他人に公開するアプリにする場合は認証を追加してください。
alter table etf_catalog enable row level security;
alter table app_settings enable row level security;
alter table etf_user_state enable row level security;
alter table purchase_plan_item enable row level security;
alter table daily_price enable row level security;
alter table notification_record enable row level security;
alter table push_subscription enable row level security;

create policy "anon full access" on etf_catalog for all using (true) with check (true);
create policy "anon full access" on app_settings for all using (true) with check (true);
create policy "anon full access" on etf_user_state for all using (true) with check (true);
create policy "anon full access" on purchase_plan_item for all using (true) with check (true);
create policy "anon full access" on daily_price for all using (true) with check (true);
create policy "anon full access" on notification_record for all using (true) with check (true);
create policy "anon full access" on push_subscription for all using (true) with check (true);
