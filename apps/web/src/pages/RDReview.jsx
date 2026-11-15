import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { approvalApi } from '../lib/api';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function RDReview() {
  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['approval-queue'],
    queryFn: approvalApi.queue,
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-6 py-4 border-b bg-white flex-shrink-0">
        <h1 className="text-base font-semibold text-gray-800">RD Approval Queue</h1>
        <p className="text-xs text-gray-500 mt-0.5">Menus awaiting dietitian review</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

        {!isLoading && queue.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <ClipboardList className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No menus pending review</p>
          </div>
        )}

        {queue.map(menu => (
          <Link
            key={menu.id}
            to={`/approval/${menu.id}`}
            className="flex items-center justify-between p-4 bg-white border rounded-lg mb-3 hover:border-blue-400 hover:shadow-sm transition-all group"
          >
            <div>
              <p className="font-medium text-gray-800 group-hover:text-blue-700">
                {MONTH_NAMES[menu.month]} {menu.year}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Submitted by {menu.submitted_by_name ?? 'unknown'}
                {menu.submitted_at && (
                  <> · {new Date(menu.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </p>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
              Pending Review
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
