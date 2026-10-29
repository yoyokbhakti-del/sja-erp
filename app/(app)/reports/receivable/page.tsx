"use client";
import { Report } from "@/components/report";
import { docUrl } from "@/lib/doctypes";

export default function Aging() {
  return (
    <Report title="Umur Piutang" source="v_receivable_aging"
      filters={[
        { key: "party_id", label: "Customer", type: "link", target: "customers" },
        { key: "q", label: "Cari invoice / nama", type: "search", columns: ["name", "party_name", "bucket"] },
      ]}
      order={[{ column: "due_date", ascending: true }]}
      totals={["grand_total", "outstanding_amount"]}
      columns={[
        { key: "name", label: "Invoice", href: (r) => docUrl("sales_invoices", String(r.id)) },
        { key: "party_name", label: "Customer" },
        { key: "posting_date", label: "Tanggal", type: "date" },
        { key: "due_date", label: "Jatuh Tempo", type: "date" },
        { key: "grand_total", label: "Nilai Invoice", type: "currency" },
        { key: "outstanding_amount", label: "Sisa", type: "currency" },
        { key: "days_overdue", label: "Hari Terlambat", type: "float",
          tone: (r) => (Number(r.days_overdue) > 60 ? "text-red-600 font-semibold" : Number(r.days_overdue) > 0 ? "text-amber-600" : "") },
        { key: "bucket", label: "Kelompok Umur" },
      ]} />
  );
}
