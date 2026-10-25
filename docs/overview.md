---
title: Overview
---

Docs sync is a GitHub Action that checks a repository's structured docs and publishes them to Confluence Cloud. Pull requests are checked offline. Pushes to main are planned with a read token and published with a write token, see [[DEC-0002]].

![Jobs, tokens and trust boundaries](diagrams/architecture.drawio 'Each job holds only the access it needs')

## Modes

| Mode    | Runs on               | Token    | Does                                                          |
| ------- | --------------------- | -------- | ------------------------------------------------------------- |
| check   | pull requests         | not used | Lints docs and renders diagrams                               |
| plan    | pushes to main        | read     | Compares docs with Confluence and writes a hashed plan bundle |
| publish | a publish environment | write    | Verifies the bundle and applies it                            |

## What gets published

Each Markdown file becomes a page, and each catalog becomes one page with a row per entry. Decision records become pages under a Decisions page. Pages whose source is removed are archived, see [[DEC-0009]].

## Trust

Publish treats the plan as untrusted. It changes only pages under the root that carry a signed ownership marker, see [[DEC-0006]] and [[NFR-SEC-002]].

## Further reading

- [Operations guide](operations.md)
- [Requirements](requirements.yaml)
- [Security controls](security.yaml)
