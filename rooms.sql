-- v2 invite rooms. Existing v1 room rows are retained, not deleted.
-- Run only on the prefecture-draft-battle project as a database administrator.
-- Invitation holders collaborate; this is NOT a server-authoritative ranked game.
begin;
create table if not exists public.tdb_rooms (room_code text primary key, state jsonb not null);
alter table public.tdb_rooms enable row level security;
revoke all on public.tdb_rooms from public, anon, authenticated;
grant select, insert, update on public.tdb_rooms to anon;
-- Permissive policies combine with OR. Remove the old allow-all policies.
drop policy if exists tdb_rooms_select_anon on public.tdb_rooms;
drop policy if exists tdb_rooms_insert_anon on public.tdb_rooms;
drop policy if exists tdb_rooms_update_anon on public.tdb_rooms;
drop policy if exists tdb_invite_read on public.tdb_rooms;
drop policy if exists tdb_invite_create on public.tdb_rooms;
drop policy if exists tdb_invite_update on public.tdb_rooms;
do $$ begin
 if not exists (select 1 from pg_constraint where conrelid='public.tdb_rooms'::regclass and conname='tdb_v2_envelope') then
  alter table public.tdb_rooms add constraint tdb_v2_envelope check (
   room_code !~ '^R-' or coalesce(
    room_code ~ '^R-[A-Z0-9]{12}$' and jsonb_typeof(state)='object'
    and state ?& array['accessHash','revision','expiresAt','game']
    and jsonb_typeof(state->'revision')='number' and jsonb_typeof(state->'expiresAt')='number'
    and (state->>'accessHash') ~ '^[a-f0-9]{64}$' and (state->>'revision') ~ '^[0-9]{1,9}$'
    and (state->>'expiresAt') ~ '^[0-9]{13}$' and jsonb_typeof(state->'game')='object'
    and octet_length(state::text)<=262144,false)
  );
 end if;
end $$;
create policy tdb_invite_read on public.tdb_rooms for select to anon using (
 room_code ~ '^R-[A-Z0-9]{12}$'
 and (state->>'accessHash')=encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info',''),'UTF8')),'hex')
 and case when (state->>'expiresAt') ~ '^[0-9]{13}$' then (state->>'expiresAt')::bigint > extract(epoch from now())*1000 else false end
);
create policy tdb_invite_create on public.tdb_rooms for insert to anon with check (
 room_code ~ '^R-[A-Z0-9]{12}$'
 and (state->>'accessHash')=encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info',''),'UTF8')),'hex')
 and coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info','') ~ '^[a-f0-9]{64}$'
 and case when (state->>'expiresAt') ~ '^[0-9]{13}$' then
  (state->>'expiresAt')::bigint > extract(epoch from now())*1000
  and (state->>'expiresAt')::bigint <= extract(epoch from now())*1000+86400000 else false end
);
create policy tdb_invite_update on public.tdb_rooms for update to anon using (
 room_code ~ '^R-[A-Z0-9]{12}$'
 and (state->>'accessHash')=encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info',''),'UTF8')),'hex')
 and case when (state->>'expiresAt') ~ '^[0-9]{13}$' then (state->>'expiresAt')::bigint > extract(epoch from now())*1000 else false end
) with check (
 room_code ~ '^R-[A-Z0-9]{12}$'
 and (state->>'accessHash')=encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info',''),'UTF8')),'hex')
 and coalesce(current_setting('request.headers',true)::jsonb->>'x-client-info','') ~ '^[a-f0-9]{64}$'
 and case when (state->>'expiresAt') ~ '^[0-9]{13}$' then
  (state->>'expiresAt')::bigint > extract(epoch from now())*1000
  and (state->>'expiresAt')::bigint <= extract(epoch from now())*1000+86400000 else false end
);
notify pgrst, 'reload schema';
commit;
-- No automatic deletion is enabled. Access expiration does not imply physical deletion.
-- Old ROOM-* codes remain stored but are no longer anonymously readable/writable.
