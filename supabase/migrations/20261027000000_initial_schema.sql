-- Initial schema (DRAFT)
--
-- Two kinds of tables:
--   * Reference data (os_*, devices, device_os_support): filled by a scheduled
--     import job using the service-role key. Public read-only.
--   * User data (user_devices): one row per device a signed-in user saved.
--     Protected by row-level security keyed on the Clerk user id.
--
-- Auth: assumes Supabase's Clerk integration (Clerk as a third-party auth
-- provider), so the Clerk user id arrives as the JWT `sub` claim.

-- ---------------------------------------------------------------------------
-- Operating systems
-- ---------------------------------------------------------------------------

create table os_families (
  id    smallint generated always as identity primary key,
  name  text not null unique            -- iOS, iPadOS, macOS, watchOS, tvOS, visionOS, ...
);

-- One row per major version (iOS 26, macOS 15, ...). Compatibility and
-- support status are tracked at this level.
create table os_major_versions (
  id               integer generated always as identity primary key,
  family_id        smallint not null references os_families (id),
  major            integer  not null,
  codename         text,                -- e.g. 'Sequoia'
  released         date,
  end_of_support   date,                -- from endoflife.date
  is_supported     boolean not null default true,  -- Apple supports ~3 latest per family
  unique (family_id, major)
);

-- Every individual release, beta and RC, kept as history. Betas are rows
-- here (kind <> 'release') rather than a separate table.
create type release_kind as enum ('release', 'beta', 'rc');

create table os_releases (
  id                 integer generated always as identity primary key,
  major_version_id   integer not null references os_major_versions (id) on delete cascade,
  version            text not null,     -- '26.0.1', '27.1'
  build              text not null default '',  -- '23A355'
  kind               release_kind not null default 'release',
  pre_release_number smallint,          -- beta 4 -> 4, RC 2 -> 2
  released           date,
  first_seen_at      timestamptz not null default now(),  -- when our importer first saw it
  source             text,              -- 'endoflife.date', 'apple-rss', 'appledb'
  check ((kind = 'release') = (pre_release_number is null)),
  unique (major_version_id, version, build, kind, pre_release_number)
);

create index os_releases_major_idx on os_releases (major_version_id, released desc);

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

create table devices (
  id            integer generated always as identity primary key,
  appledb_key   text not null unique,   -- AppleDB `key`, e.g. 'iPhone14,2'
  name          text not null,          -- 'iPhone 13 Pro'
  category      text not null,          -- iPhone, iPad, Mac, Apple Watch, Apple TV, HomePod, Apple Vision
  device_type   text,                   -- AppleDB `type`, e.g. 'iPad Pro', 'MacBook Air'
  identifiers   text[] not null default '{}',   -- hardware ids, e.g. {'iPhone14,2'}; matched against build deviceMaps
  model_numbers text[] not null default '{}',   -- A2483, ...
  soc           text,
  released      date,
  discontinued  date
);

create index devices_category_name_idx on devices (category, name);

-- Which devices can run which major version. Built by the import job from
-- AppleDB's per-build deviceMap, collapsed to the major version.
create table device_os_support (
  device_id         integer not null references devices (id) on delete cascade,
  major_version_id  integer not null references os_major_versions (id) on delete cascade,
  first_version     text not null,      -- first release of this major that runs on the device
  last_version      text not null,      -- last release of this major that runs on the device
  primary key (device_id, major_version_id)
);

-- "Click an OS, see its devices" reads by major version.
create index device_os_support_major_idx on device_os_support (major_version_id);

-- ---------------------------------------------------------------------------
-- Users' saved devices
-- ---------------------------------------------------------------------------

create table user_devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     text not null default (auth.jwt() ->> 'sub'),  -- Clerk user id ('user_...')
  device_id   integer not null references devices (id),
  nickname    text check (char_length(nickname) <= 60),       -- "Dad's iPad"
  created_at  timestamptz not null default now()
);

create index user_devices_user_idx on user_devices (user_id);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Lowest and highest OS each device supports. One row per device. `security_invoker`
-- makes views obey the caller's RLS instead of the view owner's.
create view device_os_range with (security_invoker = true) as
select
  d.id as device_id,
  lo.family_name  as min_os_family,
  lo.version      as min_os_version,
  hi.family_name  as max_os_family,
  hi.version      as max_os_version,
  hi.is_supported as max_os_is_supported   -- false => device is stuck on an unsupported release
from devices d
join lateral (
  select f.name as family_name, s.first_version as version
  from device_os_support s
  join os_major_versions m on m.id = s.major_version_id
  join os_families f on f.id = m.family_id
  where s.device_id = d.id
  order by m.released asc nulls last, m.major asc
  limit 1
) lo on true
join lateral (
  select f.name as family_name, s.last_version as version, m.is_supported
  from device_os_support s
  join os_major_versions m on m.id = s.major_version_id
  join os_families f on f.id = m.family_id
  where s.device_id = d.id
  order by m.released desc nulls last, m.major desc
  limit 1
) hi on true;

-- Everything the "my devices" page needs in one query.
create view my_devices with (security_invoker = true) as
select
  ud.id,
  ud.nickname,
  ud.created_at,
  d.id as device_id,
  d.name,
  d.category,
  r.min_os_family, r.min_os_version,
  r.max_os_family, r.max_os_version, r.max_os_is_supported
from user_devices ud
join devices d on d.id = ud.device_id
left join device_os_range r on r.device_id = d.id;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table os_families        enable row level security;
alter table os_major_versions  enable row level security;
alter table os_releases        enable row level security;
alter table devices            enable row level security;
alter table device_os_support  enable row level security;
alter table user_devices       enable row level security;

-- Reference data: anyone can read; no write policies, so only the service role
-- (which bypasses RLS) can import.
create policy "public read" on os_families       for select using (true);
create policy "public read" on os_major_versions for select using (true);
create policy "public read" on os_releases       for select using (true);
create policy "public read" on devices           for select using (true);
create policy "public read" on device_os_support for select using (true);

-- User data: signed-in users can only touch rows whose user_id is their own
-- Clerk id. Anonymous requests have no `sub`, so they match nothing.
create policy "own rows: select" on user_devices for select to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id);
create policy "own rows: insert" on user_devices for insert to authenticated
  with check ((select auth.jwt() ->> 'sub') = user_id);
create policy "own rows: update" on user_devices for update to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id)
  with check ((select auth.jwt() ->> 'sub') = user_id);
create policy "own rows: delete" on user_devices for delete to authenticated
  using ((select auth.jwt() ->> 'sub') = user_id);
