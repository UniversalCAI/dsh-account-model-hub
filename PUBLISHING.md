# Publishing dsh-account-model-hub to the DSH plugin market

DSH itself ships **no central plugin index**. "Discover" reads a format-1 JSON
index that a user explicitly adds. There are two independent ways to become
discoverable:

1. **Community catalog** (best for discovery): get listed in
   `awesome-dsh-plugin` / `dsh-plugin-catalog`; users add its index URL.
2. **Your own index** (immediate, full control): publish `index.json` and tell
   users to add its URL.

GitHub alone is not enough: the market does not crawl GitHub topics. The topic
and repository metadata are requirements for the community listing.

## 1. Prepare the GitHub repository

Recommended: make the repository root the plugin package (the current
`plugin/` directory). A monorepo also works, but then the entry URL and market
`directory` must point at the subdirectory.

- [ ] Create the GitHub repository and push the source.
- [ ] Add the GitHub topic **`dsh-plugin`**.
- [ ] Set a one-line repository description that matches the plugin's actual behavior.
- [ ] Keep the repository public and actively maintained (the catalog requires
      at least 1 day of repo age).
- [ ] `package.json` must declare both:

```json
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": [] }
  }
}
```

`dsh.client` alone is not installable.

- [ ] Point `repository.url` and `homepage` at **your** GitHub repository.
      The current package metadata still points at the upstream
      `V1ki/dsh-plugin-subscriptions`; update it before publishing.
- [ ] Keep `peerDependencies` for `@deepseek-ai/dsh-*` packages (do not move
      them to `dependencies`).
- [ ] Include `LICENSE`, `NOTICE`, `CREDITS.md`.
- [ ] Check the npm name is available: `npm view dsh-account-model-hub version`
      (currently it is not taken).

## 2. Publish to npm

Prebuilt npm installs are the preferred market source and avoid source-build
approval prompts.

```sh
cd plugin
pnpm build
pnpm test --test-concurrency=1
pnpm publish --access public
```

Then tag the release:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Make sure the published package includes `lib/`, `cordis.patch.yml`, and the
documented files. `package.json` `files` is already configured.

## 3. Get listed in the community catalog

The catalog is the de-facto community index:

- Index URL users add: `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`
- Submission repo: [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

Add **one YAML file** at
`data/plugins/<owner>__<repo>.yml`; do not edit the generated READMEs.

Example for a plugin at the repository root:

```yaml
url: https://github.com/<owner>/<repo>
name: <owner>/<repo>
category: model
description:
  en: Manage Codex, Claude, Grok, Copilot, Antigravity and OpenCode Go accounts, quotas and pools, with model visibility, reasoning defaults and credential controls.
  zh: 管理 Codex、Claude、Grok、Copilot、Antigravity 与 OpenCode Go 账号、额度和账号池，并配置模型可见性、默认推理强度与凭据控制。
icon: https://raw.githubusercontent.com/<owner>/<repo>/main/assets/icon-180.png
```

For a monorepo subdirectory (the current layout), use:

```yaml
url: https://github.com/<owner>/<repo>/tree/main/plugin
name: <owner>/<repo>#plugin
```

and name the file `<owner>__<repo>--plugin.yml`.

Category options include `model`, `usage`, `ui`, `tools` and `security`;
`model` is the closest fit for a provider/account/model-management plugin.
Maintainers may re-file it.

### Community review rules that matter here

- The repo must declare `dsh.bundle`, have the `dsh-plugin` topic, be at least
  1 day old, and contain real working code.
- Only accurate descriptions; no marketing claims.
- One PR adds at most 3 entries.
- A fork can be listed if it is better maintained or genuinely adds something.
  Upstream `V1ki/dsh-plugin-subscriptions` is already in the list, so explain
  the fork's differences in the PR (DSH rc.5 support, account/model two-view
  settings, credential erase, pool state, OpenCode Go, etc.). If a maintainer
  treats it as a duplicate, the self-hosted index route still works.

Once merged, the catalog rebuilds and the npm-served index updates
automatically.

## 4. Or self-host an index immediately

You do not need to wait for the community catalog. Create a static
`index.json` and host it on GitHub Pages, jsDelivr, or any HTTPS static host
with 2xx/no redirect.

Start from `market/index.example.json`, replace `<owner>` and the publish
timestamp, then host:

- `https://<owner>.github.io/<repo>/index.json`, or
- `https://cdn.jsdelivr.net/gh/<owner>/<repo>@v0.2.0/index.json`

Users enable the experimental **Custom plugin indexes** bundle, open
**Plugins → Discover → Add index source**, and paste the URL.

The index must be format `1`; a single npm plugin entry is enough. When you
publish a new version, append it to `versions` (or regenerate the index).

## 5. What users will see

- The card's recommended version is the highest non-prerelease version
  compatible with their DSH build; prereleases are shown when no stable
  version is listed.
- Compatible errors are shown in **Manage index sources**.
- The confirmation dialog shows the npm package or Git commit source;
  nothing is installed without confirmation.
- GitHub-only entries can still install via the command shown, but the market
  index is most useful when an npm version exists.

## 6. Optional: dsh-market

The third-party `dsh-market` plugin mirrors the community catalog. Once the
catalog entry is merged, users of dsh-market can find it there too. It is not
required for DSH's own Discover workflow.

## Pre-release links to include in README

- Install from npm: `dsh plugin --profile web add dsh-account-model-hub`
- Install from git: `dsh plugin --profile web add github:<owner>/<repo>`
- Market index: your `index.json` URL
- Source/credits: GitHub, CREDITS.md, NOTICE
