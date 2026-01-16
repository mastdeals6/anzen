import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Search, FileText, LayoutList, Table2 } from 'lucide-react';
import { Modal } from '../Modal';

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

interface FlatJournalLine {
  journal_entry_id: string;
  line_id: string;
  date: string;
  voucher_no: string;
  voucher_type: string;
  account_code: string;
  ledger: string;
  debit: number;
  credit: number;
  narration: string;
  reference_number: string | null;
  source_module: string | null;
  customer_name: string | null;
  supplier_name: string | null;
  line_number: number;
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

export function JournalEntryViewerEnhanced({ canManage }: JournalEntryViewerEnhancedProps) {
  const [viewMode, setViewMode] = useState<'journal' | 'voucher'>('journal');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [flatLines, setFlatLines] = useState<FlatJournalLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [entryLines, setEntryLines] = useState<JournalEntryLine[]>([]);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  });
  const [filterModule, setFilterModule] = useState('all');

  useEffect(() => {
    if (viewMode === 'journal') {
      loadFlatJournal();
    } else {
      loadEntries();
    }
  }, [dateRange, filterModule, viewMode]);

  const loadFlatJournal = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('journal_flat_view')
        .select('*')
        .gte('date', dateRange.start)
        .lte('date', dateRange.end);

      if (filterModule !== 'all') {
        query = query.eq('source_module', filterModule);
      }

      const { data, error } = await query;

      if (error) throw error;
      setFlatLines(data || []);
    } catch (error) {
      console.error('Error loading flat journal:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEntries = async () => {
    try {
      setLoading(true);
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
    } catch (error) {
      console.error('Error loading entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadEntryLines = async (entryId: string) => {
    try {
      const { data, error } = await supabase
        .from('journal_entry_lines')
        .select('*, chart_of_accounts(code, name), customers(company_name), suppliers(company_name)')
        .eq('journal_entry_id', entryId)
        .order('line_number');

      if (error) throw error;
      setEntryLines(data || []);
    } catch (error) {
      console.error('Error loading lines:', error);
    }
  };

  const handleViewEntry = async (entry: JournalEntry) => {
    setSelectedEntry(entry);
    await loadEntryLines(entry.id);
    setViewModalOpen(true);
  };

  const filteredEntries = entries.filter(e =>
    e.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.reference_number && e.reference_number.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (e.description && e.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredFlatLines = flatLines.filter(line =>
    line.voucher_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
    line.ledger.toLowerCase().includes(searchTerm.toLowerCase()) ||
    line.narration.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (line.reference_number && line.reference_number.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const voucherTotals = {
    debit: filteredEntries.reduce((sum, e) => sum + e.total_debit, 0),
    credit: filteredEntries.reduce((sum, e) => sum + e.total_credit, 0),
  };

  const journalTotals = {
    debit: filteredFlatLines.reduce((sum, line) => sum + line.debit, 0),
    credit: filteredFlatLines.reduce((sum, line) => sum + line.credit, 0),
  };

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="space-y-4">
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('journal')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'journal'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Table2 className="w-4 h-4" />
            Journal View (CA)
          </button>
          <button
            onClick={() => setViewMode('voucher')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
              viewMode === 'voucher'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <LayoutList className="w-4 h-4" />
            Voucher View (Admin)
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {viewMode === 'journal' ? 'Flat view - Read only' : 'Grouped view - Click to view details'}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder={viewMode === 'journal' ? "Search voucher, ledger, narration..." : "Search entries..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
          <span className="text-gray-500">to</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="all">All Sources</option>
          <option value="sales_invoice">Sales Invoices</option>
          <option value="sales_invoice_cogs">COGS</option>
          <option value="purchase_invoice">Purchase Invoices</option>
          <option value="receipt">Receipts</option>
          <option value="payment">Payments</option>
          <option value="petty_cash">Petty Cash</option>
          <option value="fund_transfer">Fund Transfers</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-blue-600">Total Debit</p>
          <p className="text-2xl font-bold text-blue-700">
            Rp {(viewMode === 'journal' ? journalTotals.debit : voucherTotals.debit).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-sm text-green-600">Total Credit</p>
          <p className="text-2xl font-bold text-green-700">
            Rp {(viewMode === 'journal' ? journalTotals.credit : voucherTotals.credit).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Journal View (Flat - Tally Style) */}
      {viewMode === 'journal' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Voucher No</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Voucher Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Ledger</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Debit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider border-r">Credit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Narration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filteredFlatLines.map((line) => (
                  <tr key={line.line_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-900 border-r">
                      {new Date(line.date).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono text-blue-600 border-r">
                      {line.voucher_no}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap border-r">
                      <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                        {line.voucher_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-r">
                      <div className="font-medium text-gray-900">{line.ledger}</div>
                      {line.customer_name && (
                        <div className="text-xs text-blue-600">{line.customer_name}</div>
                      )}
                      {line.supplier_name && (
                        <div className="text-xs text-purple-600">{line.supplier_name}</div>
                      )}
                      <div className="text-xs text-gray-500 font-mono">{line.account_code}</div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap border-r">
                      {line.debit > 0 && (
                        <span className="text-blue-700 font-medium">
                          {line.debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap border-r">
                      {line.credit > 0 && (
                        <span className="text-green-700 font-medium">
                          {line.credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs max-w-xs">
                      {line.narration || '-'}
                    </td>
                  </tr>
                ))}
                {filteredFlatLines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                      No journal entries found
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-gray-50 font-bold">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-right">Total:</td>
                  <td className="px-3 py-2 text-right text-blue-700">
                    {journalTotals.debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-3 py-2 text-right text-green-700">
                    {journalTotals.credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Voucher View (Grouped) */}
      {viewMode === 'voucher' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry No</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">View</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{entry.entry_number}</td>
                  <td className="px-4 py-3">{new Date(entry.entry_date).toLocaleDateString('id-ID')}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                      {entry.source_module ? sourceModuleLabels[entry.source_module] || entry.source_module : 'Manual'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{entry.reference_number || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{entry.description || '-'}</td>
                  <td className="px-4 py-3 text-right text-blue-600">Rp {entry.total_debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-right text-green-600">Rp {entry.total_credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleViewEntry(entry)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredEntries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                    No journal entries found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Voucher Detail Modal */}
      <Modal isOpen={viewModalOpen} onClose={() => setViewModalOpen(false)} title={`Journal Entry: ${selectedEntry?.entry_number}`}>
        {selectedEntry && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Date:</span>
                <span className="ml-2 font-medium">{new Date(selectedEntry.entry_date).toLocaleDateString('id-ID')}</span>
              </div>
              <div>
                <span className="text-gray-500">Source:</span>
                <span className="ml-2">{selectedEntry.source_module ? sourceModuleLabels[selectedEntry.source_module] : 'Manual'}</span>
              </div>
              <div>
                <span className="text-gray-500">Reference:</span>
                <span className="ml-2 font-mono">{selectedEntry.reference_number || '-'}</span>
              </div>
              <div>
                <span className="text-gray-500">Posted:</span>
                <span className="ml-2">{new Date(selectedEntry.posted_at).toLocaleString('id-ID')}</span>
              </div>
            </div>

            {selectedEntry.description && (
              <div className="p-3 bg-gray-50 rounded-lg text-sm">
                {selectedEntry.description}
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Account</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entryLines.map(line => (
                    <tr key={line.id}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs text-gray-500">{line.chart_of_accounts?.code}</div>
                        <div>{line.chart_of_accounts?.name}</div>
                        {line.customers && <div className="text-xs text-blue-600">{line.customers.company_name}</div>}
                        {line.suppliers && <div className="text-xs text-purple-600">{line.suppliers.company_name}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-600">{line.description || '-'}</td>
                      <td className="px-3 py-2 text-right text-blue-600">
                        {line.debit > 0 ? `Rp ${line.debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                      <td className="px-3 py-2 text-right text-green-600">
                        {line.credit > 0 ? `Rp ${line.credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 font-medium">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 text-right">Total:</td>
                    <td className="px-3 py-2 text-right text-blue-700">
                      Rp {selectedEntry.total_debit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right text-green-700">
                      Rp {selectedEntry.total_credit.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {selectedEntry.total_debit !== selectedEntry.total_credit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                Warning: Debit and Credit totals do not match!
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
