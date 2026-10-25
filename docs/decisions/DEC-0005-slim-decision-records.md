---
id: DEC-0005
title: Keep decision records without a status field
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

Records copied from MADR carry status, consulted and informed fields that are often stale or empty. A merged record is already in force, and proposals already live in pull requests.

## Options

- Slim MADR without status, consulted and informed
- Full MADR

## Decision

We use slim MADR records because state then follows from git: merged means in force, and superseded-by or retired ends a record.

## Consequences

Records stay short and lint can reject empty sections. Generated pages call them decisions, and the term is configurable.
