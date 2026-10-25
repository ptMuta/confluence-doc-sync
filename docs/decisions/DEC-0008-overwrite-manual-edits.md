---
id: DEC-0008
title: Overwrite manual Confluence edits after a warning
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

People sometimes edit synced pages in Confluence. The repository is the source of truth, and Confluence keeps every page version.

## Options

- Warn in the plan, then overwrite
- Refuse to sync edited pages
- Merge edits back into the repository

## Decision

We use warn then overwrite because the old version stays in page history, and the on-risk approval mode makes a reviewer accept the overwrite.

## Consequences

An edit made in Confluence is lost from the current page unless someone moves it into the repository.
