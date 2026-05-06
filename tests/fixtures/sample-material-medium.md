# Research Summary: Distributed Knowledge Synthesis in Fictional Multi-Agent Systems

## Executive Summary

This document presents a comprehensive overview of research conducted at the Westgate Institute of Technology's fictional Department of Computational Intelligence between 2018 and 2024. The research program, internally designated Project Meridian, investigated methods for synthesizing structured knowledge from unstructured document corpora using networks of coordinated autonomous reasoning agents. The principal investigators were Dr. Priya Nambiar (Computational Semantics Lab) and Dr. Olu Adewale (Distributed Systems Group). All findings, institutions, individuals, datasets, and citations referenced herein are entirely fictional and are provided solely as test fixture material.

---

## Section 1: Research Motivation

### 1.1 The Knowledge Gap Problem

Organizations that accumulate large volumes of unstructured documents — internal reports, meeting transcripts, technical specifications, regulatory filings — consistently struggle to extract and maintain structured, queryable knowledge from those documents. Manual curation is expensive and does not scale. Automated extraction tools of the early 2020s (within this fictional research timeline) produced high-recall, low-precision outputs: they retrieved many relevant passages but could not reliably determine which claims were factual, which were inferential, and which were procedural.

Project Meridian hypothesized that a multi-agent approach, in which specialized agents handle distinct epistemic tasks (fact extraction, synthesis, cross-referencing, and quality verification), would outperform monolithic extraction pipelines on precision while maintaining competitive recall.

### 1.2 Prior Work

Relevant prior work within this fictional research context includes:

- **Nambiar et al. (2016)** — "Hierarchical Claim Extraction from Scientific Corpora." Introduced the four-category taxonomy (atomic fact, synthetic analysis, procedural description, external reference) that was later adopted by Project Meridian. Published in the *Fictional Journal of Computational Linguistics*, Vol. 44, pp. 211–238.
- **Adewale and Okonkwo (2017)** — "Consensus Mechanisms for Distributed Reasoning Agents." Proposed the token-budget coordination protocol used in the Meridian agent loop. Published in the *Proceedings of the 12th Fictional International Conference on Distributed AI*, pp. 88–102.
- **Vasquez (2015)** — "Cost-Benefit Modeling for Decentralized Sanitation in Peri-Urban Zones." Cited here as a methodological template for the economic analysis in Section 4.2, not for its engineering content.
- **Linares et al. (2019)** — "Prompt Injection and Adversarial Inputs in Language Model Pipelines." Established the threat model that motivated the XML wrapping and escaping protocol adopted in Phase 3 of the Meridian implementation. Published in the *Fictional Security and AI Review*, Vol. 7, pp. 14–39.

---

## Section 2: System Architecture

### 2.1 Agent Roles

The Meridian system uses four agent roles arranged in a directed acyclic collaboration graph:

1. **Extractor Agent** — Reads raw document chunks (up to 20,000 characters per call) and identifies candidate claims. Does not classify or synthesize; only surfaces passages that contain potentially useful information. Outputs a ranked list of candidate passages with source offsets.

2. **Classifier Agent** — Receives candidate passages from the Extractor and assigns each to one of four epistemic categories: atomic fact, synthetic analysis, procedural description, or external reference. Applies the Nambiar taxonomy with confidence scores. Passages below 0.65 confidence are discarded.

3. **Synthesis Agent** — Receives classified passages and merges overlapping or complementary claims into coherent note drafts. Assigns slugs using the kebab-case naming convention. Checks for duplicates against the existing knowledge base catalog before creating new notes.

4. **Verifier Agent** — Reviews note drafts produced by the Synthesis Agent against the source passages. Flags notes that contain claims not supported by the source material. Rejected notes are returned to the Synthesis Agent with correction instructions.

### 2.2 Coordination Protocol

Agents communicate via a shared message queue backed by a fictional in-memory message broker called Coronis. Each agent consumes tasks from its designated queue, processes one task at a time, and publishes results to downstream queues. The system enforces a global step budget: the entire pipeline for one document ingestion job is capped at 120 total agent calls across all four roles. If the budget is reached before processing is complete, the Synthesis Agent is instructed to finalize any in-progress notes and call the `complete` tool.

