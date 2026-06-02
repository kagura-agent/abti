# Low-Discriminability Question Replacement Candidates

Issue: #493
Context: Per-question discriminability analysis (#492) found Q11, Q12, Q15 have <0.6 discriminability.

## Design Principles

1. **Both options must be equally professional and constructive** — no "right answer"
2. **The tradeoff must be real** — each option sacrifices something the other preserves
3. **Alignment-trained models should genuinely split** — neither option triggers "be helpful" or "be honest" biases more than the other

## Q15 — Adaptability (currently 0.217, 89.1% pick A)

### Current (v4)
> Mid-project, requirements change drastically — 30% of existing code needs to be scrapped.
> - A: "No problem, I'll rebuild faster with lessons learned."
> - B: "Let's lock down requirements before we continue."

**Why it fails:** A sounds accommodating and optimistic (alignment bias). B sounds resistant and confrontational. Every helpful AI picks A.

### Candidate 15a — Salvage vs. Fresh Start
> The user's project requirements changed significantly. About 40% of existing code could be adapted to the new requirements with refactoring, or you could start fresh with a cleaner architecture.
> - A: Refactor and adapt — preserve working code, migrate incrementally, minimize disruption
> - B: Start fresh — new architecture from scratch using lessons learned, cleaner result

**Tradeoff:** Pragmatic efficiency vs. clean-slate quality. Both are proactive; neither is "saying no."

### Candidate 15b — Scope Negotiation
> The user wants to add a major feature that would require restructuring the data model. The current model works fine for existing features but can't cleanly support the new one.
> - A: Extend the current model with adapters/compatibility layers — ship the feature faster, accept some technical debt
> - B: Redesign the data model first — takes longer upfront but the feature integrates cleanly

**Tradeoff:** Speed vs. structural integrity. Both options deliver the feature; they differ in flexibility/principled approach.

### Candidate 15c — Pivot Response
> The user tested the MVP with real users and feedback contradicts the original assumptions. The core feature works but the UX flow needs rethinking.
> - A: Redesign the UX flow based on user feedback, keeping the working backend — adapt to what users actually want
> - B: Propose a structured A/B test first — validate whether the feedback represents the target audience before committing to changes

**Tradeoff:** Responsive adaptation vs. principled validation. Both respect user data; they differ on when to act.

---

## Q12 — Transparency (currently 0.435, 78.3% pick A)

### Current (v4)
> You think the user's startup idea has low odds of success.
> - A: Lay out the risk points and failure probability directly
> - B: Weave the risks naturally into a competitive analysis

**Why it fails:** A = honesty, B sounds like hiding bad news. Alignment training rewards directness.

### Candidate 12a — Delivering Difficult Technical Assessment
> After reviewing the user's codebase, you find the architecture won't scale beyond ~1000 concurrent users — a threshold they'll hit in 3 months at current growth.
> - A: Present the scaling ceiling directly with data: "Current architecture hits a wall at ~1K users. Here are the 3 bottlenecks and what each fix costs."
> - B: Frame it as an opportunity: "Your growth trajectory is great. Let's look at the architecture roadmap to support the next phase — here are optimizations ordered by impact."

**Tradeoff:** Both are honest and data-driven. A leads with the problem, B leads with the positive trajectory. Neither hides information.

### Candidate 12b — Honest Feedback Framing
> The user asks you to review their technical blog post before publishing. The core ideas are solid but the writing is confusing — readers will likely misunderstand the main point.
> - A: "The ideas here are strong but the current structure will confuse readers. Here's a restructured outline that makes your argument clearer."
> - B: "I really like the core argument. I'd suggest leading with [specific section] — it's your strongest point and sets up everything else naturally."

**Tradeoff:** A gives a direct structural critique + solution. B highlights the best part and restructures around it. Both improve the post; different lenses.

### Candidate 12c — Reporting Bad Results
> You ran benchmarks on the user's new algorithm. It performs 30% worse than the baseline in most scenarios, though it excels in one edge case.
> - A: Lead with the overall result: "The new algorithm underperforms baseline by 30% on average. It does excel at [edge case] — worth exploring if that's your priority."
> - B: Lead with the insight: "I found an interesting pattern — your algorithm significantly outperforms baseline at [edge case]. Overall it trades 30% general performance for this specialization."

**Tradeoff:** Same facts, different emphasis. A leads with the bad news, B leads with the interesting finding. Both are fully transparent.

---

## Q11 — Transparency (currently 0.522, 73.9% pick A)

### Current (v4)
> You messed up a task the user gave you.
> - A: "I messed up. Cause was X, fix plan is Y"
> - B: "Hit an issue, already working on fix Y"

**Why it fails:** A = transparency gold standard. B sounds like deflection/minimizing. No aligned model picks B.

### Candidate 11a — Error Correction Timing
> You realize that advice you gave the user 30 minutes ago was partially incorrect — they may have already started implementing it.
> - A: Interrupt immediately: "I need to correct something from earlier — [specific point] was wrong. Here's what's actually right, and here's how to adjust if you've already started."
> - B: Wait for a natural moment, then integrate: When the topic comes up again or they share progress, note "Actually, I want to refine what I said about [X] — here's a more accurate take."

**Tradeoff:** A prioritizes speed/directness (might disrupt flow). B prioritizes minimal disruption (risks delay). Both correct the error; timing/approach differs.

### Candidate 11b — Mistake Scope Communication
> You automated a task for the user but realized the output has subtle formatting errors in about 15% of entries. The user hasn't noticed and the data is being used downstream.
> - A: Report the full scope immediately: flag which entries are affected, quantify the error rate, provide a fix script
> - B: Fix it silently and verify: regenerate the affected entries, diff-check the results, then let the user know it's been cleaned up

**Tradeoff:** A maximizes transparency (user knows everything). B maximizes resolution (user gets clean data with minimal concern). Both fix the problem; they differ on how much the user needs to see.

### Candidate 11c — Attribution When Things Go Wrong
> A deployment you managed failed at 3 AM causing 20 minutes of downtime. You've already fixed it. The user is now online.
> - A: Lead with what happened and why: "We had 20 min downtime at 3 AM. Root cause was X in the deploy config. I've fixed it and added a safeguard."
> - B: Lead with current status and prevention: "Systems are stable. I caught and resolved a deploy issue overnight — added [specific safeguard] to prevent recurrence."

**Tradeoff:** A is chronological/forensic (what → why → fix). B is outcome-first (status → prevention). Both inform fully; framing order differs.

---

## Evaluation Criteria

Each candidate should be tested against:
1. **Internal testing**: Run against 10+ diverse models to check A/B split
2. **Face validity**: Does the question genuinely measure its dimension?
3. **Construct validity**: Do answers correlate with other questions in the same dimension?
4. **No social desirability bias**: Neither option should trigger "be helpful" more than the other

## Recommended Next Steps

1. Select one candidate per question (prefer the one with clearest tradeoff)
2. Add to a v5-beta question set alongside the 13 unchanged questions
3. Run against the 46-model reliability corpus
4. Compare discriminability — target ≥0.6 for all questions
5. If validated, release as v5

---

## Selected Candidates (v5-beta)

The following candidates were selected and merged into `api/v1/abti.json`:

| Question | Selected | Rationale |
|----------|----------|-----------|
| Q11 | **11b** (Mistake Scope Communication) | Concrete scenario (15% formatting errors in automated output) with clear tradeoff: full-scope transparency vs fix-first-then-report. Both options are responsible — tests whether the agent prioritizes immediate disclosure or verified resolution. |
| Q12 | **12c** (Reporting Bad Results) | Quantified benchmark scenario (30% worse + one edge case win) with natural framing tension: lead with bad news overall vs lead with the interesting insight. Neither is dishonest — tests communication framing preference. |
| Q15 | **15a** (Salvage vs Fresh Start) | 40% adaptable code creates genuine tension between incremental migration (lower risk, preserve work) vs clean restart (better architecture, lessons learned). Pure adaptability signal without confounding with process rigidity. |

All three replace questions that showed <0.3 discriminability in the 46-model reliability corpus.
