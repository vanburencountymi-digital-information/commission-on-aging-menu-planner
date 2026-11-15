import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ThumbsUp, ThumbsDown, AlertTriangle, TrendingDown, TrendingUp, Star, Calendar, RefreshCw } from 'lucide-react';
import { recipesApi, feedbackApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_COLORS = {
  HOT_ENTREE:  'bg-orange-100 text-orange-700',
  COLD_ENTREE: 'bg-sky-100 text-sky-700',
  SIDE:        'bg-green-100 text-green-700',
  FRUIT:       'bg-pink-100 text-pink-700',
  BREAD:       'bg-yellow-100 text-yellow-700',
  DESSERT:     'bg-purple-100 text-purple-700',
};

function Stars({ rating }) {
  if (rating === null) return <span className="text-gray-300 text-xs">No ratings</span>;
  const full = Math.round(rating);
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} className={n <= full ? 'text-amber-400' : 'text-gray-200'}>★</span>
      ))}
      <span className="ml-1 text-xs text-gray-500">{Number(rating).toFixed(1)}</span>
    </span>
  );
}

function RecipeScoreRow({ recipe }) {
  const [open, setOpen] = useState(false);

  const { data: score, isLoading } = useQuery({
    queryKey: ['recipe-score', recipe.id],
    queryFn: () => feedbackApi.recipeScore(recipe.id),
    staleTime: 2 * 60 * 1000,
  });

  const avgRating = score?.avg_rating ? Number(score.avg_rating) : null;
  const count = score?.count ?? 0;
  const isLowRated = avgRating !== null && avgRating < 3.0;

  return (
    <>
      <tr
        className={`border-b transition-colors cursor-pointer ${
          isLowRated
            ? 'bg-red-50 hover:bg-red-100'
            : 'hover:bg-gray-50'
        }`}
        onClick={() => count > 0 && setOpen(o => !o)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {count > 0 && (
              <span className="text-gray-400 text-xs">{open ? '▼' : '▶'}</span>
            )}
            <span className="font-medium text-gray-900 text-sm">{recipe.name}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[recipe.category] ?? 'bg-gray-100 text-gray-600'}`}>
            {recipe.category?.replace('_', ' ') ?? '—'}
          </span>
        </td>
        <td className="px-4 py-3">
          {isLoading ? (
            <span className="text-gray-300 text-xs">Loading…</span>
          ) : (
            <Stars rating={avgRating} />
          )}
        </td>
        <td className="px-4 py-3 text-sm text-gray-600">
          {isLoading ? '—' : count}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400">
          {score?.last_rated_at
            ? new Date(score.last_rated_at).toLocaleDateString()
            : '—'}
        </td>
      </tr>
      {open && score?.comments?.length > 0 && (
        <tr className={isLowRated ? 'bg-red-50' : 'bg-gray-50'}>
          <td colSpan={5} className="px-8 pb-3">
            <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">Client comments</p>
            <ul className="space-y-1">
              {score.comments.map((c, i) => (
                <li key={i} className="text-sm text-gray-700 italic">&ldquo;{c}&rdquo;</li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

// ── AI Insights Panel ─────────────────────────────────────────────────────────

const INSIGHT_CONFIG = {
  retire:    { label: 'Consider Retiring',  Icon: TrendingDown, border: 'border-red-200',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-700' },
  reduce:    { label: 'Reduce Ordering',    Icon: TrendingDown, border: 'border-amber-200',  bg: 'bg-amber-50',  badge: 'bg-amber-100 text-amber-700' },
  increase:  { label: 'Increase Ordering',  Icon: TrendingUp,   border: 'border-blue-200',   bg: 'bg-blue-50',   badge: 'bg-blue-100 text-blue-700' },
  celebrate: { label: 'Client Favorite',    Icon: Star,         border: 'border-violet-200', bg: 'bg-violet-50', badge: 'bg-violet-100 text-violet-700' },
  seasonal:  { label: 'Seasonal Insight',   Icon: Calendar,     border: 'border-green-200',  bg: 'bg-green-50',  badge: 'bg-green-100 text-green-700' },
};

function InsightCard({ insight, vote, onVote }) {
  const navigate = useNavigate();
  const cfg = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.reduce;
  const { Icon } = cfg;

  return (
    <div className={`rounded-lg border p-4 ${cfg.border} ${cfg.bg}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cfg.badge}`}>
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>
            <button
              onClick={() => navigate(`/recipes/${insight.recipe_id}`)}
              className="text-sm font-semibold text-gray-900 hover:underline text-left truncate max-w-xs"
            >
              {insight.recipe_name}
            </button>
          </div>
          <p className="text-sm text-gray-800 mb-1">{insight.recommendation}</p>
          <p className="text-xs text-gray-500 italic">{insight.supporting_data}</p>
        </div>
        <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
          <button
            onClick={() => onVote(insight.recipe_id, vote === 'up' ? null : 'up')}
            className={`p-1.5 rounded transition-colors ${vote === 'up' ? 'text-green-600 bg-green-100' : 'text-gray-300 hover:text-green-600 hover:bg-green-50'}`}
            title="Helpful"
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onVote(insight.recipe_id, vote === 'down' ? null : 'down')}
            className={`p-1.5 rounded transition-colors ${vote === 'down' ? 'text-red-600 bg-red-100' : 'text-gray-300 hover:text-red-600 hover:bg-red-50'}`}
            title="Not helpful"
          >
            <ThumbsDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AIInsightsPanel() {
  const [result, setResult]   = useState(null);
  const [votes, setVotes]     = useState({}); // recipe_id → 'up' | 'down' | null
  const [apiError, setApiError] = useState('');

  const mutation = useMutation({
    mutationFn: () => feedbackApi.getInsights(),
    onSuccess: (data) => { setResult(data); setApiError(''); },
    onError: (err)  => setApiError(err.response?.data?.error ?? 'Failed to generate insights. Please try again.'),
  });

  function handleVote(recipeId, value) {
    setVotes(prev => ({ ...prev, [recipeId]: value }));
  }

  const hasResult = result !== null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-white">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold text-gray-800">AI Waste &amp; Ordering Insights</h2>
          {hasResult && result.data_quality !== 'insufficient' && (
            <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full font-medium">
              {result.insights.length} insight{result.insights.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {mutation.isPending ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              {hasResult ? 'Regenerate' : 'Generate Insights'}
            </>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {/* Not yet generated */}
        {!hasResult && !mutation.isPending && !apiError && (
          <p className="text-sm text-gray-400 text-center py-4">
            Click <strong>Generate Insights</strong> to get AI-powered waste reduction and ordering recommendations based on client feedback.
          </p>
        )}

        {/* Loading */}
        {mutation.isPending && (
          <div className="flex items-center justify-center gap-3 py-6 text-gray-500 text-sm">
            <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
            <span>Analyzing feedback data…</span>
          </div>
        )}

        {/* Error */}
        {apiError && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {apiError}
          </div>
        )}

        {/* Results */}
        {hasResult && !mutation.isPending && (
          <>
            {/* Data quality notice */}
            {result.data_quality !== 'sufficient' && result.data_note && (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 mb-4">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{result.data_note}</span>
              </div>
            )}

            {/* No insights */}
            {result.insights.length === 0 && result.data_quality !== 'insufficient' && (
              <p className="text-sm text-gray-500 text-center py-3">
                No strong patterns found yet — keep collecting feedback!
              </p>
            )}

            {/* Insight grid */}
            {result.insights.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {result.insights.map(insight => (
                  <InsightCard
                    key={insight.recipe_id + insight.type}
                    insight={insight}
                    vote={votes[insight.recipe_id] ?? null}
                    onVote={handleVote}
                  />
                ))}
              </div>
            )}

            {result.insights.length > 0 && (
              <p className="text-xs text-gray-400 mt-3 text-center">
                ✨ AI-generated — verify against your operational knowledge · Thumbs up/down helps track usefulness
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ['ALL', 'HOT_ENTREE', 'COLD_ENTREE', 'SIDE', 'FRUIT', 'BREAD', 'DESSERT'];

export default function ClientRatings() {
  const { user } = useAuth();
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [sortLow, setSortLow] = useState(true); // true = problems first (low rating first)

  const canViewInsights = ['NUTRITION_MANAGER', 'ADMIN'].includes(user?.role);

  const { data: recipes = [], isLoading, error } = useQuery({
    queryKey: ['recipes-all'],
    queryFn: () => recipesApi.list({ limit: 500 }),
    staleTime: 5 * 60 * 1000,
  });

  const filtered = recipes.filter(r =>
    filterCategory === 'ALL' || r.category === filterCategory
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Loading recipes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-red-500 text-sm">
        Failed to load recipe list.
      </div>
    );
  }

  return (
    // The app shell uses overflow-hidden on its main column, so each page
    // owns its own scroll region (see DRIReport.jsx for the standard pattern).
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Client Ratings</h1>
          <p className="text-sm text-gray-500 mt-1">
            Recipes sorted by rating — lowest first to surface problems
          </p>
        </div>
      </div>

      {/* AI Insights Panel — NM / Admin only */}
      {canViewInsights && <AIInsightsPanel />}

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filterCategory === cat
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat === 'ALL' ? 'All categories' : cat.replace('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <p className="text-lg mb-1">No recipes in this category</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Recipe</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Avg Rating</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Responses</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Last Rated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(recipe => (
                <RecipeScoreRow key={recipe.id} recipe={recipe} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4 text-center">
        Click a recipe row to expand client comments · Recipes highlighted red have average rating below 3.0
      </p>
      </div>
    </div>
  );
}