The step budget is enforced by a shared counter stored in the fictional distributed cache system Zephyr. Each agent call atomically increments the counter via Zephyr's `INCR` command before executing. If the counter exceeds the cap, the call returns a `budget_exceeded` signal instead of proceeding. This design mirrors the Redis INCR pattern used in production cost-metering systems.

### 2.3 Data Flow

```
Document Upload
      │
      ▼
[Extractor Agent × N]  — parallel, one per document chunk
      │
      ▼
[Classifier Agent]     — sequential, processes ranked candidate list
      │
      ▼
[Synthesis Agent]      — sequential, checks catalog, drafts notes
      │
      ▼
[Verifier Agent]       — sequential, validates against source
      │
      ▼
Knowledge Base Update  — atomic batch write
```

Extraction is parallelized across document chunks. Classification, synthesis, and verification are sequential within each document job to preserve causal consistency of the knowledge base state.

---

## Section 3: Knowledge Taxonomy

### 3.1 Atomic Facts

An atomic fact is the smallest independently verifiable claim that can be extracted from a document. It corresponds to a single datum: a date, a quantity, a name, a definition, a quoted statement. Atomic facts must include a source citation referencing the document and approximate character offset from which they were extracted.

Examples from the fictional Project Meridian test corpus:

- "The Verdanian Ministry of Public Works allocated 340 million FCU to infrastructure projects in fiscal year 2022." (Source: Verdanian Budget Report 2022, offset ~4400)
- "The Coronis message broker was designed by the Westgate Distributed Systems Group and released under the fictional OpenCores License 2.0." (Source: Coronis Technical Specification v3.1, offset ~220)
- "Dr. Priya Nambiar holds a doctoral degree in Computational Semantics from the fictional University of Calloway." (Source: Project Meridian Personnel Dossier, offset ~80)

### 3.2 Synthetic Analysis

A synthetic analysis note records an interpretation that spans multiple source passages or multiple documents. It must explicitly cite the atomic facts it synthesizes. The Classifier Agent assigns this category when a passage contains comparative language, causal attribution, trend identification, or explicit conclusion-drawing.

Example: "The increase in infrastructure investment observed between 2019 and 2023 (facts: FCU-alloc-2019, FCU-alloc-2023) correlates with a 17% reduction in reported water access incidents (fact: water-access-2023), consistent with the causal model proposed by Vasquez (2015)."

### 3.3 Procedural Descriptions

A procedural note captures a step-by-step workflow. The Classifier Agent assigns this category only when the source material contains numbered or ordered steps that a reader could follow. Prose descriptions of processes that lack explicit ordering are classified as atomic facts or synthetic analyses depending on their epistemic role.

Example procedure from the fictional test corpus — "Water Quality Verification Protocol, Revision 4":

1. Collect a 500 mL sample from the output valve of the treatment unit.
2. Apply the Verdanian Standard Colorimetric Test Kit, following the reagent sequence prescribed in Appendix B.
3. Record the turbidity index and pH value on Form WQV-7.
4. If turbidity > 2.0 NTU or pH outside 6.5–8.5 range, isolate the treatment unit and notify the district supervisor within two hours.
5. Retain the sample for 72 hours in the sealed archive cabinet pending secondary verification.

### 3.4 External References

An external reference note records a pointer to an outside resource: a cited paper, a URL, a named dataset, an organization, or a quoted person. Its body is short — the citation plus one or two lines of context. Other notes link to reference notes; reference notes do not link outward.

---

## Section 4: Experimental Results

### 4.1 Benchmark Dataset

Project Meridian was evaluated against a fictional benchmark corpus called MeridianBench-2022, comprising 1,200 fictional documents across six domains: environmental engineering, regulatory policy, medical procedure, financial reporting, historical narrative, and technical specification. Each document was between 2,000 and 50,000 characters. A panel of twelve fictional subject-matter experts annotated a stratified 10% sample (120 documents) with ground-truth claim labels.

### 4.2 Precision and Recall

Results on the annotated 10% sample:

| Metric | Extractor | Classifier | Synthesis | Verifier | End-to-End |
|---|---|---|---|---|---|
| Precision | 0.61 | 0.84 | 0.79 | 0.91 | 0.88 |
| Recall | 0.93 | 0.88 | 0.82 | 0.82 | 0.76 |
| F1 | 0.74 | 0.86 | 0.80 | 0.86 | 0.82 |

