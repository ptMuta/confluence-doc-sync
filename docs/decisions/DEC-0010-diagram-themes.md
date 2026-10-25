---
id: DEC-0010
title: Style diagrams with semantic roles, built-in themes and Tabler icons
date: 2026-10-23
decision-makers: [ptMuta]
---

## Context

Diagrams drawn by different people look different, and hand-picked colors drift. Mixed vendor icon sets clash with each other.

## Options

- Semantic roles mapped to a theme, with one icon set
- Free styling checked only by review

## Decision

We use semantic roles such as role=service with built-in themes because the tool then applies one look everywhere, and lint rejects unknown roles.

## Consequences

Nord is the default of 9 built-in themes, and a theme file can replace them. Icons come from Tabler only, which is MIT licensed.
