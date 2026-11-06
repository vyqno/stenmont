# SQL migration authority

Wrangler's numbered `.sql` files in `services/api/migrations/` are the migration authority for this build. Wrangler applies them in filename order and records applied filenames in the target D1 database. Number gaps are intentional reservations, not missing schema. API tests also apply every SQL file, sorted, to a fresh SQLite database; `test/migrations.test.ts` checks the append-only audit trigger and key uniqueness.

The Drizzle schema describes queries. `migrations/meta/_journal.json` and snapshots currently end at 0016; later migrations were authored as reviewed SQL. They are not a complete drizzle-kit generation baseline. Do not run `db:generate` against that stale snapshot and apply its result: it can propose tables/columns already created by later SQL.

Decision: retain the reviewed append-only SQL history and document this state. Do not fabricate historical snapshots, rewrite applied SQL, or regenerate the journal as though drizzle-kit authored it. Before resuming automatic generation, create a separate reviewed baseline from a disposable database containing all SQL migrations, compare it with `src/db/schema.ts`, and prove the next generated migration has no duplicate DDL. That baseline work has not been run here.

Local-only application from repository root:

```bash
pnpm --filter @stenmont/api db:migrate:local
```

The lead lists and applies remote migrations on staging before the matching API release. Production migrations are not authorized. Neither a schema edit nor an updated journal alone changes a remote database.
