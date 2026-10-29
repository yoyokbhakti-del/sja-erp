"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Report } from "@/components/report";
import { byKey, docUrl } from "@/lib/doctypes";
import { localISO } from "@/lib/format";

function GL() {
  const sp = useSearchParams();
  const voucher = sp.get("voucher");
  const account = sp.get("account");
  const first = new Date(); first.setDate(1);
  return (
    <Report title="Buku Besar" source="v_general_ledger"
      initial={voucher ? {} : { posting_date_from: localISO(first), ...(account ? { account_id: account } : {}) }}
      filters={[
        { key: "posting_date_from", label: "Dari Tanggal", type: "date", op: "gte" },
        { key: "posting_date_to", label: "Sampai Tanggal", type: "date", op: "lte" },
        { key: "account_id", label: "Akun", type: "link", target: "accounts" },
        { key: "q", label: "Cari No. Dokumen / Customer / Supplier", type: "search", columns: ["voucher_no", "party_name", "remarks"] },
      ]}
      extra={(q) => (voucher ? q.eq("voucher_id", voucher) : q.eq("is_cancelled", false))}
      order={[{ column: "posting_date", ascending: true }, { column: "id", ascending: true }]}
      totals={["debit", "credit"]}
      columns={[
        { key: "posting_date", label: "Tanggal", type: "date" },
        { key: "account_code", label: "Kode" },
        { key: "account_name", label: "Akun" },
        { key: "debit", label: "Debit", type: "currency" },
        { key: "credit", label: "Kredit", type: "currency" },
        { key: "party_name", label: "Customer / Supplier" },
        { key: "voucher_type", label: "Jenis", display: (r) => byKey[String(r.voucher_type)]?.label ?? String(r.voucher_type) },
        { key: "voucher_no", label: "No. Dokumen", href: (r) => (byKey[String(r.voucher_type)] ? docUrl(String(r.voucher_type), String(r.voucher_id)) : null) },
        { key: "remarks", label: "Keterangan" },
      ]} />
  );
}
export default function Page() { return <Suspense><GL /></Suspense>; }
