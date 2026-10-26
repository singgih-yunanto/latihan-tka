# TKA Practice — Grade 6 Elementary

Web app for practising the Indonesian **Tes Kemampuan Akademik** (TKA) at
elementary level: **Bahasa Indonesia**, **Matematika**, and **IPAS**.

Three kinds of account, all created by an admin:

| Role | Can do |
|---|---|
| **Admin** | Everything: create every account, link parents to children, compose assignments for anyone, see all results, manage the question bank. |
| **Orang tua** (parent) | Assign work to **their own children only**, and monitor those children's results and analytics. One parent may have several children, and a child may have two parents. |
| **Murid** (student) | Work through the assignments given to them and review their own results. |

An admin or a parent composes an assignment with a per-subject question mix,
hands it to several children at once, sets the time limit, then reviews results
and analytics.

> The user interface and all question content are in Indonesian, because that is
> the language the children sit the exam in. Documentation and code comments are
> in English.

## What makes it different

- **A student never sees the same question twice.** Enforced at the database
  level and recorded at draw time, so two assignments created back to back
  cannot overlap.
- **Every student gets their own draw**, so children sitting next to each other
  do not work through an identical paper.
- **Answer options are shuffled** per student and then stored, so reloading the
  page never reshuffles them.
- **Timing follows the real exam** — 150 seconds per question — and the budget
  covers the whole assignment rather than each item.
- **Free navigation.** Students may move back and forth to any question, across
  subject boundaries, and change answers until they submit.
- **Illustrated questions** use SVG written directly into the question bank, so
  figures are reviewable in git and stay sharp at any screen size.
- **A parent sees their own children and nobody else's.** The rule is enforced
  inside every Server Action, not just hidden from the page, because Server
  Actions are publicly callable endpoints.

## Quick start

```bash
npm install
npm run db:migrate
npm run bank:sync
npm run seed:users -- "Dina" "Bayu" "Rani"
npm run create:admin -- --username ayah --nama "Nama Lengkap"
npm run dev
```

Open http://localhost:3000 and sign in. Everyone lands on the area their role
belongs to: `/admin`, `/wali` for a parent, `/u` for a student.

Seeded students receive a username derived from their first name (`Dina
Maharani` becomes `dina`) and a random one-time password, printed once, valid
for 7 days and changed at first sign-in. Accounts created or reset from the
admin panel get the same treatment. `create:admin` prompts for its password
rather than reading it from the command line, so it stays out of your shell
history.

To install on a server, see **[docs/DEPLOY.md](docs/DEPLOY.md)**.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Build and run in production mode |
| `npm test` | Run domain logic tests and question bank checks |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:backup` | Back up the database (VACUUM INTO) |
| `npm run bank:validate` | Check the question bank files |
| `npm run bank:sync` | Sync the question bank into the database |
| `npm run bank:stats` | Report bank coverage against the blueprint targets |
| `npm run bank:simulate` | Estimate how many more full TKA papers each student can sit without repeats |
| `npm run seed:users -- "Name"` | Add students and issue their default credentials |
| `npm run create:admin` | Create the first admin account (prompts for a password) |

## Adding questions

The question bank is a set of JSON files under `content/bank/`, one file per
batch. To add questions, write a new batch file there. The authoring rules live in
[docs/BLUEPRINT-TKA.md](docs/BLUEPRINT-TKA.md) and
[docs/FIGURE-GUIDE.md](docs/FIGURE-GUIDE.md). Afterwards run
`npm run bank:validate && npm run bank:sync`.

## Project layout

```
src/domain/      Core logic: blueprint, drawing, scoring, shuffling, timing, figures
src/db/          Drizzle schema, SQLite connection, migrations
src/app/         Student pages (/) and admin panel (/admin)
src/components/  Question runner, figure component, assignment form
content/bank/    Question bank (source of truth)
scripts/         Command line tooling
deploy/          systemd units, Nginx config, certificate and deploy scripts
docs/            Blueprint, figure guide, admin guide, deployment guide
```

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · SQLite via
better-sqlite3 and Drizzle ORM · KaTeX · Vitest.

A single Node process serves both the UI and the API. SQLite in WAL mode suits
single-server use without redundancy.

## A note on TKA coverage

Bahasa Indonesia and Matematika follow the official Pusmendik assessment
framework. IPAS is marked **provisional**: its addition to elementary TKA was
only announced for 2027 and the official framework has not been published yet,
so its strands are derived from the IPAS curriculum for grades 4–6. Once the
official guidance is released, editing `src/domain/blueprint.ts` is enough.
