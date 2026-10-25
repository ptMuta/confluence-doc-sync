---
id: DEC-0009
title: Archive pages whose source is deleted
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

When a Markdown or catalog file is removed, its Confluence page has no source any more. Links from other spaces may still point at it.

## Options

- Archive the page
- Delete the page
- Leave the page

## Decision

We use archiving because the page can be restored and its links keep working.

## Consequences

Archiving counts as a risky change and needs a reviewer in on-risk mode.
