# CheckendBench v0

CheckendBench measures the model triage of Checkend (`AI_TRIAGE`): how often the stock Clef
answers agree with labels. v0 has the harness, the case format and the scores; the datasets come
separately.

## Two modes

1. **A dataset through Clef** (each model call costs money on your Cloudflare account; the calls go
   through AI Gateway, without stored logs):

   ```sh
   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
     node bench/checkendbench/run.ts --dataset cases.jsonl --model clef-flash
   ```

2. **The labels of an instance** (no model call). People and agents correct the triage with
   `POST /v1/issues/:id/triage-correction` or the MCP tool `correct_triage`. Each correction keeps
   the model answer of that time. Save the labels, then score them:

   ```sh
   curl -H "Authorization: Bearer $ADMIN_TOKEN" "$CHECKEND_URL/v1/labels?limit=1000" > labels.json
   node bench/checkendbench/run.ts --labels labels.json
   ```

## The case format (JSONL, one case per line)

```json
{"id": "...", "source": "...", "license": "...",
 "error": {"title": "...", "platform": "node", "message": null,
           "exceptions": [{"type": "TypeError", "value": "...",
                           "frames": [{"function": "...", "filename": "...", "lineno": 12, "in_app": true, "context_line": "..."}]}]},
 "labels": {"category": "code_bug", "severity": 2, "transient": false, "agent_fixable": true, "noise": false}}
```

- `labels` can have any subset of the five questions. The categories and the severity levels are
  the triage questions in `src/core/ai/triage.ts`.
- The error goes through the same scrubbing and normalization as the product input.
- Each case names its `source` and `license`. Use only data whose license allows this use.
  Benchmark data is for evaluation: do not train a model on it.
- `test/fixtures/checkendbench/sample.jsonl` has three synthetic cases for the tests. They are not
  a benchmark.

## The report

Per question: the number of labelled cases, the correct answers and the accuracy. For the
category also a confusion table (label → answer); for the severity also the mean absolute error;
for the yes/no questions also the Brier score (lower is better). The report also has the model,
the question set version, the failed calls and the input tokens.
