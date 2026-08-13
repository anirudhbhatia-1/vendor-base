## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Project documentation contract

Before product implementation, read `README.md`, `prd.md`, `architecture.md`, `design.md`, `workflow.md`, `implementation.md`, and `rules.md`. Use the authority table in `implementation.md` §1, execute work through its vertical slices, and stop when a money, privacy, safety, legal, or provider gate is unresolved. Keep product requirements, architecture, design, workflow, implementation contracts, tests, and examples synchronized in the same change.
