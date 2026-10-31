# Credits and provenance

`dsh-account-model-hub` is an independent fork maintained in this workspace. It is
not an official DeepSeek product and is not endorsed by the upstream authors.

## Upstream project

- **[`V1ki/dsh-plugin-subscriptions`](https://github.com/V1ki/dsh-plugin-subscriptions)** — upstream subscription-provider plugin by **V1ki and contributors**, version `0.9.10`, MIT License.
- Copyright and license text are preserved in `LICENSE`.
- The fork adds the OpenCode Go line, account/quota UI work, model-settings view, and the compatibility fixes documented in this repository.

## Advisor panel fork

- **[`sequoiayunus-hue/dsh-subagent-model-config`](https://github.com/sequoiayunus-hue/dsh-subagent-model-config)** — `dsh-subagent-model-config@0.3.1` by **sequoiayunus-hue**, MIT License.
- `kits/dsh-advisor-panel` is a fork of that project's advisor/registry idea and client panel; see its own `CREDITS.md` and `README.md`.

## Design and protocol references

The `NOTICE` file lists the public projects and data used as design/protocol
references, including OpenCode Go integration, account-pool kernels, quota
rotation state machines, and static catalog data. Those projects are not
bundled source-for-source unless explicitly stated.

## Runtime

- **DeepSeek Harness (DSH)** — plugin host/client APIs, slot system, RPC and UI primitives. DeepSeek Harness is a separate project; this plugin is not part of it.
- Third-party product names are trademarks of their respective owners; see `NOTICE`.

## Suggested release wording

> Account Hub is a fork of dsh-plugin-subscriptions by V1ki and contributors
> (MIT), with additional account-pool, OpenCode Go, model-settings and UI work.
> It also references the projects listed in NOTICE. It is not affiliated with
> or endorsed by DeepSeek, OpenAI, Anthropic, xAI, GitHub, Google or the
> upstream authors.
