---
id: DEC-0007
title: Reference external decisions by source and id, with a lock file
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

Higher level, technology agnostic decisions live in a Confluence space with stable ids and their own lifecycle. Local records must link to them without breaking when they move or change state.

## Options

- References such as ea:ADR-012, resolved at plan time and locked
- Plain page URLs

## Decision

We use source:id references resolved at plan time because the syntax stays the same when the external space or its lifecycle changes, and the lock file shows any new resolution in review.

## Consequences

Plan needs read access to the external space. A reference that matches no page or several pages fails the plan.

## Confirmation

- [Plan tests](../../test/plan.test.ts)
