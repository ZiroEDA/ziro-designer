\pset pager off
\set QUIET on
delete from public.project_versions; delete from public.projects;
delete from storage.objects where bucket_id='projects';
insert into auth.users (id, instance_id, aud, role, email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@x.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@x.test')
on conflict do nothing;
insert into storage.buckets(id,name,public) values ('projects','projects',false) on conflict do nothing;
insert into public.projects (id, user_id, name, files)
values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Board A',
        '[{"name":"board.kicad_pcb","hash":"HASH1","size":10}]'::jsonb);
insert into storage.objects(bucket_id,name) values
  ('projects','aaaaaaaa-0000-0000-0000-000000000001/blobs/HA/HASH1'),
  ('projects','aaaaaaaa-0000-0000-0000-000000000001/blobs/HA/HASH2');
\set QUIET off

\echo '### 1 blob index built from manifest -- expect HASH1 only'
select hash from public.project_blobs;

\echo '### 2 B cannot see A''s project -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as n from public.projects; commit;

\echo '### 3 A issues a viewer link -- expect INSERT 0 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.project_invites (token, project_uid, role, created_by)
select '99999999-9999-9999-9999-999999999999', uid, 'viewer','aaaaaaaa-0000-0000-0000-000000000001'
  from public.projects; commit;

\echo '### 4 B redeems -- expect viewer, then sees 1 project'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select role as redeemed from public.redeem_project_invite('99999999-9999-9999-9999-999999999999');
select count(*) as n from public.projects; commit;

\echo '### 5 viewer CANNOT write -- expect null'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('11111111-1111-1111-1111-111111111111','Hijacked',
  '[{"name":"b","hash":"HASH9","size":1}]'::jsonb, 1, (select uid from public.projects)) as viewer_write; commit;

\echo '### 6 viewer sees HASH1 (in the project) but NOT HASH2 -- expect one row'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select regexp_replace(name,'^.*/','') as blob from storage.objects; commit;

\echo '### 7 promote B to editor; B commits -- expect version 2, one bump only'
\set QUIET on
update public.project_members set role='editor' where user_id='bbbbbbbb-0000-0000-0000-000000000002';
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('11111111-1111-1111-1111-111111111111','Edited by B',
  '[{"name":"b","hash":"HASH3","size":11}]'::jsonb, 1, (select uid from public.projects)) as new_version; commit;
select version, name from public.projects;

\echo '### 8 editor CANNOT steal ownership -- expect exception'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.projects set user_id='bbbbbbbb-0000-0000-0000-000000000002'; rollback;

\echo '### 9 editor CANNOT delete the project -- expect DELETE 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
delete from public.projects; rollback;

\echo '### 10 revoked link is refused -- expect exception'
\set QUIET on
update public.project_invites set revoked=true;
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select * from public.redeem_project_invite('99999999-9999-9999-9999-999999999999'); rollback;

\echo '### 11 roles -- expect A=owner, B=editor'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.project_role_of((select uid from public.projects)) as a_role; commit;
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.project_role_of((select uid from public.projects)) as b_role; commit;

\echo '### 12 B can leave; then sees nothing -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
delete from public.project_members where user_id='bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as n from public.projects; commit;

\echo '### 13 link sharing: off by default -- expect exception'
\set QUIET on
insert into auth.users (id, instance_id, aud, role, email) values
 ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@x.test')
on conflict do nothing;
-- Captured HERE, as superuser. Reading it inside the stranger's transaction
-- reads it under row-level security, which returns nothing -- so the function
-- would be handed a null and refuse for that reason instead of the one under
-- test. That is a check that cannot fail, and it looked green.
select uid as puid from public.projects limit 1
\gset
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select public.join_project_by_link(:'puid'::uuid); rollback;

\echo '### 14 a link-shared project is NOT in a stranger''s list until opened -- expect 0'
\set QUIET on
update public.projects set link_access = 'viewer';
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select count(*) as n from public.projects; commit;

\echo '### 15 following the link grants viewer, and then it appears -- expect viewer, then 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select public.join_project_by_link(:'puid'::uuid) as granted; commit;
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select count(*) as n from public.projects; commit;

\echo '### 16 a viewer link never demotes an existing editor -- expect editor'
\set QUIET on
update public.project_members set role='editor' where user_id='cccccccc-0000-0000-0000-000000000003';
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select public.join_project_by_link(:'puid'::uuid) as granted; commit;

\echo '### 17 the owner following their own link gets no membership row -- expect owner, 0 rows'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.join_project_by_link(:'puid'::uuid) as granted; commit;
select count(*) as owner_member_rows from public.project_members
 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo '### 18 a link cannot grant ownership -- expect exception'
update public.projects set link_access = 'owner';

\echo '### 19 an EDITOR cannot change how a project is shared -- expect exception'
\set QUIET on
update public.projects set link_access = 'viewer';
-- B is put back on the project as an editor FIRST. Test 12 had them leave, and
-- without this the update below matches no row they can see -- so the check
-- reports "UPDATE 0" and passes while proving nothing at all about editors.
insert into public.project_members (project_uid, user_id, role)
select uid,'bbbbbbbb-0000-0000-0000-000000000002','editor' from public.projects
on conflict on constraint project_members_pkey do update set role='editor';
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.projects set link_access = 'editor'; rollback;

