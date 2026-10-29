"use client";
import { Report } from "@/components/report";
import { byKey, docUrl } from "@/lib/doctypes";

export default function AuditLog() {
  return (
      <Report title="Audit Trail" source="audit_log"
        filters={[
          { key: "at_from", label: "Dari Tanggal", type: "date", op: "gte" },
          { key: "at_to", label: "Sampai Tanggal", type: "date", op: "lte" },
          { key: "q", label: "Cari tabel / user / aksi", type: "search", columns: ["table_name", "user_email", "action", "record_id"] },
        ]}
        extra={(q) => q.limit(500)}
        order={[{ column: "at", ascending: false }]}
        columns={[
          { key: "at", label: "Waktu", type: "datetime" },
          { key: "user_email", label: "User", display: (r) => String(r.user_email ?? "sistem") },
          { key: "action", label: "Aksi" },
          { key: "table_name", label: "Dokumen", display: (r) => byKey[String(r.table_name)]?.label ?? String(r.table_name) },
          { key: "record_id", label: "ID",
            display: (r) => String((r.new_data as Record<string, unknown>)?.name ?? (r.old_data as Record<string, unknown>)?.name ?? r.record_id ?? ""),
            href: (r) => (byKey[String(r.table_name)] && r.action !== "DELETE" ? docUrl(String(r.table_name), String(r.record_id)) : null) },
          { key: "changed", label: "Perubahan",
            display: (r) => r.changed
              ? Object.entries(r.changed as Record<string, [unknown, unknown]>).map(([k, [a, b]]) => `${k}: ${a ?? "∅"} → ${b ?? "∅"}`).join("; ")
              : r.action === "DELETE" ? "dihapus" : "" },
        ]} />
  );
}
