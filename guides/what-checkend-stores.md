# What Checkend stores

After Checkend accepts an event, it cleans the event, limits its size, and puts it in an issue.
This guide tells what Checkend keeps, and what it removes.

## 1. Secrets are removed first

Checkend removes secrets before it stores anything. It replaces each secret with `[Filtered]`.

Checkend removes:

- the values of sensitive keys, for example `password`, `token`, `secret`, `api_key`,
  `cookie`, `authorization` and `session`
- credentials after `Bearer`, `Basic` and `Token`
- JSON Web Tokens (JWTs)
- private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Stripe, AWS, GitHub and Slack tokens
- passwords in URLs (`https://user:password@host`)
- the value after a sensitive key in text, for example `password=...`, `token: ...` or
  `"api_key": "..."`, also in URLs and query strings
- card numbers that pass the Luhn check

Examples of text with a key and a value:

| Before | After |
|---|---|
| `password=hunter2 id 4821` | `password=[Filtered] id 4821` |
| `login with password: hunter2 failed` | `login with password: [Filtered] failed` |
| `{"password": "hunter 2"}` (as text) | `{"password": "[Filtered]"}` |
| `https://api.example.com/v1?api_key=sk_live_123&id=7` | `https://api.example.com/v1?api_key=[Filtered]&id=7` |

A key is sensitive when it has a sensitive word: `my_password` and `myPassword` are sensitive,
but `mypassword` is not. A value without quotes ends at a space, a quote, `&` or `;`. A value in
quotes ends at its closing quote (512 characters at most).

Checkend removes secrets everywhere: in the stored event, in the issue title, and in the raw
payload.

The list is fixed for now. You cannot change it yet.

## 2. Size limits

Checkend keeps the most useful parts of an event, and cuts the rest:

| Item | Limit |
|---|---|
| Exceptions per event | 10 |
| Frames per exception | 50 |
| Breadcrumbs | 50 |
| Tags | 50 |
| Depth of free-form data (`extra`, `contexts`, `user`) | 4 levels |
| Stored event, as JSON | 64 KB |

When an event is still too large, Checkend removes the least useful parts first (breadcrumb
data, breadcrumbs, `extra`, `contexts`, headers, source lines) until the event fits.

Strings also have length limits. Checkend keeps source lines only for in-app frames (frames from
your code, not from libraries).

Checkend removes invisible characters, control characters and bidi characters from text.

An event timestamp more than 30 days in the past, or more than 60 seconds in the future, is
replaced with the time when Checkend received the event. A breadcrumb timestamp that is not
valid becomes `null`.

## 3. Grouping into issues

An issue is a group of events with the same cause. Checkend makes a fingerprint for each event.
Events with the same fingerprint go into the same issue.

Checkend uses the first of these rules that applies (fingerprint version 1):

1. **The SDK fingerprint**, if your code sets one. `{{ default }}` works: it is replaced with the
   default fingerprint.
2. **The exception types and the in-app frames.** When an exception has no in-app frames,
   Checkend uses all its frames. A frame is its module (or file name) and its function. Line
   numbers and bundle hashes are not used, so a deploy that only moves code does not create new
   issues. A renamed function or module gives a new issue.
3. **The exception type and the message**, when no frame is usable: there is no stack trace, or
   the frames have only minified names (in a hashed or `.min.js` bundle, with names of 3
   characters or fewer). Checkend replaces the parts that change in the message: numbers, IDs,
   and quoted values.
4. **The message** for message events (`captureMessage`), with the same replacements.

## 4. Caps per project

These caps protect your database from an error flood:

| Cap | Default | What happens above the cap |
|---|---|---|
| Stored events per issue | 100 | Checkend counts the event, but does not store it. |
| New issues per hour | 100 | Events that would make a new issue go into one "flood" issue. The hour is the last 60 minutes. Events of existing issues are counted as usual. |
| Tag keys | 200 | Checkend removes tags with a new key from the event. Tags with known keys stay. |

You can change the defaults. See [Settings and health](settings.md).

> **Known limitation:** when an issue has 100 stored events, or in budget mode, Checkend does
> not store the event. If an SDK sends the same event again, it is counted again.

## 5. The raw payload

Checkend also keeps the original event, so that a later version of Checkend can process old
events again. The raw payload:

- has its secrets removed, like the stored event
- is compressed with gzip
- is kept only for events of 256 KB or less (and 64 KB or less after compression)
- is used only to process events again. The API never returns it.
