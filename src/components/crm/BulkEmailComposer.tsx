import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import {
  Mail, Send, FileText, Clock, Users, AlertCircle, CheckCircle,
  XCircle, Bold, Italic, Underline, List, AlignLeft, AlignCenter,
  AlignRight, Link2, Image, ChevronDown, X, Minus, Plus, Type
} from 'lucide-react';
import { showToast } from '../ToastNotification';

interface EmailTemplate {
  id: string;
  template_name: string;
  subject: string;
  body: string;
  category: string | null;
}

interface SelectedCustomer {
  id: string;
  company_name: string;
  email: string;
  contact_person: string | null;
}

interface BulkEmailComposerProps {
  selectedCustomers: SelectedCustomer[];
  onClose: () => void;
  onComplete: () => void;
}

interface SendResult {
  customerId: string;
  companyName: string;
  email: string;
  status: 'pending' | 'sending' | 'success' | 'error';
  error?: string;
}

const VARIABLES = [
  { label: 'Company Name', value: '{{company_name}}' },
  { label: 'Contact Person', value: '{{contact_person}}' },
];

export function BulkEmailComposer({ selectedCustomers, onClose, onComplete }: BulkEmailComposerProps) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState(30);
  const [sending, setSending] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showVariableMenu, setShowVariableMenu] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<'compose' | 'sending' | 'done'>('compose');
  const [senderName, setSenderName] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const templateMenuRef = useRef<HTMLDivElement>(null);
  const variableMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadTemplates();
    loadSenderInfo();
    const results = selectedCustomers.map(c => ({
      customerId: c.id,
      companyName: c.company_name,
      email: c.email,
      status: 'pending' as const,
    }));
    setSendResults(results);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (templateMenuRef.current && !templateMenuRef.current.contains(e.target as Node)) {
        setShowTemplateMenu(false);
      }
      if (variableMenuRef.current && !variableMenuRef.current.contains(e.target as Node)) {
        setShowVariableMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadSenderInfo = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('user_profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (data?.full_name) setSenderName(data.full_name);
  };

  const loadTemplates = async () => {
    const { data } = await supabase
      .from('crm_email_templates')
      .select('*')
      .eq('is_active', true)
      .order('template_name');
    setTemplates(data || []);
  };

  const applyTemplate = (template: EmailTemplate) => {
    setSubject(template.subject);
    setSelectedTemplate(template);
    setShowTemplateMenu(false);
    if (editorRef.current) {
      editorRef.current.innerHTML = template.body;
      setHtmlBody(template.body);
    }
  };

  const execFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncHtml();
  };

  const syncHtml = useCallback(() => {
    if (editorRef.current) {
      setHtmlBody(editorRef.current.innerHTML);
    }
  }, []);

  const insertVariable = (variable: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, variable);
    syncHtml();
    setShowVariableMenu(false);
  };

  const insertLink = () => {
    const url = prompt('Enter URL:');
    if (url) execFormat('createLink', url);
  };

  const personalizeContent = (html: string, customer: SelectedCustomer): string => {
    return html
      .replace(/\{\{company_name\}\}/g, customer.company_name)
      .replace(/\{\{contact_person\}\}/g, customer.contact_person || 'Sir/Madam');
  };

  const personalizeSubject = (subj: string, customer: SelectedCustomer): string => {
    return subj
      .replace(/\{\{company_name\}\}/g, customer.company_name)
      .replace(/\{\{contact_person\}\}/g, customer.contact_person || 'Sir/Madam');
  };

  const sendBulkEmails = async () => {
    const currentHtml = editorRef.current?.innerHTML || '';
    if (!subject.trim() || !currentHtml.trim() || currentHtml === '<br>') {
      showToast({ type: 'error', title: 'Error', message: 'Please fill in subject and message' });
      return;
    }

    setSending(true);
    setStep('sending');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error('Not authenticated');

      const { data: gmailConnection } = await supabase
        .from('gmail_connections')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_connected', true)
        .maybeSingle();

      if (!gmailConnection) {
        showToast({ type: 'error', title: 'Gmail Not Connected', message: 'Please connect Gmail in Settings first.' });
        setSending(false);
        setStep('compose');
        return;
      }

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      let successCount = 0;

      for (let i = 0; i < selectedCustomers.length; i++) {
        const customer = selectedCustomers[i];
        setCurrentIndex(i);

        setSendResults(prev => prev.map((r, idx) =>
          idx === i ? { ...r, status: 'sending' } : r
        ));

        try {
          const emailAddresses = customer.email
            .split(';')
            .map(e => e.trim())
            .filter(e => e.length > 0);

          const personalizedSubject = personalizeSubject(subject, customer);
          const personalizedHtml = personalizeContent(currentHtml, customer);

          const response = await fetch(`${supabaseUrl}/functions/v1/send-bulk-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.session!.access_token}`,
            },
            body: JSON.stringify({
              userId: user.id,
              toEmails: emailAddresses,
              subject: personalizedSubject,
              body: personalizedHtml,
              contactId: customer.id,
              senderName,
              isHtml: true,
            }),
          });

          const result = await response.json();

          if (result.success) {
            await supabase.from('crm_email_activities').insert([{
              contact_id: customer.id,
              email_type: 'sent',
              from_email: user.email,
              to_email: emailAddresses,
              subject: personalizedSubject,
              body: personalizedHtml,
              template_id: selectedTemplate?.id || null,
              sent_date: new Date().toISOString(),
              created_by: user.id,
            }]);

            setSendResults(prev => prev.map((r, idx) =>
              idx === i ? { ...r, status: 'success' } : r
            ));
            successCount++;
          } else {
            throw new Error(result.error || 'Unknown error');
          }

          if (i < selectedCustomers.length - 1) {
            await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
          }
        } catch (err: any) {
          setSendResults(prev => prev.map((r, idx) =>
            idx === i ? { ...r, status: 'error', error: err.message } : r
          ));
        }
      }

      if (selectedTemplate) {
        await supabase
          .from('crm_email_templates')
          .update({ last_used: new Date().toISOString() })
          .eq('id', selectedTemplate.id);
      }

      setStep('done');
      showToast({
        type: 'success',
        title: 'Bulk Email Complete',
        message: `${successCount} of ${selectedCustomers.length} emails sent successfully.`,
      });
      onComplete();
    } catch (err: any) {
      showToast({ type: 'error', title: 'Error', message: err.message || 'Failed to complete bulk email.' });
      setStep('compose');
    } finally {
      setSending(false);
    }
  };

  const successCount = sendResults.filter(r => r.status === 'success').length;
  const errorCount = sendResults.filter(r => r.status === 'error').length;
  const pendingCount = sendResults.filter(r => r.status === 'pending').length;
  const progress = selectedCustomers.length > 0 ? (successCount + errorCount) / selectedCustomers.length : 0;

  return (
    <div className="flex flex-col h-full max-h-[90vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl flex-shrink-0">
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600" />
          <span className="font-semibold text-gray-900">Bulk Email</span>
          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium flex items-center gap-1">
            <Users className="w-3 h-3" />
            {selectedCustomers.length} recipients
          </span>
        </div>
        <button onClick={onClose} disabled={sending} className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition disabled:opacity-40">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Compose panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* To field */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
            <span className="text-sm text-gray-500 w-14 flex-shrink-0">To</span>
            <div className="flex-1 flex flex-wrap gap-1 min-h-[28px]">
              {selectedCustomers.slice(0, 4).map(c => (
                <span key={c.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                  {c.contact_person ? `${c.contact_person} <${c.email}>` : c.email}
                </span>
              ))}
              {selectedCustomers.length > 4 && (
                <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 border border-gray-200 rounded text-xs text-gray-600">
                  +{selectedCustomers.length - 4} more
                </span>
              )}
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0">Each receives their own copy</span>
          </div>

          {/* Subject */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
            <span className="text-sm text-gray-500 w-14 flex-shrink-0">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              disabled={sending}
              className="flex-1 text-sm text-gray-900 outline-none bg-transparent placeholder-gray-400 disabled:opacity-60"
              placeholder="Subject (use {{company_name}}, {{contact_person}})"
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 bg-white flex-shrink-0 flex-wrap">
            <ToolbarButton icon={<Bold className="w-3.5 h-3.5" />} onClick={() => execFormat('bold')} title="Bold (Ctrl+B)" />
            <ToolbarButton icon={<Italic className="w-3.5 h-3.5" />} onClick={() => execFormat('italic')} title="Italic (Ctrl+I)" />
            <ToolbarButton icon={<Underline className="w-3.5 h-3.5" />} onClick={() => execFormat('underline')} title="Underline (Ctrl+U)" />
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <ToolbarButton icon={<Type className="w-3.5 h-3.5" />} onClick={() => execFormat('fontSize', '4')} title="Larger text" />
            <ToolbarButton icon={<Type className="w-3 h-3" />} onClick={() => execFormat('fontSize', '2')} title="Smaller text" />
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <ToolbarButton icon={<AlignLeft className="w-3.5 h-3.5" />} onClick={() => execFormat('justifyLeft')} title="Align left" />
            <ToolbarButton icon={<AlignCenter className="w-3.5 h-3.5" />} onClick={() => execFormat('justifyCenter')} title="Align center" />
            <ToolbarButton icon={<AlignRight className="w-3.5 h-3.5" />} onClick={() => execFormat('justifyRight')} title="Align right" />
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <ToolbarButton icon={<List className="w-3.5 h-3.5" />} onClick={() => execFormat('insertUnorderedList')} title="Bullet list" />
            <ToolbarButton icon={<Link2 className="w-3.5 h-3.5" />} onClick={insertLink} title="Insert link" />
            <div className="w-px h-4 bg-gray-200 mx-1" />

            {/* Color picker */}
            <label className="relative cursor-pointer p-1.5 rounded hover:bg-gray-100 transition" title="Text color">
              <span className="text-xs font-bold" style={{ color: '#e53e3e' }}>A</span>
              <input
                type="color"
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                onChange={e => execFormat('foreColor', e.target.value)}
              />
            </label>

            {/* Variables insert */}
            <div className="relative ml-1" ref={variableMenuRef}>
              <button
                onClick={() => setShowVariableMenu(v => !v)}
                className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition"
                title="Insert variable"
              >
                Insert variable
                <ChevronDown className="w-3 h-3" />
              </button>
              {showVariableMenu && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[160px]">
                  {VARIABLES.map(v => (
                    <button
                      key={v.value}
                      onClick={() => insertVariable(v.value)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 text-gray-700 first:rounded-t-lg last:rounded-b-lg"
                    >
                      <span className="font-mono text-blue-600">{v.value}</span>
                      <span className="text-gray-400 ml-1">— {v.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Template picker */}
            <div className="relative ml-auto" ref={templateMenuRef}>
              <button
                onClick={() => setShowTemplateMenu(v => !v)}
                disabled={sending}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg transition disabled:opacity-40"
              >
                <FileText className="w-3.5 h-3.5" />
                Templates
                <ChevronDown className="w-3 h-3" />
              </button>
              {showTemplateMenu && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-72">
                  <div className="px-3 py-2 border-b border-gray-100">
                    <p className="text-xs font-semibold text-gray-700">Email Templates</p>
                  </div>
                  {templates.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">No templates available</div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto">
                      {templates.map(t => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className="w-full text-left px-3 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0 transition"
                        >
                          <p className="text-sm font-medium text-gray-800">{t.template_name}</p>
                          <p className="text-xs text-gray-400 truncate mt-0.5">{t.subject}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto bg-white px-4 py-3">
            <div
              ref={editorRef}
              contentEditable={!sending}
              suppressContentEditableWarning
              onInput={syncHtml}
              onPaste={() => setTimeout(syncHtml, 0)}
              className={`min-h-[200px] outline-none text-sm text-gray-800 leading-relaxed ${sending ? 'opacity-60 pointer-events-none' : ''}`}
              style={{ wordBreak: 'break-word' }}
              data-placeholder="Write your message here... Use {{company_name}} and {{contact_person}} for personalization"
            />
          </div>

          {/* Throttle & footer */}
          <div className="flex-shrink-0 border-t border-gray-100 bg-white px-4 py-2">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>Delay between emails:</span>
                <button onClick={() => setIntervalSeconds(s => Math.max(10, s - 5))} disabled={sending} className="p-0.5 hover:bg-gray-100 rounded">
                  <Minus className="w-3 h-3" />
                </button>
                <span className="font-mono font-semibold w-8 text-center">{intervalSeconds}s</span>
                <button onClick={() => setIntervalSeconds(s => Math.min(300, s + 5))} disabled={sending} className="p-0.5 hover:bg-gray-100 rounded">
                  <Plus className="w-3 h-3" />
                </button>
                <span className="text-gray-400">≈ {Math.ceil((selectedCustomers.length * intervalSeconds) / 60)} min total</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={onClose} disabled={sending} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-40">
                  Cancel
                </button>
                <button
                  onClick={sendBulkEmails}
                  disabled={sending || !subject.trim()}
                  className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  <Send className="w-3.5 h-3.5" />
                  Send to {selectedCustomers.length}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Recipients panel */}
        <div className="w-56 border-l border-gray-100 bg-gray-50 flex flex-col flex-shrink-0">
          <div className="px-3 py-2 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Recipients</p>
          </div>

          {step === 'sending' || step === 'done' ? (
            <>
              {/* Progress bar */}
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{successCount + errorCount} / {selectedCustomers.length}</span>
                  <span>{Math.round(progress * 100)}%</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <div className="flex gap-3 mt-1.5 text-xs">
                  <span className="text-green-600 flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />{successCount}</span>
                  <span className="text-red-500 flex items-center gap-0.5"><XCircle className="w-3 h-3" />{errorCount}</span>
                  <span className="text-gray-400 flex items-center gap-0.5"><Clock className="w-3 h-3" />{pendingCount}</span>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {sendResults.map((r, idx) => (
                  <div key={idx} className={`px-3 py-2 border-b border-gray-100 last:border-0 flex items-center gap-2 ${
                    r.status === 'success' ? 'bg-green-50' :
                    r.status === 'error' ? 'bg-red-50' :
                    r.status === 'sending' ? 'bg-blue-50' : ''
                  }`}>
                    <div className="flex-shrink-0">
                      {r.status === 'success' && <CheckCircle className="w-3.5 h-3.5 text-green-600" />}
                      {r.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                      {r.status === 'sending' && <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />}
                      {r.status === 'pending' && <Clock className="w-3.5 h-3.5 text-gray-300" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{r.companyName}</p>
                      <p className="text-xs text-gray-400 truncate">{r.email}</p>
                      {r.error && <p className="text-xs text-red-500 truncate">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {selectedCustomers.map((c, idx) => (
                <div key={idx} className="px-3 py-2 border-b border-gray-100 last:border-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{c.company_name}</p>
                  <p className="text-xs text-gray-400 truncate">{c.contact_person || ''}</p>
                  <p className="text-xs text-gray-400 truncate">{c.email}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function ToolbarButton({ icon, onClick, title }: { icon: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      className="p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 rounded transition"
      title={title}
      type="button"
    >
      {icon}
    </button>
  );
}
