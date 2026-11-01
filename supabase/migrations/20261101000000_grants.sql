-- Table privileges for the Data API roles.
--
-- Row-level security (see the initial schema) decides WHICH rows a role may touch, but a
-- role also needs the basic privilege on the table first. This project does not get those
-- automatically for tables created in the SQL Editor, so grant them explicitly.
--
-- anon          = signed-out visitors
-- authenticated = signed-in users (Clerk token accepted by Supabase)
-- service_role  = the server-side import job (bypasses RLS)

-- Reference data: readable by everyone, writable only by the service role.
grant select on
  os_families, os_major_versions, os_releases, devices, device_os_support
  to anon, authenticated;

grant select on device_os_range to anon, authenticated;

-- Users' saved devices: signed-in users only. RLS limits them to their own rows.
grant select, insert, update, delete on user_devices to authenticated;
grant select on my_devices to authenticated;

-- The import job.
grant all on
  os_families, os_major_versions, os_releases, devices, device_os_support, user_devices
  to service_role;
grant select on device_os_range, my_devices to service_role;
