import { useState, useEffect, Component } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { menusApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import CalendarGrid from '../components/calendar/CalendarGrid';
import DayEditor from '../components/calendar/DayEditor';
import ProposalPanel from '../components/calendar/ProposalPanel';
import NutritionPanel from '../components/nutrition/NutritionPanel';
import DailyNutritionSummary from '../components/nutrition/DailyNutritionSummary';
import { MenuEditProvider } from '../contexts/MenuEditContext';
import OrderListPanel from '../components/calendar/OrderListPanel';
import MonthNav from '../components/ui/MonthNav';
import StatusBadge from '../components/ui/StatusBadge';

class RightPanelErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <aside className="w-96 flex-shrink-0 border-l bg-white flex flex-col items-center justify-center p-6 gap-3">
          <p className="text-sm font-semibold text-red-600">Panel render error</p>
          <p className="text-xs text-gray-500 text-center break-all">{String(this.state.err)}</p>
          <button
            onClick={() => this.setState({ err: null })}
            className="text-xs px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-700"
          >
            Dismiss
          </button>
        </aside>
      );
    }
    return this.props.children;
  }
}

export default function MenuCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [generateConfirm, setGenerateConfirm] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const qc = useQueryClient();
  const { user } = useAuth();

  // Find existing menu for this month
  const { data: menuList = [], isLoading: listLoading } = useQuery({
    queryKey: ['menus', year, month],
    queryFn: () => menusApi.list(year, month),
  });
  const menuSummary = menuList[0] ?? null;

  // Load full menu detail with days + items + conflicts
  const { data: menu, isLoading: menuLoading } = useQuery({
    queryKey: ['menu', menuSummary?.id],
    queryFn: () => menusApi.get(menuSummary.id),
    enabled: !!menuSummary?.id,
  });

  // Sync notesDraft when switching menus (not on every save invalidation)
  useEffect(() => {
    setNotesDraft(menu?.planning_notes ?? '');
  }, [menu?.id]);

  const updateNotes = useMutation({
    mutationFn: (planning_notes) => menusApi.updateNotes(menu.id, planning_notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }),
  });

  async function handleNotesSave() {
    if (notesDraft === (menu?.planning_notes ?? '')) return;
    setNotesSaving(true);
    setNotesSaved(false);
    try {
      await updateNotes.mutateAsync(notesDraft || null);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } finally {
      setNotesSaving(false);
    }
  }

  const clearItems = useMutation({
    mutationFn: () => menusApi.clearItems(menu.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }),
  });

  const generateMenu = useMutation({
    mutationFn: () => menusApi.generate(menu.id),
    onSuccess: (data) => setProposal(data),
  });

  const hasItems = (menu?.days ?? []).some(d => (d.items ?? []).length > 0);

  async function handleGenerateClick() {
    if (hasItems) { setGenerateConfirm(true); return; }
    generateMenu.mutate();
  }

  async function handleGenerateConfirm(overwrite) {
    setGenerateConfirm(false);
    if (overwrite) {
      await clearItems.mutateAsync();
    }
    generateMenu.mutate();
  }

  const createMenu = useMutation({
    mutationFn: () => menusApi.create(year, month),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menus', year, month] });
    },
  });

  function prevMonth() {
    setSelectedDayId(null);
    setProposal(null);
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }

  function nextMonth() {
    setSelectedDayId(null);
    setProposal(null);
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  const submitMenu = useMutation({
    mutationFn: () => menusApi.submit(menu.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }),
  });

  const publishMenu = useMutation({
    mutationFn: () => menusApi.publish(menu.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }),
  });

  const archiveMenu = useMutation({
    mutationFn: () => menusApi.archive(menu.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }),
  });

  const [confirmClear, setConfirmClear] = useState(false);

  const clearMenu = useMutation({
    mutationFn: () => menusApi.clearItems(menu.id),
    onSuccess: () => {
      setConfirmClear(false);
      setSelectedDayId(null);
      qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] });
    },
  });

  const [showOrderList, setShowOrderList] = useState(false);
  const [narrativeDraft, setNarrativeDraft] = useState('');
  const [narrativeSaved, setNarrativeSaved] = useState(false);

  // Sync narrative draft when menu changes
  useEffect(() => {
    setNarrativeDraft(menu?.client_narrative ?? '');
  }, [menu?.id]);

  const generateNarrative = useMutation({
    mutationFn: () => menusApi.generateNarrative(menu.id),
    onSuccess: (data) => {
      setNarrativeDraft(data.narrative);
      qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] });
    },
  });

  const saveNarrative = useMutation({
    mutationFn: () => menusApi.saveNarrative(menu.id, narrativeDraft),
    onSuccess: () => { setNarrativeSaved(true); setTimeout(() => setNarrativeSaved(false), 2000); qc.invalidateQueries({ queryKey: ['menu', menuSummary?.id] }); },
  });

  const isLoading = listLoading || menuLoading;
  const selectedMenuDay = menu?.days?.find(d => d.id === selectedDayId) ?? null;

  const canEdit = ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role);

  // Submit button: DRAFT + all non-holiday days have ≥1 HOT item + user can submit
  const menuDaysArr = Array.isArray(menu?.days) ? menu.days : [];
  const canSubmit = menu?.status === 'DRAFT'
    && ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role)
    && menuDaysArr.length > 0
    && menuDaysArr.every(day =>
        day.is_holiday || (Array.isArray(day.items) ? day.items : []).some(item => item.meal_type === 'HOT')
      );

  const menuEditValue = {
    menuId: menu?.id ?? null,
    menuDays: menu?.days ?? [],
    menuStatus: menu?.status ?? null,
    canEdit,
    onChangesApplied: () => setSelectedDayId(null),
  };

  return (
    <MenuEditProvider value={menuEditValue}>
    <div className="flex h-full overflow-hidden">
      {/* Main calendar column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b bg-white flex-shrink-0">
          <div className="flex items-center gap-4">
            <MonthNav year={year} month={month} onPrev={prevMonth} onNext={nextMonth} />
            {menu && <StatusBadge status={menu.status} />}
          </div>

          <div className="flex items-center gap-2">
            {!menuSummary && !listLoading && (
              <button
                onClick={() => createMenu.mutate()}
                disabled={createMenu.isPending}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {createMenu.isPending ? 'Creating…' : 'Create Menu'}
              </button>
            )}
            {menu?.status === 'DRAFT' && canEdit && hasItems && (
              <button
                onClick={() => { if (window.confirm('Remove all menu items from this month?')) clearItems.mutate(); }}
                disabled={clearItems.isPending}
                className="px-4 py-1.5 bg-red-100 text-red-700 text-sm rounded-md hover:bg-red-200 disabled:opacity-50 transition-colors"
              >
                {clearItems.isPending ? 'Clearing…' : 'Clear Month'}
              </button>
            )}
            {menu?.status === 'DRAFT' && canEdit && (
              generateConfirm ? (
                <div className="flex items-center gap-1.5 bg-violet-50 border border-violet-200 rounded-md px-3 py-1.5">
                  <span className="text-xs text-violet-700 font-medium">Items exist:</span>
                  <button onClick={() => handleGenerateConfirm(false)} className="px-2 py-0.5 text-xs bg-violet-600 text-white rounded hover:bg-violet-700">Fill empty days</button>
                  <button onClick={() => handleGenerateConfirm(true)} className="px-2 py-0.5 text-xs bg-red-600 text-white rounded hover:bg-red-700">Replace all</button>
                  <button onClick={() => setGenerateConfirm(false)} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={handleGenerateClick}
                  disabled={generateMenu.isPending || clearItems.isPending}
                  className="px-4 py-1.5 bg-violet-600 text-white text-sm rounded-md hover:bg-violet-700 disabled:opacity-50 transition-colors"
                >
                  {generateMenu.isPending ? 'Generating…' : 'Generate Menu'}
                </button>
              )
            )}
            {generateMenu.isPending && (
              <span className="text-xs text-violet-500 animate-pulse">This may take a few minutes…</span>
            )}
            {generateMenu.isError && (
              <span className="text-xs text-red-500 max-w-md">
                {generateMenu.error?.response?.data?.error ?? 'Generation failed — check console'}
              </span>
            )}
            {menu?.status === 'DRAFT' && canEdit && (
              confirmClear ? (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-red-600 font-medium">Clear all items?</span>
                  <button
                    onClick={() => clearMenu.mutate()}
                    disabled={clearMenu.isPending}
                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {clearMenu.isPending ? 'Clearing…' : 'Yes, clear'}
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-2 py-1 text-xs bg-white text-slate-600 border border-slate-300 rounded hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  className="px-4 py-1.5 text-sm rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                >
                  Clear Menu
                </button>
              )
            )}
            {canSubmit && (
              <button
                onClick={() => submitMenu.mutate()}
                disabled={submitMenu.isPending}
                className="px-4 py-1.5 bg-emerald-600 text-white text-sm rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {submitMenu.isPending ? 'Submitting…' : 'Submit for RD Review'}
              </button>
            )}
            {menu?.status === 'APPROVED' && ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role) && (
              <button
                onClick={() => publishMenu.mutate()}
                disabled={publishMenu.isPending}
                className="px-4 py-1.5 bg-teal-600 text-white text-sm rounded-md hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {publishMenu.isPending ? 'Publishing…' : 'Publish Menu'}
              </button>
            )}
            {['APPROVED', 'PUBLISHED'].includes(menu?.status) && canEdit && (
              <button
                onClick={() => { setShowOrderList(v => !v); setSelectedDayId(null); }}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                  showOrderList
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                }`}
              >
                📦 Order List
              </button>
            )}
            {menu?.status === 'PUBLISHED' && (
              <a
                href={`${import.meta.env.VITE_API_URL ?? ''}/api/menus/${menu.id}/export/pdf`}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-1.5 bg-slate-600 text-white text-sm rounded-md hover:bg-slate-700 transition-colors"
              >
                Export PDF
              </a>
            )}
            {menu?.status === 'PUBLISHED' && user?.role === 'ADMIN' && (
              <button
                onClick={() => archiveMenu.mutate()}
                disabled={archiveMenu.isPending}
                className="px-4 py-1.5 bg-gray-500 text-white text-sm rounded-md hover:bg-gray-600 disabled:opacity-50 transition-colors"
              >
                {archiveMenu.isPending ? 'Archiving…' : 'Archive'}
              </button>
            )}
          </div>
        </div>

        {/* Generation in-progress notice */}
        {generateMenu.isPending && (
          <div className="px-6 py-2 border-b bg-violet-50 flex-shrink-0 flex items-center gap-2">
            <svg className="animate-spin h-4 w-4 text-violet-500 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <p className="text-xs text-violet-800">
              <span className="font-semibold">Generating menu proposal…</span>
              <span className="font-normal text-violet-600 ml-1">— The assistant is reviewing your recipe library and building a full month of meals. This can take 1–2 minutes. Please don't navigate away.</span>
            </p>
          </div>
        )}

        {/* Vendor constraints — editable textarea in DRAFT, read-only banner otherwise */}
        {menu && menu.status === 'DRAFT' && canEdit && (
          <div className="px-6 py-2 border-b bg-amber-50 flex-shrink-0">
            <label className="block text-xs font-semibold text-amber-800 mb-1">
              Vendor constraints &amp; planning notes
              <span className="font-normal text-amber-600 ml-1">— injected into all AI suggestions for this menu</span>
            </label>
            <textarea
              className="w-full text-sm border border-amber-200 rounded px-2 py-1 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
              rows={2}
              placeholder='e.g. "GFS is out of salmon this month" · "Use up 50 lbs of zucchini" · "No pork — client preference"'
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              onBlur={handleNotesSave}
            />
            {notesSaving && <p className="text-xs text-amber-600 mt-0.5">Saving…</p>}
            {notesSaved && <p className="text-xs text-emerald-600 mt-0.5">Saved</p>}
          </div>
        )}
        {menu && menu.status !== 'DRAFT' && menu.planning_notes && (
          <div className="px-6 py-2 border-b bg-amber-50 flex-shrink-0">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Planning constraints: </span>{menu.planning_notes}
            </p>
          </div>
        )}

        {/* Client narrative — PUBLISHED menus, editable by NM/ADMIN */}
        {menu?.status === 'PUBLISHED' && canEdit && (
          <div className="px-6 py-2 border-b bg-blue-50 flex-shrink-0">
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-blue-800">
                Client Menu Narrative
                <span className="font-normal text-blue-600 ml-1">— printed on PDF header</span>
              </label>
              <div className="flex items-center gap-2">
                {narrativeSaved && <span className="text-xs text-emerald-600">Saved</span>}
                <button
                  onClick={() => generateNarrative.mutate()}
                  disabled={generateNarrative.isPending}
                  className="text-xs px-2 py-0.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded transition-colors flex items-center gap-1"
                >
                  ✨ {generateNarrative.isPending ? 'Writing…' : 'Generate'}
                </button>
                <button
                  onClick={() => saveNarrative.mutate()}
                  disabled={saveNarrative.isPending || narrativeDraft === (menu?.client_narrative ?? '')}
                  className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
            <textarea
              className="w-full text-sm border border-blue-200 rounded px-2 py-1 bg-white resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
              rows={2}
              placeholder="Click ✨ Generate to have the assistant write a friendly intro, or type your own…"
              value={narrativeDraft}
              onChange={e => setNarrativeDraft(e.target.value)}
            />
          </div>
        )}
        {/* Show narrative read-only for non-editors on published menus */}
        {menu?.status === 'PUBLISHED' && !canEdit && menu?.client_narrative && (
          <div className="px-6 py-2 border-b bg-blue-50 flex-shrink-0">
            <p className="text-sm text-blue-800 italic">{menu.client_narrative}</p>
          </div>
        )}

        {/* Calendar body */}
        <div className="flex-1 overflow-auto p-6 min-h-0">
          {isLoading && (
            <p className="text-gray-400 text-sm">Loading…</p>
          )}

          {!isLoading && !menuSummary && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <p className="text-lg mb-1">No menu for this month</p>
              <p className="text-sm">Click "Create Menu" to get started.</p>
            </div>
          )}

          {menu && (
            <CalendarGrid
              year={year}
              month={month}
              days={menu.days}
              selectedDayId={selectedDayId}
              onSelectDay={id => {
                setShowOrderList(false);
                setSelectedDayId(id === selectedDayId ? null : id);
              }}
            />
          )}
        </div>
      </div>

      {/* Right panel: DayEditor > ProposalPanel > OrderListPanel > NutritionPanel */}
      <RightPanelErrorBoundary>
      {selectedMenuDay ? (
        <div className="w-96 flex-shrink-0 border-l bg-white flex flex-col h-full shadow-xl">
          <DayEditor
            menuId={menu.id}
            menuDay={selectedMenuDay}
            menuStatus={menu.status}
            onClose={() => setSelectedDayId(null)}
          />
          <DailyNutritionSummary menuId={menu.id} dayId={selectedMenuDay.id} />
        </div>
      ) : proposal && menu ? (
        <ProposalPanel
          proposal={proposal}
          menuId={menu.id}
          menuDays={menu.days}
          onClose={() => setProposal(null)}
        />
      ) : showOrderList && menu ? (
        <OrderListPanel
          menuId={menu.id}
          menuYear={year}
          menuMonth={month}
          onClose={() => setShowOrderList(false)}
        />
      ) : (
        menu && <NutritionPanel menuId={menu.id} />
      )}
      </RightPanelErrorBoundary>
    </div>
    </MenuEditProvider>
  );
}
