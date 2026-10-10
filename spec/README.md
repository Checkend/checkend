# Open specs (v0.1)

Formats and protocols that Checkend uses, written so that other tools can use them too. They are
drafts: comments are welcome in issues.

| Spec | What it describes |
|---|---|
| [Agent Issue Brief](agent-issue-brief.md) | A short description of an error for a coding agent, with facts apart from untrusted data. JSON Schema: [`schemas/brief-v1.schema.json`](schemas/brief-v1.schema.json). |
| [Fix verification](fix-verification.md) | How a tracker decides, without a person, that a fix worked in production, or that it did not. |

The schema file is generated from the reference implementation (`npm run spec:build`). A test
checks that it is current, and that every brief Checkend builds matches it.

License: the same as the repository (Apache License 2.0).
