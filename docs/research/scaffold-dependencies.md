# Scaffold dependency evidence

Date: 2026-11-06. Delegated researcher: `gpt-6-luna`.

This records documentation/registry evidence, not installation, browser or provider success. Actual installed versions and commands belong in the workflow checklist and application lockfiles.

| Package | Registry evidence | Compatibility |
| --- | --- | --- |
| Angular core | 21.2.26 | Node 24.22.1 fits the Angular 21 Node range |
| Material/CDK | 21.2.14 | Material requires matching CDK; supports Angular 21 |
| `@ai-sdk/angular` | 3.0.163 | Angular >=16; use the matching AI SDK 7 line |
| `ai` | 7.0.163 | Node >=22 |
| `@openrouter/ai-sdk-provider` | 3.1.0 | AI SDK ^7; Zod ^3.25.76 or ^4.1.8; Node >=22; ESM |
| Next.js | 16.4.5 | Node >=20.9 |

Research used Context7 library resolution and queries first. Registry metadata supplied exact published versions absent from the general documentation. The first default-cache query failed with EPERM; workspace-local cache succeeded. No secrets were inspected.

The selected [official Angular starter](https://github.com/vercel/ai/tree/6737c7721b10ce489e21efff43a4acf9c8ca7f04/examples/angular) remains the chat provenance. Its workspace dependencies cannot be copied into a standalone manifest. The generated Angular shell will retain its transport/message pattern with Material controls; the Express sample is adapted to Next.js rather than run as another server.

Sources: [Angular CLI](https://angular.dev/cli/new), [Material schematics](https://github.com/angular/components/blob/main/guides/schematics.md), [Next CLI](https://nextjs.org/docs/app/api-reference/cli/create-next-app), [OpenRouter provider manifest](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/package.json), and npm registry metadata collected by the researcher. Released package compatibility must still be checked through installation and builds.
