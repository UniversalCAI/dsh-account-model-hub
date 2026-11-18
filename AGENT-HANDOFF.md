# Agent handoff checklist

This file is for an agent or maintainer taking over this repository on a fresh
machine. It separates the automatable install/build work from the steps that
require the human account owner.

## 1. Prerequisites

- DSH `0.2.2-rc.1`, `0.2.2-rc.2`, or `0.2.2-rc.3` for the current `0.3.4`
  release. Other DSH versions are rejected by the load-time peer check.
- Node.js 24.9+ (the DSH runtime already provides this).
- Network access to the DSH profile's package registry and GitHub.
- A DSH profile in which plugins may be installed.

## 2. Install

### From the GitHub source (normal agent path)

```sh
dsh plugin --profile web add github:UniversalCAI/dsh-account-model-hub
```

The repository intentionally does **not** commit `lib/`; pnpm installs the
source and runs the `prepare` script, which builds `lib/index.js` and
`lib/client.js`. If pnpm reports an unapproved build script, add the printed
package key to the profile's `pnpm-workspace.yaml` and re-run the command:

```yaml
allowBuilds:
  dsh-account-model-hub: true
```

Only approve this for a source you trust; the build script executes package
code at install time.

Restart the DSH process (or re-enable the bundle) after installation.

### From a local checkout

```sh
git clone https://github.com/UniversalCAI/dsh-account-model-hub.git
cd dsh-account-model-hub
pnpm install        # runs prepare and builds lib/
pnpm build
pnpm test --test-concurrency=1
dsh plugin --profile web add ./dsh-account-model-hub
```

A clean clone of this repository has been verified to run `pnpm install`,
produce `lib/index.js` and `lib/client.js`, and pass the test suite; it does not
require a pre-existing `lib/` directory.

## 3. Human-only configuration

An agent must not invent, copy, or commit credentials. After installation:

1. Open the DSH Web UI.
2. Go to **Settings → Accounts & Quota**.
3. Connect only the providers the human owns:
   - Codex / Grok / Antigravity: browser OAuth;
   - Copilot: GitHub device-code flow;
   - Claude: browser OAuth, or import an existing Claude Code login;
   - OpenCode Go: enter the API key in its Add API Key field.
4. Antigravity additionally requires a Google OAuth client supplied by the
   human: configure `antigravity.clientId` and optional
   `antigravity.clientSecret`, or the matching `ANTIGRAVITY_*` environment
   variables. No client identity is bundled.
5. Select a model from the plugin's provider in the model picker and run one
   small request to verify the account.

Account tokens stay in the local host credential store
(`~/.dsh/plugins/account-hub/auth.json`) and are never stored in this
repository.

## 4. Verify the installation

```sh
dsh plugin --profile web list
```

Expected state for the current release:

```text
dsh-account-model-hub 0.3.4
enabled
no incompatible-version or import error
```

Then verify in the UI:

- **Settings → Accounts & Quota** renders the account cards.
- The model picker contains only connected providers.
- A small request succeeds and the usage badge appears when a provider reports
  quota.
- The plugin manager has no `incompatible-version`, `import failed`, or
  activation diagnostics.

## 5. Do not do these

- Do not copy an existing `auth.json`, token file, or browser profile into the
  repository.
- Do not commit `.dsh`, `node_modules`, generated media, or account screenshots.
- Do not bypass DSH's peer-version check by editing the profile or patching
  DSH. Update the plugin's supported ranges and test it against the target
  release instead.
- Do not enable another plugin that registers the same provider routes or
  wraps the same subagent lifecycle without checking for conflicts.
- Do not publish a built package until the source tree and release assets have
  been audited for account data.

## 6. Known limits

- A GitHub install requires the package build toolchain and an allowBuilds
  approval; it is not a prebuilt npm drop-in.
- The plugin is not currently published to npm. The self-hosted market index
  is the supported install path.
- The account OAuth/device-code/API-key steps cannot be completed by an agent
  without the human's interaction.
- Antigravity has no default OAuth client in this repository.
