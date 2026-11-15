import { useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { recipesApi } from '../../lib/api';

export default function USDASearchModal({ onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSearch(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await recipesApi.usdaSearch(query.trim());
      setResults(data);
      if (data.length === 0) setError('No results found. Try different keywords.');
    } catch {
      setError('Search failed. Check that the API is running.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800">Search USDA FoodData Central</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 px-5 py-3 border-b">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="e.g. chicken breast, whole wheat bread…"
            className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </button>
        </form>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="px-5 py-3 text-sm text-amber-600">{error}</p>
          )}
          {results.map(food => (
            <button
              key={food.fdcId}
              onClick={() => onSelect(food)}
              className="w-full flex flex-col items-start px-5 py-3 hover:bg-blue-50 border-b last:border-0 text-left transition-colors"
            >
              <span className="text-sm font-medium text-gray-800">{food.description}</span>
              <span className="text-xs text-gray-500 mt-0.5">
                FDC ID: {food.fdcId}
                {food.dataType && <> · {food.dataType}</>}
                {food.brandOwner && <> · {food.brandOwner}</>}
              </span>
            </button>
          ))}
        </div>

        {!loading && results.length === 0 && !error && (
          <p className="px-5 py-4 text-sm text-gray-400 text-center">
            Search for an ingredient to link USDA nutrition data.
          </p>
        )}
      </div>
    </div>
  );
}
