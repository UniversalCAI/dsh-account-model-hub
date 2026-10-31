# Release checklist

## Scope and compatibility

- [ ] `package.json` version is final; tag matches version.
- [ ] Declared DSH peer ranges include the tested runtime (`0.2.1-rc.5` today).
- [ ] Plugin loads in a clean profile with pluginManager error `null`.
- [ ] `dsh-account-model-hub` and `dsh-advisor-panel` package versions match their changelogs.
- [ ] Windows smoke test passed.
- [ ] macOS smoke test passed (see platform section in README).
- [ ] Linux smoke test passed if claimed.

## Install / upgrade / uninstall

- [ ] Fresh install from the published package / git source.
- [ ] Upgrade from the previous minor release preserves accounts and model settings.
- [ ] Uninstall removes the settings section without leaving the UI broken.
- [ ] Reinstall after uninstall can read the existing auth store.
- [ ] `pnpm build` and `pnpm test --test-concurrency=1` pass from a clean checkout.

## Provider authentication

For each provider claimed as supported (Codex, Claude, Grok, Copilot, Antigravity, OpenCode Go):

- [ ] First login succeeds (OAuth, device code, or API key as appropriate).
- [ ] Cancel and retry work.
- [ ] A second account can be added; browser/account switching instructions are correct.
- [ ] Per-account logout removes only that account.
- [ ] Re-login of the same identity updates in place.
- [ ] Expired token refresh succeeds.
- [ ] Copilot device-code expiry/cancel path is understandable.
- [ ] Claude Code import works on macOS (Keychain) and file fallback where applicable.

## Quota and pool

- [ ] Settings usage cards show **remaining** percentages and bar fill.
- [ ] Footer quota board shows the same remaining numbers.
- [ ] A used-up window displays 0% remaining.
- [ ] Two accounts can be pooled and the active account is visible.
- [ ] Simulated 429/quota failure switches accounts and shows cooldown reason/until.
- [ ] All accounts unavailable produces an actionable error, not an infinite retry.
- [ ] Manual pool pin and reset-to-automatic behavior work.

## Model settings

- [ ] Model visibility changes are reflected in the model picker.
- [ ] Default reasoning effort persists after restart.
- [ ] Display name and context settings persist.
- [ ] Model-only view opens without account-management fields.
- [ ] Hidden models remain usable by existing sessions (documented behavior).

## Security and privacy

- [ ] Auth store path and `0600` permissions are documented.
- [ ] “Log out all & erase local credentials” confirms and removes every account.
- [ ] Logout-all also clears manual pool pins.
- [ ] No token, refresh token, device code, or complete email appears in logs or diagnostics.
- [ ] README states that local erase does not revoke provider-side sessions.
- [ ] Terms-of-service/provider-risk warning is present.

## Media tools (optional)

- [ ] `mediaTools: false` keeps accounts/quota/model settings and registers no image/video/X tools.
- [ ] With a Codex/Grok login, the intended tools appear; unsupported tools are absent.
- [ ] Tool changes apply only to sessions created after saving.

## Release content

- [ ] README quick start, screenshots, platform matrix, FAQ.
- [ ] `CREDITS.md` and `NOTICE` included in the package.
- [ ] `ARCHITECTURE.md` matches the shipped module boundaries.
- [ ] CHANGELOG and SemVer updated.
- [ ] `package.json` repository/homepage point to the intended fork.
- [ ] npm provenance / release workflow and license reviewed.
