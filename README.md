# git-confluence-sync

GitHub Action that checks a repository's structured docs and publishes them to Confluence Cloud: decisions, requirements, security controls, logging, monitoring and draw.io diagrams.

## How it works

| Mode      | Runs on               | Token | Does                                                              |
| --------- | --------------------- | ----- | ----------------------------------------------------------------- |
| `check`   | pull requests         | none  | Lints docs and renders diagrams offline                           |
| `plan`    | pushes to `main`      | read  | Compares the docs with Confluence and writes a hashed plan bundle |
| `publish` | a publish environment | write | Verifies the bundle and applies it                                |

Publish treats the plan as untrusted. It checks the bundle hash, commit, branch and config, re-classifies risk, re-checks who can view the root, and only changes pages under the root that carry a signed ownership marker.

Risky changes are new, moved or archived pages, overwriting a manual edit in Confluence, and changes to pages with `deviates-from` links.

## Setup

1. Copy [`examples/config.yaml`](examples/config.yaml) to `.docs-sync/config.yaml` and [`examples/docs-sync.yml`](examples/docs-sync.yml) to `.github/workflows/`.
2. Add CODEOWNERS for `.github/workflows/` and `.docs-sync/`, and require reviews on `main`.
3. Create two Confluence service account tokens:
   - Read: `read:space:confluence`, `read:page:confluence`, `read:hierarchical-content:confluence`, `read:attachment:confluence`, `read:folder:confluence`, `search:confluence`, `read:space.permission:confluence`, and `read:group:confluence` when `readers` is set.
   - Write: the read scopes plus `write:page:confluence`, `write:attachment:confluence`, `read:content-details:confluence`, `write:label:confluence`, `read:label:confluence` and `read:content.metadata:confluence`.
4. Create GitHub environments, each limited to `main`:

| Environment             | Secrets                                             | Variables                    |
| ----------------------- | --------------------------------------------------- | ---------------------------- |
| `docs-plan`             | `CONFLUENCE_READ_TOKEN`                             | none                         |
| `docs-publish`          | `CONFLUENCE_WRITE_TOKEN`, `DOCS_SYNC_OWNERSHIP_KEY` | `DOCS_SYNC_TIER: unreviewed` |
| `docs-publish-reviewed` | same as `docs-publish`, with required reviewers     | `DOCS_SYNC_TIER: reviewed`   |
| `docs-sync-approve`     | same as `docs-publish`                              | `DOCS_SYNC_TIER: approver`   |

`DOCS_SYNC_OWNERSHIP_KEY` is a random string of at least 32 characters, for example `openssl rand -hex 32`. Use the same key in every publish environment.

Required reviewers work only in public repos or on GitHub Enterprise. Elsewhere, leave the repo variable `DOCS_SYNC_REVIEWERS` unset and add [`examples/docs-sync-approve.yml`](examples/docs-sync-approve.yml). A risky plan then stops after the plan job, and an approver starts `docs-sync-approve` with the run id and bundle hash from its summary.

## Config

| Key                      | Default                 | Meaning                                                                           |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `system`                 | required                | System name, used as a prefix in page titles                                      |
| `confluence.site`        | required                | `<name>.atlassian.net`                                                            |
| `confluence.cloud-id`    | none                    | Pins the site's cloud id                                                          |
| `confluence.space`       | required                | Space key                                                                         |
| `confluence.root-page`   | one of the two          | Page id that holds the synced pages                                               |
| `confluence.root-folder` | one of the two          | Folder id that holds the synced pages, instead of `root-page`                     |
| `confluence.visibility`  | `space`                 | `space`: no anonymous access; `restricted`: the root must be restricted; `public` |
| `confluence.readers`     | none                    | Groups that must be exactly the root's viewers (needs `restricted`)               |
| `approval`               | `on-risk`               | `none`, `always` or `on-risk`                                                     |
| `approvers`              | `[]`                    | GitHub logins that can run `docs-sync-approve`                                    |
| `self-approval`          | `true`                  | Whether an approver can approve their own change                                  |
| `branch`                 | `main`                  | The only branch publish runs on                                                   |
| `diagram-output`         | `image`                 | `image` (PNG) or `macro` (draw.io app)                                            |
| `drawio-macro-key`       | draw.io Marketplace app | Forge extension key of the draw.io app                                            |
| `theme`                  | `nord`                  | Built-in theme or a theme file                                                    |
| `diagram-max-mb`         | `50`                    | Size limit per diagram                                                            |
| `docs`                   | `docs`                  | Docs folder                                                                       |
| `decisions`              | `Decision`, `DEC`       | `label`, `id-prefix` and `folder` of decision records                             |
| `catalogs`               | `docs/<name>.yaml`      | Paths of the requirements, security, logging and monitoring catalogs              |
| `tags`                   | none                    | Shared `vocabulary` file and `extra` tags                                         |
| `reference-sources`      | none                    | External decisions in Confluence, referenced as `<source>:<id>`                   |
| `lint`                   | built in                | Length `budgets`, `filler` phrases and `deny-patterns`                            |

Plan writes `docs-sync.lock` with the resolved external decisions. Commit it next to the config so a changed resolution shows up in review.

## Verify a release

Pin the action to a release tag's commit. That commit's `action.yml` pins the image digest.

```sh
gh release verify v1.0.0 -R ptMuta/git-confluence-sync
gh attestation verify oci://ghcr.io/ptmuta/git-confluence-sync@sha256:<digest> -R ptMuta/git-confluence-sync
```

## Development

Node 26. `npm ci --ignore-scripts`, then `npm run verify` runs type checks, lint, formatting, tests with coverage, Knip and the build.

To release, run the `release` workflow on `main` with a version such as `v1.0.0`, or `v1.0.0-rc.1` for a pre-release. It needs a `release` environment limited to `main`, and immutable releases turned on in the repo settings.

The same workflow publishes a rolling nightly pre-release every night when `main` has changed, through a `nightly` environment without reviewers. Immutable tags can't be reused, so each nightly is tagged `nightly-YYYYMMDD` and replaces the previous one; the image is also tagged `nightly`. Release candidates are deleted with their images once their final version is out. Final releases are kept until deleted by hand.

`test/live/confluence.mjs` runs plan and publish against a real Confluence site. Run it with the `live-test` workflow.

Copyright © 2026 ptMuta. All rights reserved. Proprietary; no license is granted.
