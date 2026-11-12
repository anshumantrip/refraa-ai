export const defaultWeights = Object.freeze({
  requiredSkills: 40, preferredSkills: 20, experience: 15, cgpa: 10, projects: 15
});

export const weightLabels = Object.freeze({
  requiredSkills: 'Required skills', preferredSkills: 'Preferred skills',
  experience: 'Experience', cgpa: 'CGPA', projects: 'Projects'
});

export function scoringConfiguration({ experienceCriteria, cgpaCriteria }) {
  const active = Object.entries(defaultWeights).filter(([key]) =>
    (key !== 'experience' || experienceCriteria?.enabled === true) &&
    (key !== 'cgpa' || cgpaCriteria?.enabled === true));
  const sum = active.reduce((total, [, weight]) => total + weight, 0);
  // Allocate whole basis points by largest remainder so the total is always exactly 10,000.
  const parts = active.map(([key, weight], index) => ({
    key, index, points: Math.floor(weight * 10_000 / sum), remainder: (weight * 10_000) % sum
  }));
  const unallocated = 10_000 - parts.reduce((total, part) => total + part.points, 0);
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const part of byRemainder.slice(0, unallocated)) part.points++;
  return {
    basisPoints: Object.fromEntries(parts.map(({ key, points }) => [key, points])),
    totalBasisPoints: 10_000,
    eligibilityCriteria: {
      ...(experienceCriteria?.enabled === true && { experience: { ...experienceCriteria } }),
      ...(cgpaCriteria?.enabled === true && { cgpa: { ...cgpaCriteria } })
    }
  };
}
