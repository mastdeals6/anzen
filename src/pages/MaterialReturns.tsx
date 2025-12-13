import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Layout } from '../components/Layout';
import { Plus, Eye, Trash2, PackageX, AlertTriangle } from 'lucide-react';
import { Modal } from '../components/Modal';
import { DataTable } from '../components/DataTable';

interface MaterialReturn {
  id: string;
  return_number: string;
  return_date: string;
  return_type: string;
  return_reason: string;
  status: string;
  customers: {
    company_name: string;
  };
  delivery_challans?: {
    challan_number: string;
  };
}

interface ReturnItem {
  product_id: string;
  batch_id: string;
  quantity_returned: number;
  original_quantity: number;
  condition: string;
  notes?: string;
}

interface ChallanItem {
  product_id: string;
  batch_id: string;
  quantity: number;
  products: {
    product_name: string;
    product_code: string;
  };
  batches: {
    batch_number: string;
  };
}

interface Customer {
  id: string;
  company_name: string;
}

interface DeliveryChallan {
  id: string;
  challan_number: string;
  challan_date: string;
  customer_id: string;
}

export default function MaterialReturns() {
  const { user, profile } = useAuth();
  const { t } = useLanguage();
  const [returns, setReturns] = useState<MaterialReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deliveryChallans, setDeliveryChallans] = useState<DeliveryChallan[]>([]);
  const [challanItems, setChallanItems] = useState<ChallanItem[]>([]);
  const [returnItems, setReturnItems] = useState<ReturnItem[]>([]);

  const [formData, setFormData] = useState({
    customer_id: '',
    original_dc_id: '',
    return_date: new Date().toISOString().split('T')[0],
    return_type: 'quality_issue',
    return_reason: '',
    notes: '',
  });

  useEffect(() => {
    loadReturns();
    loadCustomers();
  }, []);

  const loadReturns = async () => {
    try {
      const { data, error } = await supabase
        .from('material_returns')
        .select(`
          *,
          customers(company_name),
          delivery_challans(challan_number)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReturns(data || []);
    } catch (error) {
      console.error('Error loading returns:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('id, company_name')
        .eq('is_active', true)
        .order('company_name');

      if (error) throw error;
      setCustomers(data || []);
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const loadDeliveryChallans = async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from('delivery_challans')
        .select('id, challan_number, challan_date, customer_id')
        .eq('customer_id', customerId)
        .order('challan_date', { ascending: false });

      if (error) throw error;
      setDeliveryChallans(data || []);
    } catch (error) {
      console.error('Error loading delivery challans:', error);
    }
  };

  const loadChallanItems = async (challanId: string) => {
    try {
      const { data, error } = await supabase
        .from('delivery_challan_items')
        .select(`
          product_id,
          batch_id,
          quantity,
          products(product_name, product_code),
          batches(batch_number)
        `)
        .eq('challan_id', challanId);

      if (error) throw error;

      setChallanItems(data || []);

      const items: ReturnItem[] = (data || []).map((item) => ({
        product_id: item.product_id,
        batch_id: item.batch_id,
        quantity_returned: 0,
        original_quantity: item.quantity,
        condition: 'good',
        notes: '',
      }));

      setReturnItems(items);
    } catch (error) {
      console.error('Error loading challan items:', error);
    }
  };

  const handleCustomerChange = (customerId: string) => {
    setFormData({ ...formData, customer_id: customerId, original_dc_id: '' });
    setChallanItems([]);
    setReturnItems([]);
    if (customerId) {
      loadDeliveryChallans(customerId);
    } else {
      setDeliveryChallans([]);
    }
  };

  const handleChallanChange = (challanId: string) => {
    setFormData({ ...formData, original_dc_id: challanId });
    if (challanId) {
      loadChallanItems(challanId);
    } else {
      setChallanItems([]);
      setReturnItems([]);
    }
  };

  const updateReturnItem = (index: number, field: keyof ReturnItem, value: any) => {
    const updated = [...returnItems];
    updated[index] = { ...updated[index], [field]: value };
    setReturnItems(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.customer_id || !formData.original_dc_id || !formData.return_reason) {
      alert('Please complete all required fields');
      return;
    }

    const validItems = returnItems.filter(item => item.quantity_returned > 0);
    if (validItems.length === 0) {
      alert('Please enter at least one item with return quantity');
      return;
    }

    const hasInvalidQuantities = validItems.some(
      item => item.quantity_returned > item.original_quantity
    );
    if (hasInvalidQuantities) {
      alert('Return quantity cannot exceed original quantity');
      return;
    }

    try {
      const { data: returnData, error: returnError } = await supabase
        .from('material_returns')
        .insert({
          customer_id: formData.customer_id,
          original_dc_id: formData.original_dc_id,
          return_date: formData.return_date,
          return_type: formData.return_type,
          return_reason: formData.return_reason,
          notes: formData.notes,
          status: 'pending_approval',
          created_by: user?.id,
        })
        .select()
        .single();

      if (returnError) throw returnError;

      const itemsToInsert = validItems.map(item => ({
        return_id: returnData.id,
        product_id: item.product_id,
        batch_id: item.batch_id,
        quantity_returned: item.quantity_returned,
        original_quantity: item.original_quantity,
        condition: item.condition,
        notes: item.notes,
      }));

      const { error: itemsError } = await supabase
        .from('material_return_items')
        .insert(itemsToInsert);

      if (itemsError) throw itemsError;

      alert('Material return created successfully. Pending approval.');
      setModalOpen(false);
      resetForm();
      loadReturns();
    } catch (error: any) {
      console.error('Error creating return:', error);
      alert(error.message || 'Failed to create material return');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this material return?')) return;

    try {
      const { error } = await supabase
        .from('material_returns')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadReturns();
    } catch (error) {
      console.error('Error deleting return:', error);
      alert('Failed to delete material return');
    }
  };

  const resetForm = () => {
    setFormData({
      customer_id: '',
      original_dc_id: '',
      return_date: new Date().toISOString().split('T')[0],
      return_type: 'quality_issue',
      return_reason: '',
      notes: '',
    });
    setChallanItems([]);
    setReturnItems([]);
    setDeliveryChallans([]);
  };

  const canManage = profile?.role === 'admin' || profile?.role === 'sales' || profile?.role === 'manager';

  const columns = [
    {
      key: 'return_number',
      label: 'Return #',
      render: (ret: MaterialReturn) => ret.return_number || 'Pending'
    },
    {
      key: 'return_date',
      label: 'Date',
      render: (ret: MaterialReturn) => new Date(ret.return_date).toLocaleDateString()
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (ret: MaterialReturn) => ret.customers?.company_name || 'N/A'
    },
    {
      key: 'dc_number',
      label: 'Original DC',
      render: (ret: MaterialReturn) => ret.delivery_challans?.challan_number || 'N/A'
    },
    {
      key: 'return_type',
      label: 'Type',
      render: (ret: MaterialReturn) => ret.return_type.replace('_', ' ')
    },
    {
      key: 'status',
      label: 'Status',
      render: (ret: MaterialReturn) => (
        <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
          ret.status === 'approved' ? 'bg-green-100 text-green-800' :
          ret.status === 'rejected' ? 'bg-red-100 text-red-800' :
          ret.status === 'completed' ? 'bg-blue-100 text-blue-800' :
          'bg-yellow-100 text-yellow-800'
        }`}>
          {ret.status.replace('_', ' ')}
        </span>
      )
    },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Material Returns</h1>
            <p className="text-gray-600 mt-1">Manage physical returns before invoicing</p>
          </div>
          {canManage && (
            <button
              onClick={() => {
                resetForm();
                setModalOpen(true);
              }}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
            >
              <Plus className="w-5 h-5" />
              Create Material Return
            </button>
          )}
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-yellow-800">
            <p className="font-medium">Material Returns vs Credit Notes:</p>
            <p className="mt-1">Use Material Returns for physical goods returned BEFORE invoice is made (e.g., DC 100kg → return 20kg). For returns AFTER invoice filing, use Credit Notes.</p>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={returns}
          loading={loading}
          actions={canManage ? (ret) => (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDelete(ret.id)}
                className="p-1 text-red-600 hover:bg-red-50 rounded"
                title="Delete Return"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ) : undefined}
        />

        <Modal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            resetForm();
          }}
          title="Create Material Return"
          size="xl"
        >
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <PackageX className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">How Material Returns Work:</p>
                  <ol className="mt-1 list-decimal list-inside space-y-1">
                    <li>Select the customer who is returning goods</li>
                    <li>Choose the Delivery Challan that was originally dispatched</li>
                    <li>The system will show all products, batches, and quantities from that DC</li>
                    <li>Enter the quantity being returned for each item</li>
                    <li>After approval, stock will be added back to inventory</li>
                  </ol>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer *
                </label>
                <select
                  value={formData.customer_id}
                  onChange={(e) => handleCustomerChange(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  <option value="">Select Customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.company_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Original Delivery Challan *
                </label>
                <select
                  value={formData.original_dc_id}
                  onChange={(e) => handleChallanChange(e.target.value)}
                  required
                  disabled={!formData.customer_id}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:bg-gray-100"
                >
                  <option value="">Select Delivery Challan</option>
                  {deliveryChallans.map((dc) => (
                    <option key={dc.id} value={dc.id}>
                      {dc.challan_number} - {new Date(dc.challan_date).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {formData.customer_id && deliveryChallans.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1">No delivery challans found for this customer</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Return Date *
                </label>
                <input
                  type="date"
                  value={formData.return_date}
                  onChange={(e) => setFormData({ ...formData, return_date: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Return Type *
                </label>
                <select
                  value={formData.return_type}
                  onChange={(e) => setFormData({ ...formData, return_type: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  <option value="quality_issue">Quality Issue</option>
                  <option value="wrong_product">Wrong Product</option>
                  <option value="excess_quantity">Excess Quantity</option>
                  <option value="damaged">Damaged</option>
                  <option value="expired">Expired</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Return Reason *
              </label>
              <textarea
                value={formData.return_reason}
                onChange={(e) => setFormData({ ...formData, return_reason: e.target.value })}
                required
                rows={3}
                placeholder="Explain why the goods are being returned..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            {challanItems.length > 0 && (
              <div className="border-t pt-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Items from Delivery Challan</h4>
                <p className="text-sm text-gray-600 mb-4">Enter the quantity being returned for each item. Leave as 0 if not returning that item.</p>

                <div className="space-y-3">
                  {challanItems.map((item, index) => {
                    const returnItem = returnItems[index];
                    if (!returnItem) return null;

                    return (
                      <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="grid grid-cols-12 gap-4">
                          <div className="col-span-4">
                            <label className="block text-xs text-gray-600 mb-1">Product</label>
                            <div className="text-sm font-medium text-gray-900">
                              {item.products.product_name}
                            </div>
                            <div className="text-xs text-gray-500">
                              Code: {item.products.product_code}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Batch</label>
                            <div className="text-sm font-medium text-gray-900">
                              {item.batches.batch_number}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Dispatched Qty</label>
                            <div className="text-sm font-medium text-blue-600">
                              {item.quantity}
                            </div>
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Return Qty</label>
                            <input
                              type="number"
                              step="0.01"
                              value={returnItem.quantity_returned || ''}
                              onChange={(e) => updateReturnItem(index, 'quantity_returned', parseFloat(e.target.value) || 0)}
                              max={item.quantity}
                              min="0"
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                              placeholder="0"
                            />
                            {returnItem.quantity_returned > item.quantity && (
                              <p className="text-xs text-red-600 mt-1">Cannot exceed {item.quantity}</p>
                            )}
                          </div>

                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">Condition</label>
                            <select
                              value={returnItem.condition}
                              onChange={(e) => updateReturnItem(index, 'condition', e.target.value)}
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                            >
                              <option value="good">Good</option>
                              <option value="damaged">Damaged</option>
                              <option value="expired">Expired</option>
                              <option value="unusable">Unusable</option>
                            </select>
                          </div>
                        </div>

                        {returnItem.quantity_returned > 0 && (
                          <div className="mt-3">
                            <label className="block text-xs text-gray-600 mb-1">Notes for this item (optional)</label>
                            <input
                              type="text"
                              value={returnItem.notes || ''}
                              onChange={(e) => updateReturnItem(index, 'notes', e.target.value)}
                              placeholder="Any additional notes about this return item..."
                              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {challanItems.length === 0 && formData.original_dc_id && (
              <div className="text-center py-8 text-gray-500">
                <PackageX className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                <p>No items found in the selected delivery challan</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Additional Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                placeholder="Any additional information..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>

            <div className="flex justify-end gap-3 pt-6 border-t">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                Create Material Return
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
