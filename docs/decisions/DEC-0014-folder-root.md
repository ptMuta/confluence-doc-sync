---
id: DEC-0014
title: Allow a folder as the root
date: 2026-10-25
decision-makers: [ptMuta]
---

## Context

Confluence spaces are now organized with folders, and the docs for this repository go into a folder. The tool only accepted a page as its root.

## Options

- A root-folder setting next to root-page
- A page inside the folder as the root

## Decision

We use a root-folder setting because teams can then publish straight into the folder they already have.

## Consequences

Plan and publish read the root through the page or folder endpoints, and the visibility check starts at the root, whichever type it is.

## Confirmation

- [Publish tests](../../test/publish.test.ts)
