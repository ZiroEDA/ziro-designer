\pset pager off
\set QUIET on
delete from realtime.messages;
delete from public.project_members; delete from public.project_versions; delete from public.projects;
insert into auth.users (id, instance_id, aud, role, email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@x.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@x.test'),
 ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@x.test')
on conflict do nothing;
insert into public.projects (id, uid, user_id, name, files)
values ('11111111-1111-1111-1111-111111111111','12345678-1234-1234-1234-123456789abc',
        'aaaaaaaa-0000-0000-0000-000000000001','Board A','[]'::jsonb);
insert into public.project_members (project_uid, user_id, role)
values ('12345678-1234-1234-1234-123456789abc','bbbbbbbb-0000-0000-0000-000000000002','viewer');
-- One frame of each kind on the project's channel, as the service would hold
-- them; the question is who may see or add one.
insert into realtime.messages (topic, extension) values
  ('project:12345678-1234-1234-1234-123456789abc','broadcast'),
  ('project:12345678-1234-1234-1234-123456789abc','presence'),
  ('project:12345678-1234-1234-1234-123456789abc','postgres_changes');
\set QUIET off

\echo '### 1 topic parser -- expect the uid, then two nulls'
select public.project_uid_of_topic('project:12345678-1234-1234-1234-123456789abc') as parsed;
select public.project_uid_of_topic('project:not-a-uuid') as parsed;
select public.project_uid_of_topic('room:12345678-1234-1234-1234-123456789abc') as parsed;

\echo '### 2 owner A joins -- expect 2 (broadcast + presence, never postgres_changes)'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
select count(*) as n from realtime.messages; commit;

\echo '### 3 viewer B joins -- expect 2'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
select count(*) as n from realtime.messages; commit;

\echo '### 4 C, who only knows the uid, cannot join -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
select count(*) as n from realtime.messages; commit;

\echo '### 5 viewer B may send (presence, cursors) -- expect INSERT 0 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
insert into realtime.messages (topic, extension) values ('project:12345678-1234-1234-1234-123456789abc','broadcast'); commit;

\echo '### 6 C cannot send -- expect ERROR row-level security'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
insert into realtime.messages (topic, extension) values ('project:12345678-1234-1234-1234-123456789abc','broadcast'); rollback;

\echo '### 7 a malformed topic is refused, not an error -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
set local "realtime.topic" = 'project:12345678';
select count(*) as n from realtime.messages; commit;

\echo '### 8 signed out -- expect ERROR permission denied'
begin; set local role anon;
set local "realtime.topic" = 'project:12345678-1234-1234-1234-123456789abc';
select count(*) as n from realtime.messages; rollback;
