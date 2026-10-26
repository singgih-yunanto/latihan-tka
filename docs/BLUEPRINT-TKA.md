# TKA Question Bank Blueprint — Grade 6 Elementary

The rules to follow whenever a new batch of questions is written. The
machine-readable source of truth is `src/domain/blueprint.ts` — if the two ever
disagree, the TypeScript file wins and this document must be updated.

> Questions themselves are written in Indonesian. Only this guidance is in
> English.

## 1. Subjects and status

| Subject | Status | Strands | Competencies |
|---|---|---|---|
| Bahasa Indonesia | Compulsory since TKA 2025 | Teks informasi, Teks fiksi | Literal comprehension, Inferential comprehension, Evaluation & appreciation |
| Matematika | Compulsory since TKA 2025 | Bilangan, Geometri & Pengukuran, Data & Peluang | Mathematical knowledge, Representation, Reasoning, Problem solving, Connections |
| IPAS | **Provisional** — added from TKA 2027 | 8 strands (see below) | Conceptual understanding, Application, Reasoning & inquiry |

> **IPAS is provisional.** Kemendikdasmen announced the addition of a science
> subject to elementary TKA starting 2027, but the BSKAP assessment framework
> has not been published. The strands below are derived from the IPAS curriculum
> for grades 4–6. Once the official guidance lands, edit
> `src/domain/blueprint.ts`; existing questions stay usable because each one is
> already tagged with a strand and a competency.

## 2. Target distribution (120 items per subject)

**Bahasa Indonesia** — Teks informasi 72 · Teks fiksi 48

**Matematika** — Bilangan 48 · Geometri & Pengukuran 42 · Data & Peluang 30

**IPAS** — Living things & ecosystems 20 · Human body & health 16 ·
Matter & its changes 12 · Energy, force & motion 20 · Earth & space 16 ·
People, place & environment 14 · Time & change 12 · Society & economy 10

Applies to all three subjects:

- **Question formats** — `pg` 70% · `pgk_multi` 20% · `pgk_kategori` 10%
- **Difficulty** — easy 30% · medium 50% · hard 20%
- **Competencies** — spread evenly within each strand

Check where the bank currently stands with `npm run bank:stats`.

## 3. Authoring rules

### General

1. **Indonesian context, close to a child's daily life** — names, places, food,
   school activities, markets, rice fields, community health posts. Avoid
   foreign settings.
2. **Plain sentences.** Keep the stem under roughly 40 words and the vocabulary
   at grade 6 level.
3. **One problem per item.** Do not stack two concepts into a single question
   unless the item is specifically testing connections.
4. **Distractors must be plausible** and ideally reflect mistakes children
   actually make (wrong unit, forgetting to halve, misreading a chart). Lazy
   distractors make the item too easy.
5. **No position-dependent options** — "all of the above", "A and C", "none of
   these". Option order is shuffled per student, so such options break. The
   validator rejects them.
6. **Keep option lengths balanced.** An answer key that is always the longest
   option is a pattern children spot quickly.
7. **Explanations must teach**, not just name the key. Show the working, or say
   why the popular wrong answer is wrong.
8. **Question `id`** follows `<subject>-<strand>-<number>`, e.g. `mtk-geo-0031`,
   `bi-info-0007`, `ipas-energi-0012`.

### Bahasa Indonesia

- Every item **must** attach to a stimulus (`stimulusId`) — the subject tests
  reading skill, not recall. An automated test enforces this.
- One stimulus serves 3–5 items; passages run 150–400 words.
- **Teks informasi**: news, popular articles, procedures, reports, infographics.
- **Teks fiksi**: children's stories, fables, folk tales, poems and pantun.
- Vary the competency within a single stimulus — do not make every item ask for
  explicitly stated information.
  - *Literal* — stated information, word meaning, main idea
  - *Inferential* — conclusions, implied meaning, character traits, cause and effect
  - *Evaluation & appreciation* — judging the author's purpose, moral, opinions grounded in the text

### Matematika

- **Every** Geometri & Pengukuran and Data & Peluang item must have a figure
  (there is an automated test). See `FIGURE-GUIDE.md`.
- Keep numbers reasonable for grade 6: sensible denominators, divisions that
  come out whole unless that is the point of the item.
- Formulas use KaTeX syntax between `$...$`, e.g. `$\frac{3}{4}$`.
- Write units in full and consistently (cm, cm², cm³, kg, litre).
- Core material: arithmetic operations, fractions/decimals/percentages, LCM and
  GCF, ratio and scale, plane and solid figures, area/perimeter/volume, units,
  angles, data presentation, mean/median/mode, simple probability.

### IPAS

- Draw on material from grades 4, 5 and 6 — not grade 6 alone.
- Favour application and reasoning over recalling definitions.
- *Reasoning & inquiry* items should present experimental or observational data
  and ask for a conclusion.
- Social strands (geography, history, society and economy) stay in an Indonesian
  context: physical geography, Nusantara kingdoms, independence figures,
  economic activity, cultural diversity.

## 4. File format

One file per batch, placed in `content/bank/` and named
`<subject>-<strand>-<sequence>.json`.

```jsonc
{
  "batch": "mtk-geo-01",
  "note": "Geometri & Pengukuran, plane figures",
  "stimuli": [],
  "questions": [
    {
      "id": "mtk-geo-0001",
      "subject": "matematika",
      "domain": "geometri_pengukuran",
      "competency": "penyelesaian_masalah",
      "difficulty": "sedang",
      "type": "pg",
      "stem": "Perhatikan gambar. Berapa luas trapesium tersebut?",
      "figure": { "kind": "svg", "svg": "<svg viewBox=\"0 0 220 150\">...</svg>",
                  "alt": "Trapesium dengan sisi sejajar 14 cm dan 8 cm, tinggi 6 cm" },
      "choices": [
        { "id": "a", "text": "$66$ cm²" },
        { "id": "b", "text": "$88$ cm²" },
        { "id": "c", "text": "$132$ cm²" },
        { "id": "d", "text": "$44$ cm²" }
      ],
      "answer": "a",
      "explanation": "Luas trapesium $=\\frac{(14+8)\\times 6}{2}=\\frac{132}{2}=66$ cm²."
    }
  ]
}
```

The shape of `answer` follows `type`:

| `type` | content | `answer` |
|---|---|---|
| `pg` | `choices` (min. 3) | one option id: `"b"` |
| `pgk_multi` | `choices` (min. 3) | array of ids, min. 2, never all of them: `["a","c"]` |
| `pgk_kategori` | `statements` + `categories` (min. 2 each) | object: `{"s1":"benar","s2":"salah"}` |

Note that strand, competency and difficulty values stay in Indonesian, because
they are database keys shared with the running application.

## 5. Adding a batch

```bash
# 1. Write the new file under content/bank/
npm run bank:validate     # schema, answer keys, duplicates, SVG safety
npm run bank:sync         # load into the database (idempotent)
npm run bank:stats        # see where the bank stands against targets
```

`bank:sync` is safe to run at any time, including while the app is serving
students — new items become drawable without a restart. Items removed from the
files are only **deactivated** in the database rather than deleted, so past
results remain viewable.