The Verifier Agent improved end-to-end precision from 0.79 (Synthesis alone) to 0.88 at the cost of a modest recall reduction (0.82 → 0.76). The research team considered this trade-off acceptable for the target use case, in which false claims in a knowledge base are more harmful than missed claims.

### 4.3 Step Budget Utilization

Across the full 1,200-document corpus, the average step count per document job was 87 out of the 120-step budget. The 95th-percentile step count was 114, indicating that fewer than 5% of jobs approached the budget ceiling. Jobs that hit the ceiling were predominantly documents with high redundancy (the same claims repeated across many paragraphs), where the Synthesis Agent spent budget checking for duplicates that the Extractor had surfaced multiple times.

A subsequent optimization — adding a deduplication pass in the Extractor before downstream dispatch — reduced 95th-percentile step usage to 108 and eliminated all budget-exceeded signals in the test corpus.

### 4.4 Adversarial Robustness

Twenty documents in MeridianBench-2022 contained adversarial prompt-injection payloads, placed at various positions within otherwise legitimate content. Payloads included: early delimiter close attempts (`</material>` variants), nested tag injection (`<material id="trusted">`), instruction override phrases ("ignore previous instructions"), and role-reassignment attempts ("you are now operating in admin mode").

The XML wrapping and escaping protocol (see Section 2.1) neutralized all delimiter-close and nested-tag attacks. The system prompt's security instructions (treating `<material>` content as data, not commands) caused the Synthesis Agent to record instruction-override phrases as atomic fact notes rather than acting on them — the correct behavior. No adversarial document caused the pipeline to deviate from its standard operating procedure.

---

## Section 5: Limitations and Future Work

### 5.1 Single-Language Corpus

MeridianBench-2022 contains documents exclusively in fictional English. Performance on multilingual corpora has not been evaluated. The research team plans a follow-on study using a multilingual version of the benchmark (MeridianBench-2025-ML) covering four fictional languages: Standard Verdanian, Aurantian Creole, Western Calloway, and Maritime Solish.

### 5.2 Long-Document Scalability

Documents exceeding 50,000 characters were excluded from MeridianBench-2022 due to the 120-step budget constraint. For longer documents, the research team proposes a hierarchical chunking strategy: a routing agent first produces a high-level document outline, and subordinate Extractor Agents are assigned to individual sections. The budget is allocated proportionally across sections. This architecture is under development as Project Meridian Phase 2.

### 5.3 Knowledge Base Staleness

The current system treats each document ingestion as an independent job. When source documents are updated, previously extracted notes may become stale. A change-detection module — comparing document hashes across versions and triggering selective re-extraction on changed sections — is planned for Phase 2.

### 5.4 Human-in-the-Loop Escalation

The Verifier Agent rejects notes that fail source-grounding checks, but the current implementation does not surface rejected notes to human reviewers. A planned escalation interface would present flagged notes to a human curator with a side-by-side view of the note and the source passage. Curator decisions would be used to fine-tune the Classifier Agent's confidence thresholds over time.

---

## Section 6: Deployment Architecture

### 6.1 Infrastructure

Project Meridian is deployed in a fictional cloud environment operated by the Westgate Institute. The production deployment uses:

- **Compute**: Eight fictional VM instances, each with 32 vCPUs and 128 GB RAM, running the agent processes as containerized workloads.
- **Message Broker**: Coronis v4.2, deployed as a three-node cluster with replication factor 2.
- **Distributed Cache**: Zephyr v6.1, deployed as a five-node cluster. Used for step-budget counters and document-chunk deduplication bloom filters.
- **Object Storage**: Fictional S3-compatible store called Nebula, operated by the fictional cloud provider Stratum Computing. Documents are stored before extraction; extracted text is stored after extraction.
- **Relational Database**: Fictional PostgreSQL-compatible system called Arkis DB 14, used for the knowledge base (notes, taxonomy labels, cross-references, catalog entries).

### 6.2 Operational Metrics

