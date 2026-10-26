# Admin Guide

Day-to-day usage for an admin or a parent.

> The admin panel itself is in Indonesian. This guide describes it in English;
> screen labels are quoted as they appear.

## Signing in

Everyone — admin, parent and student alike — opens
`https://<server-address>/` and signs in with a username and password. You then
land on the area your role belongs to, and cannot reach the others:

| Role | Lands on | Can do |
|---|---|---|
| **Admin** | `/admin` | Everything, including creating accounts and managing the question bank |
| **Orang tua** (parent) | `/wali` | Assign work to and monitor **their own children only** |
| **Murid** (student) | `/u` | Work through their own assignments and review their own results |

A session lasts 30 days. **Keluar** in the top right ends it.

---

## Accounts

**Admin → Kelola akun.** Every account in the system is created here.

### Creating one

Fill in the full name, optionally a username (leave it blank and one is derived
from the first name — `Dina Maharani` becomes `dina`), pick the role, and press
**Tambah akun**. The account gets its own random one-time password, shown once
in the green box under the form. **Salin** copies the username or the password, and
**Salin keduanya** copies both, ready to paste into a message. Hand it over right away:
it is not stored anywhere and cannot be shown again. It works for 7 days and must
be replaced at first sign-in. If it is lost or expires, press **Reset sandi** for
a new one.

A banner at the top of the page counts how many accounts are still on a one-time
password, and each such row carries a **kata sandi sementara** badge, so none
get forgotten.

### Linking a parent to their children

A parent account on its own sees nothing. On the parent's row, pick a child from
the dropdown under **Anak yang dipantau** and press **Hubungkan**. Repeat for
each child. Press the **×** next to a name to unlink.

The relationship is many-to-many on purpose: one parent may have several
children, and a child may have both parents linked to them.

### The other buttons

- **Simpan** saves an edited name, username or role. You cannot change your own
  role, which keeps you from locking yourself out of the admin panel.
- **Reset sandi** issues a fresh one-time password (shown once) and forces a
  change at the next sign-in. Use it when somebody forgets theirs. It also signs
  that person out everywhere, so a device still logged in cannot be used to work
  around the reset.
  Locked out of the admin panel, or resetting many accounts at once? On the
  server, `npm run user:reset-password -- <username>` (or `--role student`,
  `--pending`) does the same from the command line; see `docs/DEPLOY.md`.
- **Nonaktifkan** deactivates an account. It takes effect on that person's very
  next request, even if they are signed in at the time. Past results are kept,
  and a deactivated student no longer appears when assigning new work.
- Sessions also end on their own after 7 days without use, which matters on a
  tablet the whole family shares.

### Changing your own password

**Akun** in the top right, on any page. Changing it signs you out of every other
device.

---

## Creating an assignment

**Admin → Penugasan → Buat penugasan**

### 1. Question mix per subject

Set the number of questions for each subject. A subject left at `0` is not
included. For example Bahasa Indonesia 10, Matematika 15, IPAS 5 → 30 questions
total.

The arrows on the left of each row control the order of the question blocks the
student will see. There are also quick presets, including **TKA penuh** (30
questions per subject).

The **Filter** button on each row restricts the draw to particular strands,
competencies, question formats or difficulty levels. This is useful for drilling
one specific weakness, for example Geometri & Pengukuran only. With nothing
ticked, everything is eligible.

**Komposisi seperti TKA asli** (on by default) shapes each student's draw like a
real paper: strands in proportion to the blueprint targets, and difficulty at
30% easy, 50% medium, 20% hard within each strand. Where the bank runs short in
one cell the gap is filled from the same strand, then from the whole subject.
Turn it off for a purely random draw.

### 2. Choosing students

Tick the students who receive it. **Pilih semua** (select all) is at the top
right. As a parent you are offered only your own children, and the server
refuses the assignment outright if it names anyone else.

Each student gets their own draw, so they do not sit an identical paper.

### 3. Time limit

The time budget covers the **whole assignment**, not each question and not each
subject. Students divide the time as they see fit.

| Mode | Meaning |
|---|---|
| **Proporsional TKA** | 150 seconds per question, matching the real exam (30 questions = 75 minutes). 30 questions → 1 h 15 min; 90 questions → 3 h 45 min |
| **Atur sendiri** | Enter a number of minutes for the whole assignment |
| **Tanpa batas waktu** | No countdown |

The clock starts when the student presses **Mulai mengerjakan**, not when the
assignment is created. Closing the tab or reloading the page does not give the
time back. The countdown follows the server's clock, not the device's, so a
tablet with the wrong time still gets exactly the time it is owed. Answers given
in the last seconds are saved before the attempt is graded.

An optional **Tenggat** (due date) shows on the student's list, turning red once
it has passed. It is a reminder only: late work can still be done.

### 4. Availability preview

Press **Periksa** to see how many unseen questions each student still has. Green
means enough, red means short.

If it is short, there are four ways out:

1. Reduce the number of questions
2. Loosen the filters
3. Add questions to the bank (see the next section)
4. Tick **Izinkan soal terulang bila stok habis** (allow repeats when stock runs out)

Repeats are off by default, so a student will **never** receive an item they
have already been given.

---

## Adding questions to the bank

