# Security Policy

## Supported Scope

This repository contains public application code and deployment templates. It must not contain:

- live credentials
- internal hostnames or private IP addresses
- production-only operator secrets

## Reporting a Vulnerability

Do not open a public issue for a security vulnerability.

Use GitHub private vulnerability reporting if it is enabled for the repository. If it is not enabled yet, contact the repository owners through a private channel configured in the repository settings before publication.

Include:

- affected file or route
- reproduction steps
- impact summary
- any proof-of-concept details needed to validate the report

## Response Expectations

- Credential exposure should be treated as an immediate rotation event.
- Reports that affect public protocol routes, auth, cron routes, or quote integrity should be triaged first.
- Fixes should be accompanied by documentation or tests when appropriate.

