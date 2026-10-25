---
id: DEC-0011
title: Let each workflow choose PNG images or draw.io macros
date: 2026-10-23
decision-makers: [ptMuta]
---

## Context

Some sites have the draw.io app and want diagrams people can open in Confluence. Others have no app, or want a fixed image.

## Options

- Configurable output, PNG by default
- PNG only
- draw.io macro only

## Decision

We use a diagram-output setting because the same .drawio source then serves sites with and without the draw.io app.

## Consequences

Macro output uploads the .drawio file and its PNG preview, and publish allows only draw.io macros that use the configured app key.

## Confirmation

- [Publish tests](../../test/publish.test.ts)
