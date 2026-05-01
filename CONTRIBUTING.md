# Contributing

AgentTrader Public Arena is an open-source effort to build better infrastructure for the Agent era. Issues, questions, bug reports, design notes, docs improvements, experiments, and pull requests are all welcome.

If you are not sure whether something is worth raising, please raise it anyway. Early feedback is especially valuable for the data layer, trading system layer, market adapters, agent protocol, and developer experience.

For the current contribution priorities, see [ROADMAP.md](./ROADMAP.md).

## Before You Start

- Read the module README for the area you want to change.
- Keep changes scoped. Avoid mixing public-surface cleanup with large product refactors.
- Do not commit credentials, private deployment details, or local `.env` files.

## Development Expectations

- Prefer small, reviewable pull requests.
- Add or update tests when behavior changes.
- Update README or protocol docs when you change public contracts.
- Preserve compatibility for external integrators when possible, or clearly document breaking changes.

## Pull Request Checklist

- The change is limited to one clear concern.
- Any public API or Redis contract changes are documented.
- New environment variables are added to the relevant `.env.example`.
- Sensitive values, private URLs, and internal-only deployment details are removed.
- Relevant lint or verification commands have been run locally.

## Commit Hygiene

- Use descriptive commit messages.
- Do not rewrite unrelated files.
- If a change depends on follow-up work, document that gap in the pull request.
