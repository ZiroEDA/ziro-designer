\pset pager off
\set QUIET on
-- Project keys: the owner writes a sealed key for a member, each reads only
-- their own, and enc_meta rides through commit_project.
delete from public.project_keys;
insert into auth.users (id, instance_id, aud, role, email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@x.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@x.test'),
 ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@x.test')
on conflict do nothing;
\set QUIET off

\echo '### P1 A commits an encrypted project: opaque files, enc_meta -- expect 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project('33333333-3333-4333-8333-333333333333', '', '[{"hash":"0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d","size":77}]'::jsonb, 0, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'ENCMETA-v1') as first_commit; commit;

\echo '### P2 the row holds enc_meta and the blob index took the opaque id -- expect ENCMETA-v1, then 1'
select enc_meta from public.projects where uid = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
select count(*) as n from public.project_blobs where project_uid = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0' and hash like '0badf00d%';

\echo '### P3 A wraps the key for themselves -- expect INSERT 0 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.project_keys (project_uid, user_id, enc_key, how) values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'aaaaaaaa-0000-0000-0000-000000000001', 'wrapA', 'master'); commit;

\echo '### P4 A, the owner, seals the key for B -- expect INSERT 0 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.project_keys (project_uid, user_id, enc_key, how) values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'bbbbbbbb-0000-0000-0000-000000000002', 'sealedB', 'sealed'); commit;

\echo '### P5 C, not the owner, cannot seal a key for B -- expect ERROR row-level security'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'cccccccc-0000-0000-0000-000000000003';
insert into public.project_keys (project_uid, user_id, enc_key, how) values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'bbbbbbbb-0000-0000-0000-000000000002', 'EVIL', 'sealed'); rollback;

\echo '### P6 an owner may not write a MASTER-wrapped row for someone else -- expect ERROR row-level security'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.project_keys (project_uid, user_id, enc_key, how) values ('f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'cccccccc-0000-0000-0000-000000000003', 'x', 'master'); rollback;

\echo '### P7 B reads exactly their own key -- expect sealedB'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select enc_key from public.project_keys; commit;

\echo '### P8 B re-wraps it under their own master key -- expect UPDATE 1, then master'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.project_keys set enc_key = 'wrapB', how = 'master' where user_id = auth.uid();
select how from public.project_keys where user_id = auth.uid(); commit;

\echo '### P9 B cannot take A''s key away; A can take B''s -- expect DELETE 0, then DELETE 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
delete from public.project_keys where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'; commit;
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.project_keys where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'; commit;

\echo '### P10 a second commit rotates enc_meta with the version -- expect 2, then ENCMETA-v2'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project('33333333-3333-4333-8333-333333333333', '', '[{"hash":"0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d","size":77}]'::jsonb, 1, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0', 'ENCMETA-v2') as second_commit;
select enc_meta from public.projects where uid = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'; commit;

\echo '### P11 the old five-argument call still resolves -- expect 3'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.commit_project('33333333-3333-4333-8333-333333333333', 'plain', '[{"hash":"0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d0badf00d","size":77}]'::jsonb, 2, 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0') as third_commit; commit;