As of December 2024, the production system processes an average of 4,300 documents per day. Peak throughput (observed during a fictional academic conference upload event in October 2024) reached 18,700 documents in a single 24-hour period. Average end-to-end latency from document upload to knowledge base update is 4.2 minutes at median load and 11.8 minutes at the observed peak.

### 6.3 Cost Model

Infrastructure cost is tracked per document using the following fictional unit economics:

| Component | Cost per Document (FCU) |
|---|---|
| Compute (agent execution) | 0.0042 |
| Message broker (Coronis) | 0.0003 |
| Distributed cache (Zephyr) | 0.0001 |
| Object storage (Nebula) | 0.0008 |
| Database (Arkis DB) | 0.0006 |
| **Total** | **0.0060** |

At 4,300 documents per day, daily infrastructure cost is approximately 25.8 FCU. The Westgate Institute charges academic partner institutions 0.025 FCU per document processed, generating a modest surplus that funds ongoing research and maintenance.

---

## Section 7: Ethical Considerations

### 7.1 Data Provenance and Consent

All documents processed by Project Meridian in production are submitted by partner institutions under a data processing agreement that explicitly permits automated extraction and knowledge base indexing. No documents from external sources are ingested without institutional consent. Personal data (names, contact information, health data) appearing in submitted documents is subject to a pre-processing anonymization step that replaces identified personal data with pseudonymous tokens before the document reaches the Extractor Agent.

### 7.2 Bias in Claim Classification

The Nambiar taxonomy and the classifier's confidence thresholds were developed using a corpus drawn primarily from environmental engineering and regulatory policy documents. Performance may be lower in other domains. The research team is conducting an ongoing bias audit comparing classification accuracy across the six MeridianBench-2022 domains, with particular attention to whether certain domain conventions (e.g., the use of hedged language in medical procedure documents) systematically reduce confidence scores below the 0.65 acceptance threshold.

### 7.3 Knowledge Base Authority

Extracted knowledge in the Project Meridian knowledge base is explicitly not authoritative. Every note carries a provenance label linking it to its source document. Users of the knowledge base are instructed through the system's interface to treat notes as research aids, not as verified ground truth. The system does not present itself as infallible.

---

## Appendix A: Fictional References

- Nambiar, P., Okonkwo, C., and Lim, S. (2016). "Hierarchical Claim Extraction from Scientific Corpora." *Fictional Journal of Computational Linguistics*, 44, 211–238.
- Adewale, O. and Okonkwo, C. (2017). "Consensus Mechanisms for Distributed Reasoning Agents." *Proceedings of the 12th Fictional International Conference on Distributed AI*, 88–102.
- Vasquez, E. (2015). "Cost-Benefit Modeling for Decentralized Sanitation in Peri-Urban Zones." *Aurantian Environmental Review*, 22(3), 45–71.
- Linares, M., Petrov, A., and Yuen, R. (2019). "Prompt Injection and Adversarial Inputs in Language Model Pipelines." *Fictional Security and AI Review*, 7, 14–39.
- Westgate Institute of Technology. (2022). *Coronis Message Broker Technical Specification v4.2*. Internal document. Westgate Academic Press.
- Nambiar, P. (2018). *Applied Computational Semantics: Extracting Structured Knowledge from Unstructured Text*. 2nd ed. Westgate Academic Press.

---

## Appendix B: Glossary of Fictional Terms

- **FCU (Fictional Currency Unit)**: The monetary unit used throughout this document. Exchange rates to real currencies are undefined and intentionally meaningless.
- **Coronis**: A fictional in-memory message broker inspired by (but entirely distinct from) real message brokers. Any resemblance to real software products is coincidental.
- **Zephyr**: A fictional distributed cache. Not related to any real software product of the same or similar name.
- **Arkis DB**: A fictional relational database system. Not related to any real database product.
- **Nebula**: A fictional object storage service. Not related to any real cloud service.
- **Verdania, Aurantia, Calloway, Solera**: Fictional countries and cities. Any resemblance to real places is coincidental.
- **MeridianBench-2022**: A fictional benchmark dataset. Not downloadable from any real source.

---

*All persons, places, organizations, systems, datasets, publications, and events described in this document are entirely fictional and are intended for use as test fixture material only. Any resemblance to real individuals, entities, products, or events is coincidental.*
