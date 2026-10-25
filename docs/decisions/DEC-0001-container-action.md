---
id: DEC-0001
title: Ship as a container GitHub Action pinned by digest
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

The tool runs where the docs live, next to the IaC code in GitHub. Rendering draw.io diagrams needs the draw.io desktop app and fixed fonts, which a plain runner does not have.

## Options

- Container GitHub Action
- JavaScript GitHub Action
- Atlassian Forge app

## Decision

We use a container GitHub Action because it carries a pinned draw.io build and fonts, and runs the same on every Linux runner.

## Consequences

Renders are repeatable and the image can be scanned and attested. Runs only on Linux runners, and the first run of a release pulls a large image.

## Drivers

- [[NFR-SEC-005]]
- [[NFR-REL-002]]
