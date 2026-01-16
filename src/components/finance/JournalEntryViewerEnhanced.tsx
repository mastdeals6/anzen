import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, ChevronDown, ChevronRight, FileText, Download } from 'lucide-react';

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  source_module: string | null;
  reference_number: string | null;
  description: string | null;
  total_debit: number;
  total_credit: number;
  is_posted: boolean;
  posted_at: string;
}

interface JournalEntryLine {
  id: string;
  line_number: number;
  account_id: string;
  description: string | null;
  debit: number;
  credit: number;
  chart_of_accounts?: {
    code: string;
    name: string;
  };
  customers?: { company_name: string } | null;
  suppliers?: { company_name: string } | null;
}

interface JournalEntryViewerEnhancedProps {
  canManage: boolean;
}

const sourceModuleLabels: Record<string, string> = {
  sales_invoice: 'Sales Invoice',
  sales_invoice_cogs: 'COGS Entry',
  purchase_invoice: 'Purchase Invoice',
  receipt: 'Receipt Voucher',
  payment: 'Payment Voucher',
  petty_cash: 'Petty Cash',
  fund_transfer: 'Fund Transfer',
  manual: 'Manual Entry',
};

const sourceModuleColors: Record<string, string> = {
  sales_invoice: 'bg-blue-100 text-blue-700',
  sales_invoice_cogs: 'bg-purple-100 text-purple-700',
  purchase_invoice: 'bg-orange-100 text-orange-700',
  receipt: 'bg-green-100 text-green-700',
  payment: 'bg-red-100 text-red-700',
  petty_cash: 'bg-yellow-100 text-yellow-700',
  fund_transfer: 'bg-indigo-100 text-indigo-700',
  manual: 'bg-gray-100 text-gray-700',
};

