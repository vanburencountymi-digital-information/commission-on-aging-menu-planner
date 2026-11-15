import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle, X, Send, Sparkles, RotateCcw, GripHorizontal } from 'lucide-react';
import { helpApi } from '../../lib/api';
import { useMenuEdit } from '../../contexts/MenuEditContext';
import NLEditPanel from '../calendar/NLEditPanel';

const PAGE_LABELS = {
  '/menus':       'Menu Calendar',
  '/recipes':     'Recipe List',
  '/approval':    'RD Review Queue',
  '/ratings':     'Client Ratings',
  '/kitchen':     'Kitchen View',
  '/admin/users': 'Admin — User Management',
};

function getPageLabel(pathname) {
  if (PAGE_LABELS[pathname]) return PAGE_LABELS[pathname];
  for (const [prefix, label] of Object.entries(PAGE_LABELS)) {
    if (pathname.startsWith(prefix + '/')) return label;
  }
  return pathname;
}

const SUGGESTIONS = [
  'How do I submit the menu for RD review?',
  'What does the protein conflict warning mean?',
  'Why is my sodium score red?',
  'How do I generate the Order List?',
  'What is the fish frequency rule?',
];

const MIN_W = 320;
const MIN_H = 300;
const DEFAULT_W = 384;
const DEFAULT_H = 500;

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

