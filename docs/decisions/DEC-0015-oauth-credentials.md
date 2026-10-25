---
id: DEC-0015
title: Authenticate with service account OAuth credentials
date: 2026-10-25
decision-makers: [ptMuta]
---

## Context

Service account API tokens can only be created by hand and expire after at most a year. Confluence accepts only Atlassian tokens, so GitHub or Entra identities cannot call it directly.

## Options

- Service account API tokens
- Service account OAuth credentials

## Decision

We use OAuth credentials because each run exchanges them for an access token that expires after an hour, and Confluence never sees the stored secret.

## Consequences

The organization needs Atlassian's centralized user management. Plan and publish each hold a client ID and secret instead of a token.
