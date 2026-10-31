# Changelog

## 0.3.1 — 2026-10-31

### Security

- Removed all screenshot/image assets from the published repository before re-upload.
- Recreated the public repository with no image blobs and no personal account screenshots.
- Set the commit author to the project identity rather than a personal email.

## 0.3.0 — 2026-10-30

### Changed

- Renamed the public package and plugin to **dsh-account-model-hub** to reflect the combined account + model scope. The legacy credential path `~/.dsh/plugins/account-hub/` is retained so existing logins keep working.
- Moved the local-credential erase action into a collapsed section at the bottom of the Accounts view; it no longer appears as a prominent action on page open.
- Removed the upstream bundled Google Antigravity OAuth client ID/secret. Antigravity now requires `antigravity.clientId` / `ANTIGRAVITY_CLIENT_ID` (secret optional).
- Removed the upstream npm trusted-publishing workflow from the fork; releases are tagged and served through the self-hosted market index.

### Added

- Remaining-quota display, credential security card, logout-all, pool cooldown/active state, provider error classes.

## 0.2.0 — 2026-10-29

### Added

- Account/Model settings split into two views: **Accounts & Quota** and **Model settings**.
- Model-only editor: visibility, default reasoning effort, display names and context without account fields.
- Remaining-quota display in Settings, matching the sidebar footer and bar-fill semantics.
- Local credential security card and **Log out all & erase local credentials**.
- Pool state in Settings: active account badge, cooldown reason and cooldown expiry.
- Actionable provider error classes (auth, rate limit, network, server).
- Optional `mediaTools: false` boundary for image/video/X search tools.
- `ARCHITECTURE.md`, `CREDITS.md`, `RELEASE-CHECKLIST.md`.
- DSH `0.2.1-rc.5` compatibility for the plugin host and model-settings interactions.

### Changed

- Settings navigation is now **Accounts & Models**.
- Add-account primary action is consistently labelled **Add account** for all OAuth providers; browser authorization is the tooltip, not the button label.
- Copilot gets a device-flow-specific hint.
- `README` now documents Windows/macOS/Linux support expectations.

### Fixed

- Settings quota bars were using used percentages instead of remaining percentages.
- Claude and GPT displayed different add-account labels for the same action.
- DSH rc.5 peer/runtime mismatch blocked the whole bundle; peer ranges now include rc.4/rc.5.
- Codex payload/state-runtime mismatch (documented in `CODEX-SUBAGENT-FIX-20261029.md`).