The question bank lives as JSON files in `content/bank/`. Adding to it happens
by writing a new batch file there, not through the admin panel.

Each batch is one file named `<subject>-<strand>-<seq>.json`, for example
`mtk-data-03.json`. Write it following `docs/BLUEPRINT-TKA.md` (taxonomy, target
distribution, authoring rules, file format) and `docs/FIGURE-GUIDE.md` (inline
SVG figures). Then run the checks:

```bash
npm run bank:validate   # schema, answer keys, duplicates, SVG safety
npm run bank:sync       # load into the database
npm run bank:stats      # coverage against targets
```

To find out whether the bank is still deep enough, run:

```bash
npm run bank:simulate
```

That estimates how many more full TKA papers (90 questions) each student can sit
before running out of unseen items. It works on a temporary copy, so real
student history is untouched.

`bank:sync` is safe to run at any time, including while the app is serving
students — new items become drawable without a restart.

The commands above load the bank on the machine you run them on. To put new
questions on the live server, commit and push the files, then run
`sudo -u tka bash /opt/tka/deploy/add-questions.sh` there. See "Adding
questions to a running server" in `docs/DEPLOY.md`.

Items removed from the files are only **deactivated** in the database, never
deleted, so past results remain viewable.

---

## Reviewing results

**Admin → Hasil** lists every attempt: student, assignment, status, score, total
time, and finish time. It can be filtered per student, printed, and exported to
CSV (the export carries both the overall score and the per-subject scores).
Parents get the same page, print button and export, limited to their own
children. An attempt whose time ran out is graded the moment any of these pages
opens, so nothing sits on "Sedang dikerjakan" after its deadline.

Click **Detail** to see answers item by item against the key, the score
breakdown by strand and by competency, and every question in full including its
figures.

The **Kosongkan & ulangi** button clears the answers and returns the assignment
to the not-started state. The questions already drawn stay in the student's
history, so they will re-sit the same paper rather than get a fresh draw. The
finished score is archived first and shown under **Riwayat pengerjaan
sebelumnya**: the first sitting is the honest measure, because by the second the
student has seen the key and the explanations.

Under every question, on this page and on the student's own results page, a
**Laporkan soal ini** link sends a note to **Admin → Bank soal** (a wrong key, a
typo, a figure that does not match). Fix the item in `content/bank/` and run
`npm run bank:sync`, or press **Tarik dari undian** to stop it being drawn. A
withdrawn item stays withdrawn across deploys and syncs. Scores already given
never change either way: each attempt keeps its own frozen copy of the options
and key.

---

## Analytics

**Admin → Analitik** shows:

- **Per student** — score trend per subject with an estimate of the TKA score
  (the average of the last three results), the three weakest and strongest
  strands (only counted once there are at least 3 items in that strand) with a
  **Latih bagian ini** link that opens a pre-filled practice on exactly those
  strands, a competency breakdown, and how many unseen questions remain in the
  bank, also expressed as full TKA papers. Red means the student cannot sit
  another full paper in that subject without repeats.
- **Item analysis** — the items answered wrongly most often, flagged when the
  difficulty recorded in the bank appears to disagree with real results, plus
  how many items nobody has attempted yet

These numbers only become meaningful after several sittings.

---

## Ranking

**Peringkat** is a shared leaderboard. Admins find it in the admin menu, parents in
theirs, and students through the **Peringkat** link on their task list.

- **Score.** Each child's score is their pooled result over every finished
  assignment: total points earned over total points possible. A short quiz
  therefore counts for less than a full tryout.
- **Tabs.** There are tabs for all subjects and for each subject, and a toggle
  between the last 30 days and all time.
- **Minimum.** A child needs at least 20 answered questions in the chosen tab to
  be ranked. Until then they appear under **Belum cukup soal** with a count such
  as 12/20.
- **Ties.** Children with equal scores share a place, so the order runs 1, 1, 3.
- **Highlights.** A student's own row and a parent's own children are
  highlighted, with a "peringkat 3 dari 12" card above the board.

**Privacy.** Everyone who can open the board sees every ranked child's full
name and average, across families. They see nothing more: there are no links
to other children's results or answers. Tell families before you switch it on.

**Controls (admin only):**

- **Nonaktifkan peringkat / Aktifkan peringkat** on the Peringkat page turns the
  feature off or on for everyone. When it is off, the menu links disappear and
  the page tells students and parents it has been switched off. Admins still
  see the board.
- **Sembunyikan** on a row, or **Sembunyikan dari peringkat** under **Kelola akun**,
  takes one student off the board, for example a test account or a child who
  prefers not to be shown. **Tampilkan lagi** brings them back.
- Deactivated students are left off automatically.

Every child gets a different set of questions, so the board is an indication,
not an official grade. The page says so too.

---

## Managing students

See **[Accounts](#accounts)** above — students, parents and admins are all
managed from the same page.

---

## A note on IPAS

IPAS is marked **provisional** throughout the app. Kemendikdasmen announced the
addition of a science subject to elementary TKA from 2027, but the official
assessment framework has not been published. Until it is, the IPAS strands here
are derived from the IPAS curriculum for grades 4–6.

When the official guidance is released, editing `src/domain/blueprint.ts` is
enough. Existing questions stay usable because each one already carries its
strand and competency tags.
