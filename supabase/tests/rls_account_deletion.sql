\pset pager off
\set QUIET on
delete from public.account_deletion_feedback;
delete from public.project_members; delete from public.project_versions; delete from public.projects;
delete from storage.objects where bucket_id='projects';
delete from auth.users where id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002');
insert into auth.users (id, instance_id, aud, role, email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@x.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@x.test');
insert into storage.buckets(id,name,public) values ('projects','projects',false) on conflict do nothing;
insert into public.projects (id, uid, user_id, name, files)
values ('11111111-1111-1111-1111-111111111111','12345678-1234-1234-1234-123456789abc',
        'aaaaaaaa-0000-0000-0000-000000000001','Board A','[]'::jsonb),
       ('22222222-2222-2222-2222-222222222222','22345678-1234-1234-1234-123456789abc',
        'bbbbbbbb-0000-0000-0000-000000000002','Board B','[]'::jsonb);
insert into public.project_members (project_uid, user_id, role) values
  ('12345678-1234-1234-1234-123456789abc','bbbbbbbb-0000-0000-0000-000000000002','viewer'),
  ('22345678-1234-1234-1234-123456789abc','aaaaaaaa-0000-0000-0000-000000000001','editor');
insert into storage.objects(bucket_id,name) values
  ('projects','aaaaaaaa-0000-0000-0000-000000000001/blobs/HA/HASH1'),
  ('projects','bbbbbbbb-0000-0000-0000-000000000002/blobs/HB/HASH2');
\set QUIET off

\echo '### 1 summary for A -- expect 1 project, 1 person'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select * from public.account_deletion_summary(); commit;

\echo '### 2 A may delete own blob, not B''s -- expect DELETE 1 then DELETE 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from storage.objects where name = 'aaaaaaaa-0000-0000-0000-000000000001/blobs/HA/HASH1';
delete from storage.objects where name = 'bbbbbbbb-0000-0000-0000-000000000002/blobs/HB/HASH2'; commit;

\echo '### 3 a token with no recent password sign-in cannot delete -- expect ERROR reauthentication required'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', format('{"sub":"aaaaaaaa-0000-0000-0000-000000000001","amr":[{"method":"password","timestamp":%s}]}', extract(epoch from now() - interval '1 hour')::bigint), true);
select public.delete_my_account('not_listed', 'stale token'); rollback;

\echo '### 4 signed out cannot delete -- expect ERROR'
begin; set local role anon;
select public.delete_my_account('not_listed', 'anon'); rollback;

\echo '### 5 A, freshly signed in with the password, deletes -- expect one row of feedback, then A gone'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', format('{"sub":"aaaaaaaa-0000-0000-0000-000000000001","amr":[{"method":"password","timestamp":%s}]}', extract(epoch from now())::bigint), true);
select public.delete_my_account('missing_feature', 'no rigid-flex'); commit;
select reason, feedback from public.account_deletion_feedback;
select count(*) as a_users from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '### 6 everything under A is gone; B and B''s project are not -- expect 0, 0, 0, then 1'
select count(*) as a_projects from public.projects where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select count(*) as b_membership_in_a from public.project_members where project_uid = '12345678-1234-1234-1234-123456789abc';
select count(*) as a_membership_in_b from public.project_members where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select count(*) as b_projects from public.projects where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

\echo '### 7 nobody reads the feedback through the API -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as n from public.account_deletion_feedback; commit;
