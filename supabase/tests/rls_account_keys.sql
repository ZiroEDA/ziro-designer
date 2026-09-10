\pset pager off
\set QUIET on
-- The wrapped keys of an account: yours in every direction, and the public key
-- readable by anyone signed in. See 20260910120000_account_keys.sql.
delete from public.account_keys;
insert into auth.users (id, instance_id, aud, role, email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@x.test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@x.test')
on conflict do nothing;
\set QUIET off

\echo '### K1 A stores their own keys -- expect INSERT 0 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.account_keys (user_id, kdf, public_key, enc_master_key_by_password, enc_master_key_by_recovery, enc_private_key, enc_recovery_key_by_master)
values ('aaaaaaaa-0000-0000-0000-000000000001', '{"name":"argon2id","salt":"c2FsdA==","opsLimit":4,"memLimitKiB":1048576}', 'PUBKEY_A', 'wrapA1', 'wrapA2', 'wrapA3', 'wrapA4'); commit;

\echo '### K2 B cannot see A''s row -- expect 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select count(*) as n from public.account_keys; commit;

\echo '### K3 B cannot write a row for A -- expect ERROR row-level security'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.account_keys (user_id, kdf, public_key, enc_master_key_by_password, enc_master_key_by_recovery, enc_private_key, enc_recovery_key_by_master)
values ('aaaaaaaa-0000-0000-0000-000000000001', '{}', 'EVIL', 'x', 'x', 'x', 'x'); rollback;

\echo '### K4 B cannot overwrite A''s wrap either -- expect UPDATE 0'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.account_keys set enc_master_key_by_password = 'EVIL' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'; commit;

\echo '### K5 B, signed in, reads A''s PUBLIC key and nothing else -- expect PUBKEY_A'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'bbbbbbbb-0000-0000-0000-000000000002';
select public_key from public.public_keys_of(array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]); commit;

\echo '### K6 anon may not call it -- expect ERROR permission denied'
begin; set local role anon;
select public_key from public.public_keys_of(array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[]); rollback;

\echo '### K7 A re-wraps under a new password; updated_at moves -- expect t'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_sleep(0.01);
update public.account_keys set enc_master_key_by_password = 'wrapA1-new', kdf = '{"name":"argon2id","salt":"bmV3","opsLimit":8,"memLimitKiB":524288}' where user_id = auth.uid();
select updated_at > created_at as bumped from public.account_keys where user_id = auth.uid(); commit;

\echo '### K8 nobody deletes keys, not even their owner -- expect DELETE 0, then 1'
begin; set local role authenticated; set local "request.jwt.claim.sub" = 'aaaaaaaa-0000-0000-0000-000000000001';
delete from public.account_keys where user_id = auth.uid();
select count(*) as n from public.account_keys; commit;
