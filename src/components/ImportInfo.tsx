import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  Upload, Search, Download, Trash2, ChevronUp, ChevronDown,
  ChevronsUpDown, Filter, X, RefreshCw, AlertCircle, FileSpreadsheet,
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportRow {
  id: string;
  date: string | null;
  hs_code: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_rate: number;
  currency: string;
  total_usd: number;
  origin: string;
  destination: string;
  exporter: string;
  importer: string;
  type: string;
  created_at: string;
}

type SortField = keyof Omit<ImportRow, 'id' | 'created_at'>;
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 50;

const COLS: { key: SortField; label: string; width: string; numeric?: boolean }[] = [
  { key: 'date', label: 'DATE', width: 'min-w-[110px]' },
  { key: 'hs_code', label: 'HS CODE', width: 'min-w-[100px]' },
  { key: 'product_name', label: 'PRODUCT', width: 'min-w-[220px]' },
  { key: 'quantity', label: 'QTY', width: 'min-w-[80px]', numeric: true },
  { key: 'unit', label: 'UNIT', width: 'min-w-[90px]' },
  { key: 'unit_rate', label: 'UNIT RATE', width: 'min-w-[100px]', numeric: true },
  { key: 'currency', label: 'CURRENCY', width: 'min-w-[90px]' },
  { key: 'total_usd', label: 'TOTAL (USD)', width: 'min-w-[120px]', numeric: true },
  { key: 'origin', label: 'ORIGIN', width: 'min-w-[140px]' },
  { key: 'destination', label: 'DESTINATION', width: 'min-w-[120px]' },
  { key: 'exporter', label: 'EXPORTER', width: 'min-w-[200px]' },
  { key: 'importer', label: 'IMPORTER', width: 'min-w-[200px]' },
  { key: 'type', label: 'TYPE', width: 'min-w-[130px]' },
];

const TYPE_COLORS: Record<string, string> = {
  'API': 'bg-blue-100 text-blue-800',
  'Finished Product': 'bg-green-100 text-green-800',
  'Excipient': 'bg-amber-100 text-amber-800',
  'Flavor / Fragrance': 'bg-pink-100 text-pink-800',
  'Agrochemical': 'bg-lime-100 text-lime-800',
  'Medical Device / Dental': 'bg-cyan-100 text-cyan-800',
};

function getTypeColor(type: string) {
  return TYPE_COLORS[type] || 'bg-gray-100 text-gray-700';
}

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    const parts = cleaned.match(/(\d{1,2})[\/\-\.](\w+)[\/\-\.](\d{2,4})/);
    if (parts) {
      const months: Record<string,string> = {
        jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
        jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
      };
      const day = parts[1].padStart(2,'0');
      const mo = months[parts[2].toLowerCase()] || parts[2].padStart(2,'0');
      const yr = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
      return `${yr}-${mo}-${day}`;
    }
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }
  return null;
}

