# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email us at: **security@furvur.com**

Include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt within 48 hours
2. **Investigation**: We will investigate and validate the issue within 7 days
3. **Resolution**: We aim to release a fix within 30 days for critical issues
4. **Disclosure**: We will coordinate with you on public disclosure timing

### Security Best Practices for Self-Hosting

When deploying Checkend, ensure you:

1. **Use HTTPS**: Always deploy behind SSL/TLS
2. **Secure credentials**: Use Rails encrypted credentials, never commit secrets
3. **Database security**: Use strong passwords, restrict network access
4. **Keep updated**: Regularly update Rails and gem dependencies
5. **Run security scans**: Use `bin/brakeman` and `bin/bundler-audit` regularly

### Security Scanning

We use the following tools to maintain security:

```bash
# Static analysis for Rails vulnerabilities
bin/brakeman --no-pager

# Check for known gem vulnerabilities
bin/bundler-audit

# Check JavaScript dependencies
bin/importmap audit
```

These checks run automatically in CI on every pull request.

## Security Features

Checkend includes several security features:

- **Password history**: Prevents reuse of last 5 passwords
- **Session management**: View and revoke active sessions
- **API key scoping**: Fine-grained API permissions
- **Encrypted credentials**: Sensitive data encrypted at rest
- **CSRF protection**: Built-in Rails CSRF tokens
- **SQL injection prevention**: ActiveRecord parameterized queries

## Acknowledgments

We appreciate security researchers who help keep Checkend secure. Contributors who report valid vulnerabilities will be acknowledged here (with permission).
