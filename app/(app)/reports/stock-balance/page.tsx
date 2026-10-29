"use client";
import { Report } from "@/components/report";
import { docUrl } from "@/lib/doctypes";

export default function StockBalance() {
  return (
    <Report title="Saldo Stok" source="v_stock_balance"
      filters={[
        { key: "warehouse_id", label: "Gudang", type: "link", target: "warehouses" },
        { key: "item_id", label: "Item", type: "link", target: "items" },
        { key: "q", label: "Cari", type: "search", columns: ["item_code", "item_name"] },
      ]}
      extra={(q) => q.neq("actual_qty", 0)}
      order={[{ column: "item_code", ascending: true }, { column: "warehouse_code", ascending: true }]}
      totals={["stock_value"]}
      columns={[
        { key: "item_code", label: "Kode", href: (r) => docUrl("items", String(r.item_id)) },
        { key: "item_name", label: "Nama Item" },
        { key: "item_type", label: "Jenis" },
        { key: "warehouse_code", label: "Gudang" },
        { key: "actual_qty", label: "Qty", type: "float",
          tone: (r) => (Number(r.actual_qty) < Number(r.min_qty) ? "text-red-600" : "") },
        { key: "stock_uom", label: "Satuan" },
        { key: "valuation_rate", label: "Harga Rata-rata", type: "currency" },
        { key: "stock_value", label: "Nilai Stok", type: "currency" },
      ]} />
  );
}
