import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, XCircle, ArrowLeft, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { menusApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import CalendarGrid from '../components/calendar/CalendarGrid';
import NutrientBar from '../components/nutrition/NutrientBar';

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const SEVERITY_STYLE = {
  ERROR:   'bg-red-50 border-red-200 text-red-800',
  WARNING: 'bg-amber-50 border-amber-200 text-amber-800',
  FLAG:    'bg-blue-50 border-blue-200 text-blue-800',
};

const STATUS_STYLES = {
  PASS:    { bar: 'bg-green-600',  bg: 'bg-green-50 border-green-200',  text: 'text-green-800',  label: 'All Clear' },
  WARNING: { bar: 'bg-amber-500',  bg: 'bg-amber-50 border-amber-200',  text: 'text-amber-800',  label: 'Minor Issues' },
  ERROR:   { bar: 'bg-red-600',    bg: 'bg-red-50 border-red-200',      text: 'text-red-800',    label: 'Compliance Failures' },
};

function AISummaryPanel({ menuId, enabled }) {
  const [expanded, setExpanded] = useState(true);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ['review-summary', menuId],
    queryFn: () => menusApi.reviewSummary(menuId),
    enabled: !!enabled,
    staleTime: 10 * 60 * 1000, // cache for 10 min — this is an expensive AI call
    retry: false,
  });

  if (!enabled) return null;

  const style = summary ? (STATUS_STYLES[summary.overall_status] ?? STATUS_STYLES.WARNING) : null;

  return (
    <div className={`mb-5 rounded-xl border overflow-hidden ${style?.bg ?? 'bg-slate-50 border-slate-200'}`}>
      {/* Header bar */}
      <button
        onClick={() => setExpanded(e => !e)}
        className={`w-full flex items-center justify-between px-4 py-3 ${style?.bg ?? 'bg-slate-50'}`}
      >
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${style?.text ?? 'text-slate-500'}`} />
          <span className={`text-sm font-semibold ${style?.text ?? 'text-slate-700'}`}>
            AI Review Summary
            {summary && (
              <span className={`ml-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                summary.overall_status === 'PASS'    ? 'bg-green-100 text-green-700' :
                summary.overall_status === 'WARNING' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>
                {style.label}
              </span>
            )}
          </span>
          {isLoading && (
            <span className="text-xs text-slate-400 ml-1">Generating…</span>
          )}
        </div>
        {summary && (expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />)}
      </button>

      {/* Content */}
      {isLoading && (
        <div className="px-4 pb-4">
          <div className="h-2 bg-slate-200 rounded animate-pulse mb-2 w-3/4" />
          <div className="h-2 bg-slate-200 rounded animate-pulse mb-2 w-1/2" />
          <div className="h-2 bg-slate-200 rounded animate-pulse w-2/3" />
        </div>
      )}

      {error && (
        <div className="px-4 pb-3 text-xs text-slate-500">
          {error.response?.data?.error ?? 'Summary unavailable — AI service may not be configured.'}
        </div>
      )}

      {summary && expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Compliance score */}
          <div className="flex items-center gap-3 text-sm">
            <span className={`font-medium ${style.text}`}>
              {summary.compliant_days} / {summary.total_active_days} days compliant
            </span>
            <div className="flex-1 h-1.5 bg-white/60 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${style.bar}`}
                style={{ width: `${summary.total_active_days > 0 ? (summary.compliant_days / summary.total_active_days) * 100 : 0}%` }}
              />
            </div>
          </div>

          {/* Key findings */}
          {summary.key_findings?.length > 0 && (
            <ul className={`text-xs space-y-1 ${style.text}`}>
              {summary.key_findings.map((f, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="mt-0.5 flex-shrink-0">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Flagged days */}
          {summary.flagged_days?.length > 0 && (
            <div>
              <p className={`text-xs font-semibold mb-1 ${style.text}`}>
                Flagged days ({summary.flagged_days.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {summary.flagged_days.map(d => (
                  <span
                    key={d.date}
                    title={d.reasons?.join('; ')}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-help ${
                      summary.overall_status === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended action */}
          {summary.recommended_action && (
            <div className={`text-xs font-medium px-3 py-2 rounded-lg border ${
              summary.overall_status === 'PASS'
                ? 'bg-white/60 border-green-200 text-green-900'
                : summary.overall_status === 'ERROR'
                ? 'bg-white/60 border-red-200 text-red-900'
                : 'bg-white/60 border-amber-200 text-amber-900'
            }`}>
              <span className="font-semibold">Recommended action: </span>
              {summary.recommended_action}
            </div>
          )}

          <p className="text-[10px] text-slate-400">
            AI-generated summary · advisory only · professional judgment governs approval
          </p>
        </div>
      )}
    </div>
  );
}

function ApproveDialog({ onConfirm, onCancel, isPending }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-start gap-3 mb-4">
          <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900">Confirm Approval</h3>
            <p className="text-sm text-gray-600 mt-1">
              By approving this menu you confirm it meets OAA Title III-C nutritional
              requirements. This action is logged with your name and timestamp.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Approving…' : 'Approve Menu'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RDReviewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();

  const [rdNotes, setRdNotes] = useState('');
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const { data: menu, isLoading: menuLoading } = useQuery({
    queryKey: ['menu', id],
    queryFn: () => menusApi.get(id),
  });

  const { data: nutrition, isLoading: nutritionLoading } = useQuery({
    queryKey: ['nutrition', id],
    queryFn: () => menusApi.getNutrition(id),
    enabled: !!menu,
  });

  const approveMutation = useMutation({
    mutationFn: () => menusApi.approve(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-queue'] });
      navigate('/approval');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => menusApi.reject(id, rdNotes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-queue'] });
      navigate('/approval');
    },
  });

  function handleReject() {
    if (!rdNotes.trim()) {
      setRejectError('Notes are required when rejecting a menu.');
      return;
    }
    setRejectError('');
    rejectMutation.mutate();
  }

  const isSelf = menu?.submitted_by && menu.submitted_by === user?.id;
  const isLoading = menuLoading || nutritionLoading;

  // Collect all unresolved conflicts across all days
  const allConflicts = menu?.days?.flatMap(d => d.conflicts ?? []) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/approval')}
          className="text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-base font-semibold text-gray-800">
            {menu ? `${MONTH_NAMES[menu.month]} ${menu.year}` : 'Loading…'}
          </h1>
          {menu?.submitted_by_name && (
            <p className="text-xs text-gray-500">Submitted by {menu.submitted_by_name}</p>
          )}
        </div>
      </div>

      {isLoading && <p className="p-6 text-sm text-gray-400">Loading…</p>}

      {menu && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: calendar + conflicts */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* AI Review Summary — auto-generated for SUBMITTED menus */}
            <AISummaryPanel
              menuId={id}
              enabled={menu.status === 'SUBMITTED'}
            />

            {isSelf && (
              <div className="flex items-center gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                You submitted this menu — you cannot approve it.
              </div>
            )}

            {/* Read-only calendar */}
            <div className="pointer-events-none select-none mb-6">
              <CalendarGrid
                year={menu.year}
                month={menu.month}
                days={menu.days}
                selectedDayId={null}
                onSelectDay={() => {}}
              />
            </div>

            {/* Conflicts */}
            {allConflicts.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-2">
                  Unresolved Conflicts ({allConflicts.length})
                </h2>
                {allConflicts.map(c => (
                  <div key={c.id} className={`flex items-start gap-2 p-3 border rounded-lg mb-2 text-sm ${SEVERITY_STYLE[c.severity] ?? ''}`}>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>{c.description}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Prior RD notes (if menu was previously rejected) */}
            {menu.rd_notes && (
              <div className="mb-6 p-3 bg-slate-50 border rounded-lg text-sm text-slate-700">
                <p className="font-medium mb-1 text-slate-600">Prior RD Notes</p>
                {menu.rd_notes}
              </div>
            )}

            {/* RD notes + action buttons */}
            {menu.status === 'SUBMITTED' && (
              <div className="border rounded-xl p-4 bg-white">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  RD Notes
                </label>
                <textarea
                  value={rdNotes}
                  onChange={e => { setRdNotes(e.target.value); setRejectError(''); }}
                  placeholder="Add notes for the nutrition manager…"
                  rows={3}
                  className="w-full border rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                />
                {rejectError && (
                  <p className="text-xs text-red-600 mt-1">{rejectError}</p>
                )}
                {(approveMutation.isError || rejectMutation.isError) && (
                  <p className="text-xs text-red-600 mt-1">
                    {approveMutation.error?.response?.data?.error ?? rejectMutation.error?.response?.data?.error ?? 'An error occurred.'}
                  </p>
                )}
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => setShowApproveDialog(true)}
                    disabled={isSelf || approveMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={rejectMutation.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-red-300 text-red-700 rounded-lg hover:bg-red-50 disabled:opacity-40 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right: nutrition summary */}
          {nutrition && (
            <aside className="w-72 border-l bg-white flex flex-col overflow-hidden flex-shrink-0">
              <div className="px-4 py-3 border-b">
                <h2 className="text-sm font-semibold text-gray-800">Monthly Averages</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {nutrition.days.filter(d => !d.is_holiday && Object.values(d.totals).some(v => v > 0)).length} active days
                </p>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {nutrition.monthly_compliance.map(row => (
                  <NutrientBar key={row.nutrient} {...row} />
                ))}
              </div>
            </aside>
          )}
        </div>
      )}

      {showApproveDialog && (
        <ApproveDialog
          onConfirm={() => { setShowApproveDialog(false); approveMutation.mutate(); }}
          onCancel={() => setShowApproveDialog(false)}
          isPending={approveMutation.isPending}
        />
      )}
    </div>
  );
}
