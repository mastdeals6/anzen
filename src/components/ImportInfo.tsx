import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  Upload, Search, Download, Trash2, ChevronUp, ChevronDown,
  ChevronsUpDown, X, RefreshCw, AlertCircle, FileSpreadsheet,
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
}

type SortField = keyof Omit<ImportRow, 'id'>;
type SortDir = 'asc' | 'desc';

const FILTERABLE: SortField[] = ['product_name', 'origin', 'destination', 'exporter', 'importer', 'type'];

interface ColDef {
  key: SortField;
  label: string;
  defaultWidth: number;
  numeric?: boolean;
  filterable?: boolean;
}

const COLS: ColDef[] = [
  { key: 'date', label: 'DATE', defaultWidth: 100 },
  { key: 'hs_code', label: 'HS CODE', defaultWidth: 100 },
  { key: 'product_name', label: 'PRODUCT', defaultWidth: 220, filterable: true },
  { key: 'quantity', label: 'QTY', defaultWidth: 80, numeric: true },
  { key: 'unit', label: 'UNIT', defaultWidth: 80 },
  { key: 'unit_rate', label: 'UNIT RATE', defaultWidth: 95, numeric: true },
  { key: 'currency', label: 'CURRENCY', defaultWidth: 85 },
  { key: 'total_usd', label: 'TOTAL (USD)', defaultWidth: 110, numeric: true },
  { key: 'origin', label: 'ORIGIN', defaultWidth: 130, filterable: true },
  { key: 'destination', label: 'DESTINATION', defaultWidth: 120, filterable: true },
  { key: 'exporter', label: 'EXPORTER', defaultWidth: 190, filterable: true },
  { key: 'importer', label: 'IMPORTER', defaultWidth: 190, filterable: true },
  { key: 'type', label: 'TYPE', defaultWidth: 130, filterable: true },
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
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim();
    const parts = cleaned.match(/(\d{1,2})[\/\-\.](\w+)[\/\-\.](\d{2,4})/);
    if (parts) {
      const months: Record<string, string> = {
        jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
        jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      };
      const day = parts[1].padStart(2, '0');
      const mo = months[parts[2].toLowerCase()] || parts[2].padStart(2, '0');
      const yr = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
      return `${yr}-${mo}-${day}`;
    }
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function formatDisplayDate(val: string | null): string {
  if (!val) return '-';
  const d = new Date(val + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtNum(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getCellValue(row: ImportRow, key: SortField): string | number {
  const v = row[key];
  return v ?? '';
}

export function ImportInfo() {
  const [allRows, setAllRows] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [userRole, setUserRole] = useState<string>('');

  const [search, setSearch] = useState('');
  const [colFilters, setColFilters] = useState<Partial<Record<SortField, string>>>({});
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Column widths (resizable)
  const [colWidths, setColWidths] = useState<Record<string, number>>(
    () => Object.fromEntries(COLS.map(c => [c.key, c.defaultWidth]))
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    supabase.from('user_profiles').select('role').maybeSingle().then(({ data }) => {
      if (data) setUserRole(data.role || '');
    });
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      let allData: ImportRow[] = [];
      let from = 0;
      const chunk = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('import_data')
          .select('id,date,hs_code,product_name,quantity,unit,unit_rate,currency,total_usd,origin,destination,exporter,importer,type')
          .range(from, from + chunk - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data as ImportRow[]);
        if (data.length < chunk) break;
        from += chunk;
      }
      setAllRows(allData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Client-side filtering + sorting (instant, no debounce needed)
  const filteredRows = useMemo(() => {
    let rows = allRows;

    if (search.trim()) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        r.product_name?.toLowerCase().includes(s) ||
        r.importer?.toLowerCase().includes(s) ||
        r.exporter?.toLowerCase().includes(s)
      );
    }

    Object.entries(colFilters).forEach(([k, v]) => {
      if (!v) return;
      const lo = v.toLowerCase();
      rows = rows.filter(r => String((r as Record<string,unknown>)[k] ?? '').toLowerCase().includes(lo));
    });

    rows = [...rows].sort((a, b) => {
      const av = getCellValue(a, sortField);
      const bv = getCellValue(b, sortField);
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [allRows, search, colFilters, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  // Column resize
  function onResizeMouseDown(e: React.MouseEvent, key: string) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { key, startX: e.clientX, startW: colWidths[key] };

    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(40, resizingRef.current.startW + delta);
      setColWidths(prev => ({ ...prev, [resizingRef.current!.key]: newW }));
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
      fetchAll();
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
    if (!error) { setAllRows([]); setShowClearConfirm(false); }
  }

  function downloadCSV() {
    if (!filteredRows.length) return;
    const headers = COLS.map(c => c.label);
    const csvRows = filteredRows.map(r => [
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

  const activeColFilters = Object.values(colFilters).filter(Boolean).length;
  const isFiltered = search.trim() || activeColFilters > 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: 500 }}>
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search product, importer, exporter..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {isFiltered && (
            <button onClick={() => { setSearch(''); setColFilters({}); }} className="flex items-center gap-1.5 px-3 py-2 text-xs bg-amber-50 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-100">
              <X className="w-3 h-3" />
              Clear filters
            </button>
          )}
          <button onClick={downloadCSV} disabled={!filteredRows.length} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40">
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-xs">Export CSV</span>
          </button>
          {(userRole === 'admin' || userRole === 'manager') && (
            <button onClick={() => setShowClearConfirm(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline text-xs">Clear All</span>
            </button>
          )}
          <label className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Uploading...' : 'Upload CSV/Excel'}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>

      {/* Upload Message */}
      {uploadMsg && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs mb-2 flex-shrink-0 ${uploadMsg.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {uploadMsg.type === 'error' && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
          {uploadMsg.text}
          <button onClick={() => setUploadMsg(null)} className="ml-auto"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-3 mb-2 flex-shrink-0 text-xs text-gray-500">
        <span>
          <span className="font-semibold text-gray-700">{filteredRows.length.toLocaleString()}</span>
          {isFiltered && <span className="text-blue-600"> filtered</span>}
          {' '}of <span className="font-medium text-gray-600">{allRows.length.toLocaleString()}</span> records
        </span>
        <button onClick={fetchAll} className="ml-auto flex items-center gap-1 hover:text-gray-700 text-gray-400">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Table */}
      {allRows.length === 0 && !loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-16 text-gray-400">
          <FileSpreadsheet className="w-12 h-12 mb-3 opacity-30" />
          <p className="font-medium text-gray-500 mb-1">No import data yet</p>
          <p className="text-sm">Upload a CSV or Excel file to get started</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-gray-200 shadow-sm select-none">
          <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: COLS.reduce((s, c) => s + (colWidths[c.key] || c.defaultWidth), 0) }}>
            <thead className="sticky top-0 z-20">
              <tr className="bg-gray-700 text-white">
                {COLS.map(col => (
                  <th
                    key={col.key}
                    style={{ width: colWidths[col.key], minWidth: 40, position: 'relative', overflow: 'hidden' }}
                    className="px-0 py-0 text-left font-semibold border-r border-gray-600 last:border-r-0"
                  >
                    <div className="flex flex-col">
                      {/* Sort row */}
                      <button
                        onClick={() => handleSort(col.key)}
                        className="flex items-center gap-1 px-2 pt-2 pb-1 hover:text-blue-300 text-left w-full truncate"
                        title={col.label}
                      >
                        <span className="truncate">{col.label}</span>
                        {sortField === col.key
                          ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 flex-shrink-0 text-blue-300" /> : <ChevronDown className="w-3 h-3 flex-shrink-0 text-blue-300" />)
                          : <ChevronsUpDown className="w-3 h-3 flex-shrink-0 text-gray-400" />}
                      </button>
                      {/* Filter row - only for filterable cols */}
                      <div className="px-1.5 pb-1.5" onClick={e => e.stopPropagation()}>
                        {col.filterable ? (
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Filter..."
                              value={colFilters[col.key] || ''}
                              onChange={e => setColFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                              className="w-full px-1.5 py-0.5 text-[10px] bg-gray-600 text-white placeholder-gray-400 rounded border border-gray-500 focus:outline-none focus:border-blue-400"
                            />
                            {colFilters[col.key] && (
                              <button
                                onClick={() => setColFilters(prev => { const n = { ...prev }; delete n[col.key]; return n; })}
                                className="absolute right-0.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                              ><X className="w-2 h-2" /></button>
                            )}
                          </div>
                        ) : (
                          <div className="h-[18px]" />
                        )}
                      </div>
                    </div>
                    {/* Resize handle */}
                    <div
                      onMouseDown={e => onResizeMouseDown(e, col.key)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 opacity-0 hover:opacity-100 z-10"
                      style={{ background: 'rgba(96,165,250,0.5)' }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length} className="text-center py-12 text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Loading all records...
                </td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan={COLS.length} className="text-center py-10 text-gray-400">No records match your search.</td></tr>
              ) : filteredRows.map((row, i) => (
                <tr key={row.id} className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}`}>
                  <td style={{ width: colWidths.date, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 whitespace-nowrap text-gray-600">{formatDisplayDate(row.date)}</td>
                  <td style={{ width: colWidths.hs_code, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 whitespace-nowrap font-mono text-gray-600 text-[11px]">{row.hs_code}</td>
                  <td style={{ width: colWidths.product_name, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 font-medium text-gray-900" title={row.product_name}>
                    <div className="truncate">{row.product_name}</div>
                  </td>
                  <td style={{ width: colWidths.quantity, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-right whitespace-nowrap text-gray-700">{row.quantity.toLocaleString()}</td>
                  <td style={{ width: colWidths.unit, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.unit}</td>
                  <td style={{ width: colWidths.unit_rate, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-right whitespace-nowrap font-medium text-emerald-700">{fmtNum(row.unit_rate)}</td>
                  <td style={{ width: colWidths.currency, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 whitespace-nowrap text-gray-600">{row.currency}</td>
                  <td style={{ width: colWidths.total_usd, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-right whitespace-nowrap font-medium text-blue-700">{fmtNum(row.total_usd)}</td>
                  <td style={{ width: colWidths.origin, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-gray-600" title={row.origin}>
                    <div className="truncate">{row.origin}</div>
                  </td>
                  <td style={{ width: colWidths.destination, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-gray-600" title={row.destination}>
                    <div className="truncate">{row.destination}</div>
                  </td>
                  <td style={{ width: colWidths.exporter, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-gray-700" title={row.exporter}>
                    <div className="truncate">{row.exporter}</div>
                  </td>
                  <td style={{ width: colWidths.importer, overflow: 'hidden' }} className="px-2 py-1.5 border-r border-gray-100 text-gray-700" title={row.importer}>
                    <div className="truncate">{row.importer}</div>
                  </td>
                  <td style={{ width: colWidths.type, overflow: 'hidden' }} className="px-2 py-1.5">
                    {row.type ? (
                      <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${getTypeColor(row.type)}`}>
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

      {/* Clear Confirm */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
              <h3 className="font-semibold text-gray-900">Clear all import data?</h3>
            </div>
            <p className="text-sm text-gray-600 mb-5">This permanently deletes all {allRows.length.toLocaleString()} records and cannot be undone.</p>
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
