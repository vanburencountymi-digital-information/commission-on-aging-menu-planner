const COLORS = {
  HOT:    'bg-orange-100 text-orange-800 border-orange-200',
  COLD:   'bg-sky-100 text-sky-800 border-sky-100',
  FROZEN: 'bg-purple-100 text-purple-800 border-purple-200',
};

export default function RecipeChip({ name, type, onRemove }) {
  return (
    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${COLORS[type] ?? COLORS.HOT}`}>
      <span className="truncate max-w-[130px]">{name}</span>
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="flex-shrink-0 opacity-50 hover:opacity-100 leading-none ml-0.5"
        >
          ×
        </button>
      )}
    </div>
  );
}
