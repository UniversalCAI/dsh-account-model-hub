# Internal module boundaries

This document describes the intended ownership inside the single
`dsh-account-model-hub` package. The package is deliberately **not split**; the
boundaries exist so a future extraction remains possible.

## Modules

| Area | Location | Owns | Must not own |
|---|---|---|---|
| Auth | `src/auth/` | OAuth/device/API-key flows, token persistence/refresh, credential imports, account labels | UI layout, model visibility |
| Providers/pool | `src/providers/` | provider adapters/translators, model catalogs, pools, quota/cooldown, rate-limit wait | token storage format, settings UI |
| Model settings | `src/provider-settings.ts`, `src/client/ProviderModelEditor.tsx`, `ProviderAccountManager.tsx` | model visibility, default effort, display names, context, per-provider tools switches | OAuth/account login |
| Media tools (optional) | `src/tools/` | `image_generate`, `video_generate`, `x_search` | account routing or auth state |
| Client shell | `src/client/` | settings section, quota footer/badge, tool views, locale | credential persistence |
| HTTP/proxy | `src/http.ts` | outbound fetch, proxy config, network diagnostics | provider-specific auth policy |

## Dependency rules

- `src/client/` talks to the host only through `/subscriptions-auth` RPC.
- Auth is the only module that reads/writes `~/.dsh/plugins/account-hub/auth.json`.
- Providers receive token managers through injection; they do not import UI.
- Model settings consume provider catalog/settings RPCs; they do not own account data.
- Media tools are optional: set `mediaTools: false` in plugin config to keep accounts, quota, pools and model settings while registering no media tools.
- The settings UI and the footer/badge are separate consumers of the same usage RPC data.

## Config boundary

`mediaTools: false` is the first explicit feature boundary. Additional modules
should follow the same pattern: default-on only when required for core account
use, with a documented config switch and no client-side hard dependency.