// ── Lightweight Markdown renderer ───────────────────────────────────────────
// Handles **bold**, `code`, numbered + bulleted lists, and ## headers.
function renderInline(text) {
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m, key = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={key++} className="bg-gray-200 rounded px-1 py-0.5 text-xs font-mono">{tok.slice(1, -1)}</code>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function MarkdownText({ content }) {
  const blocks = [];
  let list = null; // { type, items }

  const flush = () => {
    if (!list) return;
    const Tag = list.type;
    blocks.push(
      <Tag
        key={blocks.length}
        className={`${list.type === 'ol' ? 'list-decimal' : 'list-disc'} pl-5 space-y-0.5`}
      >
        {list.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
      </Tag>
    );
    list = null;
  };

  for (const raw of String(content).split('\n')) {
    const line = raw.trimEnd();
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const hd = line.match(/^#{1,3}\s+(.*)$/);
    if (ol) {
      if (list?.type !== 'ol') { flush(); list = { type: 'ol', items: [] }; }
      list.items.push(ol[1]);
    } else if (ul) {
      if (list?.type !== 'ul') { flush(); list = { type: 'ul', items: [] }; }
      list.items.push(ul[1]);
    } else if (hd) {
      flush();
      blocks.push(<p key={blocks.length} className="font-semibold">{renderInline(hd[1])}</p>);
    } else if (line.trim() === '') {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

export default function HelpAssistant() {
  const location = useLocation();
  const menuEdit = useMenuEdit();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('help');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Position: null = default (bottom-right anchor via CSS)
  const [position, setPosition] = useState(null); // { x, y }
  const [dimensions, setDimensions] = useState({ width: DEFAULT_W, height: DEFAULT_H });

  const panelRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const pageLabel = getPageLabel(location.pathname);
  const showEditTab = !!(menuEdit?.canEdit && menuEdit?.menuStatus === 'DRAFT' && menuEdit?.menuId);

  useEffect(() => {
    if (!showEditTab && tab === 'edit') setTab('help');
  }, [showEditTab, tab]);

  useEffect(() => {
    if (open && tab === 'help') {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      inputRef.current?.focus();
    }
  }, [open, history.length, tab]);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const startDrag = useCallback((e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();

    const rect = panelRef.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    function onMove(e) {
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - rect.width));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - rect.height));
      setPosition({ x, y });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────────
  const startResize = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = dimensions.width;
    const startH = dimensions.height;

    function onMove(e) {
      setDimensions({
        width:  Math.max(MIN_W, startW + (e.clientX - startX)),
        height: Math.max(MIN_H, startH + (e.clientY - startY)),
      });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dimensions]);

  // ── Panel positioning style ───────────────────────────────────────────────
  const panelStyle = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto', width: dimensions.width, height: dimensions.height }
    : { bottom: '5rem', right: '1.5rem', width: dimensions.width, height: dimensions.height };

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function sendMessage(text) {
    const msg = text ?? input.trim();
    if (!msg || loading) return;
    setInput('');
    setError(null);
    const newHistory = [...history, { role: 'user', content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const { response } = await helpApi.ask(msg, history, pageLabel);
      setHistory(h => [...h, { role: 'assistant', content: response }]);
    } catch (err) {
      setError(err?.response?.data?.error ?? 'Could not reach the help service. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function clearChat() { setHistory([]); setError(null); setInput(''); }

  function handleOpen() {
    setOpen(v => !v);
    if (!open && showEditTab) setTab('edit');
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-50 select-none"
          style={panelStyle}
        >
          {/* Header — drag handle */}
          <div
            onMouseDown={startDrag}
            className={`flex items-center justify-between px-4 py-3 text-white flex-shrink-0 cursor-grab active:cursor-grabbing ${
              tab === 'edit' ? 'bg-violet-700' : 'bg-blue-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Sparkles size={15} />
              <span className="font-semibold text-sm">COA Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <GripHorizontal size={14} className="opacity-40 mr-1" />
              {tab === 'help' && history.length > 0 && (
                <button
                  onClick={clearChat}
                  title="Clear chat"
                  className={`p-1 rounded transition-colors ${tab === 'edit' ? 'hover:bg-violet-600' : 'hover:bg-blue-600'}`}
                >
                  <RotateCcw size={13} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className={`p-1 rounded transition-colors ${tab === 'edit' ? 'hover:bg-violet-600' : 'hover:bg-blue-600'}`}
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Tab switcher */}
          {showEditTab && (
            <div className="flex border-b flex-shrink-0">
              <button
                onClick={() => setTab('help')}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  tab === 'help'
                    ? 'text-blue-700 border-b-2 border-blue-600 bg-blue-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                ❓ Help
              </button>
              <button
                onClick={() => setTab('edit')}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${
                  tab === 'edit'
                    ? 'text-violet-700 border-b-2 border-violet-600 bg-violet-50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                ✏️ Edit Menu
              </button>
            </div>
          )}

          {/* ── Edit tab ── */}
          {tab === 'edit' && menuEdit && (
            <NLEditPanel
              menuId={menuEdit.menuId}
              menuDays={menuEdit.menuDays}
              onChangesApplied={menuEdit.onChangesApplied}
              embedded
            />
          )}

          {/* ── Help tab ── */}
          {tab === 'help' && (
            <>
              <div className="px-3 py-1.5 bg-blue-50 border-b flex-shrink-0">
                <span className="text-xs text-blue-600">
                  📍 Helping you with: <span className="font-medium">{pageLabel}</span>
                </span>
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {history.length === 0 && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500 text-center">Ask me anything about the COA Menu Planner</p>
                    <div className="space-y-1.5">
                      {SUGGESTIONS.map(s => (
                        <button
                          key={s}
                          onClick={() => sendMessage(s)}
                          className="w-full text-left text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-colors"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {history.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm whitespace-pre-wrap'
                        : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }`}>
                      {msg.role === 'user'
                        ? msg.content
                        : <MarkdownText content={msg.content} />}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 rounded-2xl rounded-bl-sm"><TypingDots /></div>
                  </div>
                )}

                {error && (
                  <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">{error}</div>
                )}

                <div ref={bottomRef} />
              </div>

              <div className="px-3 py-3 border-t bg-white flex-shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question…"
                    rows={1}
                    disabled={loading}
                    className="flex-1 resize-none border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
                    style={{ maxHeight: '80px', overflowY: 'auto' }}
                  />
                  <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim() || loading}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                  >
                    <Send size={15} />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1 text-center">Press Enter to send · Shift+Enter for new line</p>
              </div>
            </>
          )}

          {/* Resize handle — bottom-right corner */}
          <div
            onMouseDown={startResize}
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-end justify-end pb-0.5 pr-0.5 opacity-30 hover:opacity-70 transition-opacity"
            title="Resize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="text-gray-500">
              <path d="M10 0L0 10h2L10 2V0zM10 4L4 10h2l4-4V4zM10 8L8 10h2V8z"/>
            </svg>
          </div>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={handleOpen}
        className={`fixed bottom-6 right-6 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all z-50 ${
          open
            ? `${showEditTab && tab === 'edit' ? 'bg-violet-700' : 'bg-blue-700'} text-white scale-110`
            : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-110'
        }`}
        title="COA Assistant"
        aria-label="Open COA assistant"
      >
        {open ? <X size={20} /> : <HelpCircle size={22} />}
      </button>
    </>
  );
}
