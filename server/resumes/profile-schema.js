import { z } from 'zod';

const optionalText = z.string().max(600).nullable();
const score = z.number().nonnegative().finite().nullable();
const education = z.strictObject({
  text: z.string().max(600), degree: optionalText, institution: optionalText,
  cgpa: score, scale: score, percentage: score, dateRange: optionalText
});
const entry = z.strictObject({
  text: z.string().max(600), title: optionalText, description: optionalText,
  startDate: optionalText, endDate: optionalText, duration: optionalText
});
const source = z.strictObject({
  line: z.number().int().positive(), excerpt: z.string().max(600), method: z.literal('deterministic')
});

export const profileResult = z.strictObject({
  text: z.string().min(1).max(251_000),
  data: z.strictObject({
    name: z.string().max(80).nullable(), email: z.string().max(600).nullable(), phone: z.string().max(16).nullable(),
    education: z.array(education).max(100), skills: z.array(z.string().max(100)).max(100),
    experience: z.array(entry).max(100), internships: z.array(entry).max(100),
    projects: z.array(entry).max(100), certifications: z.array(entry).max(100)
  }),
  evidence: z.record(z.string(), z.union([source, z.array(source).max(100)]))
});
