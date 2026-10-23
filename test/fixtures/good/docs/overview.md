---
title: Payments overview
tags: [system-payments]
---

Payments runs in two regions behind private endpoints, see [[DEC-0002]].

![Network zones and trust boundaries](diagrams/network.drawio "Network zones")

## Data stores

| Store | Purpose |
| --- | --- |
| Ledger | Balances, see [the requirements](requirements.yaml) |

> [!NOTE]
> Keys rotate every 90 days.

```hcl
module "ledger" {}
```
