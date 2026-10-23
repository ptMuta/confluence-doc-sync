---
id: DEC-0002
title: Use private endpoints for all data stores
date: 2026-10-22
decision-makers: [platform-team]
tags: [qa-security]
supersedes: DEC-0001
realizes: [ea:ADR-012]
deviates-from:
  - ref: ea:ADR-007
    reason: Region pair not available for this service
    approved-by: architecture-board
---

## Context

Private endpoints are now available in both regions.

## Drivers

- [[NFR-SEC-004]]
- [[ea:ADR-031]]

## Options

- Private endpoints
- Keep public endpoints

## Decision

We use private endpoints because they keep traffic off the internet.

## Consequences

No allow lists to maintain. Local access needs a VPN.

## Links

- [[DEC-0001]]
- [Provider docs](https://example.com/private-endpoints)
