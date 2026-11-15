const STYLES = {
  DRAFT:     'bg-gray-100 text-gray-600',
  SUBMITTED: 'bg-yellow-100 text-yellow-700',
  APPROVED:  'bg-green-100 text-green-700',
  PUBLISHED: 'bg-blue-100 text-blue-700',
  ARCHIVED:  'bg-slate-100 text-slate-500',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STYLES[status] ?? STYLES.DRAFT}`}>
      {status}
    </span>
  );
}
