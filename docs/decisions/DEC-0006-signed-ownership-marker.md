---
id: DEC-0006
title: Sign page ownership markers with an HMAC key
date: 2026-10-23
decision-makers: [ptMuta]
---

## Context

The tool must change only pages it created. A content property marks those pages, but anyone who can edit a page can add or copy that property.

## Options

- HMAC-signed marker with a key held only by publish environments
- Unsigned marker

## Decision

We use an HMAC-signed marker because a copied or hand-made marker then fails the signature check, and publish refuses the page.

## Consequences

Publish environments need an ownership key of at least 32 characters. Rotating the key is not supported yet: pages signed with the old key are refused.

## Drivers

- [[NFR-SEC-002]]

## Confirmation

- [Publish tests](../../test/publish.test.ts)
