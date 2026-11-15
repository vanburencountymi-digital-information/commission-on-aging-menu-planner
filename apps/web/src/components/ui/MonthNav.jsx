import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export default function MonthNav({ year, month, onPrev, onNext }) {
  const date = new Date(year, month - 1, 1);
  return (
    <div className="flex items-center gap-2">
      <button onClick={onPrev} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
        <ChevronLeft size={18} />
      </button>
      <span className="text-lg font-semibold text-gray-900 w-40 text-center">
        {format(date, 'MMMM yyyy')}
      </span>
      <button onClick={onNext} className="p-1 rounded hover:bg-gray-100 text-gray-500 transition-colors">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
