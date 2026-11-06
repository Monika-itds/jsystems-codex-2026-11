# App

The approved Hardware Service Decision Copilot uses `../web/` for Angular Material and `../api/` for the Next.js backend. This folder is the original course placeholder; the checklist below is historical scaffolding guidance. Follow `../docs/plans/hardware-assessment-chat-implementation-plan.md` and `../docs/workflow-checklist.md` for current scope and verification status.

This folder will contain AI Chat, built during the course with TypeScript, React and the Vercel AI SDK on the server and client. It currently contains no application or package manifest. Participants may choose their own idea through the same process.

## How to start

The app is scaffolded live during the course through a structured process:

1. **Research** - use agents to research and validate the project idea
2. **PRD** - generate a Product Requirements Document (`../docs/PRD.md`)
3. **ADR** - generate Architecture Decision Records (`../docs/ADR/`) to choose the tech stack
4. **Scaffold** - choose an AI SDK starter compatible with the ADR (Next.js or Vite with a TypeScript backend)
5. **Implement** - build features with agents using TDD

## Checklist

Use this checklist during scaffolding. Some items are provided by the boilerplate (e.g. `create-next-app` ships `tsconfig.json`, ESLint config). Others you add explicitly.

### Project setup
- [ ] Choose framework (Next.js or Vite with Hono/Express for the group project) - record in ADR
- [ ] Initialize project (e.g. `npx create-next-app@latest` or equivalent)
- [ ] TypeScript config (`tsconfig.json`)
- [ ] Package manager chosen (npm / pnpm / bun)

### Code quality
- [ ] ESLint config (`eslint.config.js`)
- [ ] Prettier config (`.prettierrc`, `.prettierignore`)
- [ ] `.editorconfig` (optional but recommended)

### Testing
- [ ] Unit/integration test runner (Vitest / Jest)
- [ ] E2E test runner (Playwright)
- [ ] Test setup file (e.g. `test-setup.ts` with Testing Library matchers)

### Environment
- [ ] `.env.example` with required env vars (API keys, ports)
- [ ] `.env` created locally (gitignored)
- [ ] `.gitignore` (node_modules, .env, build output, etc.)

### AI integration
- [ ] Vercel AI SDK (`ai` on the server, `@ai-sdk/react` on the client)
- [ ] API route / endpoint for chat
- [ ] Model configuration (provider, model name, API key from env)
- [ ] Compatible SDK/provider versions recorded in the lockfile
- [ ] Synthetic AI SDK mock model for unit/integration tests without an API key

### Design
- [ ] Design tokens (`../assets/design-tokens.json`)
- [ ] Tailwind CSS or equivalent
- [ ] Logo and favicon (`../assets/`)
- [ ] Design system doc (`../docs/design-guidelines.md`)

### Documentation
- [ ] PRD (`../docs/PRD.md`)
- [ ] ADRs (`../docs/ADR/`)
- [ ] AGENTS.md in `app/` with stack-specific rules

## Notes

- Don't create config files manually if the boilerplate provides them - it leads to conflicts.
- Let the agent research and recommend the right boilerplate based on the ADR decisions.
- Run installation, test and startup commands here once `package.json` exists; inspect its scripts first.
- Keep this folder organized: separate routes, components, domain logic, and tests.
