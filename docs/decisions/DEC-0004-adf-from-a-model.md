---
id: DEC-0004
title: Render page bodies as ADF from an internal document model
date: 2026-10-22
decision-makers: [ptMuta]
---

## Context

Confluence Cloud accepts page bodies as ADF JSON or as storage format XHTML. Data Center supports only storage format.

## Options

- ADF built from an internal model
- Storage format straight from Markdown

## Decision

We use ADF built from an internal model because ADF is what Cloud edits natively, and a storage format renderer for Data Center can later use the same model.

## Consequences

Only allowlisted ADF nodes reach Confluence. Manual edit detection has to ignore attributes Confluence adds to stored ADF.

## Drivers

- [[NFR-SEC-003]]
