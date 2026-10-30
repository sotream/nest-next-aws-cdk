# Cost estimate

A rough monthly estimate per environment. **These are estimates, not quotes.** The unit prices are the
`eu-central-1` on-demand list prices used by the
[Terraform project's estimate](https://github.com/sotream/nest-next-aws-terraform/blob/main/docs/guides/cost-estimate.md)
as understood in October 2026. They were **not** looked up again for this repository and not checked in the
AWS Pricing Calculator. The totals below are my arithmetic on those prices. Check
[the calculator](https://calculator.aws/) before you rely on them.

## Assumptions

- 730 hours a month, USD, no free tier, no savings plans, no reserved instances.
- Fargate Linux x86: about 0.0466 USD per vCPU-hour and 0.0051 USD per GB-hour. Every task is 0.25 vCPU and
  0.5 GB, about 10 USD a month.
- NAT gateway about 0.052 USD per hour (38 a month) plus 0.052 USD per GB; about 20 GB a month.
- Application Load Balancer about 0.024 USD per hour plus capacity units.
- RDS and ElastiCache figures are taken from the Terraform estimate; `t4g.medium` is about double the
  `t4g.small` instance price, which is my extrapolation.
- No WAF, no ALB access logs, a few GB of data transfer, under 5 GB of logs, 20 GB of database storage.
- The Route 53 hosted zone is not created here and is not counted.

## Per environment, per month

| Item                                        | dev           | stage               | prod                        | preview       |
| ------------------------------------------- | ------------- | ------------------- | --------------------------- | ------------- |
| NAT gateways                                | 1: 38         | 2: 76               | 2: 76                       | 1: 38         |
| NAT data processing                         | 1             | 2                   | 2                           | 1             |
| Application Load Balancer                   | 23            | 23                  | 25                          | 23            |
| Fargate tasks                               | 2: 21         | 4: 42               | 4: 42                       | 2: 21         |
| RDS PostgreSQL and storage                  | micro: 17     | small, Multi-AZ: 61 | medium, Multi-AZ: about 117 | micro: 17     |
| ElastiCache Redis                           | 1 node: 12    | 2 nodes: 50         | 2 nodes: about 100          | 1 node: 12    |
| Secrets Manager (5 secrets)                 | 2             | 2                   | 2                           | 2             |
| KMS key (alarm topic)                       | 1             | 1                   | 1                           | 1             |
| Logs, flow logs, alarms, Container Insights | 6             | 9                   | 14                          | 4             |
| ECR, other                                  | 2             | 2                   | 4                           | 2             |
| **Approximate total**                       | **about 125** | **about 270**       | **about 385**               | **about 120** |

Shared across everything: the ECR repositories (cents) and the OIDC provider (free).

What moves the numbers most: NAT gateway count, Multi-AZ, and the number and size of tasks.

## Previews

A preview costs about as much as `dev` while it exists: roughly 4 USD a day. Closing the pull request destroys
it; the nightly clean-up destroys any that survive a closed pull request or reach seven days, so an orphan
costs at most about 28 USD. A busy repository with many open pull requests multiplies this by the number of
open pull requests.

## Cheapest way to try it

Deploy `dev` only, without a domain; destroy it when finished. There is no cheap pause: RDS, ElastiCache,
the NAT gateway and the load balancer cost money while they exist.
