import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const db = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const results: string[] = [];

    // Step 1: Create the auto-rereserve trigger function
    const { error: e1 } = await db.rpc('exec_sql' as any, { sql: `
      CREATE OR REPLACE FUNCTION fn_auto_rereserve_on_batch_arrival()
      RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
      DECLARE
        v_product_id uuid;
        v_so_id uuid;
        v_total_stock numeric;
        v_total_reserved numeric;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          v_product_id := NEW.product_id;
        ELSIF TG_OP = 'UPDATE' THEN
          IF NEW.current_stock <= OLD.current_stock THEN RETURN NEW; END IF;
          v_product_id := NEW.product_id;
        ELSE RETURN NEW;
        END IF;

        FOR v_so_id IN
          SELECT DISTINCT so.id FROM sales_orders so
          JOIN sales_order_items soi ON soi.sales_order_id = so.id
          WHERE soi.product_id = v_product_id AND so.status = 'shortage'
          ORDER BY so.created_at ASC
        LOOP
          PERFORM fn_reserve_stock_for_so_v2(v_so_id);
        END LOOP;

        SELECT COALESCE(SUM(b.current_stock), 0),
          COALESCE((SELECT SUM(sr.reserved_quantity) FROM stock_reservations sr
            WHERE sr.product_id = v_product_id AND sr.is_released = false), 0)
        INTO v_total_stock, v_total_reserved
        FROM batches b WHERE b.product_id = v_product_id AND b.is_active = true;

        IF v_total_stock >= v_total_reserved THEN
          UPDATE import_requirements SET
            status = 'received',
            notes = COALESCE(notes || ' | ', '') || 'Auto-marked received: stock sufficient ' || now()::date::text
          WHERE product_id = v_product_id AND status IN ('pending', 'ordered');
        END IF;

        RETURN NEW;
      END; $$;
    ` });
    results.push(e1 ? 'trigger_fn error: ' + e1.message : 'trigger_fn created');

    // Step 2: Create trigger
    const { error: e2 } = await db.rpc('exec_sql' as any, { sql: `
      DROP TRIGGER IF EXISTS trg_auto_rereserve_on_batch_arrival ON batches;
      CREATE TRIGGER trg_auto_rereserve_on_batch_arrival
        AFTER INSERT OR UPDATE OF current_stock ON batches
        FOR EACH ROW EXECUTE FUNCTION fn_auto_rereserve_on_batch_arrival();
    ` });
    results.push(e2 ? 'trigger error: ' + e2.message : 'trigger created');

    // Step 3: Re-run reservations for all current shortage SOs
    const { data: shortSOs, error: e3 } = await db
      .from('sales_orders')
      .select('id, so_number')
      .eq('status', 'shortage');

    if (e3) {
      results.push('fetch shortage SOs error: ' + e3.message);
    } else {
      results.push(`Found ${shortSOs?.length || 0} shortage SOs`);
      for (const so of (shortSOs || [])) {
        const { data: res, error: err } = await db.rpc('fn_reserve_stock_for_so_v2', { p_so_id: so.id });
        results.push(`SO ${so.so_number}: ${err ? err.message : JSON.stringify(res?.[0])}`);
      }
    }

    // Step 4: Mark import_requirements as received where stock is sufficient
    const { data: products } = await db
      .from('product_stock_summary')
      .select('product_id, total_current_stock, product_name');

    let markedReceived = 0;
    for (const p of (products || [])) {
      const { data: reservations } = await db
        .from('stock_reservations')
        .select('reserved_quantity')
        .eq('product_id', p.product_id)
        .eq('is_released', false);

      const totalReserved = reservations?.reduce((s, r) => s + Number(r.reserved_quantity), 0) || 0;

      if (p.total_current_stock >= totalReserved) {
        const { data: updated } = await db
          .from('import_requirements')
          .update({
            status: 'received',
            notes: 'Auto-marked received: stock sufficient as of 2026-04-01'
          })
          .eq('product_id', p.product_id)
          .in('status', ['pending', 'ordered'])
          .select('id');

        if (updated?.length) {
          markedReceived += updated.length;
          results.push(`${p.product_name}: marked ${updated.length} import requirements as received`);
        }
      }
    }
    results.push(`Total import requirements marked received: ${markedReceived}`);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
