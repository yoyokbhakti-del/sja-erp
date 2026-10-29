"use client";
import { Report } from "@/components/report";
import { docUrl } from "@/lib/doctypes";

export default function BatchStock() {
  return (
    <Report title="Stok per Batch & Kedaluwarsa" source="v_batch_stock"
      filters={[
        { key: "warehouse_id", label: "Gudang", type: "link", target: "warehouses" },
        { key: "item_id", label: "Item", type: "link", target: "items" },
        { key: "q", label: "Cari Batch / Item", type: "search", columns: ["batch_no", "item_code", "item_name"] },
      ]}
      extra={(q) => q.gt("qty", 0)}
      order={[{ column: "expiry_date", ascending: true }]}
      columns={[
        { key: "item_code", label: "Kode", href: (r) => docUrl("items", String(r.item_id)) },
        { key: "item_name", label: "Nama Item" },
        { key: "warehouse_code", label: "Gudang" },
        { key: "batch_no", label: "No. Batch" },
        { key: "mfg_date", label: "Tgl. Produksi", type: "date" },
        { key: "expiry_date", label: "Kedaluwarsa", type: "date",
          tone: (r) => (Number(r.days_to_expiry) < 0 ? "text-red-600 font-semibold" : Number(r.days_to_expiry) <= 90 ? "text-amber-600" : "") },
        { key: "days_to_expiry", label: "Sisa Hari", type: "float" },
        { key: "qty", label: "Qty", type: "float" },
        { key: "stock_uom", label: "Satuan" },
      ]} />
  );
}
