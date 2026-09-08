# Job boundary

The web process validates requests and queues work. A separate worker bulk-queries matching resources, records frozen IDs and exact before/after values, launches GraphQL bulk mutations, reconciles results, and reverts after conflict checks.

Every job payload must contain shopDomain; every database lookup must scope by it.
