@AGENTS.md

## Multi-tenant invariants

- Never query tenant-owned Prisma models (Task, TaskRun, TaskChange, SavedTask, WebhookReceipt) through the global client. Use tenantDb with the authenticated session shop.
- Never accept a shop domain from form data as authorization. Derive it from Shopify's authenticated admin session or verified webhook.
- Session.shop intentionally has no foreign key to Shop.domain: Shopify's session adapter persists the OAuth session before the afterAuth hook can upsert Shop during first install. Adding that FK would break first installation.
- Cross-tenant Task to TaskRun to TaskChange links are prevented with composite foreign keys on (shopDomain, id).
- The scheduler and reconciliation worker are the only privileged global task readers. It selects scheduling metadata only; all claims and writes match both shopDomain and task id.
