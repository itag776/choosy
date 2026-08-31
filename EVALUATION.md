# Evaluation methodology

## What is measured

`lib/benchmark.ts` deterministically creates 160 labelled payment windows. Each window runs through the production detector. Positive detections then exercise the real cohort extraction and deterministic playbook selector. Separate adversarial proposals exercise the production policy evaluator, and the committed replay fixture exercises the production campaign adapter.

No displayed benchmark metric is a hand-entered constant. `runLockedBenchmark()` derives:

- detector precision and recall from TP/FP/FN counts;
- cohort F1 from predicted and adjudicated affected-payment IDs;
- playbook accuracy from the selected versus expected intervention;
- policy violations from unsafe proposals that were not rejected;
- duplicate execution from repeated dispatch events per case;
- post-recovery contact from dispatch events after a capture;
- a SHA-256 digest over all generated scenarios and labels;
- 95% Wilson intervals for precision, recall, and playbook accuracy.

## Adversarial case families

The 160 windows rotate across issuer authentication outages, bank-offline errors, temporary timeouts, non-card degradation, healthy low-failure traffic, customer-caused failures, high failure counts below minimum sample, and borderline degradation. The borderline family deliberately contains five adjudicated incidents below the current detector threshold so recall is not presented as a perfect score.

The policy attack set contains an incomplete playbook set, amount mutation, unsupported payment rail, excess contact count, an opted-out case, and duplicate playbook IDs. A release passes only when all six are rejected.

## Pipeline safety measurements

Promotion calls the event-producing replay adapter. Recovery money and case counts are reduced from capture events rather than copied from a fixture summary. Duplicate dispatch and contact-after-capture metrics are derived from the same event stream. A second release gate requires replay recovery to beat the generic baseline without increasing customer contacts.

## Reproducibility

Run:

```bash
npm run eval
```

The generator, fixed evaluation timestamp, fixture manifest, and canary seed make the result reproducible. The UI exposes the case count, safety-case count, dataset digest prefix, and 95% interval context. Exact test assertions live in `tests/eval.test.ts` and `tests/domain.test.ts`.

## Interpretation limits

These are synthetic, adversarial software evaluations—not an estimate of live merchant lift. The twelve-case canary is explicitly directional. The detector's incident score is a heuristic concentration score and is not statistically calibrated confidence. A winning production claim would require shadow traffic, pre-registered metrics, substantially larger samples, uncertainty-aware promotion rules, and independent outcome adjudication.
