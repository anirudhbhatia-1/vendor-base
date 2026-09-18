# Claude Operating Rules & Project Guidelines

## 1. Core Architecture & Quality Invariants (Work Perfectly)

- **Language & Types:** Strict TypeScript. Never use `any` unless absolutely forced. Use domain types from `@neighbourhood-store/domain-types` (e.g. `UuidV7`, `RequestContext`, `MoneyMinor`).
- **Database & Schema:** PostgreSQL + PostGIS. The paired, reviewed SQL migrations in `database/migrations/` are the only schema authority; the runtime is raw SQL through `pg`. `database/schema.ts` is a Drizzle mirror that `verify-static.ts` ratchets (new tables must be declared there; 78 older ones are recorded debt) — it is not consulted at runtime, and whether to finish or remove it is an open owner decision (tech-debt item 7). Direct `drizzle-kit push` is strictly prohibited.
- **Financial Invariants:** Always use integer minor units (paise/INR). Money movements must use append-only double-entry ledger records. Floating-point money math is strictly prohibited.
- **Concurrency & Messaging:** Always enforce idempotency keys, aggregate version transitions, and transactional outbox patterns (`outbox_events`).
- **Authorization:** Enforce server-side role and capability checks using `authorization.guard.ts`. Hiding UI buttons is never considered security.
- **Pre-flight Code Verification:** Before editing any file, inspect the target file and its nearest interfaces/types to ensure zero type errors or broken imports. Run boundary checks (`pnpm run check:boundaries`) when adding cross-module imports.

---

## 2. Token Conservation & Efficiency Rules (Zero Waste)

- **Targeted Reading Over Bulk Loading:**
  - Do NOT read all large reference documents (`prd.md`, `architecture.md`, `phases.md`, `schema.ts`) in full on every turn.
  - Read ONLY the specific sections, lines, or files directly needed for the active task using line ranges (`StartLine`/`EndLine`) or exact grep search.
- **Never Re-read Conversation Logs or Transcripts:**
  - Do NOT search, grep, or read historical transcripts (`transcript.jsonl`, `transcript_full.jsonl`, `.system_generated/logs/`) unless explicitly requested by the user for log debugging.
- **Search Hygiene:**
  - Always exclude `node_modules`, `.next`, `.git`, `dist`, `out`, and `.pnpm-store` from search queries and file listings.
- **Concise Communication:**
  - Be direct and concise. Avoid re-summarizing previous conversation history or restating tool actions.
  - When presenting code changes, output targeted snippets or diffs rather than dumping entire multi-hundred-line files.

---

## 3. Skill Routing

When the user's request matches an available skill, invoke it via the Skill tool. Key routing rules:
- Product ideas/brainstorming → `/office-hours`
- Strategy/scope → `/plan-ceo-review`
- Architecture → `/plan-eng-review`
- Design system/plan review → `/design-consultation` or `/plan-design-review`
- Full review pipeline → `/autoplan`
- Bugs/errors → `/investigate`
- QA/testing site behavior → `/qa` or `/qa-only`
- Code review/diff check → `/review`
- Visual polish → `/design-review`
- Ship/deploy/PR → `/ship` or `/land-and-deploy`
- Save progress → `/context-save`
- Resume context → `/context-restore`
- Author a backlog-ready spec/issue → `/spec`
