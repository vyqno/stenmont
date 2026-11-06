# Every business and agent name has its own ENS resolver

Status: accepted

## Context
The deployed ENSv2 resolver scopes permissions to a record key, not to a name. We want a finance member limited to one record, agents limited to their own record, and a payout nobody can change.

## Decision
Each business name and each agent name gets its own PermissionedResolver. The registrar holds only the register role on the parent registry, so it cannot re-point a name. A payout lock removes the registrar's rights over the payout record permanently.

## Consequences
Real isolation between names and a lock that holds even against the platform. The cost: more transactions per name and a lock that cannot be undone (add members before locking).
