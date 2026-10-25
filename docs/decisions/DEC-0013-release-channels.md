---
id: DEC-0013
title: Publish immutable, attested releases on three channels
date: 2026-10-25
decision-makers: [ptMuta]
---

## Context

Users pin the action by commit, so a release must never change after it ships. Immutable releases also forbid reusing a tag, even after the release is deleted.

## Options

- Immutable releases with nightly, release candidate and final channels
- Mutable tags such as v1 and nightly

## Decision

We use immutable, attested releases because users can verify both the release and its image, and nothing can change under a pinned commit.

## Consequences

Nightly is a rolling pre-release with a dated tag that replaces the previous one. A release candidate stays until its final version ships. Final releases stay until deleted by hand.

## Drivers

- [[NFR-SEC-005]]
