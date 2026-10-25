---
id: DEC-0003
title: Write docs as Markdown pages and YAML catalogs
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

Docs are reviewed in pull requests next to code. Requirements, controls, logging and monitoring are lists of short entries with fixed fields.

## Options

- Markdown with YAML front matter, one YAML file per catalog
- Markdown only, with tables for catalogs
- AsciiDoc

## Decision

We use Markdown with YAML front matter and one YAML file per catalog because both diff well, and a schema can check each catalog entry.

## Consequences

Each Markdown file becomes one page and each catalog becomes one page with a row per entry. Only a small Markdown subset is allowed, so some formatting has to wait for support.
