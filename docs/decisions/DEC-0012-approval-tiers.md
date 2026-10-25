---
id: DEC-0012
title: Gate risky changes with environment tiers
date: 2026-10-23
decision-makers: [ptMuta]
---

## Context

Content edits should sync without waiting, but new, moved and archived pages or overwritten manual edits need a person. Required reviewers on GitHub environments exist only in public repositories and on Enterprise.

## Options

- Tiers set per environment: low-risk, high-risk, manual
- A reviewer for every publish

## Decision

We use tiers set per environment because publish re-classifies every change and refuses risky ones in the low-risk tier, whatever the plan job chose.

## Consequences

Repositories without environment reviewers use a manual approve workflow run by a listed approver. Self-approval is on by default for solo maintainers.

## Drivers

- [[NFR-SEC-004]]
