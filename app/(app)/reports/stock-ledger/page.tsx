"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Report } from "@/components/report";
import { byKey, docUrl } from "@/lib/doctypes";
import { localISO } from "@/lib/format";

function Ledger() {
  const voucher = useSearchParams().get("voucher");
  const first = new Date(); first.setDate(1);
  return (
    <Report title="Buku Besar Stok" source="v_stock_ledger"
      initial={voucher ? {} : { posting_date_from: localISO(first) }}
      filters={[
        { key: "posting_date_from", label: "Dari Tanggal", type: "date", op: "gte" },
        { key: "posting_date_to", label: "Sampai Tanggal", type: "date", op: "lte" },
        { key: "warehouse_id", label: "Gudang", type: "link", target: "warehouses" },
        { key: "item_id", label: "Item", type: "link", target: "items" },
        { key: "q", label: "Cari No. Dokumen / Batch", type: "search", columns: ["voucher_no", "batch_no"] },
      ]}
      extra={(q) => (voucher ? q.eq("voucher_id", voucher) : q)}
      order={[{ column: "id", ascending: false }]}
      columns={[
        { key: "posting_date", label: "Tanggal", type: "date" },
        { key: "item_code", label: "Item" },
        { key: "warehouse_code", label: "Gudang" },
        { key: "batch_no", label: "Batch" },
        { key: "qty", label: "Qty", type: "float", tone: (r) => (Number(r.qty) < 0 ? "text-red-600" : "text-emerald-700") },
        { key: "qty_after", label: "Saldo", type: "float" },
        { key: "valuation_rate", label: "Harga", type: "currency" },
        { key: "stock_value_difference", label: "Nilai", type: "currency" },
        { key: "voucher_type", label: "Jenis", display: (r) => byKey[String(r.voucher_type)]?.label ?? String(r.voucher_type) },
        { key: "voucher_no", label: "No. Dokumen", href: (r) => (byKey[String(r.voucher_type)] ? docUrl(String(r.voucher_type), String(r.voucher_id)) : null) },
      ]} />
  );
}

export default function Page() {
  return <Suspense><Ledger /></Suspense>;
}
