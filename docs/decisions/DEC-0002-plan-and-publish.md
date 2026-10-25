---
id: DEC-0002
title: Split plan and publish into separate jobs with separate tokens
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

Publishing needs a Confluence write token. Parsing docs and rendering diagrams handles content from any contributor, so the job that does it should not hold that token.

## Options

- One job with a write token
- A plan job with a read token and a publish job with the write token

## Decision

We use separate plan and publish jobs because only the publish job then holds the write token, and it applies nothing but a hashed plan it can check.

## Consequences

The write token lives only in environments limited to the main branch. Every sync passes a plan bundle between jobs, and publish has to re-check it.

## Drivers

- [[NFR-SEC-001]]
- [[NFR-SEC-002]]

## Confirmation

- [Publish tests](../../test/publish.test.ts)