\echo '### 20 ...and the owner can -- expect UPDATE 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.projects set link_access = 'editor'; commit;

\echo '### 21 an editor may still edit the project itself -- expect UPDATE 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.projects set name = 'Renamed by the editor'; commit;
select name from public.projects;

-- Three by now, not two: A owns it, B was made an editor in 19 and C joined by
-- link in 15 and was promoted in 21. The owner comes first because ownership is
-- the projects row and carries its created_at.
\echo '### 22 the roster names the owner and every member -- expect a@owner, c@editor, b@editor'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select email, role from public.project_roster(:'puid'::uuid); commit;

\echo '### 23 a member sees the same roster -- expect the same three'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select email, role from public.project_roster(:'puid'::uuid); commit;

\echo '### 24 somebody not on the project sees nothing -- expect exception'
\set QUIET on
delete from public.project_members where user_id = 'cccccccc-0000-0000-0000-000000000003';
update public.projects set link_access = null;
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select email from public.project_roster(:'puid'::uuid); rollback;

\echo '### 25 ...and cannot enumerate accounts with a uid they invented -- expect exception'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
select email from public.project_roster('00000000-0000-0000-0000-000000000000'::uuid); rollback;

-- 26 and 27 are the regression for the bug that shipped: `commit_project`'s
-- first-commit branch ends with `returning version`, Postgres applies the
-- SELECT policy to the row a statement returns, and that policy asked a
-- `stable` function about `projects` -- which reads the pre-insert snapshot and
-- cannot see the row being inserted. Every first push of a new project failed.
-- The suite missed it because it only ever committed to projects that already
-- existed.
\echo '### 26 a first commit returns its version -- expect 1, not an RLS error'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('77777777-7777-7777-7777-777777777777','B own board',
  '[{"name":"b.kicad_sch","hash":"HB","size":3}]'::jsonb, 0) as first_commit;
commit;

\echo '### 27 ...and can commit to it again -- expect 2'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('77777777-7777-7777-7777-777777777777','B own board v2',
  '[{"name":"b.kicad_sch","hash":"HB2","size":4}]'::jsonb, 1) as second_commit;
commit;

\echo '### 28 a client that mints its own uid gets exactly that uid -- expect 1, then the uid back'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('88888888-8888-8888-8888-888888888888','minted',
  '[{"name":"m","hash":"HM","size":2}]'::jsonb, 0,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd') as first_commit;
commit;
select uid, id, name from public.projects where uid = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

\echo '### 29 two accounts may hold the SAME local id now -- expect 1'
-- The fixed user-data folder uuids are shared by every account on purpose, and
-- that used to need `(user_id, id)` as the key. With `uid` as the key it is
-- simply not a question any more.
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project('88888888-8888-8888-8888-888888888888','same local id, other account',
  '[{"name":"m","hash":"HM","size":2}]'::jsonb, 0,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') as also_committed;
commit;
select count(*) as rows_with_that_local_id from public.projects
 where id = '88888888-8888-8888-8888-888888888888';

\echo '### 30 a re-push of a uid already there is refused, not duplicated -- expect null'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('88888888-8888-8888-8888-888888888888','again',
  '[{"name":"m","hash":"HM","size":2}]'::jsonb, 0,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd') as second_first_commit;
commit;

\echo '### 31 an old client (no uid) re-pushing a project it already has gets null, not a duplicate'
-- The regression this guards: with the conflict target moved to `uid`, a first
-- commit from a client that mints nothing arrives with a fresh uid, conflicts
-- with nothing, and would insert a SECOND copy of a project the account already
-- has. `(user_id, id)` stays unique for exactly that caller.
\set QUIET on
select count(*) as before from public.projects
 where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
\gset
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public.commit_project('77777777-7777-7777-7777-777777777777','old client, no uid',
  '[{"name":"b","hash":"HB","size":3}]'::jsonb, 0) as refused;
commit;
select :before::int = count(*)::int as row_count_unchanged from public.projects
 where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';

\echo '### 32 turning link sharing on does NOT move the version'
-- The bug this is the regression for: `setLinkAccess` writes one metadata
-- column, the old trigger bumped the version anyway, and every other device
-- read that as "the project moved" -- pulled, found local edits, and forked the
-- project aside as "(local copy)". Turning sharing on spawned duplicates.
\set QUIET on
select version as v_before from public.projects where uid = :'puid'::uuid
\gset
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.projects set link_access = 'viewer' where uid = :'puid'::uuid; commit;
select :v_before::bigint = version as version_unchanged from public.projects
 where uid = :'puid'::uuid;

\echo '### 33 committing different files DOES move it -- expect true'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project(null,'Edited by A',
  '[{"name":"b","hash":"HNEW","size":9}]'::jsonb, :v_before::bigint, :'puid'::uuid) is not null
  as committed;
commit;
select version > :v_before::bigint as version_moved from public.projects
 where uid = :'puid'::uuid;

\echo '### 34 a rename moves it too, or no other device would learn the name'
\set QUIET on
select version as v_named from public.projects where uid = :'puid'::uuid
\gset
\set QUIET off
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project(null,'Renamed by A',
  '[{"name":"b","hash":"HNEW","size":9}]'::jsonb, :v_named::bigint, :'puid'::uuid) is not null
  as renamed;
commit;
select version > :v_named::bigint as version_moved_for_rename from public.projects
 where uid = :'puid'::uuid;