function formatDisplayDate(val: string | null): string {
  if (!val) return '-';
  const d = new Date(val + 'T00:00:00');
  const day = d.getDate();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportInfo() {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [colFilters, setColFilters] = useState<Partial<Record<SortField, string>>>({});
  const [openFilter, setOpenFilter] = useState<SortField | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [userRole, setUserRole] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    supabase.from('user_profiles').select('role').maybeSingle().then(({ data }) => {
      if (data) setUserRole(data.role || '');
    });
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from('import_data').select('*', { count: 'exact' });

      if (debouncedSearch) {
        const s = `%${debouncedSearch}%`;
        q = q.or(`product_name.ilike.${s},importer.ilike.${s},exporter.ilike.${s}`);
      }

      Object.entries(colFilters).forEach(([k, v]) => {
        if (v) q = q.ilike(k as string, `%${v}%`);
      });

      q = q.order(sortField as string, { ascending: sortDir === 'asc' });
      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await q;
      if (error) throw error;
      setRows((data as ImportRow[]) || []);
      setTotal(count || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, sortField, sortDir, colFilters, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
    setPage(0);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 text-gray-400" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-600" />
      : <ChevronDown className="w-3 h-3 text-blue-600" />;
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg(null);

    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      if (!raw.length) { setUploadMsg({ type: 'error', text: 'No data found in file.' }); return; }

      const headerMap: Record<string, SortField> = {
        'date': 'date', 'hs code': 'hs_code', 'hs_code': 'hs_code', 'hscode': 'hs_code',
        'product': 'product_name', 'product name': 'product_name', 'product_name': 'product_name',
        'quantity': 'quantity', 'qty': 'quantity',
        'unit': 'unit',
        'unit rate': 'unit_rate', 'unit_rate': 'unit_rate', 'unitrate': 'unit_rate', 'rate': 'unit_rate',
        'currency': 'currency',
        'total usd': 'total_usd', 'total_usd': 'total_usd', 'totalusd': 'total_usd', 'total (usd)': 'total_usd',
        'origin': 'origin',
        'destination': 'destination',
        'exporter': 'exporter',
        'importer': 'importer',
        'type': 'type',
      };

      const firstRow = raw[0];
      const keyMap: Record<string, SortField> = {};
      Object.keys(firstRow).forEach(k => {
        const norm = k.toLowerCase().trim();
        if (headerMap[norm]) keyMap[k] = headerMap[norm];
      });

      const batch: Record<string, unknown>[] = raw.map(r => {
        const obj: Record<string, unknown> = {};
        Object.entries(keyMap).forEach(([rawKey, dbKey]) => {
          const v = r[rawKey];
          if (dbKey === 'date') obj[dbKey] = parseDate(v);
          else if (dbKey === 'quantity' || dbKey === 'unit_rate' || dbKey === 'total_usd')
            obj[dbKey] = parseFloat(String(v).replace(/,/g, '')) || 0;
          else obj[dbKey] = String(v ?? '').trim();
        });
        return obj;
      });

      const CHUNK = 500;
      let inserted = 0;
      for (let i = 0; i < batch.length; i += CHUNK) {
        const { error } = await supabase.from('import_data').insert(batch.slice(i, i + CHUNK));
        if (error) throw error;
        inserted += Math.min(CHUNK, batch.length - i);
      }

      setUploadMsg({ type: 'success', text: `Successfully imported ${inserted} records.` });
      setPage(0);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadMsg({ type: 'error', text: msg });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleClearData() {
    const { error } = await supabase.from('import_data').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (!error) { setRows([]); setTotal(0); setShowClearConfirm(false); }
  }

  function downloadCSV() {
    if (!rows.length) return;
    const headers = COLS.map(c => c.label);
    const csvRows = rows.map(r => [
      r.date || '', r.hs_code, r.product_name, r.quantity, r.unit,
      r.unit_rate, r.currency, r.total_usd, r.origin, r.destination,
      r.exporter, r.importer, r.type,
    ]);
    const content = [headers, ...csvRows].map(row =>
      row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'import_data_filtered.csv';
    a.click();
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const activeFilters = Object.values(colFilters).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search product, importer, exporter..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {activeFilters > 0 && (
            <button onClick={() => setColFilters({})} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100">
              <Filter className="w-3.5 h-3.5" />
              Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
            </button>
          )}
          <button onClick={downloadCSV} disabled={!rows.length} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
          {(userRole === 'admin' || userRole === 'manager') && (
            <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear All</span>
            </button>
          )}
          <label className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? 'Uploading...' : 'Upload CSV/Excel'}</span>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>

      {/* Upload Message */}
      {uploadMsg && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm mb-3 flex-shrink-0 ${uploadMsg.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {uploadMsg.type === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {uploadMsg.text}
          <button onClick={() => setUploadMsg(null)} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 mb-3 flex-shrink-0 text-xs text-gray-500">
        <span className="font-medium text-gray-700">{total.toLocaleString()} records</span>
        {(debouncedSearch || activeFilters > 0) && <span className="text-blue-600">(filtered)</span>}
        <button onClick={fetchData} className="ml-auto flex items-center gap-1 hover:text-gray-700">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      {total === 0 && !loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 text-gray-400">
          <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium text-gray-500 mb-1">No import data yet</p>
          <p className="text-sm">Upload a CSV or Excel file to get started</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-700 text-white">
                {COLS.map(col => (
                  <th key={col.key} className={`${col.width} px-3 py-0 text-left font-semibold border-r border-gray-600 last:border-r-0`}>
                    <div className="flex flex-col">
                      <button
                        onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1 py-2 hover:text-blue-300 text-left w-full"
                      >
                        {col.label}
                        <SortIcon field={col.key} />
                      </button>
                      <div className="pb-1.5 relative" onClick={e => e.stopPropagation()}>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Filter..."
                            value={colFilters[col.key] || ''}
                            onChange={e => {
                              setColFilters(prev => ({ ...prev, [col.key]: e.target.value }));
                              setPage(0);
                            }}
                            className="w-full px-2 py-1 text-xs bg-gray-600 text-white placeholder-gray-400 rounded border border-gray-500 focus:outline-none focus:border-blue-400"
                          />
                          {colFilters[col.key] && (
                            <button
                              onClick={() => setColFilters(prev => { const n = {...prev}; delete n[col.key]; return n; })}
                              className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length} className="text-center py-12 text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading...
                </td></tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap text-gray-600">{formatDisplayDate(row.date)}</td>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap font-mono text-gray-600">{row.hs_code}</td>
                  <td className="px-3 py-2 border-r border-gray-100 font-medium text-gray-900">{row.product_name}</td>
                  <td className="px-3 py-2 border-r border-gray-100 text-right whitespace-nowrap text-gray-700">{row.quantity.toLocaleString()}</td>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.unit}</td>
                  <td className="px-3 py-2 border-r border-gray-100 text-right whitespace-nowrap font-medium text-emerald-700">{fmtNum(row.unit_rate)}</td>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.currency}</td>
                  <td className="px-3 py-2 border-r border-gray-100 text-right whitespace-nowrap font-medium text-blue-700">{fmtNum(row.total_usd)}</td>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.origin}</td>
                  <td className="px-3 py-2 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.destination}</td>
                  <td className="px-3 py-2 border-r border-gray-100 text-gray-700">{row.exporter}</td>
                  <td className="px-3 py-2 border-r border-gray-100 text-gray-700">{row.importer}</td>
                  <td className="px-3 py-2">
                    {row.type ? (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${getTypeColor(row.type)}`}>
                        {row.type}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 flex-shrink-0 text-xs text-gray-600">
          <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">«</button>
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">‹</button>
            <span className="px-3 py-1 rounded bg-blue-600 text-white">{page + 1}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50">»</button>
          </div>
        </div>
      )}

      {/* Clear Confirm Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <h3 className="font-semibold text-gray-900">Clear all import data?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">This will permanently delete all {total.toLocaleString()} records. This cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleClearData} className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Delete All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
