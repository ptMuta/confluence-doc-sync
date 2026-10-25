# confluence-doc-sync

[![nightly](https://github.com/ptMuta/confluence-doc-sync/actions/workflows/release.yml/badge.svg?event=schedule)](https://github.com/ptMuta/confluence-doc-sync/actions/workflows/release.yml)

A GitHub Action that checks the Markdown docs in your repository and publishes them to Confluence Cloud. Write plain Markdown, or turn on ready-made page types for decisions, requirements, security controls, logging and monitoring.

## How it works

The action runs in three steps:

| Step      | When                 | Confluence access | What it does                                                      |
| --------- | -------------------- | ----------------- | ----------------------------------------------------------------- |
| `check`   | On pull requests     | None              | Checks the docs and renders diagrams                              |
| `plan`    | On pushes to `main`  | Read              | Compares the docs with Confluence and saves the changes as a plan |
| `publish` | After a passing plan | Write             | Checks the plan again and applies it                              |

Publish does not trust the plan blindly. Before it writes, it confirms the plan is the one that was made, re-checks which changes are risky and who can view the pages, and only touches pages this action created.

## Writing docs

Every Markdown file under `docs` becomes a Confluence page. Subfolders become Confluence folders, and draw.io diagrams in a page are rendered and attached. Each folder starts with an overview page that links to its pages. Name a file `overview.md`, `index.md` or `readme.md` to write your own.

A page's title comes from `title` in its front matter, or its first `#` heading, or its file name. Front matter is optional.

To use a page type, list it under `types` in the config:

| Type            | What it adds                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| `decisions`     | Decision records in their own folder, with an overview page                             |
| `requirements`  | A requirements page                                                                     |
| `security`      | A security controls page                                                                |
| `logging`       | A logging page                                                                          |
| `monitoring`    | A monitoring page                                                                       |
| `writing-rules` | Writing checks: page length, filler words, placeholders, empty sections, duplicate text |

Some checks always run: broken links and ids, secrets pasted into docs, and broken diagrams.

## Risky changes

These changes count as risky, so you can ask for approval before they go out:

- New, moved or archived pages
- New or deleted folders
- Overwriting a page someone edited by hand in Confluence
- Changes to pages that link to a decision with `deviates-from`

## Setup

1. Copy [`examples/config.yaml`](examples/config.yaml) to `.docs-sync/config.yaml`, and [`examples/docs-sync.yml`](examples/docs-sync.yml) to `.github/workflows/`.
2. Protect `main` with required reviews, and add CODEOWNERS for `.github/workflows/` and `.docs-sync/`.
3. In admin.atlassian.com, go to Directory, then Service accounts. Create a service account that can use the space, and give it two OAuth 2.0 credentials with these Confluence scopes:
   - Read: `read:space:confluence`, `read:page:confluence`, `read:hierarchical-content:confluence`, `read:attachment:confluence`, `read:folder:confluence`, `search:confluence` and `read:space.permission:confluence`. Add `read:group:confluence` if you set `readers`.
   - Write: all the read scopes, plus `write:page:confluence`, `write:attachment:confluence`, `read:content-details:confluence`, `write:label:confluence`, `read:label:confluence` and `read:content.metadata:confluence`. Add `write:folder:confluence` and `delete:folder:confluence` if your docs have subfolders.
4. Create these GitHub environments, each limited to `main`:

| Environment                   | Secrets                                                     | Variables                                                 |
| ----------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| `docs-sync-read`              | `CONFLUENCE_READ_CLIENT_SECRET`                             | `CONFLUENCE_READ_CLIENT_ID`                               |
| `docs-sync-publish-low-risk`  | `CONFLUENCE_WRITE_CLIENT_SECRET`, `DOCS_SYNC_OWNERSHIP_KEY` | `CONFLUENCE_WRITE_CLIENT_ID`, `DOCS_SYNC_TIER: low-risk`  |
| `docs-sync-publish-high-risk` | Same as low-risk. Add required reviewers                    | `CONFLUENCE_WRITE_CLIENT_ID`, `DOCS_SYNC_TIER: high-risk` |
| `docs-sync-publish-manual`    | Same as low-risk                                            | `CONFLUENCE_WRITE_CLIENT_ID`, `DOCS_SYNC_TIER: manual`    |

`DOCS_SYNC_OWNERSHIP_KEY` marks the pages this action owns. Make it a random string of at least 32 characters, for example from `openssl rand -hex 32`, and use the same key in every publish environment.

Required reviewers on environments only work in public repos or on GitHub Enterprise. Without them, leave the repo variable `DOCS_SYNC_REVIEWERS` unset and add [`examples/docs-sync-approve.yml`](examples/docs-sync-approve.yml). A risky plan then stops after planning. To approve it, someone in `approvers` runs `docs-sync-approve` with the run id and bundle hash shown in the plan's summary.

## Config

| Key                      | Default                 | Meaning                                                                           |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `confluence.site`        | required                | Your site, `<name>.atlassian.net`                                                 |
| `confluence.cloud-id`    | none                    | Locks the site to this cloud id                                                   |
| `confluence.space`       | required                | Space key                                                                         |
| `confluence.root-page`   | set this or root-folder | Id of the page the docs go under                                                  |
| `confluence.root-folder` | set this or root-page   | Id of the folder the docs go under                                                |
| `confluence.visibility`  | `space`                 | `space`: no anonymous access. `restricted`: the root must be restricted. `public` |
| `confluence.readers`     | none                    | Groups that must be exactly the ones who can view the root (needs `restricted`)   |
| `approval`               | `on-risk`               | When publishing needs approval: `none`, `always` or `on-risk`                     |
| `approvers`              | `[]`                    | GitHub users who can run `docs-sync-approve`                                      |
| `self-approval`          | `true`                  | Whether approvers can approve their own changes                                   |
| `branch`                 | `main`                  | The only branch that can publish                                                  |
| `diagram-output`         | `image`                 | `image` for PNG, or `macro` for the draw.io app                                   |
| `drawio-macro-key`       | draw.io app             | Which draw.io app to use for `macro`                                              |
| `theme`                  | `nord`                  | Diagram theme: a built-in name or a theme file                                    |
| `diagram-max-mb`         | `50`                    | Size limit per diagram, in MB                                                     |
| `docs`                   | `docs`                  | Folder that holds the docs                                                        |
| `types`                  | `[]`                    | Page types to turn on, see [Writing docs](#writing-docs)                          |
| `decisions`              | `Decision`, `DEC`       | `label`, `id-prefix` and `folder` for decision records                            |
| `catalogs`               | `docs/<name>.yaml`      | Files for the requirements, security, logging and monitoring pages                |
| `tags`                   | none                    | A shared `vocabulary` file and `extra` tags                                       |
| `reference-sources`      | none                    | Decisions kept elsewhere in Confluence, linked as `<source>:<id>`                 |
| `lint`                   | built in                | Writing check settings: length `budgets`, `filler` phrases and `deny-patterns`    |

Plan writes `docs-sync.lock`, which records which external decisions your docs link to. Commit it next to the config, so that changes to those links show up in review.

## Verify a release

Pin the action to a release commit. That commit's `action.yml` pins the exact image. To check that a release and its image came from this repo:

```sh
gh release verify v1.0.0 -R ptMuta/confluence-doc-sync
gh attestation verify oci://ghcr.io/ptmuta/confluence-doc-sync@sha256:<digest> -R ptMuta/confluence-doc-sync
```

## Development

You need Node 26. Run `npm ci --ignore-scripts`, then `npm run verify`. It runs type checks, lint, formatting, tests, Knip and the build.

To make a release, run the `release` workflow on `main` with a version: `v1.0.0`, `v1.0.0-rc.1` for a release candidate, or `nightly`. It needs a `release` environment limited to `main`, and immutable releases turned on in the repo settings.

The same workflow makes a nightly pre-release each night, unless `main` has had only docs changes since the last one. It runs in a `nightly` environment without reviewers. Each nightly gets a `nightly-YYYYMMDD` tag and replaces the previous one, and its image is also tagged `nightly`. Release candidates are deleted once their final version ships. Final releases stay until you delete them.

Each push to `main` that changes code also pushes an attested `edge` image, which this repo uses to publish its own docs.

To test against a real Confluence site, run the `live-test` workflow. It runs `test/live/confluence.mjs`.

Copyright © 2026 ptMuta. All rights reserved. This code is proprietary, and no license is granted.