export function JournalEntryViewerEnhanced({ canManage }: JournalEntryViewerEnhancedProps) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [entryLines, setEntryLines] = useState<Record<string, JournalEntryLine[]>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [filterModule, setFilterModule] = useState('all');
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    loadEntries();
  }, [dateRange, filterModule]);

  const loadEntries = async () => {
    try {
      let query = supabase
        .from('journal_entries')
        .select('*')
        .gte('entry_date', dateRange.start)
        .lte('entry_date', dateRange.end)
        .order('entry_date', { ascending: false })
        .order('entry_number', { ascending: false });

      if (filterModule !== 'all') {
        query = query.eq('source_module', filterModule);
      }

      const { data, error } = await query;

      if (error) throw error;
      setEntries(data || []);

      // Auto-expand first 3 entries for quick viewing
      if (data && data.length > 0) {
        const firstThree = new Set(data.slice(0, 3).map(e => e.id));
        setExpandedEntries(firstThree);

        // Load lines for first 3 entries
        for (const entry of data.slice(0, 3)) {
          await loadEntryLines(entry.id);
        }
      }
    } catch (error) {
      console.error('Error loading entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEntryLines = async (entryId: string) => {
    if (entryLines[entryId]) return; // Already loaded

    try {
      const { data, error } = await supabase
        .from('journal_entry_lines')
        .select('*, chart_of_accounts(code, name), customers(company_name), suppliers(company_name)')
        .eq('journal_entry_id', entryId)
        .order('line_number');

      if (error) throw error;
      setEntryLines(prev => ({ ...prev, [entryId]: data || [] }));
    } catch (error) {
      console.error('Error loading lines:', error);
    }
  };

  const toggleEntry = async (entryId: string) => {
    const newExpanded = new Set(expandedEntries);

    if (newExpanded.has(entryId)) {
      newExpanded.delete(entryId);
    } else {
      newExpanded.add(entryId);
      // Load lines if not already loaded
      if (!entryLines[entryId]) {
        await loadEntryLines(entryId);
      }
    }

    setExpandedEntries(newExpanded);
  };

  const handleExpandAll = async () => {
    if (expandAll) {
      setExpandedEntries(new Set());
      setExpandAll(false);
    } else {
      const allIds = new Set(filteredEntries.map(e => e.id));
      setExpandedEntries(allIds);
      setExpandAll(true);

      // Load all lines
      for (const entry of filteredEntries) {
        if (!entryLines[entry.id]) {
          await loadEntryLines(entry.id);
        }
      }
    }
  };

  const filteredEntries = entries.filter(e =>
    e.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.reference_number && e.reference_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (e.description && e.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const totals = {
    debit: filteredEntries.reduce((sum, e) => sum + e.total_debit, 0),
    credit: filteredEntries.reduce((sum, e) => sum + e.total_credit, 0),
  };

  const exportToExcel = () => {
    // Create CSV content
    let csv = 'Entry Number,Date,Source,Reference,Description,Debit,Credit\n';

    filteredEntries.forEach(entry => {
      csv += `${entry.entry_number},${entry.entry_date},${entry.source_module || 'Manual'},${entry.reference_number || ''},${entry.description || ''},${entry.total_debit},${entry.total_credit}\n`;

      if (entryLines[entry.id]) {
        csv += ',,Account Code,Account Name,Line Description,Debit,Credit\n';
        entryLines[entry.id].forEach(line => {
          csv += `,,${line.chart_of_accounts?.code},${line.chart_of_accounts?.name},${line.description || ''},${line.debit},${line.credit}\n`;
        });
        csv += ',,,,,,\n';
      }
    });

    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_entries_${dateRange.start}_to_${dateRange.end}.csv`;
    a.click();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search entries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All Sources</option>
          <option value="sales_invoice">Sales Invoices</option>
          <option value="sales_invoice_cogs">COGS Entries</option>
          <option value="purchase_invoice">Purchase Invoices</option>
          <option value="receipt">Receipts</option>
          <option value="payment">Payments</option>
          <option value="petty_cash">Petty Cash</option>
          <option value="fund_transfer">Fund Transfers</option>
          <option value="manual">Manual</option>
        </select>

        <button
          onClick={handleExpandAll}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
        >
          {expandAll ? (
            <>
              <ChevronRight className="w-4 h-4" />
              Collapse All
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Expand All
            </>
          )}
        </button>

        <button
          onClick={exportToExcel}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white hover:bg-green-700 rounded-lg transition"
        >
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
          <p className="text-sm text-blue-600 font-medium">Total Debit</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">
            Rp {totals.debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-green-50 rounded-lg p-4 border border-green-100">
          <p className="text-sm text-green-600 font-medium">Total Credit</p>
          <p className="text-2xl font-bold text-green-700 mt-1">
            Rp {totals.credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider w-10"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Entry No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Description</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">Credit</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, index) => {
                const isExpanded = expandedEntries.has(entry.id);
                const lines = entryLines[entry.id] || [];
                const isBalanced = Math.abs(entry.total_debit - entry.total_credit) < 0.01;

                return (
                  <tr key={entry.id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td colSpan={8} className="p-0">
                      {/* Summary Row */}
                      <div
                        onClick={() => toggleEntry(entry.id)}
                        className="flex items-center cursor-pointer hover:bg-blue-50 transition px-4 py-3"
                      >
                        <div className="w-10 flex-shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5 text-gray-400" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 grid grid-cols-7 gap-4 items-center">
                          <div className="font-mono text-sm font-medium text-gray-900">
                            {entry.entry_number}
                            {!isBalanced && (
                              <span className="ml-2 text-xs text-red-600">⚠️</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-700">
                            {new Date(entry.entry_date).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </div>
                          <div>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${sourceModuleColors[entry.source_module || 'manual']}`}>
                              {entry.source_module ? sourceModuleLabels[entry.source_module] || entry.source_module : 'Manual'}
                            </span>
                          </div>
                          <div className="font-mono text-sm text-gray-600">
                            {entry.reference_number || '-'}
                          </div>
                          <div className="text-sm text-gray-600 truncate">
                            {entry.description || '-'}
                          </div>
                          <div className="text-right text-sm font-semibold text-blue-700">
                            Rp {entry.total_debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          <div className="text-right text-sm font-semibold text-green-700">
                            Rp {entry.total_credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="bg-gray-50 border-t border-b border-gray-200 px-4 py-3">
                          <div className="ml-10">
                            {/* Entry Metadata */}
                            <div className="mb-3 text-sm text-gray-600 flex gap-6">
                              <span>Posted: {new Date(entry.posted_at).toLocaleString('id-ID')}</span>
                              <span className={isBalanced ? 'text-green-600' : 'text-red-600 font-semibold'}>
                                {isBalanced ? '✓ Balanced' : '⚠️ Unbalanced'}
                              </span>
                            </div>

                            {/* Account Lines Table */}
                            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100 border-b border-gray-200">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Account Code</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Account Name</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Description</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Debit</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-600">Credit</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {lines.map((line, lineIndex) => (
                                    <tr key={line.id} className={lineIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                      <td className="px-3 py-2 font-mono text-xs text-gray-600">
                                        {line.chart_of_accounts?.code}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="font-medium text-gray-900">{line.chart_of_accounts?.name}</div>
                                        {line.customers && (
                                          <div className="text-xs text-blue-600 mt-0.5">
                                            Customer: {line.customers.company_name}
                                          </div>
                                        )}
                                        {line.suppliers && (
                                          <div className="text-xs text-purple-600 mt-0.5">
                                            Supplier: {line.suppliers.company_name}
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-gray-600">
                                        {line.description || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right font-medium text-blue-700">
                                        {line.debit > 0 ? (
                                          <span>Rp {line.debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        ) : (
                                          <span className="text-gray-300">-</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right font-medium text-green-700">
                                        {line.credit > 0 ? (
                                          <span>Rp {line.credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        ) : (
                                          <span className="text-gray-300">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                                  <tr>
                                    <td colSpan={3} className="px-3 py-2 text-right text-gray-700">
                                      Total:
                                    </td>
                                    <td className="px-3 py-2 text-right text-blue-800">
                                      Rp {entry.total_debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="px-3 py-2 text-right text-green-800">
                                      Rp {entry.total_credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p className="text-lg font-medium">No journal entries found</p>
                    <p className="text-sm mt-1">Try adjusting your filters or date range</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-sm text-gray-500 text-center py-2">
        Showing {filteredEntries.length} entries • First 3 expanded by default • Click any entry to expand/collapse
      </div>
    </div>
  );
}
