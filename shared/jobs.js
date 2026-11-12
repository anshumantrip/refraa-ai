import { z } from 'zod';

export const jobStatuses = ['draft', 'published', 'archived'];
export const employmentTypes = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
export const experienceTypes = ['Full-time', 'Internship', 'Projects', 'Combined'];
export const educationLevels = ['Any level', 'Secondary', 'Diploma', 'Undergraduate', 'Postgraduate', 'Doctorate'];
export const cgpaScales = { 4: 4, 10: 10, percentage: 100 };
export const criterionTypes = ['Relevant projects', 'Internships', 'Certifications', 'Domain knowledge',
  'Technical proficiency', 'Job-specific requirements'];
export const criterionPriorities = ['Mandatory', 'Preferred', 'Informational'];
export const MAX_SKILLS = 20;
export const MAX_CRITERIA = 12;
export const MAX_REFERRALS = 100;
export const DEFAULT_REFERRALS = 3;

export const skillKey = name => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const short = z.string().trim().max(120).default('');
const optionalNumber = (max) => z.number().min(0).max(max).nullable().default(null);
const skill = z.object({
  name: z.string().trim().min(1, 'Enter a skill name.').max(60),
  proficiency: short, evidence: z.string().trim().max(240).default('')
}).strict();

export const experienceSchema = z.object({
  enabled: z.boolean().default(false), minimumYears: optionalNumber(60), maximumYears: optionalNumber(60),
  experienceTypes: z.array(z.enum(experienceTypes)).max(experienceTypes.length)
    .refine(items => new Set(items).size === items.length, 'Select each experience type once.').default(['Combined']),
  includeFreshers: z.boolean().default(false), relevantOnly: z.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  if (!value.enabled) return;
  if (value.minimumYears === null) ctx.addIssue({ code: 'custom', path: ['minimumYears'], message: 'Enter minimum experience in years.' });
  if (value.maximumYears !== null && value.maximumYears < value.minimumYears) {
    ctx.addIssue({ code: 'custom', path: ['maximumYears'], message: 'Maximum experience must be at least the minimum.' });
  }
  if (!value.experienceTypes.length) ctx.addIssue({ code: 'custom', path: ['experienceTypes'], message: 'Select an experience type.' });
});

export const cgpaSchema = z.object({
  enabled: z.boolean().default(false), minimumCGPA: optionalNumber(100), maximumCGPA: optionalNumber(100),
  scale: z.enum(['4', '10', 'percentage']).default('10'),
  educationLevel: z.enum(educationLevels).default('Any level'), allowUnavailable: z.boolean().default(false)
}).strict().superRefine((value, ctx) => {
  const limit = cgpaScales[value.scale];
  if (value.minimumCGPA > limit || value.maximumCGPA > limit) {
    ctx.addIssue({ code: 'custom', path: ['scale'], message: 'CGPA values must fit the selected scale (0–' + limit + ').' });
  }
  if (value.enabled && value.minimumCGPA === null) {
    ctx.addIssue({ code: 'custom', path: ['minimumCGPA'], message: 'Enter the minimum CGPA.' });
  }
  if (value.enabled && value.maximumCGPA !== null && value.maximumCGPA < value.minimumCGPA) {
    ctx.addIssue({ code: 'custom', path: ['maximumCGPA'], message: 'Maximum CGPA must be at least the minimum.' });
  }
});

const details = z.object({
  title: z.string().trim().min(1, 'Enter a job title.').max(120),
  description: z.string().trim().min(1, 'Enter a job description.').max(5000),
  department: short, location: short, employmentType: z.union([z.enum(employmentTypes), z.literal('')]).default(''),
  education: z.string().trim().max(500).default(''),
  deadline: z.union([z.iso.date(), z.literal('')]).default('')
});
const skills = z.object({
  requiredSkills: z.array(skill).max(MAX_SKILLS).default([]), preferredSkills: z.array(skill).max(MAX_SKILLS).default([])
}).superRefine((value, ctx) => {
  const seen = new Set();
  for (const group of ['requiredSkills', 'preferredSkills']) {
    for (const entry of value[group]) {
      const key = skillKey(entry.name);
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [group], message: 'Each skill can appear only once across both lists.' });
      seen.add(key);
    }
  }
});
const criterion = z.object({
  type: z.enum(criterionTypes), priority: z.enum(criterionPriorities),
  description: z.string().trim().min(1, 'Describe the additional criterion.').max(400)
}).strict();
const experience = z.object({ experienceCriteria: experienceSchema.prefault({}) });
const cgpa = z.object({ cgpaCriteria: cgpaSchema.prefault({}) });
const additional = z.object({ additionalCriteria: z.array(criterion).max(MAX_CRITERIA).default([]) });
const referral = z.object({
  referralCount: z.number().int().min(1, 'Choose at least one candidate.')
    .max(MAX_REFERRALS, 'Choose at most ' + MAX_REFERRALS + ' candidates.').default(DEFAULT_REFERRALS)
});

export const jobSteps = [details, skills, experience, cgpa, additional, referral];
export const jobConfigSchema = z.strictObject(Object.assign({}, ...jobSteps.map(step => step.shape)))
  .superRefine((value, ctx) => {
    const result = skills.safeParse(value);
    if (!result.success) for (const issue of result.error.issues) ctx.addIssue(issue);
  });

export function newJob() {
  return { ...jobConfigSchema.parse({ title: 'Untitled', description: 'Untitled' }), title: '', description: '' };
}
