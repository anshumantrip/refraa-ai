export const statuses = ['recommended', 'pending_review', 'approved', 'rejected', 'submitted', 'completed'];
export const transitions = {
  recommended: ['pending_review'], pending_review: ['approved', 'rejected'],
  approved: ['submitted'], rejected: [], submitted: ['completed'], completed: []
};
export function permitted({ status, next, manager, owner, independent }) {
  return transitions[status]?.includes(next) && (next === 'pending_review' ? owner || manager :
    manager && (!['approved', 'rejected'].includes(next) || !independent || !owner));
}
export function csv(rows) {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return '"' + (/^[\s\uFEFF]*[=+@\-\t\r\n]/.test(text) ? "'" : '') + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
