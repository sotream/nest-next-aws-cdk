# 0004. Database TLS: `sslmode=no-verify`

- Status: proposed
- Date: 2026-10-30

## Context

The starter builds its database connection from `DATABASE_URL` only. Node does not trust the Amazon RDS
certificate authority by default, and `sslmode=require` behaves like `verify-full` in `pg` 8, so it would fail
with a self-signed certificate error unless the RDS CA bundle is added to the image. The image cannot be
changed here. [nest-next-aws-terraform ADR 0008](https://github.com/sotream/nest-next-aws-terraform/blob/main/docs/adr/0008-database-tls.md)
reached the same conclusion.

## Decision

- The RDS parameter `rds.force_ssl` is `1`: every connection must use TLS.
- `DATABASE_URL` ends in `?sslmode=no-verify`: the connection is encrypted but the server certificate is not
  checked.

## Consequences

- Traffic between tasks and the database is encrypted but not authenticated. Private subnets and security
  groups are the control against impersonation inside the VPC.
- Upgrade path: put the RDS CA bundle into the starter's image, set `NODE_EXTRA_CA_CERTS`, and switch the URL
  to `verify-full`.
- Status is `proposed` because it was derived from reading source and has not been tried against a real RDS
  instance.
