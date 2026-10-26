/**
 * Blueprint for grade 6 elementary TKA.
 *
 * Bahasa Indonesia and Matematika follow the official Pusmendik assessment
 * framework (Perka BSKAP 045/H/AN/2025). IPAS is flagged `provisional` because
 * its official framework has not been published -- its strands are derived from
 * the IPAS curriculum for grades 4-6. Once the official guidance lands, editing
 * this file is enough; existing questions stay valid because each is already
 * tagged with a strand and a competency.
 *
 * Strand, competency and difficulty keys stay in Indonesian: they are stored in
 * the database and shown in the Indonesian user interface.
 */

export const SUBJECTS = ['bahasa_indonesia', 'matematika', 'ipas'] as const;
export type Subject = (typeof SUBJECTS)[number];

export const QUESTION_TYPES = ['pg', 'pgk_multi', 'pgk_kategori'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const DIFFICULTIES = ['mudah', 'sedang', 'sulit'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const SUBJECT_LABEL: Record<Subject, string> = {
  bahasa_indonesia: 'Bahasa Indonesia',
  matematika: 'Matematika',
  ipas: 'IPAS',
};

export const SUBJECT_SHORT: Record<Subject, string> = {
  bahasa_indonesia: 'B. Indonesia',
  matematika: 'Matematika',
  ipas: 'IPAS',
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  pg: 'Pilihan ganda',
  pgk_multi: 'PG kompleks (banyak jawaban)',
  pgk_kategori: 'PG kompleks (kategori)',
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  mudah: 'Mudah',
  sedang: 'Sedang',
  sulit: 'Sulit',
};

type DomainSpec = { key: string; label: string; target: number };
type CompetencySpec = { key: string; label: string };

export type SubjectBlueprint = {
  subject: Subject;
  label: string;
  provisional: boolean;
  /** Number of items in the real TKA paper for this subject. */
  itemsInRealExam: number;
  /** Time allowance in the real TKA paper, in minutes. */
  minutesInRealExam: number;
  domains: DomainSpec[];
  competencies: CompetencySpec[];
  /** Target number of questions in the bank for this subject. */
  bankTarget: number;
};

export const BLUEPRINT: Record<Subject, SubjectBlueprint> = {
  bahasa_indonesia: {
    subject: 'bahasa_indonesia',
    label: 'Bahasa Indonesia',
    provisional: false,
    itemsInRealExam: 30,
    minutesInRealExam: 75,
    bankTarget: 120,
    domains: [
      { key: 'teks_informasi', label: 'Teks informasi', target: 72 },
      { key: 'teks_fiksi', label: 'Teks fiksi', target: 48 },
    ],
    competencies: [
      { key: 'tekstual', label: 'Pemahaman tekstual' },
      { key: 'inferensial', label: 'Pemahaman inferensial' },
      { key: 'evaluasi_apresiasi', label: 'Evaluasi & apresiasi' },
    ],
  },
  matematika: {
    subject: 'matematika',
    label: 'Matematika',
    provisional: false,
    itemsInRealExam: 30,
    minutesInRealExam: 75,
    bankTarget: 120,
    domains: [
      { key: 'bilangan', label: 'Bilangan', target: 48 },
      { key: 'geometri_pengukuran', label: 'Geometri & Pengukuran', target: 42 },
      { key: 'data_peluang', label: 'Data & Peluang', target: 30 },
    ],
    competencies: [
      { key: 'pengetahuan_matematis', label: 'Pengetahuan matematis' },
      { key: 'representasi', label: 'Representasi matematis' },
      { key: 'penalaran', label: 'Penalaran' },
      { key: 'penyelesaian_masalah', label: 'Penyelesaian masalah' },
      { key: 'koneksi', label: 'Koneksi matematis' },
    ],
  },
  ipas: {
    subject: 'ipas',
    label: 'IPAS',
    provisional: true,
    itemsInRealExam: 30,
    minutesInRealExam: 75,
    bankTarget: 120,
    domains: [
      { key: 'makhluk_hidup', label: 'Makhluk hidup & ekosistem', target: 20 },
      { key: 'tubuh_manusia', label: 'Tubuh manusia & kesehatan', target: 16 },
      { key: 'zat_perubahan', label: 'Zat & perubahannya', target: 12 },
      { key: 'energi_gaya', label: 'Energi, gaya & gerak', target: 20 },
      { key: 'bumi_antariksa', label: 'Bumi & antariksa', target: 16 },
      { key: 'geografi', label: 'Manusia, tempat & lingkungan', target: 14 },
      { key: 'sejarah', label: 'Waktu & perubahan', target: 12 },
      { key: 'sosial_ekonomi', label: 'Sosial-budaya & ekonomi', target: 10 },
    ],
    competencies: [
      { key: 'pemahaman_konsep', label: 'Pemahaman konsep' },
      { key: 'penerapan', label: 'Penerapan' },
      { key: 'penalaran_inkuiri', label: 'Penalaran & inkuiri' },
    ],
  },
};

/** Target mix of question formats in the bank, the same for every subject. */
export const TYPE_MIX: Record<QuestionType, number> = {
  pg: 0.7,
  pgk_multi: 0.2,
  pgk_kategori: 0.1,
};

/** Target mix of difficulty levels in the bank. */
export const DIFFICULTY_MIX: Record<Difficulty, number> = {
  mudah: 0.3,
  sedang: 0.5,
  sulit: 0.2,
};

export function isSubject(value: unknown): value is Subject {
  return typeof value === 'string' && (SUBJECTS as readonly string[]).includes(value);
}

export function domainsOf(subject: Subject): DomainSpec[] {
  return BLUEPRINT[subject].domains;
}

export function competenciesOf(subject: Subject): CompetencySpec[] {
  return BLUEPRINT[subject].competencies;
}

export function domainLabel(subject: Subject, key: string): string {
  return BLUEPRINT[subject].domains.find((d) => d.key === key)?.label ?? key;
}

export function competencyLabel(subject: Subject, key: string): string {
  return BLUEPRINT[subject].competencies.find((c) => c.key === key)?.label ?? key;
}

/** Every valid strand key, used by the question bank validator. */
export function allDomainKeys(subject: Subject): string[] {
  return BLUEPRINT[subject].domains.map((d) => d.key);
}

export function allCompetencyKeys(subject: Subject): string[] {
  return BLUEPRINT[subject].competencies.map((c) => c.key);
}
