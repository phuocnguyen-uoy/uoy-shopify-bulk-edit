# Shopify Bulk Editor architecture

This repository starts from Shopify's official React Router app template, Shopify's current recommended path.

## Tenant boundary

The canonical tenant key is the normalized *.myshopify.com domain. All task, run, change, billing, saved-task, and webhook data belongs to one shop. New task data access should go through tenantDb; global task queries are forbidden.

## Task lifecycle and safe undo

Task stores reusable intent. TaskRun stores an execution. TaskChange is an immutable per-resource before/after journal. One-time tasks freeze IDs at preview; recurring tasks resolve filters per occurrence. Undo writes recorded before values only after comparing current Shopify state with the recorded after values. Conflicts are skipped unless the merchant explicitly forces overwrite.

## Runtime split

- Web: embedded Admin UI, authentication, validation, preview requests, billing gates.
- Worker: bulk queries, JSONL generation, bulk mutations, reconciliation, revert.
- Scheduler: atomically claims due jobs and enqueues idempotent runs.
- PostgreSQL: tenants, tasks, runs, change journal, billing, webhook receipts.

## MVP

Products and variants; common filters; text, tags, status, price, SKU/barcode, inventory, selected metafields; preview, run, progress, history, undo. Collections, images, option topology, Google Shopping, recurring schedules, Flow, and billing UI are later milestones.
